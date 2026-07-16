import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(ROOT, "fixtures", "computer_setups_200.json");
const generatorPath = path.join(ROOT, "generate-dataset.mjs");
const dataset = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const generator = fs.readFileSync(generatorPath, "utf8");
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

expect(dataset.metadata?.seed === 20260716, "Metadata seed must be 20260716");
expect(dataset.metadata?.count === 200, "Metadata count must be 200");
expect(Array.isArray(dataset.records) && dataset.records.length === 200, "Dataset must contain 200 records");
expect(!generator.includes("../src/") && !generator.includes("models.json"), "Generator must not import application output or catalog data");

const ids = new Set();
const groups = new Map();
const setupTexts = new Set();

dataset.records.forEach((record) => {
  const profile = record.profile || {};
  expect(!ids.has(record.id), `${record.id}: duplicate id`);
  ids.add(record.id);
  expect(record.seed === 20260716, `${record.id}: wrong seed`);
  expect(Number.isInteger(record.fold) && record.fold >= 1 && record.fold <= 5, `${record.id}: invalid fold`);
  expect(allowed.languageStyle.has(record.languageStyle), `${record.id}: invalid languageStyle`);
  expect(allowed.scenarioClass.has(record.scenarioClass), `${record.id}: invalid scenarioClass`);
  expect(allowed.hardwareTier.has(record.hardwareTier), `${record.id}: invalid hardwareTier`);
  expect(typeof record.setupText === "string" && record.setupText.length >= 20, `${record.id}: setupText is too short`);
  setupTexts.add(record.setupText);
  expect(allowed.entryMode.has(record.journey?.entryMode), `${record.id}: invalid entryMode`);
  expect(["detected", "manual"].includes(record.journey?.taskSelection), `${record.id}: invalid taskSelection`);

  ["os", "deviceType", "gpuVendor", "internet", "deployment", "task", "workload"].forEach((field) => {
    expect(allowed[field].has(profile[field]), `${record.id}: invalid ${field}`);
  });
  ["ram", "vram", "storage"].forEach((field) => {
    expect(Number.isFinite(profile[field]) && profile[field] >= 0, `${record.id}: ${field} must be numeric`);
  });
  expect(Array.isArray(profile.priorities) && profile.priorities.every((value) => allowed.priority.has(value)), `${record.id}: invalid priorities`);

  expect(!(record.parserExpected?.fields instanceof Array) && typeof record.parserExpected?.fields === "object", `${record.id}: parserExpected.fields must be an object`);
  Object.keys(record.parserExpected?.fields || {}).forEach((field) => {
    expect(allowed.parserField.has(field), `${record.id}: unsupported parser field ${field}`);
  });
  (record.parserExpected?.ambiguousFields || []).forEach((field) => {
    expect(allowed.parserField.has(field), `${record.id}: unsupported ambiguous field ${field}`);
    expect(!(field in record.parserExpected.fields), `${record.id}: ambiguous field ${field} also has an expected value`);
    expect(!record.parserExpected.allowedInferredFields.includes(field), `${record.id}: ambiguous field ${field} is also an allowed inference`);
  });

  if (profile.os === "macos") expect(profile.gpuVendor === "apple", `${record.id}: macOS profile must use Apple GPU in this fixture`);
  if (profile.os === "macos") expect(/^Apple M[1-4]/.test(profile.cpuModel), `${record.id}: macOS profile must use Apple Silicon in this fixture`);
  if (profile.deviceType === "server") expect(profile.os === "linux", `${record.id}: server profile must use Linux in this fixture`);
  if (profile.deviceType === "server" && record.adversarialKind !== "unknown-cpu") expect(/xeon|epyc|threadripper/i.test(profile.cpuModel), `${record.id}: server must use a server-class CPU`);
  if (profile.deviceType === "laptop" && profile.os !== "macos") {
    if (record.adversarialKind !== "unknown-cpu") expect(/(?:u|p|h|hs|hx|g\d)$/i.test(profile.cpuModel), `${record.id}: laptop must use a mobile-class CPU`);
    if (profile.gpuVendor === "nvidia" && record.adversarialKind !== "unknown-gpu") expect(/laptop gpu/i.test(profile.gpuModel), `${record.id}: laptop NVIDIA GPU must be a laptop model`);
    expect(!(/amd ryzen/i.test(profile.cpuModel) && /intel iris/i.test(profile.gpuModel)), `${record.id}: AMD laptop CPU cannot use Intel Iris integrated graphics`);
  }
  if (profile.deviceType === "laptop" && profile.os === "macos") expect(!/ultra/i.test(profile.cpuModel), `${record.id}: Apple Ultra chip cannot be assigned to a laptop`);
  if (profile.deviceType !== "laptop") expect(!/laptop gpu/i.test(profile.gpuModel), `${record.id}: non-laptop cannot use a laptop GPU`);
  if (profile.deviceType !== "laptop") expect(!/iris xe/i.test(profile.gpuModel), `${record.id}: non-laptop cannot use Iris Xe in this fixture`);
  if (record.adversarialKind === "core-ultra") expect(profile.os === "windows" && profile.deviceType === "laptop", `${record.id}: Core Ultra adversarial case must be a Windows laptop`);
  if (profile.gpuVendor === "none") expect(profile.vram === 0, `${record.id}: CPU-only profile must have zero VRAM`);
  if (profile.deployment === "cloud-ok") expect(profile.internet === "available", `${record.id}: cloud-ok profile requires internet`);

  if (record.equivalenceGroup) {
    const members = groups.get(record.equivalenceGroup) || [];
    members.push(record);
    groups.set(record.equivalenceGroup, members);
  }
});

for (let fold = 1; fold <= 5; fold += 1) {
  const records = dataset.records.filter((record) => record.fold === fold);
  expect(records.length === 40, `Fold ${fold}: expected 40 records`);
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
    expect(canonical(actual[dimension]) === canonical(expected), `Fold ${fold}: ${dimension} quota mismatch`);
  });
}

expect(groups.size === 20, `Expected 20 equivalence groups, found ${groups.size}`);
expect(setupTexts.size >= 195, `Expected at least 195 unique setup texts, found ${setupTexts.size}`);
const pairDefinitions = new Set();
groups.forEach((members, group) => {
  expect(members.length === 2, `${group}: expected two members`);
  if (members.length === 2) {
    expect(canonical(members[0].profile) === canonical(members[1].profile), `${group}: profile mismatch`);
    expect(members[0].setupText !== members[1].setupText, `${group}: setup text must differ`);
    const definition = canonical({ profile: members[0].profile, texts: members.map((member) => member.setupText).sort() });
    expect(!pairDefinitions.has(definition), `${group}: duplicates another equivalence definition`);
    pairDefinitions.add(definition);
  }
});

if (errors.length) {
  console.error(`Dataset check failed with ${errors.length} issue(s):`);
  errors.slice(0, 50).forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(JSON.stringify({
  status: "PASS",
  records: dataset.records.length,
  folds: countBy(dataset.records, (record) => record.fold),
  equivalenceGroups: groups.size,
  scenarios: countBy(dataset.records, (record) => record.scenarioClass),
  hardwareTiers: countBy(dataset.records, (record) => record.hardwareTier)
}, null, 2));
