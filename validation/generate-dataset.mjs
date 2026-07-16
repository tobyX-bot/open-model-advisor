import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(ROOT, "fixtures", "computer_setups_200.json");
const OUTPUT = path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json");
const SOURCE_SHA256 = "e9e96bf82cde212d1f8d3ea71ac5b6184c138e355eb3a1cee07d921d1064b17b";

const ABSENT_GPU_EVIDENCE_IDS = ["user-040", "user-069", "user-110", "user-200"];
const EXPLICIT_NVIDIA_IDS = ["user-017", "user-050", "user-090", "user-143", "user-183"];
const IMMUTABLE_RECORD_PROPERTIES = [
  "id",
  "seed",
  "fold",
  "languageStyle",
  "scenarioClass",
  "adversarialKind",
  "hardwareTier",
  "equivalenceGroup",
  "setupText",
  "profile",
  "journey",
  "policyExpected"
];

const deviceEvidence = {
  en: { laptop: "laptop", desktop: "desktop PC", workstation: "workstation", server: "server" },
  "zh-CN": { laptop: "笔记本", desktop: "台式机", workstation: "工作站", server: "服务器" },
  "zh-TW": { laptop: "筆電", desktop: "台式電腦", workstation: "工作站", server: "伺服器" },
  mixed: { laptop: "laptop 笔记本", desktop: "desktop 台式机", workstation: "workstation 工作站", server: "server 服务器" }
};

const taskEvidence = {
  en: {
    "chat-llm": "chat and writing assistant",
    "coding-llm": "coding assistant",
    "image-generation": "image generation with Stable Diffusion",
    "speech-to-text": "speech-to-text transcription",
    embeddings: "RAG and semantic search"
  },
  "zh-CN": {
    "chat-llm": "聊天写作助手",
    "coding-llm": "编程助手",
    "image-generation": "Stable Diffusion 图像生成",
    "speech-to-text": "语音转文字",
    embeddings: "RAG 向量搜索"
  },
  "zh-TW": {
    "chat-llm": "聊天寫作助手",
    "coding-llm": "編程助手",
    "image-generation": "Stable Diffusion 圖像生成",
    "speech-to-text": "語音轉文字",
    embeddings: "RAG 向量搜索"
  },
  mixed: {
    "chat-llm": "chat / 写作助手",
    "coding-llm": "coding / 編程助手",
    "image-generation": "Stable Diffusion / 图像生成",
    "speech-to-text": "transcription / 語音轉文字",
    embeddings: "RAG / 向量 search"
  }
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${key}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedCandidate(text, candidates, field, id) {
  const normalizedText = text.normalize("NFKC");
  for (const candidate of candidates) {
    const normalized = String(candidate).normalize("NFKC");
    if (normalizedText.includes(normalized)) return normalized;
  }
  throw new Error(`${id}: no exact source evidence found for ${field}`);
}

function noGpuCandidates(languageStyle) {
  if (languageStyle === "zh-CN") return ["无独立显卡"];
  if (languageStyle === "zh-TW") return ["無獨立顯卡"];
  return ["no dedicated GPU"];
}

function ramCandidates(value) {
  return [
    `${value}GB RAM`,
    `RAM: ${value}GB`,
    `RAM:${value}GB`,
    `RAM ${value}GB`,
    `about ${value} gigs of memory`,
    `${value}GB unified memory`,
    `unified memory ${value}GB`,
    `${value}GB 内存`,
    `内存大概 ${value}GB`,
    `内存 ${value}GB`,
    `${value}GB 统一内存`,
    `${value}GB 記憶體`,
    `記憶體大約 ${value}GB`,
    `記憶體 ${value}GB`,
    `${value}GB 統一記憶體`
  ];
}

function vramCandidates(record, value) {
  if (record.profile.gpuVendor === "none") return noGpuCandidates(record.languageStyle);
  return [`${value}GB VRAM`, `${value}GB 显存`, `${value}GB 顯存`];
}

function storageCandidates(value) {
  return [
    `${value}GB SSD`,
    `SSD free: ${value}GB`,
    `SSD free ${value}GB`,
    `SSD ${value}GB`,
    `${value}GB free on the SSD`,
    `disk free ${value}GB`,
    `${value}GB 固态硬盘`,
    `硬盘还剩 ${value}GB`,
    `硬盘 ${value}GB`,
    `SSD 可用: ${value}GB`,
    `SSD 可用:${value}GB`,
    `${value}GB 固態硬碟`,
    `硬碟剩 ${value}GB`,
    `硬碟 ${value}GB`
  ];
}

function evidenceCandidates(record, field, value) {
  if (field === "os") return [{ windows: "Windows", macos: "macOS", linux: "Linux" }[value]];
  if (field === "deviceType") return [deviceEvidence[record.languageStyle][value]];
  if (field === "cpuModel") return [value];
  if (field === "gpuVendor") {
    if (value === "nvidia") return ["NVIDIA"];
    if (value === "none") return noGpuCandidates(record.languageStyle);
    return [record.profile.gpuModel];
  }
  if (field === "gpuModel") return value === "No dedicated GPU" ? noGpuCandidates(record.languageStyle) : [value];
  if (field === "ram") return ramCandidates(value);
  if (field === "vram") return vramCandidates(record, value);
  if (field === "storage") return storageCandidates(value);
  if (field === "task") return [taskEvidence[record.languageStyle][value]];
  throw new Error(`${record.id}: unsupported parser field ${field}`);
}

function ambiguityStatus(record, field) {
  if (["contradiction-a", "contradiction-b"].includes(record.adversarialKind) && ["ram", "vram"].includes(field)) {
    return { status: "conflict", code: `conflict.${field}` };
  }
  if (record.adversarialKind === "unknown-cpu" && field === "cpuModel") {
    return { status: "unknown", code: "unknown.cpu" };
  }
  if (record.adversarialKind === "unknown-gpu" && field === "gpuModel") {
    return { status: "unknown", code: "unknown.gpuModel" };
  }
  if (record.adversarialKind === "omitted-memory" && ["ram", "vram", "storage", "gpuVendor", "gpuModel"].includes(field)) {
    return { status: "missing", code: `missing.${field}` };
  }
  throw new Error(`${record.id}: no valid status/code mapping for ambiguous ${field}`);
}

function correctOracle(record) {
  const expected = record.parserExpected;

  if (ABSENT_GPU_EVIDENCE_IDS.includes(record.id)) {
    delete expected.fields.gpuVendor;
    delete expected.fields.gpuModel;
    expected.ambiguousFields.push("gpuVendor", "gpuModel");
  }

  if (EXPLICIT_NVIDIA_IDS.includes(record.id)) {
    expected.fields.gpuVendor = "nvidia";
    expected.ambiguousFields = expected.ambiguousFields.filter((field) => field !== "gpuVendor");
  }

  expected.sourceEvidence = Object.fromEntries(Object.entries(expected.fields).map(([field, value]) => [
    field,
    [normalizedCandidate(record.setupText, evidenceCandidates(record, field, value), field, record.id)]
  ]));

  const ambiguityEntries = expected.ambiguousFields.map((field) => [field, ambiguityStatus(record, field)]);
  expected.fieldStatuses = Object.fromEntries(ambiguityEntries.map(([field, detail]) => [field, detail.status]));
  expected.expectedIssueCodes = Object.fromEntries(ambiguityEntries.map(([field, detail]) => [field, detail.code]));
}

const sourceBytes = fs.readFileSync(SOURCE);
const sourceHash = crypto.createHash("sha256").update(sourceBytes).digest("hex");
assert(sourceHash === SOURCE_SHA256, `Frozen V1 fixture hash mismatch: ${sourceHash}`);

const sourceDataset = JSON.parse(sourceBytes.toString("utf8"));
const derivative = structuredClone(sourceDataset);
derivative.metadata.oracleVersion = "1.1";
derivative.metadata.provenance = {
  sourceFixture: path.basename(SOURCE),
  sourceSha256: SOURCE_SHA256,
  derivation: "oracle-only"
};
derivative.metadata.erratum = {
  absentGpuEvidence: {
    description: "GPU vendor and model are missing when setup text provides no GPU evidence.",
    recordIds: ABSENT_GPU_EVIDENCE_IDS
  },
  explicitNvidiaUnknownModel: {
    description: "Explicit NVIDIA vendor evidence remains stable while only the unrecognized GPU model is unknown.",
    recordIds: EXPLICIT_NVIDIA_IDS
  }
};

derivative.records.forEach(correctOracle);

sourceDataset.records.forEach((sourceRecord, index) => {
  const derivedRecord = derivative.records[index];
  IMMUTABLE_RECORD_PROPERTIES.forEach((property) => {
    assert(
      canonical(derivedRecord[property]) === canonical(sourceRecord[property]),
      `${sourceRecord.id}: immutable property ${property} changed during V1.1 derivation`
    );
  });
});

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(derivative, null, 2)}\n`);
console.log(`Wrote deterministic oracle V1.1 derivative with ${derivative.records.length} records to ${OUTPUT}`);
