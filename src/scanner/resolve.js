const FIELD_ORDER = Object.freeze([
  "os",
  "deviceType",
  "cpuModel",
  "gpuVendor",
  "gpuModel",
  "ram",
  "vram",
  "storage",
  "task"
]);

const FIELD_INDEX = new Map(FIELD_ORDER.map((field, index) => [field, index]));
const REQUIRED_FIELDS = new Set([
  "os",
  "deviceType",
  "cpuModel",
  "gpuVendor",
  "gpuModel",
  "ram",
  "storage"
]);
const NUMERIC_RANGES = Object.freeze({
  ram: [2, 512],
  vram: [0, 128],
  storage: [1, 4096]
});
const SEVERITY_INDEX = Object.freeze({ blocking: 0, review: 1, info: 2 });

const CONFLICT_CODES = Object.freeze({
  os: "conflict.os",
  deviceType: "conflict.device",
  cpuModel: "conflict.cpu",
  gpuVendor: "conflict.gpuVendor",
  gpuModel: "conflict.gpuModel",
  ram: "conflict.ram",
  vram: "conflict.vram",
  storage: "conflict.storage",
  task: "conflict.task"
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compareCandidates(left, right) {
  return (left.segmentIndex ?? Number.MAX_SAFE_INTEGER)
    - (right.segmentIndex ?? Number.MAX_SAFE_INTEGER)
    || (left.start ?? Number.MAX_SAFE_INTEGER) - (right.start ?? Number.MAX_SAFE_INTEGER)
    || (left.end ?? Number.MAX_SAFE_INTEGER) - (right.end ?? Number.MAX_SAFE_INTEGER)
    || (right.specificity ?? 0) - (left.specificity ?? 0)
    || String(left.source ?? "").localeCompare(String(right.source ?? ""))
    || String(left.value ?? "").localeCompare(String(right.value ?? ""))
    || String(left.raw ?? "").localeCompare(String(right.raw ?? ""));
}

function orderedCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter((candidate) => (
      candidate
      && typeof candidate === "object"
      && FIELD_INDEX.has(candidate.field)
    ))
    .map((candidate) => clone(candidate))
    .sort((left, right) => (
      FIELD_INDEX.get(left.field) - FIELD_INDEX.get(right.field)
      || compareCandidates(left, right)
    ));
}

function uniqueValues(candidates) {
  const values = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${typeof candidate.value}:${JSON.stringify(candidate.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(candidate.value);
  }
  return values;
}

function issue(code, severity, fields) {
  return {
    code,
    severity,
    fields: [...fields],
    messageKey: code
  };
}

function resolvedValue(value, evidence, options = {}) {
  const selected = options.selected ?? evidence[0] ?? {};
  return {
    value,
    confidence: options.confidence ?? selected.confidence ?? "high",
    reasonKey: options.reasonKey ?? `reason.${selected.source ?? "resolved"}`,
    inferred: options.inferred ?? Boolean(selected.inferred),
    evidence: clone(evidence)
  };
}

function state(status, candidates, resolved = null) {
  return {
    status,
    resolved: clone(resolved),
    candidates: clone(candidates)
  };
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function isGenericModel(candidate) {
  return candidate.specificity < 50 || /labeled-unknown/u.test(candidate.source);
}

function modelVendor(candidate) {
  if (candidate.value === "No dedicated GPU" || candidate.source === "gpu.no-dedicated") {
    return "none";
  }
  const source = String(candidate.source ?? "");
  const value = String(candidate.value ?? "");
  if (/^gpu\.nvidia/u.test(source) || /^NVIDIA\b/iu.test(value)) return "nvidia";
  if (/^gpu\.amd/u.test(source) || /^AMD\b/iu.test(value)) return "amd";
  if (/^gpu\.intel/u.test(source) || /^Intel\b/iu.test(value)) return "intel";
  return null;
}

function resolveDistinct(field, candidates) {
  if (candidates.length === 0) return { status: "missing", resolved: null, issues: [] };
  const values = uniqueValues(candidates);
  if (values.length > 1) {
    return {
      status: "conflict",
      resolved: null,
      issues: [issue(CONFLICT_CODES[field], "blocking", [field])]
    };
  }
  return {
    status: "resolved",
    resolved: resolvedValue(values[0], candidates),
    issues: []
  };
}

function resolveModel(field, candidates) {
  if (candidates.length === 0) return { status: "missing", resolved: null, issues: [] };

  const exact = candidates.filter((candidate) => !isGenericModel(candidate));
  if (exact.length > 0) {
    const values = uniqueValues(exact);
    if (values.length > 1) {
      return {
        status: "conflict",
        resolved: null,
        issues: [issue(CONFLICT_CODES[field], "blocking", [field])]
      };
    }
    const selected = exact[0];
    const evidence = candidates.filter((candidate) => (
      !isGenericModel(candidate) || overlaps(candidate, selected)
    ));
    return {
      status: "resolved",
      resolved: resolvedValue(values[0], evidence, { selected }),
      issues: []
    };
  }

  return {
    status: "unknown",
    resolved: null,
    issues: [issue(
      field === "cpuModel" ? "unknown.cpu" : "unknown.gpuModel",
      "review",
      [field]
    )]
  };
}

function resolveNumeric(field, candidates) {
  if (candidates.length === 0) return { status: "missing", resolved: null, issues: [] };

  const [minimum, maximum] = NUMERIC_RANGES[field];
  const invalid = candidates.filter((candidate) => (
    typeof candidate.value !== "number"
    || !Number.isFinite(candidate.value)
    || candidate.value < minimum
    || candidate.value > maximum
  ));
  if (invalid.length > 0) {
    return {
      status: "invalid",
      resolved: null,
      issues: [issue("invalid.range", "blocking", [field])]
    };
  }

  let preferred = candidates.filter((candidate) => !candidate.inferred);
  if (preferred.length === 0) preferred = candidates;
  if (field === "storage") {
    const free = preferred.filter((candidate) => candidate.storageKind === "free");
    if (free.length > 0) preferred = free;
  }

  const values = uniqueValues(preferred);
  if (values.length > 1) {
    return {
      status: "conflict",
      resolved: null,
      issues: [issue(CONFLICT_CODES[field], "blocking", [field])]
    };
  }

  const selected = preferred[0];
  return {
    status: "resolved",
    resolved: resolvedValue(values[0], candidates, { selected }),
    issues: []
  };
}

function resolveTask(candidates) {
  if (candidates.length === 0) return { status: "missing", resolved: null, issues: [] };
  const selected = [...candidates].sort((left, right) => (
    (right.specificity ?? 0) - (left.specificity ?? 0)
    || compareCandidates(left, right)
  ))[0];
  return {
    status: "resolved",
    resolved: resolvedValue(selected.value, candidates, { selected }),
    issues: []
  };
}

function positiveGpuConflict(groups) {
  return (
    groups.gpuVendor.some((candidate) => candidate.value !== "none")
    || groups.gpuModel.some((candidate) => candidate.value !== "No dedicated GPU")
    || groups.vram.some((candidate) => (
      typeof candidate.value === "number" && candidate.value > 0
    ))
  );
}

function noGpuResolution(groups) {
  const modelEvidence = groups.gpuModel.filter((candidate) => (
    candidate.value === "No dedicated GPU"
  ));
  const vendorEvidence = groups.gpuVendor.filter((candidate) => candidate.value === "none");
  const baseEvidence = modelEvidence.length > 0 ? modelEvidence : vendorEvidence;
  return {
    gpuVendor: resolvedValue("none", vendorEvidence.length > 0 ? vendorEvidence : baseEvidence, {
      confidence: "high",
      inferred: false,
      reasonKey: "reason.noDedicatedGpu"
    }),
    gpuModel: resolvedValue("No dedicated GPU", modelEvidence.length > 0 ? modelEvidence : baseEvidence, {
      confidence: "high",
      inferred: false,
      reasonKey: "reason.noDedicatedGpu"
    }),
    vram: resolvedValue(0, baseEvidence, {
      confidence: "high",
      inferred: true,
      reasonKey: "reason.zeroVram"
    })
  };
}

function conflictGpuGroup(groups) {
  const issues = [];
  if (groups.gpuVendor.some((candidate) => candidate.value !== "none")) {
    issues.push(issue("conflict.gpuVendor", "blocking", ["gpuVendor"]));
  }
  if (groups.gpuModel.some((candidate) => candidate.value !== "No dedicated GPU")) {
    issues.push(issue("conflict.gpuModel", "blocking", ["gpuModel"]));
  }
  if (groups.vram.some((candidate) => candidate.value > 0)) {
    issues.push(issue("conflict.vram", "blocking", ["vram"]));
  }
  return issues.length > 0
    ? issues
    : [issue("conflict.gpuModel", "blocking", ["gpuVendor", "gpuModel", "vram"] )];
}

function inferredGpuVendor(modelResult) {
  if (modelResult.status !== "resolved") return null;
  const selected = modelResult.resolved.evidence.find((candidate) => (
    candidate.value === modelResult.resolved.value
  ));
  return selected ? modelVendor(selected) : null;
}

function inspectOmissions(document) {
  const text = String(document?.normalized ?? "");
  const omitted = new Set();
  const omission = /(?:not[ \t]+(?:listed|provided|specified|written)|(?:was|were)[ \t]+(?:not[ \t]+)?(?:listed|provided|specified|written)|missing|omitted|unknown|没写|未写|没有写|沒有寫|未列|未提供|未说明|未說明)/iu;
  if (!omission.test(text)) return omitted;

  const patterns = {
    os: /\b(?:OS|operating[ \t]+system|Windows|macOS|Linux)\b|操作系统|作業系統/iu,
    deviceType: /\b(?:device|computer|laptop|desktop|workstation|server)\b|设备|設備|电脑|電腦|笔记本|筆記本|台式机|台式機|工作站|服务器|伺服器/iu,
    cpuModel: /\b(?:CPU|processor)\b|处理器|處理器|芯片|晶片/iu,
    gpuVendor: /\b(?:GPU|graphics|vendor)\b|显卡|顯卡|图形卡|圖形卡/iu,
    gpuModel: /\b(?:GPU|graphics)\b|显卡|顯卡|图形卡|圖形卡/iu,
    ram: /\b(?:RAM|memory)\b|内存|內存|記憶體/iu,
    vram: /\bVRAM\b|显存|顯存|显卡内存|顯卡內存/iu,
    storage: /\b(?:storage|SSD|HDD|disk|drive)\b|存储|存儲|硬盘|硬盤|硬碟/iu,
    task: /\b(?:task|workload|use)\b|任务|任務|用途/iu
  };
  for (const field of FIELD_ORDER) {
    if (patterns[field].test(text)) omitted.add(field);
  }
  return omitted;
}

function addMissingIssue(field, issues) {
  if (field === "task") return;
  issues.push(issue(
    `missing.${field}`,
    field === "vram" || REQUIRED_FIELDS.has(field) ? "blocking" : "info",
    [field]
  ));
}

function compareIssues(left, right) {
  const leftField = Math.min(...left.fields.map((field) => FIELD_INDEX.get(field)));
  const rightField = Math.min(...right.fields.map((field) => FIELD_INDEX.get(field)));
  return SEVERITY_INDEX[left.severity] - SEVERITY_INDEX[right.severity]
    || leftField - rightField
    || left.code.localeCompare(right.code);
}

export function resolveCandidates(document, candidates) {
  const ordered = orderedCandidates(candidates);
  const groups = Object.fromEntries(FIELD_ORDER.map((field) => [
    field,
    ordered.filter((candidate) => candidate.field === field)
  ]));
  const resolutions = {};
  const issues = [];

  resolutions.os = resolveDistinct("os", groups.os);
  resolutions.deviceType = resolveDistinct("deviceType", groups.deviceType);
  resolutions.cpuModel = resolveModel("cpuModel", groups.cpuModel);
  resolutions.ram = resolveNumeric("ram", groups.ram);
  resolutions.storage = resolveNumeric("storage", groups.storage);
  resolutions.task = resolveTask(groups.task);

  const hasNoGpu = (
    groups.gpuVendor.some((candidate) => candidate.value === "none")
    || groups.gpuModel.some((candidate) => candidate.value === "No dedicated GPU")
  );
  if (hasNoGpu) {
    if (positiveGpuConflict(groups)) {
      const gpuIssues = conflictGpuGroup(groups);
      for (const field of ["gpuVendor", "gpuModel", "vram"]) {
        resolutions[field] = { status: "conflict", resolved: null, issues: gpuIssues };
      }
    } else {
      const gpu = noGpuResolution(groups);
      for (const field of ["gpuVendor", "gpuModel", "vram"]) {
        resolutions[field] = { status: "resolved", resolved: gpu[field], issues: [] };
      }
    }
  } else {
    resolutions.gpuVendor = resolveDistinct("gpuVendor", groups.gpuVendor);
    resolutions.gpuModel = resolveModel("gpuModel", groups.gpuModel);
    resolutions.vram = resolveNumeric("vram", groups.vram);

    const vendor = resolutions.gpuVendor.status === "resolved"
      ? resolutions.gpuVendor.resolved.value
      : null;
    const vendorFromModel = inferredGpuVendor(resolutions.gpuModel);
    if (vendor && vendorFromModel && vendor !== vendorFromModel) {
      const mismatchIssues = [
        issue("conflict.gpuVendor", "blocking", ["gpuVendor"]),
        issue("conflict.gpuModel", "blocking", ["gpuModel"])
      ];
      resolutions.gpuVendor = { status: "conflict", resolved: null, issues: mismatchIssues };
      resolutions.gpuModel = { status: "conflict", resolved: null, issues: mismatchIssues };
    }

    const positiveGpu = (
      resolutions.gpuVendor.status === "resolved"
      && resolutions.gpuVendor.resolved.value !== "none"
    ) || groups.gpuModel.some((candidate) => modelVendor(candidate) !== "none");
    if (groups.vram.length === 0) {
      resolutions.vram = positiveGpu
        ? { status: "missing", resolved: null, issues: [] }
        : { status: "not-applicable", resolved: null, issues: [] };
    }
  }

  const omitted = inspectOmissions(document);
  if (omitted.has("vram") && resolutions.vram.status === "not-applicable") {
    resolutions.vram = { status: "missing", resolved: null, issues: [] };
  }
  for (const field of FIELD_ORDER) {
    const resolution = resolutions[field];
    if (resolution.status === "missing" && (REQUIRED_FIELDS.has(field) || omitted.has(field) || field === "vram")) {
      addMissingIssue(field, issues);
    }
    issues.push(...resolution.issues);
  }

  const deduplicatedIssues = [];
  const issueKeys = new Set();
  for (const entry of issues.sort(compareIssues)) {
    const key = `${entry.code}:${entry.fields.join(",")}`;
    if (issueKeys.has(key)) continue;
    issueKeys.add(key);
    deduplicatedIssues.push(entry);
  }

  const fields = {};
  const fieldStates = {};
  const unresolvedFields = [];
  const blockedFields = [];
  for (const field of FIELD_ORDER) {
    const resolution = resolutions[field];
    if (resolution.status === "resolved") fields[field] = clone(resolution.resolved);
    fieldStates[field] = state(resolution.status, groups[field], resolution.resolved);
    if (!["resolved", "not-applicable"].includes(resolution.status) && field !== "task") {
      unresolvedFields.push(field);
    }
    if (
      resolution.status === "conflict"
      || resolution.status === "invalid"
      || (resolution.status === "unknown" && REQUIRED_FIELDS.has(field))
      || (resolution.status === "missing" && (REQUIRED_FIELDS.has(field) || field === "vram"))
    ) {
      blockedFields.push(field);
    }
  }

  return {
    fields,
    fieldStates,
    issues: deduplicatedIssues,
    warnings: [...new Set(deduplicatedIssues.map((entry) => entry.messageKey))],
    unresolvedFields,
    blockedFields
  };
}
