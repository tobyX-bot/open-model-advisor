import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const V1_PATH = path.join(ROOT, "fixtures", "computer_setups_200.json");
const V1_1_PATH = path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json");
const V1_SHA256 = "e9e96bf82cde212d1f8d3ea71ac5b6184c138e355eb3a1cee07d921d1064b17b";

const ABSENT_GPU_EVIDENCE_IDS = ["user-040", "user-069", "user-110", "user-200"];
const EXPLICIT_NVIDIA_IDS = ["user-017", "user-050", "user-090", "user-143", "user-183"];
const CORRECTED_IDS = new Set([...ABSENT_GPU_EVIDENCE_IDS, ...EXPLICIT_NVIDIA_IDS]);
const APPLE_INFERENCE_ID = "user-152";

const VALID_STATUS_CODE_PAIRS = new Map([
  ["ram", new Map([["conflict", "conflict.ram"], ["missing", "missing.ram"]])],
  ["vram", new Map([["conflict", "conflict.vram"], ["missing", "missing.vram"]])],
  ["storage", new Map([["missing", "missing.storage"]])],
  ["cpuModel", new Map([["unknown", "unknown.cpu"]])],
  ["gpuVendor", new Map([["missing", "missing.gpuVendor"]])],
  ["gpuModel", new Map([["unknown", "unknown.gpuModel"], ["missing", "missing.gpuModel"]])]
]);
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
    const expectedCode = VALID_STATUS_CODE_PAIRS.get(field)?.get(status);
    expect(expectedCode === code, `${record.id}: ${field} status ${JSON.stringify(status)} does not match issue code ${JSON.stringify(code)}`);
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
