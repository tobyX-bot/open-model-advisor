import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveCpuProfile, deriveGpuProfile } from "../src/hardware.js";
import {
  applyProfileOperations,
  confirmProfile,
  isCurrentProfileConfirmed,
  operationsFromScan,
  registerScanSession
} from "../src/profile-state.js";
import { scanSetupText } from "../src/scanner.js";
import { rankModels } from "../src/scoring.js";

const HARDWARE_FIELDS = ["os", "deviceType", "cpuModel", "gpuVendor", "gpuModel", "ram", "vram", "storage"];

function initialProfile() {
  const fields = Object.fromEntries([
    ...HARDWARE_FIELDS.map((field) => [field, { value: "example-value", provenance: "example" }]),
    ["task", { value: "", provenance: "manual" }],
    ["taskLanguage", { value: "auto", provenance: "default" }],
    ["workload", { value: "daily", provenance: "default" }],
    ["deployment", { value: "local-first", provenance: "default" }],
    ["priorities", { value: ["privacy"], provenance: "default" }],
    ["internet", { value: "available", provenance: "default" }]
  ]);
  return {
    fields,
    hardwareRevision: 0,
    confirmedRevision: null,
    blockingFields: [...HARDWARE_FIELDS],
    currentScanSessionId: null
  };
}

function rankingState(profile) {
  const value = (field) => profile.fields[field].value;
  const selectedGpuVendor = value("gpuVendor");
  const cpuModel = value("cpuModel");
  const gpuModel = value("gpuModel");
  return {
    os: value("os"),
    deviceType: value("deviceType"),
    cpuModel,
    gpuModel,
    cpuProfile: deriveCpuProfile(cpuModel),
    gpuProfile: deriveGpuProfile(gpuModel, selectedGpuVendor),
    ram: value("ram"),
    gpuVendor: selectedGpuVendor,
    selectedGpuVendor,
    vram: value("vram"),
    storage: value("storage"),
    internet: value("internet"),
    deployment: value("deployment"),
    task: value("task"),
    taskLanguage: value("taskLanguage"),
    workload: value("workload"),
    priorities: value("priorities"),
    requireCommercialClearance: false
  };
}

const context = {
  t: (key) => key,
  language: "en",
  taskLabel: "Image generation",
  setupDifficultyLabel: (value) => value,
  licenseSummary: (model) => model.licenseNotes
};

test("scan operations confirm one revision and rank zero to three viable families", async () => {
  const scanSessionId = "scan-1";
  const scan = {
    ...scanSetupText([
      "Windows 11 desktop",
      "CPU AMD Ryzen 7 7800X3D",
      "GPU NVIDIA RTX 4070 SUPER",
      "VRAM 12GB",
      "RAM 32GB",
      "SSD free 184GB",
      "image generation"
    ].join(";")),
    scanSessionId
  };
  let profile = registerScanSession(initialProfile(), scanSessionId);
  profile = applyProfileOperations(profile, operationsFromScan(scan, profile));

  assert.deepEqual(profile.blockingFields, []);
  assert.equal(profile.fields.task.value, "image-generation");
  assert.equal(isCurrentProfileConfirmed(profile), false);

  const state = rankingState(profile);
  profile = confirmProfile(profile, {
    hardwareValid: [state.ram, state.vram, state.storage].every(Number.isFinite),
    gpuConflict: state.gpuProfile.conflict
  });
  assert.equal(isCurrentProfileConfirmed(profile), true);

  const catalog = JSON.parse(await readFile(new URL("../models.json", import.meta.url), "utf8"));
  const ranked = rankModels(catalog.models, state, context, { now: "2026-07-20T00:00:00Z" });
  assert.ok(ranked.ranked.length >= 1 && ranked.ranked.length <= 3);
  assert.equal(new Set(ranked.ranked.map(({ model }) => model.familyId)).size, ranked.ranked.length);
  assert.ok(ranked.ranked.every(({ compatibility }) => compatibility.ok));
  assert.ok(ranked.ranked.every((entry) => !ranked.excluded.includes(entry)));

  const noFit = rankModels(catalog.models, { ...state, storage: 0 }, context, { now: "2026-07-20T00:00:00Z" });
  assert.equal(noFit.ranked.length, 0);
  assert.ok(noFit.excluded.length > 0);
  assert.ok(noFit.hostedFallback && !("score" in noFit.hostedFallback));
});
