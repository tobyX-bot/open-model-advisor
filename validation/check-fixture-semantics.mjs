import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const V1_PATH = path.join(ROOT, "fixtures", "computer_setups_200.json");
const V1_1_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json");
const V1_SHA256 = "e9e96bf82cde212d1f8d3ea71ac5b6184c138e355eb3a1cee07d921d1064b17b";

const ABSENT_GPU_EVIDENCE_IDS = ["user-040", "user-069", "user-110", "user-200"];
const EXPLICIT_NVIDIA_IDS = ["user-017", "user-050", "user-090", "user-143", "user-183"];
const CORRECTED_IDS = new Set([...ABSENT_GPU_EVIDENCE_IDS, ...EXPLICIT_NVIDIA_IDS]);
const APPLE_INFERENCE_ID = "user-152";

const ALLOWED_ISSUE_CODES = new Set([
  "conflict.ram",
  "conflict.vram",
  "unknown.cpu",
  "unknown.gpuModel",
  "missing.ram",
  "missing.vram",
  "missing.storage",
  "missing.gpuVendor",
  "missing.gpuModel"
]);
const ENUM_EVIDENCE = {
  os: {
    windows: ["Windows"],
    macos: ["macOS"],
    linux: ["Linux"]
  },
  deviceType: {
    laptop: ["laptop", "笔记本", "筆電", "laptop 笔记本"],
    desktop: ["desktop PC", "desktop 台式机", "台式机", "台式電腦"],
    workstation: ["workstation", "工作站", "workstation 工作站"],
    server: ["server", "服务器", "伺服器", "server 服务器"]
  },
  task: {
    "chat-llm": ["chat and writing assistant", "聊天写作助手", "聊天寫作助手", "chat / 写作助手"],
    "coding-llm": ["coding assistant", "编程助手", "編程助手", "coding / 編程助手"],
    "image-generation": ["image generation with Stable Diffusion", "Stable Diffusion 图像生成", "Stable Diffusion 圖像生成", "Stable Diffusion / 图像生成"],
    "speech-to-text": ["speech-to-text transcription", "语音转文字", "語音轉文字", "transcription / 語音轉文字"],
    embeddings: ["RAG and semantic search", "RAG 向量搜索", "RAG / 向量 search"]
  }
};
const NO_GPU_EVIDENCE = ["no dedicated GPU", "无独立显卡", "無獨立顯卡"];

const errors = [];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${key}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function exactKeys(actual, expected, message) {
  const actualKeys = actual && typeof actual === "object" && !Array.isArray(actual)
    ? Object.keys(actual).sort()
    : [];
  const expectedKeys = [...expected].sort();
  expect(canonical(actualKeys) === canonical(expectedKeys), `${message}: expected [${expectedKeys.join(", ")}], found [${actualKeys.join(", ")}]`);
}

function normalizedEvidence(value) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesControlledPhrase(value, phrases) {
  const normalized = normalizedEvidence(value);
  return phrases.some((phrase) => normalized === normalizedEvidence(phrase));
}

function isNoGpuEvidence(value) {
  return matchesControlledPhrase(value, NO_GPU_EVIDENCE);
}

function containsExpectedNumber(value, expected) {
  const escaped = String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\d.])${escaped}(?:\\.0+)?(?=$|[^\\d.])`).test(normalizedEvidence(value));
}

function hasFieldContext(value, field) {
  const normalized = normalizedEvidence(value);
  if (field === "ram") return /\bram\b|\b(?:unified\s+)?memory\b|内存|统一内存|記憶體|統一記憶體/.test(normalized)
    && !/\bvram\b|显存|顯存|\bssd\b|\bdisk\b|硬盘|硬碟/.test(normalized);
  if (field === "vram") return /\bvram\b|显存|顯存/.test(normalized)
    && !/\bram\b|内存|统一内存|記憶體|統一記憶體|\bssd\b|\bdisk\b|硬盘|硬碟/.test(normalized);
  if (field === "storage") return /\bssd\b|\bdisk\b|硬盘|硬碟|固态硬盘|固態硬碟/.test(normalized)
    && !/\bram\b|\bvram\b|内存|記憶體|显存|顯存/.test(normalized);
  return false;
}

function matchesGpuVendor(value, expected) {
  const normalized = normalizedEvidence(value);
  if (expected === "nvidia") return /\bnvidia\b/.test(normalized);
  if (expected === "amd") return /\bamd\s+radeon\b|\bradeon\b/.test(normalized);
  if (expected === "intel") return /\bintel\s+(?:arc|iris)\b/.test(normalized);
  if (expected === "apple") return /\bapple\b/.test(normalized);
  if (expected === "none") return isNoGpuEvidence(value);
  return false;
}

function isFieldSemanticEvidence(record, field, value) {
  const expected = record.parserExpected.fields[field];
  if (["os", "deviceType", "task"].includes(field)) {
    return matchesControlledPhrase(value, ENUM_EVIDENCE[field]?.[expected] || []);
  }
  if (field === "cpuModel") {
    return normalizedEvidence(value).includes(normalizedEvidence(String(expected)));
  }
  if (field === "gpuModel") {
    if (expected === "No dedicated GPU") return isNoGpuEvidence(value);
    return normalizedEvidence(value).includes(normalizedEvidence(String(expected)));
  }
  if (field === "gpuVendor") return matchesGpuVendor(value, expected);
  if (["ram", "vram", "storage"].includes(field)) {
    // An explicit no-dedicated-GPU statement is canonical evidence of zero dedicated VRAM.
    if (field === "vram" && expected === 0 && record.profile.gpuVendor === "none" && isNoGpuEvidence(value)) return true;
    return containsExpectedNumber(value, expected) && hasFieldContext(value, field);
  }
  return false;
}

function parserLabels(parserExpected) {
  return {
    fields: parserExpected?.fields,
    ambiguousFields: parserExpected?.ambiguousFields,
    allowedInferredFields: parserExpected?.allowedInferredFields,
    shouldWarn: parserExpected?.shouldWarn
  };
}

function expectedCorrectedLabels(record) {
  const labels = structuredClone(parserLabels(record.parserExpected));
  if (ABSENT_GPU_EVIDENCE_IDS.includes(record.id)) {
    delete labels.fields.gpuVendor;
    delete labels.fields.gpuModel;
    labels.ambiguousFields.push("gpuVendor", "gpuModel");
  }
  if (EXPLICIT_NVIDIA_IDS.includes(record.id)) {
    labels.fields.gpuVendor = "nvidia";
    labels.ambiguousFields = labels.ambiguousFields.filter((field) => field !== "gpuVendor");
  }
  return labels;
}

function expectedStatusCode(record, field) {
  if (["contradiction-a", "contradiction-b"].includes(record.adversarialKind) && ["ram", "vram"].includes(field)) {
    return { status: "conflict", code: `conflict.${field}` };
  }
  if (record.adversarialKind === "unknown-cpu" && field === "cpuModel") {
    return { status: "unknown", code: "unknown.cpu" };
  }
  if (record.adversarialKind === "unknown-gpu" && field === "gpuModel") {
    return { status: "unknown", code: "unknown.gpuModel" };
  }
  if (record.adversarialKind === "omitted-memory") {
    if (["ram", "vram", "storage"].includes(field)) return { status: "missing", code: `missing.${field}` };
    if (ABSENT_GPU_EVIDENCE_IDS.includes(record.id) && ["gpuVendor", "gpuModel"].includes(field)) {
      return { status: "missing", code: `missing.${field}` };
    }
  }
  return null;
}

function compareNonOracleData(v1, v1_1) {
  const permittedMetadataAdditions = new Set(["oracleVersion", "provenance", "erratum"]);
  Object.entries(v1.metadata).forEach(([key, value]) => {
    expect(canonical(v1_1.metadata?.[key]) === canonical(value), `metadata.${key} changed from V1`);
  });
  Object.keys(v1_1.metadata || {}).forEach((key) => {
    expect(key in v1.metadata || permittedMetadataAdditions.has(key), `metadata.${key} is an unsupported V1.1 addition`);
  });

  const v1ById = new Map(v1.records.map((record) => [record.id, record]));
  const v1_1ById = new Map(v1_1.records.map((record) => [record.id, record]));
  expect(v1ById.size === v1.records.length, "V1 contains duplicate record IDs");
  expect(v1_1ById.size === v1_1.records.length, "V1.1 contains duplicate record IDs");
  expect(canonical([...v1ById.keys()]) === canonical([...v1_1ById.keys()]), "V1.1 record IDs or ordering changed");

  v1ById.forEach((record, id) => {
    const derivative = v1_1ById.get(id);
    if (!derivative) return;
    const sourceNonOracle = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "parserExpected"));
    const derivativeNonOracle = Object.fromEntries(Object.entries(derivative).filter(([key]) => key !== "parserExpected"));
    expect(canonical(derivativeNonOracle) === canonical(sourceNonOracle), `${id}: a non-oracle record property changed`);

    const expectedLabels = CORRECTED_IDS.has(id) ? expectedCorrectedLabels(record) : parserLabels(record.parserExpected);
    expect(canonical(parserLabels(derivative.parserExpected)) === canonical(expectedLabels), `${id}: unexpected parser oracle label change`);
  });
}

function checkMetadata(dataset) {
  expect(dataset.metadata?.oracleVersion === "1.1", "metadata.oracleVersion must be 1.1");
  expect(dataset.metadata?.provenance?.sourceFixture === "computer_setups_200.json", "metadata.provenance.sourceFixture must identify V1");
  expect(dataset.metadata?.provenance?.sourceSha256 === V1_SHA256, "metadata.provenance.sourceSha256 must match frozen V1");
  expect(dataset.metadata?.provenance?.derivation === "oracle-only", "metadata.provenance.derivation must be oracle-only");

  const erratum = dataset.metadata?.erratum;
  exactKeys(erratum, ["absentGpuEvidence", "explicitNvidiaUnknownModel"], "metadata.erratum correction classes");
  expect(canonical(erratum?.absentGpuEvidence?.recordIds) === canonical(ABSENT_GPU_EVIDENCE_IDS), "absentGpuEvidence record IDs are incorrect");
  expect(canonical(erratum?.explicitNvidiaUnknownModel?.recordIds) === canonical(EXPLICIT_NVIDIA_IDS), "explicitNvidiaUnknownModel record IDs are incorrect");
}

function checkParserSemantics(record) {
  const expected = record.parserExpected || {};
  const fields = expected.fields || {};
  const ambiguousFields = expected.ambiguousFields || [];
  const inferredFields = expected.allowedInferredFields || [];
  const normalizedText = record.setupText.normalize("NFKC");

  expect(Array.isArray(ambiguousFields), `${record.id}: ambiguousFields must be an array`);
  expect(new Set(ambiguousFields).size === ambiguousFields.length, `${record.id}: ambiguousFields contains duplicates`);
  ambiguousFields.forEach((field) => {
    expect(!(field in fields), `${record.id}: ambiguous field ${field} also appears in expected fields`);
    expect(!inferredFields.includes(field), `${record.id}: ambiguous field ${field} is also inferred`);
  });

  exactKeys(expected.sourceEvidence, Object.keys(fields), `${record.id}: sourceEvidence fields`);
  Object.keys(fields).forEach((field) => {
    const evidence = expected.sourceEvidence?.[field];
    expect(Array.isArray(evidence) && evidence.length > 0, `${record.id}: expected observable field ${field} lacks source evidence`);
    if (!Array.isArray(evidence)) return;
    evidence.forEach((value) => {
      expect(typeof value === "string" && value.length > 0, `${record.id}: ${field} source evidence must be a non-empty string`);
      if (typeof value === "string") {
        expect(normalizedText.includes(value), `${record.id}: ${field} source evidence is absent from NFKC-normalized setupText: ${JSON.stringify(value)}`);
        expect(isFieldSemanticEvidence(record, field, value), `${record.id}: ${field} source evidence is not valid for expected value ${JSON.stringify(fields[field])}: ${JSON.stringify(value)}`);
      }
    });
  });
  inferredFields.forEach((field) => {
    expect(!(field in (expected.sourceEvidence || {})), `${record.id}: inferred field ${field} must not have fabricated source evidence`);
  });

  exactKeys(expected.fieldStatuses, ambiguousFields, `${record.id}: fieldStatuses fields`);
  exactKeys(expected.expectedIssueCodes, ambiguousFields, `${record.id}: expectedIssueCodes fields`);
  ambiguousFields.forEach((field) => {
    const status = expected.fieldStatuses?.[field];
    const code = expected.expectedIssueCodes?.[field];
    expect(typeof status === "string" && ["conflict", "unknown", "missing"].includes(status), `${record.id}: ${field} has invalid field status ${JSON.stringify(status)}`);
    expect(typeof code === "string" && ALLOWED_ISSUE_CODES.has(code), `${record.id}: ${field} has invalid issue code ${JSON.stringify(code)}`);
    const required = expectedStatusCode(record, field);
    expect(required !== null, `${record.id}: ${field} is not validly ambiguous for adversarial kind ${JSON.stringify(record.adversarialKind)}`);
    if (required) {
      expect(status === required.status, `${record.id}: ${field} must use status ${required.status}, found ${JSON.stringify(status)}`);
      expect(code === required.code, `${record.id}: ${field} must use issue code ${required.code}, found ${JSON.stringify(code)}`);
    }
  });
}

function checkCorrections(dataset) {
  const byId = new Map(dataset.records.map((record) => [record.id, record]));
  ABSENT_GPU_EVIDENCE_IDS.forEach((id) => {
    const expected = byId.get(id)?.parserExpected;
    expect(expected?.ambiguousFields.includes("gpuVendor"), `${id}: absent gpuVendor must remain ambiguous`);
    expect(expected?.ambiguousFields.includes("gpuModel"), `${id}: absent gpuModel must remain ambiguous`);
    expect(!("gpuVendor" in (expected?.fields || {})), `${id}: absent gpuVendor must not be resolved`);
    expect(!("gpuModel" in (expected?.fields || {})), `${id}: absent gpuModel must not be resolved`);
  });
  EXPLICIT_NVIDIA_IDS.forEach((id) => {
    const expected = byId.get(id)?.parserExpected;
    expect(expected?.fields?.gpuVendor === "nvidia", `${id}: explicit NVIDIA must remain a stable expected field`);
    expect(!expected?.ambiguousFields.includes("gpuVendor"), `${id}: explicit NVIDIA must not remain ambiguous`);
    expect(canonical(expected?.ambiguousFields) === canonical(["gpuModel"]), `${id}: only gpuModel may remain unknown`);
    expect(expected?.sourceEvidence?.gpuVendor?.some((value) => value === "NVIDIA"), `${id}: NVIDIA source evidence must be exact`);
  });

  const appleExpected = byId.get(APPLE_INFERENCE_ID)?.parserExpected;
  expect(canonical(appleExpected?.allowedInferredFields) === canonical(["gpuVendor", "gpuModel"]), `${APPLE_INFERENCE_ID}: explicit Apple M2 Max inference must be preserved`);
  expect(appleExpected?.ambiguousFields.includes("vram"), `${APPLE_INFERENCE_ID}: omitted Apple VRAM must remain ambiguous`);
}

if (!fs.existsSync(V1_1_PATH)) {
  console.error(`Fixture semantics check failed: missing ${V1_1_PATH}`);
  process.exit(1);
}

const v1 = JSON.parse(fs.readFileSync(V1_PATH, "utf8"));
const v1_1 = JSON.parse(fs.readFileSync(V1_1_PATH, "utf8"));

expect(Array.isArray(v1.records) && v1.records.length === 200, "V1 must contain 200 records");
expect(Array.isArray(v1_1.records) && v1_1.records.length === 200, "V1.1 must contain 200 records");
checkMetadata(v1_1);
compareNonOracleData(v1, v1_1);
v1_1.records.forEach(checkParserSemantics);
checkCorrections(v1_1);

if (errors.length) {
  console.error(`Fixture semantics check failed with ${errors.length} issue(s):`);
  errors.slice(0, 80).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

const ambiguousRecords = v1_1.records.filter((record) => record.parserExpected.ambiguousFields.length > 0);
console.log(`PASS V1.1 fixture semantics: ${v1_1.records.length} records, ${CORRECTED_IDS.size} corrected oracle labels, ${ambiguousRecords.length} ambiguous records.`);
