import { weights } from "./config.js";

export function compatible(model, state) {
  if (!model.taskCategories.includes(state.task)) return { ok: false, reason: "Task mismatch" };
  if (model.internetRequired && state.internet !== "available") return { ok: false, reason: "Requires internet" };
  if (!model.deploymentModes.includes("local") && state.deployment !== "cloud-ok") return { ok: false, reason: "Deployment mismatch" };
  if (model.gpuImportance === "required" && !model.supportedGpuVendors.includes(state.gpuVendor)) {
    return { ok: false, reason: "Unsupported GPU for required-GPU model" };
  }
  return { ok: true };
}

export function scoreModel(model, state, context) {
  const { t, language, taskLabel, setupDifficultyLabel, licenseSummary } = context;
  const breakdown = [];
  const caps = [];
  let total = 0;
  const add = (name, max, points, reason) => {
    const value = Math.max(0, Math.min(max, Math.round(points)));
    breakdown.push({ name, max, value, reason });
    total += value;
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
    }
  }

  return { total: Math.max(0, Math.min(100, Math.round(total))), breakdown, caps };
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

export function stale(model) {
  const reviewed = new Date(`${model.lastReviewed}T00:00:00Z`);
  return Date.now() - reviewed.getTime() > 180 * 24 * 60 * 60 * 1000;
}
