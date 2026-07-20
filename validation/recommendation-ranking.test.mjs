import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCatalog } from "../src/catalog.js";
import { compatible, rankModels, scoreModel } from "../src/scoring.js";

const NOW = "2026-07-20T00:00:00Z";

const context = {
  t: (key) => key,
  language: "en",
  taskLabel: "Chat LLM",
  setupDifficultyLabel: (value) => value,
  licenseSummary: (model) => model.licenseNotes
};

function model(overrides = {}) {
  const id = overrides.id || "route-a";
  return {
    id,
    familyId: overrides.familyId || id,
    displayName: id,
    taskCategories: ["chat-llm"],
    minRamGb: 8,
    recommendedRamGb: 16,
    minVramGb: 0,
    recommendedVramGb: 0,
    estimatedStorageGb: 4,
    memoryTier: "8-16GB",
    gpuImportance: "none",
    supportedGpuVendors: ["none", "nvidia", "amd", "intel", "apple"],
    runtimeOptions: ["Test Runtime"],
    setupDifficulty: "easy",
    qualityTier: 4,
    speedTier: 4,
    commercialUse: "likely-allowed",
    internetRequired: false,
    deploymentModes: ["local"],
    workloadFit: ["casual", "daily", "production"],
    supportedLanguages: ["en", "zh"],
    evidenceConfidence: "high",
    lastReviewed: "2026-07-20",
    licenseNotes: "Check the applicable model license.",
    ...overrides
  };
}

function state(overrides = {}) {
  return {
    task: "chat-llm",
    taskLanguage: "auto",
    ram: 32,
    vram: 12,
    storage: 100,
    gpuVendor: "none",
    selectedGpuVendor: "none",
    internet: "available",
    deployment: "local-first",
    workload: "daily",
    priorities: [],
    requireCommercialClearance: false,
    cpuProfile: { level: "mid", confidence: "high", label: "Test CPU" },
    gpuProfile: { level: "none", confidence: "high", label: "No GPU", conflict: false },
    ...overrides
  };
}

function expectCode(candidate, profile, code) {
  const result = compatible(candidate, profile, { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, code);
  assert.equal(typeof result.reason, "string");
  assert.ok(result.reason.length > 0);
}

test("catalog parses and all curated records satisfy source and action metadata", async () => {
  const catalog = JSON.parse(await readFile(new URL("../models.json", import.meta.url), "utf8"));
  assert.equal(validateCatalog(catalog), catalog);
  assert.equal(catalog.models.length, 15);

  for (const entry of catalog.models) {
    assert.equal(typeof entry.familyId, "string");
    assert.ok(entry.familyId.length > 0);
    assert.ok(Array.isArray(entry.supportedLanguages));
    assert.ok(entry.supportedLanguages.length > 0);
    assert.ok(entry.supportedLanguages.every((language) => ["en", "zh"].includes(language)));
    assert.equal(new Set(entry.supportedLanguages).size, entry.supportedLanguages.length);
    assert.equal(entry.evidenceConfidence, "high");
    assert.equal(entry.sourceLinks[0].kind, "official-model-card");
    assert.match(entry.sourceLinks[0].url, /^https:\/\/huggingface\.co\//);
    assert.ok(entry.sourceLinks.every((link) => link.publisher && link.verifiedAt === "2026-07-20"));
    assert.ok(entry.runtimeGuides.length >= 1);
    assert.ok(entry.runtimeGuides.every((guide) => guide.official === true && /^https:\/\//.test(guide.url)));
  }
});

test("catalog rejects malformed source and runtime metadata", () => {
  const minimal = {
    models: [{
      id: "broken",
      familyId: "broken",
      supportedLanguages: ["en"],
      evidenceConfidence: "high",
      sourceLinks: [{ label: "Model page", url: "http://example.com", publisher: "Example", kind: "official-model-card", verifiedAt: "July 20" }],
      runtimeGuides: [{ runtime: "Runtime", label: "Guide", url: "https://example.com", publisher: "Example", official: true }]
    }]
  };
  assert.throws(() => validateCatalog(minimal), /missing displayName|HTTPS|Catalog entry/);
});

test("catalog rejects legacy, empty, duplicate, and unsupported language metadata", async () => {
  const catalog = JSON.parse(await readFile(new URL("../models.json", import.meta.url), "utf8"));
  const invalidValues = ["en", [], ["en", "en"], ["en", "fr"]];

  for (const supportedLanguages of invalidValues) {
    const invalid = structuredClone(catalog);
    invalid.models[0].supportedLanguages = supportedLanguages;
    assert.throws(() => validateCatalog(invalid), /supportedLanguages/);
  }
});

test("compatibility applies RAM, VRAM, and storage as hard gates", () => {
  const candidate = model({ minRamGb: 16, minVramGb: 8, estimatedStorageGb: 20 });
  expectCode(candidate, state({ ram: 15 }), "insufficient-ram");
  expectCode(candidate, state({ vram: 7 }), "insufficient-vram");
  expectCode(candidate, state({ storage: 19 }), "insufficient-storage");
});

test("compatibility rejects GPU absence, unsupported vendors, conflicts, and unresolved numbers", () => {
  const required = model({
    gpuImportance: "required",
    minVramGb: 8,
    supportedGpuVendors: ["nvidia", "amd"]
  });
  expectCode(required, state({ gpuVendor: "none", selectedGpuVendor: "none", vram: 12 }), "gpu-required");
  expectCode(required, state({ gpuVendor: "intel", selectedGpuVendor: "intel" }), "unsupported-gpu-vendor");
  expectCode(model(), state({ gpuProfile: { ...state().gpuProfile, conflict: true } }), "gpu-conflict");
  expectCode(model(), state({ ram: null }), "unresolved-hardware");
  expectCode(model(), state({ vram: Number.NaN }), "unresolved-hardware");
  expectCode(model(), state({ storage: undefined }), "unresolved-hardware");
});

test("unsupported Intel GPUs use CPU only for explicitly CPU-capable routes", () => {
  const intelState = state({
    gpuVendor: "intel",
    selectedGpuVendor: "intel",
    vram: 0,
    gpuProfile: { level: "integrated", confidence: "high", label: "Intel integrated GPU", conflict: false }
  });
  const cpuCapableChat = model({
    supportedGpuVendors: ["none", "nvidia", "amd", "apple"],
    minVramGb: 0,
    gpuImportance: "medium"
  });
  assert.deepEqual(compatible(cpuCapableChat, intelState, { now: NOW }), {
    ok: true,
    reason: "Eligible local route via CPU fallback",
    code: "eligible",
    executionVendor: "none"
  });

  const requiredImage = model({
    taskCategories: ["image-generation"],
    gpuImportance: "required",
    minVramGb: 8,
    supportedGpuVendors: ["nvidia", "amd", "apple"]
  });
  expectCode(requiredImage, state({
    ...intelState,
    task: "image-generation",
    vram: 8
  }), "unsupported-gpu-vendor");

  const noCpuRoute = model({
    supportedGpuVendors: ["nvidia", "amd", "apple"],
    minVramGb: 0,
    gpuImportance: "medium"
  });
  expectCode(noCpuRoute, intelState, "unsupported-gpu-vendor");
});

test("compatibility rejects offline, task, language, stale, commercial, and production mismatches", () => {
  expectCode(model({ internetRequired: true }), state({ internet: "offline" }), "internet-required");
  expectCode(model(), state({ task: "coding-llm" }), "task-mismatch");
  expectCode(model({ supportedLanguages: ["en"] }), state({ taskLanguage: "zh" }), "language-mismatch");
  assert.equal(compatible(model({ supportedLanguages: ["en", "zh"] }), state({ taskLanguage: "zh" }), { now: NOW }).ok, true);
  expectCode(model(), state({ taskLanguage: "fr" }), "unsupported-language-request");
  expectCode(model({ lastReviewed: "2025-01-01" }), state(), "stale-evidence");
  expectCode(model({ commercialUse: "check-license" }), state({ requireCommercialClearance: true }), "commercial-clearance");
  expectCode(model({ workloadFit: ["daily"] }), state({ workload: "production" }), "production-fit");
});

test("curated Qwen supports Mandarin while curated Llama does not", async () => {
  const catalog = JSON.parse(await readFile(new URL("../models.json", import.meta.url), "utf8"));
  const qwen = catalog.models.find(({ id }) => id === "qwen2-5-7b-instruct");
  const llama = catalog.models.find(({ id }) => id === "llama-3-1-8b-instruct");
  assert.equal(compatible(qwen, state({ taskLanguage: "zh" }), { now: NOW }).ok, true);
  expectCode(llama, state({ taskLanguage: "zh" }), "language-mismatch");
});

test("compatibility requires an exact local task route", () => {
  expectCode(model({ deploymentModes: ["cloud"] }), state({ deployment: "cloud-ok" }), "local-unsupported");
  assert.deepEqual(compatible(model(), state(), { now: NOW }), {
    ok: true,
    reason: "Eligible local route",
    code: "eligible",
    executionVendor: "none"
  });
  assert.equal(compatible(model(), state({
    gpuVendor: "nvidia",
    selectedGpuVendor: "nvidia"
  }), { now: NOW }).executionVendor, "nvidia");
});

test("scoreModel preserves rounded totals and exposes an unrounded raw total", () => {
  const scored = scoreModel(model({ setupDifficulty: "moderate" }), state({ priorities: ["ease"] }), context);
  assert.equal(Number.isInteger(scored.total), true);
  assert.equal(typeof scored.rawTotal, "number");
  assert.notEqual(scored.rawTotal, scored.total);
  assert.ok(Array.isArray(scored.breakdown));
  assert.ok(Array.isArray(scored.caps));
});

test("ranking deduplicates families before limiting to three", () => {
  const candidates = [
    model({ id: "family-a-slow", familyId: "family-a", speedTier: 2 }),
    model({ id: "family-a-fast", familyId: "family-a", speedTier: 5 }),
    model({ id: "family-b", familyId: "family-b" }),
    model({ id: "family-c", familyId: "family-c" }),
    model({ id: "family-d", familyId: "family-d" })
  ];
  const result = rankModels(candidates, state({ priorities: ["speed"] }), context, { now: NOW });
  assert.equal(result.ranked.length, 3);
  assert.equal(new Set(result.ranked.map(({ model: entry }) => entry.familyId)).size, 3);
  assert.ok(result.ranked.some(({ model: entry }) => entry.id === "family-a-fast"));
  assert.ok(!result.ranked.some(({ model: entry }) => entry.id === "family-a-slow"));
});

test("ranking returns zero, one, two, or three local results without padding", () => {
  for (const count of [0, 1, 2, 3, 4]) {
    const candidates = Array.from({ length: count }, (_, index) => model({ id: `route-${index}` }));
    const result = rankModels(candidates, state(), context, { now: NOW });
    assert.equal(result.ranked.length, Math.min(count, 3));
  }
});

test("ranking uses deterministic semantic comparators and marks stable-id-only ties", () => {
  const candidates = [model({ id: "route-b" }), model({ id: "route-a" }), model({ id: "route-c", evidenceConfidence: "medium" })];
  const first = rankModels(candidates, state(), context, { now: NOW });
  const second = rankModels([...candidates].reverse(), state(), context, { now: NOW });
  assert.deepEqual(first.ranked.map(({ model: entry }) => entry.id), second.ranked.map(({ model: entry }) => entry.id));
  assert.deepEqual(first.ranked.map(({ model: entry }) => entry.id), ["route-a", "route-b", "route-c"]);
  assert.equal(first.ranked[0].semanticTie, true);
  assert.equal(first.ranked[1].semanticTie, true);
  assert.equal(first.ranked[2].semanticTie, false);
});

test("hosted fallback stays separate and is absent for local-only", () => {
  const ineligible = [model({ id: "too-large", minRamGb: 128 })];
  const localOnly = rankModels(ineligible, state({ deployment: "local-only" }), context, { now: NOW });
  assert.equal(localOnly.ranked.length, 0);
  assert.equal(localOnly.hostedFallback, null);

  const fallback = rankModels(ineligible, state({ deployment: "local-first" }), context, { now: NOW });
  assert.equal(fallback.ranked.length, 0);
  assert.deepEqual(Object.keys(fallback.hostedFallback).sort(), ["access", "license", "privacy"]);
  assert.ok(!fallback.ranked.includes(fallback.hostedFallback));

  const cloudOk = rankModels([model()], state({ deployment: "cloud-ok" }), context, { now: NOW });
  assert.equal(cloudOk.ranked.length, 1);
  assert.ok(cloudOk.hostedFallback);
  assert.equal("score" in cloudOk.hostedFallback, false);
});

test("raising RAM, VRAM, or storage never makes an eligible model ineligible", () => {
  const candidate = model({ minRamGb: 16, minVramGb: 8, estimatedStorageGb: 20 });
  const levels = [
    state({ ram: 16, vram: 8, storage: 20 }),
    state({ ram: 32, vram: 8, storage: 20 }),
    state({ ram: 32, vram: 16, storage: 20 }),
    state({ ram: 32, vram: 16, storage: 100 })
  ];
  assert.deepEqual(levels.map((profile) => compatible(candidate, profile, { now: NOW }).ok), [true, true, true, true]);
});
