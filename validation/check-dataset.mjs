import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const V1_PATH = path.join(ROOT, "fixtures", "computer_setups_200.json");
const V1_1_PATH = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json");
const GENERATOR_PATH = path.join(ROOT, "generate-dataset.mjs");
const V1_SHA256 = "e9e96bf82cde212d1f8d3ea71ac5b6184c138e355eb3a1cee07d921d1064b17b";
const V1_1_SHA256 = "54fe97fdd3e8b742000bd9df4ec79c586e0e16eeaa07f3c61ac99aebefce02b7";

const v1Bytes = fs.readFileSync(V1_PATH);
const v1_1Bytes = fs.readFileSync(V1_1_PATH);
const v1 = JSON.parse(v1Bytes.toString("utf8"));
const v1_1 = JSON.parse(v1_1Bytes.toString("utf8"));
const generator = fs.readFileSync(GENERATOR_PATH, "utf8");
const errors = [];

const allowed = {
  os: new Set(["windows", "macos", "linux"]),
  deviceType: new Set(["laptop", "desktop", "workstation", "server"]),
  gpuVendor: new Set(["none", "nvidia", "amd", "intel", "apple"]),
  internet: new Set(["available", "setup-only", "offline"]),
  deployment: new Set(["local-only", "local-first", "cloud-ok"]),
  task: new Set(["chat-llm", "coding-llm", "image-generation", "speech-to-text", "embeddings"]),
  workload: new Set(["casual", "daily", "batch", "production", "latency", "quality"]),
  priority: new Set(["privacy", "quality", "speed", "ease", "commercial", "low-cost", "low-hardware"]),
  parserField: new Set(["os", "deviceType", "cpuModel", "gpuVendor", "gpuModel", "ram", "vram", "storage", "task"]),
  languageStyle: new Set(["en", "zh-CN", "zh-TW", "mixed"]),
  scenarioClass: new Set(["clean", "messy", "adversarial"]),
  entryMode: new Set(["paste", "manual", "preset-edit"]),
  hardwareTier: new Set(["entry", "mainstream", "performance", "extreme"])
};

const quotas = {
  task: { "chat-llm": 12, "coding-llm": 10, embeddings: 6, "image-generation": 6, "speech-to-text": 6 },
  os: { linux: 10, macos: 12, windows: 18 },
  device: { desktop: 14, laptop: 18, server: 3, workstation: 5 },
  language: { en: 22, mixed: 4, "zh-CN": 9, "zh-TW": 5 },
  scenario: { adversarial: 6, clean: 24, messy: 10 },
  entry: { manual: 5, paste: 32, "preset-edit": 3 },
  deployment: { "cloud-ok": 8, "local-first": 22, "local-only": 10 },
  tier: { entry: 10, extreme: 4, mainstream: 16, performance: 10 }
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${key}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function countBy(rows, selector) {
  const counts = {};
  rows.forEach((row) => {
    const value = selector(row);
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

function validateDataset(dataset, label) {
  expect(dataset.metadata?.seed === 20260716, `${label}: metadata seed must be 20260716`);
  expect(dataset.metadata?.count === 200, `${label}: metadata count must be 200`);
  expect(Array.isArray(dataset.records) && dataset.records.length === 200, `${label}: dataset must contain 200 records`);

  const ids = new Set();
  const groups = new Map();
  const setupTexts = new Set();

  (dataset.records || []).forEach((record) => {
    const profile = record.profile || {};
    expect(!ids.has(record.id), `${label} ${record.id}: duplicate id`);
    ids.add(record.id);
    expect(record.seed === 20260716, `${label} ${record.id}: wrong seed`);
    expect(Number.isInteger(record.fold) && record.fold >= 1 && record.fold <= 5, `${label} ${record.id}: invalid fold`);
    expect(allowed.languageStyle.has(record.languageStyle), `${label} ${record.id}: invalid languageStyle`);
    expect(allowed.scenarioClass.has(record.scenarioClass), `${label} ${record.id}: invalid scenarioClass`);
    expect(allowed.hardwareTier.has(record.hardwareTier), `${label} ${record.id}: invalid hardwareTier`);
    expect(typeof record.setupText === "string" && record.setupText.length >= 20, `${label} ${record.id}: setupText is too short`);
    setupTexts.add(record.setupText);
    expect(allowed.entryMode.has(record.journey?.entryMode), `${label} ${record.id}: invalid entryMode`);
    expect(["detected", "manual"].includes(record.journey?.taskSelection), `${label} ${record.id}: invalid taskSelection`);

    ["os", "deviceType", "gpuVendor", "internet", "deployment", "task", "workload"].forEach((field) => {
      expect(allowed[field].has(profile[field]), `${label} ${record.id}: invalid ${field}`);
    });
    ["ram", "vram", "storage"].forEach((field) => {
      expect(Number.isFinite(profile[field]) && profile[field] >= 0, `${label} ${record.id}: ${field} must be numeric`);
    });
    expect(Array.isArray(profile.priorities) && profile.priorities.every((value) => allowed.priority.has(value)), `${label} ${record.id}: invalid priorities`);

    const parserExpected = record.parserExpected || {};
    expect(!(parserExpected.fields instanceof Array) && typeof parserExpected.fields === "object", `${label} ${record.id}: parserExpected.fields must be an object`);
    expect(Array.isArray(parserExpected.ambiguousFields), `${label} ${record.id}: ambiguousFields must be an array`);
    expect(Array.isArray(parserExpected.allowedInferredFields), `${label} ${record.id}: allowedInferredFields must be an array`);
    Object.keys(parserExpected.fields || {}).forEach((field) => {
      expect(allowed.parserField.has(field), `${label} ${record.id}: unsupported parser field ${field}`);
    });
    (parserExpected.ambiguousFields || []).forEach((field) => {
      expect(allowed.parserField.has(field), `${label} ${record.id}: unsupported ambiguous field ${field}`);
      expect(!(field in (parserExpected.fields || {})), `${label} ${record.id}: ambiguous field ${field} also has an expected value`);
      expect(!parserExpected.allowedInferredFields.includes(field), `${label} ${record.id}: ambiguous field ${field} is also an allowed inference`);
    });

    if (label === "V1.1") {
      expect(parserExpected.sourceEvidence && typeof parserExpected.sourceEvidence === "object" && !Array.isArray(parserExpected.sourceEvidence), `${label} ${record.id}: sourceEvidence must be an object`);
      expect(parserExpected.fieldStatuses && typeof parserExpected.fieldStatuses === "object" && !Array.isArray(parserExpected.fieldStatuses), `${label} ${record.id}: fieldStatuses must be an object`);
      expect(parserExpected.expectedIssueCodes && typeof parserExpected.expectedIssueCodes === "object" && !Array.isArray(parserExpected.expectedIssueCodes), `${label} ${record.id}: expectedIssueCodes must be an object`);
    }

    if (profile.os === "macos") expect(profile.gpuVendor === "apple", `${label} ${record.id}: macOS profile must use Apple GPU in this fixture`);
    if (profile.os === "macos") expect(/^Apple M[1-4]/.test(profile.cpuModel), `${label} ${record.id}: macOS profile must use Apple Silicon in this fixture`);
    if (profile.deviceType === "server") expect(profile.os === "linux", `${label} ${record.id}: server profile must use Linux`);
    if (profile.deviceType === "server" && record.adversarialKind !== "unknown-cpu") {
      expect(/xeon|epyc|threadripper/i.test(profile.cpuModel), `${label} ${record.id}: server must use a server-class CPU`);
    }
    if (profile.deviceType === "laptop" && profile.os !== "macos") {
      if (record.adversarialKind !== "unknown-cpu") expect(/(?:u|p|h|hs|hx|g\d)$/i.test(profile.cpuModel), `${label} ${record.id}: laptop must use a mobile-class CPU`);
      if (profile.gpuVendor === "nvidia" && record.adversarialKind !== "unknown-gpu") expect(/laptop gpu/i.test(profile.gpuModel), `${label} ${record.id}: laptop NVIDIA GPU must be a laptop model`);
      expect(!(/amd ryzen/i.test(profile.cpuModel) && /intel iris/i.test(profile.gpuModel)), `${label} ${record.id}: AMD laptop CPU cannot use Intel Iris graphics`);
    }
    if (profile.deviceType === "laptop" && profile.os === "macos") expect(!/ultra/i.test(profile.cpuModel), `${label} ${record.id}: Apple Ultra chip cannot be assigned to a laptop`);
    if (profile.deviceType !== "laptop") expect(!/laptop gpu/i.test(profile.gpuModel), `${label} ${record.id}: non-laptop cannot use a laptop GPU`);
    if (profile.deviceType !== "laptop") expect(!/iris xe/i.test(profile.gpuModel), `${label} ${record.id}: non-laptop cannot use Iris Xe`);
    if (record.adversarialKind === "core-ultra") expect(profile.os === "windows" && profile.deviceType === "laptop", `${label} ${record.id}: Core Ultra case must be a Windows laptop`);
    if (profile.gpuVendor === "none") expect(profile.vram === 0, `${label} ${record.id}: CPU-only profile must have zero VRAM`);
    if (profile.deployment === "cloud-ok") expect(profile.internet === "available", `${label} ${record.id}: cloud-ok profile requires internet`);

    if (record.equivalenceGroup) {
      const members = groups.get(record.equivalenceGroup) || [];
      members.push(record);
      groups.set(record.equivalenceGroup, members);
    }
  });

  for (let fold = 1; fold <= 5; fold += 1) {
    const records = dataset.records.filter((record) => record.fold === fold);
    expect(records.length === 40, `${label} fold ${fold}: expected 40 records`);
    const actual = {
      task: countBy(records, (record) => record.profile.task),
      os: countBy(records, (record) => record.profile.os),
      device: countBy(records, (record) => record.profile.deviceType),
      language: countBy(records, (record) => record.languageStyle),
      scenario: countBy(records, (record) => record.scenarioClass),
      entry: countBy(records, (record) => record.journey.entryMode),
      deployment: countBy(records, (record) => record.profile.deployment),
      tier: countBy(records, (record) => record.hardwareTier)
    };
    Object.entries(quotas).forEach(([dimension, expected]) => {
      expect(canonical(actual[dimension]) === canonical(expected), `${label} fold ${fold}: ${dimension} quota mismatch`);
    });
  }

  expect(groups.size === 20, `${label}: expected 20 equivalence groups, found ${groups.size}`);
  expect(setupTexts.size >= 195, `${label}: expected at least 195 unique setup texts, found ${setupTexts.size}`);
  const pairDefinitions = new Set();
  groups.forEach((members, group) => {
    expect(members.length === 2, `${label} ${group}: expected two members`);
    if (members.length === 2) {
      expect(canonical(members[0].profile) === canonical(members[1].profile), `${label} ${group}: profile mismatch`);
      expect(members[0].setupText !== members[1].setupText, `${label} ${group}: setup text must differ`);
      const definition = canonical({ profile: members[0].profile, texts: members.map((member) => member.setupText).sort() });
      expect(!pairDefinitions.has(definition), `${label} ${group}: duplicates another equivalence definition`);
      pairDefinitions.add(definition);
    }
  });

  return {
    records: dataset.records.length,
    folds: countBy(dataset.records, (record) => record.fold),
    equivalenceGroups: groups.size,
    scenarios: countBy(dataset.records, (record) => record.scenarioClass),
    hardwareTiers: countBy(dataset.records, (record) => record.hardwareTier)
  };
}

const v1Hash = crypto.createHash("sha256").update(v1Bytes).digest("hex");
const v1_1Hash = crypto.createHash("sha256").update(v1_1Bytes).digest("hex");
expect(v1Hash === V1_SHA256, `V1 fixture SHA-256 changed: ${v1Hash}`);
expect(v1_1Hash === V1_1_SHA256, `V1.1 fixture SHA-256 changed: ${v1_1Hash}`);
expect(v1.metadata?.oracleVersion === undefined, "V1 must remain unversioned and byte-immutable");
expect(!generator.includes("../src/") && !generator.includes("models.json"), "Generator must not import application output or catalog data");
expect(generator.includes("computer_setups_200_v1_1.json"), "Generator must target the V1.1 derivative");

expect(v1_1.metadata?.oracleVersion === "1.1", "V1.1 metadata.oracleVersion must be 1.1");
expect(v1_1.metadata?.provenance?.sourceFixture === path.basename(V1_PATH), "V1.1 provenance must identify V1 source fixture");
expect(v1_1.metadata?.provenance?.sourceSha256 === V1_SHA256, "V1.1 provenance must pin V1 SHA-256");
expect(v1_1.metadata?.provenance?.derivation === "oracle-only", "V1.1 provenance must declare oracle-only derivation");

const summaries = {
  v1: validateDataset(v1, "V1"),
  v1_1: validateDataset(v1_1, "V1.1")
};

if (errors.length) {
  console.error(`Dataset check failed with ${errors.length} issue(s):`);
  errors.slice(0, 80).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "PASS",
  v1Sha256: v1Hash,
  v1_1Sha256: v1_1Hash,
  fixtures: summaries
}, null, 2));
