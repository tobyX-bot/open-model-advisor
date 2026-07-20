import { weights } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_RANK = { low: 1, medium: 2, high: 3 };
const SETUP_RANK = { easy: 1, moderate: 2, advanced: 3 };

function rejected(code, reason) {
  return { ok: false, reason, code };
}

function currentTime(options = {}) {
  const value = options.now ?? Date.now();
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function compatible(model, state, options = {}) {
  if (!model.taskCategories.includes(state.task)) return rejected("task-mismatch", "Task mismatch");
  if (!model.deploymentModes.includes("local")) return rejected("local-unsupported", "No local deployment route");
  if (model.internetRequired && state.internet === "offline") return rejected("internet-required", "Requires internet while offline");
  if (state.gpuProfile?.conflict) return rejected("gpu-conflict", "GPU profile has an unresolved conflict");
  if (![state.ram, state.vram, state.storage].every(Number.isFinite)) {
    return rejected("unresolved-hardware", "Critical hardware capacity is unresolved");
  }
  if (state.ram < model.minRamGb) return rejected("insufficient-ram", "RAM is below the local minimum");
  if (state.vram < model.minVramGb) return rejected("insufficient-vram", "VRAM is below the local minimum");
  if (state.storage < model.estimatedStorageGb) return rejected("insufficient-storage", "Storage is below the estimated model footprint");

  const selectedGpuVendor = state.selectedGpuVendor ?? state.gpuVendor;
  if (model.gpuImportance === "required" && selectedGpuVendor === "none") {
    return rejected("gpu-required", "A GPU is required for this local route");
  }
  let executionVendor = selectedGpuVendor;
  if (!model.supportedGpuVendors.includes(selectedGpuVendor)) {
    const canUseCpuFallback = model.supportedGpuVendors.includes("none")
      && model.minVramGb === 0
      && model.gpuImportance !== "required";
    if (!canUseCpuFallback) return rejected("unsupported-gpu-vendor", "Selected GPU vendor is unsupported");
    executionVendor = "none";
  }

  const requestedLanguage = state.taskLanguage;
  if (requestedLanguage && requestedLanguage !== "auto") {
    if (!["en", "zh"].includes(requestedLanguage)) {
      return rejected("unsupported-language-request", "Requested task language code is unsupported");
    }
    if (!model.supportedLanguages.includes(requestedLanguage)) {
      return rejected("language-mismatch", "Requested task language is unsupported by this route");
    }
  }
  if (state.requireCommercialClearance === true && model.commercialUse !== "likely-allowed") {
    return rejected("commercial-clearance", "Commercial clearance is not likely allowed");
  }
  if (stale(model, { now: options.now })) return rejected("stale-evidence", "Catalog evidence is older than 180 days");
  return {
    ok: true,
    reason: executionVendor === selectedGpuVendor ? "Eligible local route" : "Eligible local route via CPU fallback",
    code: "eligible",
    executionVendor
  };
}

export function scoreModel(model, state, context) {
  const { t, language, taskLabel, setupDifficultyLabel, licenseSummary } = context;
  const breakdown = [];
  const caps = [];
  let total = 0;
  let rawTotal = 0;
  const add = (name, max, points, reason) => {
    const rawValue = Math.max(0, Math.min(max, points));
    const value = Math.round(rawValue);
    breakdown.push({ name, max, value, reason });
    total += value;
    rawTotal += rawValue;
  };

  add(
    t("taskLegend"),
    weights.task,
    weights.task,
    language === "zh" ? `匹配${taskLabel}。` : `Matches ${taskLabel}.`
  );

  let hardware = weights.hardware;
  if (!model.supportedGpuVendors.includes(state.gpuVendor)) {
    hardware = state.gpuVendor === "intel" && model.gpuImportance !== "required" ? 12 : 4;
  } else if (model.gpuImportance === "required" && state.gpuVendor === "none") {
    hardware = 0;
    caps.push(language === "zh" ? "GPU 必需模型没有合适 GPU。" : "No suitable GPU for a GPU-required model.");
  } else if (model.gpuImportance === "high" && state.gpuVendor === "none") {
    hardware = 6;
    caps.push(language === "zh"
      ? "该类别高度依赖 GPU 加速；仅 CPU 运行通常较慢或配置困难。"
      : "This category strongly prefers GPU acceleration; CPU-only use is likely slow or awkward.");
  } else if (model.gpuImportance === "none") {
    hardware = 25;
  } else if (state.cpuProfile.level === "low" && state.gpuVendor === "none") {
    hardware = 12;
  } else if (state.cpuProfile.level === "server" || state.gpuProfile.level === "high") {
    hardware = Math.min(25, hardware + 2);
  }
  if (state.cpuProfile.confidence === "low") hardware -= 3;
  if (state.gpuProfile.confidence === "low" && state.gpuVendor !== "none") hardware -= 5;
  if ((model.gpuImportance === "high" || model.gpuImportance === "required")
    && ["integrated", "entry", "unknown"].includes(state.gpuProfile.level)) hardware -= 6;
  add(
    t("hardwareReasoning"),
    weights.hardware,
    hardware,
    language === "zh"
      ? `GPU 重要性：${model.gpuImportance}；识别到 ${state.gpuProfile.label}（${state.gpuVendor}）和 ${state.cpuProfile.label}。`
      : `${model.gpuImportance} GPU importance; ${state.gpuProfile.label} (${state.gpuVendor}) and ${state.cpuProfile.label}.`
  );

  let memory = weights.memory;
  if (state.ram < model.minRamGb || state.storage < model.estimatedStorageGb) memory = 0;
  else if (state.ram < model.recommendedRamGb) memory -= 5;
  if (model.minVramGb > 0 && state.vram < model.minVramGb) memory -= model.gpuImportance === "required" ? 10 : 5;
  else if (model.recommendedVramGb > 0 && state.vram < model.recommendedVramGb) memory -= 3;

  if (state.ram < model.minRamGb) {
    caps.push(language === "zh"
      ? `内存低于最低要求（可用 ${state.ram}GB，最低 ${model.minRamGb}GB）。`
      : `RAM below minimum (${state.ram}GB available, ${model.minRamGb}GB minimum).`);
  }
  if (state.vram < model.minVramGb) {
    caps.push(language === "zh"
      ? `显存/统一内存低于最低要求（可用 ${state.vram}GB，最低 ${model.minVramGb}GB）。`
      : `VRAM/unified memory below minimum (${state.vram}GB available, ${model.minVramGb}GB minimum).`);
  }
  if (state.storage < model.estimatedStorageGb) {
    caps.push(language === "zh"
      ? `存储低于模型估算占用（可用 ${state.storage}GB，约需 ${model.estimatedStorageGb}GB）。`
      : `Storage below estimated model footprint (${state.storage}GB free, about ${model.estimatedStorageGb}GB needed).`);
  }
  add(
    t("memory"),
    weights.memory,
    memory,
    language === "zh"
      ? `${model.memoryTier}；模型存储估算 ${model.estimatedStorageGb}GB。`
      : `${model.memoryTier}; storage estimate ${model.estimatedStorageGb}GB.`
  );

  const workloadExact = model.workloadFit.includes(state.workload);
  const workloadRelated = (state.workload === "production" && model.workloadFit.includes("daily"))
    || (state.workload === "quality" && model.qualityTier >= 4)
    || (state.workload === "latency" && model.speedTier >= 4);
  add(
    t("workloadLegend"),
    weights.workload,
    workloadExact ? 10 : workloadRelated ? 7 : 4,
    language === "zh"
      ? (workloadExact ? "目录明确标记为适合该负载。" : "与该负载部分匹配。")
      : (workloadExact ? "Explicit workload fit." : "Partial workload fit.")
  );

  const priorityPoints = scorePriority(model, state, context);
  add(t("prioritiesLegend"), weights.priority, priorityPoints.points, priorityPoints.reason);

  const runtimePoints = model.setupDifficulty === "easy" ? 5 : model.setupDifficulty === "moderate" ? 3 : 1;
  add(
    t("runtime"),
    weights.runtime,
    runtimePoints,
    language === "zh"
      ? `${model.runtimeOptions.join(", ")}；安装难度：${setupDifficultyLabel(model.setupDifficulty)}。`
      : `${model.runtimeOptions.join(", ")}; setup is ${model.setupDifficulty}.`
  );

  const licensePoints = model.commercialUse === "likely-allowed" ? 5 : state.priorities.includes("commercial") ? 2 : 3;
  add(t("licenseNote"), weights.license, licensePoints, licenseSummary(model));

  if (caps.length) {
    const capValue = capScore(model, state);
    if (total > capValue) {
      breakdown.push({
        name: t("localFeasibilityCap"),
        max: 100,
        value: capValue,
        reason: language === "zh"
          ? `封顶前分数 ${Math.round(total)}/100；原因：${caps.join(" ")}`
          : `Pre-cap score ${Math.round(total)}/100 was capped because: ${caps.join(" ")}`
      });
      total = capValue;
      rawTotal = Math.min(rawTotal, capValue);
    }
  }

  return {
    total: Math.max(0, Math.min(100, Math.round(total))),
    rawTotal: Math.max(0, Math.min(100, rawTotal)),
    breakdown,
    caps
  };
}

function normalizedHeadroom(model, state) {
  const requirements = [
    [state.ram, model.minRamGb],
    [state.vram, model.minVramGb],
    [state.storage, model.estimatedStorageGb]
  ].filter(([, required]) => required > 0);
  return Math.min(...requirements.map(([available, required]) => (available - required) / required));
}

function compareSemantic(a, b) {
  return b.score.rawTotal - a.score.rawTotal
    || (EVIDENCE_RANK[b.model.evidenceConfidence] || 0) - (EVIDENCE_RANK[a.model.evidenceConfidence] || 0)
    || b.minimumNormalizedHeadroom - a.minimumNormalizedHeadroom
    || (SETUP_RANK[a.model.setupDifficulty] || 99) - (SETUP_RANK[b.model.setupDifficulty] || 99);
}

function hostedFallback(state, ranked) {
  if (state.deployment === "local-only") return null;
  if (ranked.length && state.deployment !== "cloud-ok") return null;
  return {
    privacy: "Hosted processing can send prompts, files, or outputs beyond this device; review provider retention and training terms.",
    access: "Requires network access and a separately chosen provider account or API.",
    license: "Verify model, provider, output, and commercial-use terms before deployment."
  };
}

export function rankModels(models, state, context, options = {}) {
  const eligible = [];
  const excluded = [];

  models.forEach((model) => {
    const compatibility = compatible(model, state, options);
    if (!compatibility.ok) {
      excluded.push({ model, compatibility });
      return;
    }
    eligible.push({
      model,
      compatibility,
      score: scoreModel(model, state, context),
      minimumNormalizedHeadroom: normalizedHeadroom(model, state)
    });
  });

  eligible.sort((a, b) => compareSemantic(a, b) || a.model.id.localeCompare(b.model.id));
  const byFamily = new Map();
  eligible.forEach((entry) => {
    if (!byFamily.has(entry.model.familyId)) byFamily.set(entry.model.familyId, entry);
  });
  const deduplicated = [...byFamily.values()];
  deduplicated.forEach((entry, index) => {
    entry.semanticTie = deduplicated.some((other, otherIndex) => otherIndex !== index && compareSemantic(entry, other) === 0);
  });
  const ranked = deduplicated.slice(0, Math.min(options.limit ?? 3, 3));

  return { ranked, excluded, hostedFallback: hostedFallback(state, ranked) };
}

export function capScore(model, state) {
  if (state.storage < model.estimatedStorageGb || state.ram < model.minRamGb) return 39;
  if (model.gpuImportance === "required" && !model.supportedGpuVendors.includes(state.gpuVendor)) return 0;
  if (model.gpuImportance === "required" && state.vram < model.minVramGb) return 39;
  if (model.gpuImportance === "high" && state.gpuVendor === "none") return 49;
  return 59;
}

export function scorePriority(model, state, { language, setupDifficultyLabel }) {
  if (!state.priorities.length) {
    return { points: 8, reason: language === "zh" ? "未选择额外优先级。" : "No extra priorities selected." };
  }

  let points = 0;
  const reasons = [];
  state.priorities.forEach((priority) => {
    if (priority === "privacy") {
      points += model.deploymentModes.includes("local") ? 2.5 : 0;
      reasons.push(language === "zh" ? "本地模式有利于隐私" : "local mode supports privacy");
    }
    if (priority === "quality") {
      points += model.qualityTier >= 5 ? 2.5 : model.qualityTier >= 4 ? 2 : 1;
      reasons.push(language === "zh" ? `质量层级 ${model.qualityTier}/5` : `quality tier ${model.qualityTier}/5`);
    }
    if (priority === "speed") {
      points += model.speedTier >= 5 ? 2.5 : model.speedTier >= 4 ? 2 : 1;
      reasons.push(language === "zh" ? `速度层级 ${model.speedTier}/5` : `speed tier ${model.speedTier}/5`);
    }
    if (priority === "ease") {
      points += model.setupDifficulty === "easy" ? 2.5 : model.setupDifficulty === "moderate" ? 1.6 : 0.7;
      reasons.push(language === "zh" ? `安装难度 ${setupDifficultyLabel(model.setupDifficulty)}` : `${model.setupDifficulty} setup`);
    }
    if (priority === "commercial") {
      points += model.commercialUse === "likely-allowed" ? 2.5 : model.commercialUse === "check-license" ? 1.4 : 0.4;
      reasons.push(language === "zh" ? "许可证需要核对" : "license requires verification");
    }
    if (priority === "low-cost") {
      points += model.deploymentModes.includes("local") && !model.internetRequired ? 2.2 : 0.8;
      reasons.push(language === "zh" ? "安装后可本地运行" : "can run locally after setup");
    }
    if (priority === "low-hardware") {
      points += model.minRamGb <= 8 && model.minVramGb === 0 ? 2.5 : model.minRamGb <= 16 ? 1.5 : 0.5;
      reasons.push(language === "zh" ? `最低内存 ${model.minRamGb}GB` : `${model.minRamGb}GB RAM minimum`);
    }
  });
  return { points: Math.min(weights.priority, points), reason: `${reasons.join("; ")}.` };
}

export function fitLabel(score) {
  if (score >= 80) return "strong";
  if (score >= 60) return "usable";
  if (score >= 40) return "weak";
  return "notRecommended";
}

export function performanceLabel(model, state, score) {
  if (score < 40) return "unsuitable";
  if (state.ram < model.recommendedRamGb || state.vram < model.recommendedVramGb) {
    return score >= 60 ? "acceptable" : "slow";
  }
  if (model.speedTier >= 4 && score >= 75) return "smooth";
  return score >= 60 ? "acceptable" : "slow";
}

export function stale(model, options = {}) {
  const reviewed = new Date(`${model.lastReviewed}T00:00:00Z`);
  return currentTime(options) - reviewed.getTime() > 180 * DAY_MS;
}
