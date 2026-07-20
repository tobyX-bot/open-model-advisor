const HARDWARE_FIELDS = Object.freeze([
  "os",
  "deviceType",
  "cpuModel",
  "gpuVendor",
  "gpuModel",
  "ram",
  "vram",
  "storage"
]);

const NON_HARDWARE_FIELDS = Object.freeze([
  "task",
  "workload",
  "deployment",
  "priorities"
]);

const ALL_FIELDS = new Set([...HARDWARE_FIELDS, ...NON_HARDWARE_FIELDS]);
const HARDWARE_FIELD_SET = new Set(HARDWARE_FIELDS);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function detachedState(state) {
  return clone(state);
}

function orderedBlockers(blockingFields) {
  const blockers = new Set(Array.isArray(blockingFields) ? blockingFields : []);
  return HARDWARE_FIELDS.filter((field) => blockers.has(field));
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function validSessionId(value) {
  return typeof value === "string" && value.length > 0;
}

function validOperation(operation) {
  if (!operation || typeof operation !== "object") return false;
  if (!ALL_FIELDS.has(operation.field)) return false;
  if (!new Set(["set", "clear", "preserve"]).has(operation.kind)) return false;
  if (typeof operation.provenance !== "string" || operation.provenance.length === 0) return false;
  if (operation.kind === "set" && !hasValue(operation.value) && operation.value !== 0) return false;
  if (operation.kind === "clear" && !HARDWARE_FIELD_SET.has(operation.field)) return false;
  return true;
}

/** @typedef {{kind:"set"|"clear"|"preserve", field:string, value?:string|number, provenance:string}} ProfileOperation */

export function operationsFromScan(scanResult, currentProfile) {
  const scanSessionId = scanResult?.scanSessionId ?? null;
  const fieldStates = scanResult?.fieldStates ?? {};
  const operations = HARDWARE_FIELDS.map((field) => {
    const fieldState = fieldStates[field];
    if (fieldState?.status === "resolved" && hasValue(fieldState.resolved?.value)) {
      return {
        kind: "set",
        field,
        value: clone(fieldState.resolved.value),
        provenance: "scan"
      };
    }
    return { kind: "clear", field, provenance: "scan" };
  });

  const currentTask = currentProfile?.fields?.task;
  if (hasValue(currentTask?.value)) {
    operations.push({
      kind: "preserve",
      field: "task",
      provenance: currentTask.provenance || "manual"
    });
  } else {
    const taskState = fieldStates.task;
    if (taskState?.status === "resolved" && hasValue(taskState.resolved?.value)) {
      operations.push({
        kind: "set",
        field: "task",
        value: clone(taskState.resolved.value),
        provenance: "scan"
      });
    } else {
      operations.push({
        kind: "preserve",
        field: "task",
        provenance: currentTask?.provenance || "manual"
      });
    }
  }

  return { scanSessionId, operations };
}

export function applyProfileOperations(state, batch) {
  const unchanged = detachedState(state);
  if (!state || typeof state !== "object") return unchanged;
  if (!validSessionId(batch?.scanSessionId)) return unchanged;
  if (batch.scanSessionId !== state.currentScanSessionId) return unchanged;
  if (!Array.isArray(batch.operations) || batch.operations.length === 0) return unchanged;
  if (!batch.operations.every(validOperation)) return unchanged;

  const fields = batch.operations.map((operation) => operation.field);
  if (new Set(fields).size !== fields.length) return unchanged;

  const next = detachedState(state);
  next.blockingFields = orderedBlockers(next.blockingFields);
  let hardwareChanged = false;

  for (const operation of batch.operations) {
    if (operation.kind === "preserve") continue;
    if (operation.kind === "set") {
      next.fields[operation.field] = {
        value: clone(operation.value),
        provenance: operation.provenance
      };
      if (HARDWARE_FIELD_SET.has(operation.field)) {
        next.blockingFields = next.blockingFields.filter((field) => field !== operation.field);
        hardwareChanged = true;
      }
      continue;
    }

    next.fields[operation.field] = { value: null, provenance: operation.provenance };
    if (!next.blockingFields.includes(operation.field)) {
      next.blockingFields.push(operation.field);
      next.blockingFields = orderedBlockers(next.blockingFields);
    }
    hardwareChanged = true;
  }

  if (hardwareChanged) next.hardwareRevision += 1;
  return next;
}

export function editProfileField(state, field, value) {
  const next = detachedState(state);
  if (!state || typeof state !== "object" || !ALL_FIELDS.has(field)) return next;

  next.fields[field] = { value: clone(value), provenance: "manual" };
  if (HARDWARE_FIELD_SET.has(field)) {
    next.hardwareRevision += 1;
    next.blockingFields = orderedBlockers(next.blockingFields)
      .filter((blockingField) => blockingField !== field);
  }
  return next;
}

export function confirmProfile(state) {
  const next = detachedState(state);
  if (!state || typeof state !== "object") return next;
  if (orderedBlockers(state.blockingFields).length > 0) return next;
  next.confirmedRevision = next.hardwareRevision;
  return next;
}

export function isCurrentProfileConfirmed(state) {
  return Boolean(
    state
    && Number.isInteger(state.hardwareRevision)
    && state.confirmedRevision === state.hardwareRevision
    && orderedBlockers(state.blockingFields).length === 0
  );
}
