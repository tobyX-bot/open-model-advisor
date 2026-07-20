import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProfileOperations,
  confirmProfile,
  editProfileField,
  isCurrentProfileConfirmed,
  operationsFromScan,
  registerScanSession
} from "../src/profile-state.js";

const HARDWARE_FIELDS = [
  "os",
  "deviceType",
  "cpuModel",
  "gpuVendor",
  "gpuModel",
  "ram",
  "vram",
  "storage"
];

const EXAMPLE_VALUES = {
  os: "windows",
  deviceType: "laptop",
  cpuModel: "Intel Core i5",
  gpuVendor: "intel",
  gpuModel: "Intel Iris Xe",
  ram: 16,
  vram: 4,
  storage: 256,
  task: "chat-llm",
  workload: "daily",
  deployment: "local-first",
  priorities: ["privacy"]
};

function profile(overrides = {}) {
  const fields = Object.fromEntries(Object.entries(EXAMPLE_VALUES).map(([field, value]) => [
    field,
    { value: structuredClone(value), provenance: "example" }
  ]));
  return {
    fields,
    hardwareRevision: 0,
    confirmedRevision: null,
    blockingFields: [...HARDWARE_FIELDS],
    currentScanSessionId: "scan-1",
    ...structuredClone(overrides)
  };
}

function resolved(value) {
  return { status: "resolved", resolved: { value }, candidates: [] };
}

function scanResult(scanSessionId, values = {}, statuses = {}) {
  return {
    scanSessionId,
    fieldStates: Object.fromEntries([
      ...HARDWARE_FIELDS,
      "task"
    ].map((field) => [
      field,
      statuses[field] ? { status: statuses[field], resolved: null, candidates: [] } : resolved(values[field])
    ]))
  };
}

const COMPLETE_SCAN = {
  os: "linux",
  deviceType: "desktop",
  cpuModel: "AMD Ryzen 9 7950X",
  gpuVendor: "nvidia",
  gpuModel: "NVIDIA RTX 4090",
  ram: 64,
  vram: 24,
  storage: 1000,
  task: "coding-llm"
};

test("complete scan emits deterministic set operations and preserves a selected task", () => {
  const state = profile();
  const batch = operationsFromScan(scanResult("scan-1", COMPLETE_SCAN), state);

  assert.equal(batch.scanSessionId, "scan-1");
  assert.deepEqual(batch.operations.map(({ kind, field, value, provenance }) => ({
    kind,
    field,
    value,
    provenance
  })), [
    ...HARDWARE_FIELDS.map((field) => ({
      kind: "set",
      field,
      value: COMPLETE_SCAN[field],
      provenance: "scan"
    })),
    { kind: "preserve", field: "task", value: undefined, provenance: "example" }
  ]);
  assert.equal(state.fields.os.value, "windows");
});

test("resolved scan task is set only when the current task is empty", () => {
  const state = profile();
  state.fields.task = { value: "", provenance: "manual" };

  const batch = operationsFromScan(scanResult("scan-1", COMPLETE_SCAN), state);
  assert.deepEqual(batch.operations.at(-1), {
    kind: "set",
    field: "task",
    value: "coding-llm",
    provenance: "scan"
  });
});

test("partial scan clears every unresolved hardware field and blocks review", () => {
  const state = profile({
    blockingFields: [],
    confirmedRevision: 0
  });
  for (const field of HARDWARE_FIELDS) state.fields[field].provenance = "manual";

  const statuses = {
    cpuModel: "unknown",
    gpuVendor: "conflict",
    gpuModel: "missing",
    ram: "invalid",
    vram: "not-applicable",
    storage: "missing"
  };
  const batch = operationsFromScan(scanResult("scan-1", COMPLETE_SCAN, statuses), state);
  assert.deepEqual(batch.operations.slice(2, 8).map(({ kind, field }) => ({ kind, field })), [
    { kind: "clear", field: "cpuModel" },
    { kind: "clear", field: "gpuVendor" },
    { kind: "clear", field: "gpuModel" },
    { kind: "clear", field: "ram" },
    { kind: "clear", field: "vram" },
    { kind: "clear", field: "storage" }
  ]);

  const applied = applyProfileOperations(state, batch);
  for (const field of Object.keys(statuses)) {
    assert.deepEqual(applied.fields[field], { value: null, provenance: "scan" });
  }
  assert.deepEqual(applied.blockingFields, Object.keys(statuses));
  assert.equal(applied.hardwareRevision, 1);
  assert.equal(isCurrentProfileConfirmed(applied), false);
});

test("not-applicable VRAM is set to zero only when the resolver supplies zero", () => {
  const state = profile();
  const values = { ...COMPLETE_SCAN, vram: 0 };
  const batch = operationsFromScan(scanResult("scan-1", values), state);
  assert.deepEqual(batch.operations[6], {
    kind: "set",
    field: "vram",
    value: 0,
    provenance: "scan"
  });
});

test("a second scan batch replaces the first and stale session batches are rejected atomically", () => {
  const original = profile({ currentScanSessionId: "scan-2" });
  const first = operationsFromScan(scanResult("scan-1", COMPLETE_SCAN), original);
  const secondValues = { ...COMPLETE_SCAN, ram: 128, storage: 2000 };
  const second = operationsFromScan(scanResult("scan-2", secondValues), original);

  assert.notDeepEqual(second, first);
  assert.equal(second.operations.find(({ field }) => field === "ram").value, 128);

  const staleRejected = applyProfileOperations(original, first);
  assert.deepEqual(staleRejected, original);
  assert.notStrictEqual(staleRejected, original);
  assert.notStrictEqual(staleRejected.fields, original.fields);

  const applied = applyProfileOperations(original, second);
  assert.equal(applied.fields.ram.value, 128);
  assert.equal(applied.fields.storage.value, 2000);
  assert.equal(applied.hardwareRevision, 1);
});

test("invalid operation batches do not partially mutate state", () => {
  const state = profile();
  const invalid = {
    scanSessionId: "scan-1",
    operations: [
      { kind: "set", field: "ram", value: 32, provenance: "scan" },
      { kind: "set", field: "notAField", value: 1, provenance: "scan" }
    ]
  };

  const result = applyProfileOperations(state, invalid);
  assert.deepEqual(result, state);
  assert.notStrictEqual(result, state);
  assert.equal(state.fields.ram.value, 16);
});

test("manual hardware edits affect one field, remove only its blocker, and invalidate confirmation", () => {
  const state = profile({
    blockingFields: ["cpuModel", "ram", "storage"],
    confirmedRevision: 0
  });
  const edited = editProfileField(state, "ram", 32);

  assert.deepEqual(edited.fields.ram, { value: 32, provenance: "manual" });
  assert.deepEqual(edited.fields.cpuModel, state.fields.cpuModel);
  assert.deepEqual(edited.blockingFields, ["cpuModel", "storage"]);
  assert.equal(edited.hardwareRevision, 1);
  assert.equal(edited.confirmedRevision, 0);
  assert.equal(isCurrentProfileConfirmed(edited), false);
  assert.equal(state.fields.ram.value, 16);
});

test("clearing a hardware field keeps that field blocked", () => {
  const state = profile({ blockingFields: ["cpuModel", "storage"] });
  const edited = editProfileField(state, "cpuModel", "");

  assert.deepEqual(edited.blockingFields, ["cpuModel", "storage"]);
  assert.equal(edited.fields.cpuModel.value, "");
  assert.equal(edited.hardwareRevision, 1);
});

test("task, language, workload, deployment, priorities, and internet edits do not advance hardware revision", () => {
  let state = profile({ blockingFields: [], confirmedRevision: 0 });
  state = editProfileField(state, "task", "coding-llm");
  state = editProfileField(state, "taskLanguage", "zh");
  state = editProfileField(state, "workload", "batch");
  state = editProfileField(state, "deployment", "local-only");
  state = editProfileField(state, "priorities", ["quality", "speed"]);
  state = editProfileField(state, "internet", "offline");

  assert.equal(state.hardwareRevision, 0);
  assert.equal(isCurrentProfileConfirmed(state), true);
  for (const field of ["task", "taskLanguage", "workload", "deployment", "priorities", "internet"]) {
    assert.equal(state.fields[field].provenance, "manual");
  }
});

test("unknown manual fields return an unchanged detached state", () => {
  const state = profile();
  const result = editProfileField(state, "notAField", "available");
  assert.deepEqual(result, state);
  assert.notStrictEqual(result, state);
  assert.notStrictEqual(result.fields, state.fields);
});

test("confirmation records only an unblocked current revision", () => {
  const blocked = profile();
  assert.deepEqual(confirmProfile(blocked), blocked);

  const reviewComplete = profile({
    hardwareRevision: 4,
    blockingFields: []
  });
  const confirmed = confirmProfile(reviewComplete);
  assert.equal(confirmed.confirmedRevision, 4);
  assert.equal(isCurrentProfileConfirmed(confirmed), true);

  const laterEdit = editProfileField(confirmed, "gpuModel", "NVIDIA RTX 4080");
  assert.equal(laterEdit.hardwareRevision, 5);
  assert.equal(isCurrentProfileConfirmed(laterEdit), false);
});

test("confirmation rejects invalid hardware and GPU conflicts", () => {
  const reviewComplete = profile({ hardwareRevision: 2, blockingFields: [] });

  assert.equal(confirmProfile(reviewComplete, { hardwareValid: false }).confirmedRevision, null);
  assert.equal(confirmProfile(reviewComplete, { gpuConflict: true }).confirmedRevision, null);
  assert.equal(
    confirmProfile(reviewComplete, { hardwareValid: true, gpuConflict: false }).confirmedRevision,
    2
  );
});

test("registering a new scan session replaces stale authority without changing revision", () => {
  const state = profile({ currentScanSessionId: "scan-9", hardwareRevision: 3 });
  const next = registerScanSession(state, "scan-10");

  assert.equal(next.currentScanSessionId, "scan-10");
  assert.equal(next.hardwareRevision, 3);
  assert.equal(state.currentScanSessionId, "scan-9");
});

test("state transitions are detached, serializable, and preserve deterministic field order", () => {
  const state = profile({ blockingFields: [] });
  const batch = operationsFromScan(scanResult("scan-1", COMPLETE_SCAN), state);
  const applied = applyProfileOperations(state, batch);
  const serialized = JSON.parse(JSON.stringify(applied));

  assert.deepEqual(serialized, applied);
  assert.deepEqual(Object.keys(applied.fields).slice(0, HARDWARE_FIELDS.length), HARDWARE_FIELDS);
  assert.notStrictEqual(applied, state);
  assert.notStrictEqual(applied.fields, state.fields);
  assert.notStrictEqual(applied.fields.task, state.fields.task);
  applied.fields.task.value = "changed";
  assert.equal(state.fields.task.value, "chat-llm");
});
