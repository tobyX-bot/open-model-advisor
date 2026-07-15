export function createModelCopy({ language, t }) {
  const setupDifficultyLabel = (value) => ({
    easy: t("setupEasy"),
    moderate: t("setupModerate"),
    advanced: t("setupAdvanced")
  }[value] || value);

  const modelCategoryText = (model) => {
    if (language !== "zh") return model.modelCategory || model.recommendationCategory;
    const byCategory = {
      "chat-llm": "本地量化聊天大模型",
      "coding-llm": model.sizeClass === "large" ? "本地中大型编程模型" : "本地量化编程模型",
      "image-generation": model.id === "sdxl-base-1-0" ? "成熟本地图像生成模型" : "GPU 优先的本地图像生成模型",
      "speech-to-text": "本地语音转文字模型",
      embeddings: "本地向量与搜索模型"
    };
    return byCategory[model.category] || model.modelCategory || model.recommendationCategory;
  };

  const modelSizeNoteText = (model) => {
    if (language !== "zh") return model.modelSizeNote;
    const categoryNotes = {
      "chat-llm": `${model.parameterRange || model.sizeClass}，适合从量化本地版本开始尝试。`,
      "coding-llm": `${model.parameterRange || model.sizeClass}，偏向代码补全、解释和局部改写。`,
      "image-generation": "本地图像模型，显存和工作流优化会明显影响体验。",
      "speech-to-text": "本地转录模型，速度取决于 CPU/GPU 与音频长度。",
      embeddings: "本地向量模型，适合 RAG、搜索和小型索引。"
    };
    return categoryNotes[model.category] || model.modelSizeNote;
  };

  const starterRecommendationText = (model, field) => {
    const starter = model.starterRecommendation;
    if (language !== "zh") return starter[field];
    if (field === "family" || field === "preferredRuntime") return starter[field];
    if (field === "sizeAndQuantization") {
      if (model.category === "image-generation") return `${starter.family}，优先使用显存优化的本地工作流。`;
      if (model.category === "speech-to-text") return `${starter.family}，内存紧张时选择更小或量化版本。`;
      if (model.category === "embeddings") return `${starter.family}，优先选择本地友好的运行方式。`;
      return `${starter.family}，优先选择 4-bit/GGUF 或其他量化版本。`;
    }
    if (field === "hardwareFitNote") {
      return `适合先在 ${model.recommendedRamGb}GB 内存、${model.recommendedVramGb}GB 显存/统一内存左右的机器上尝试；最低约 ${model.minRamGb}GB 内存、${model.minVramGb}GB 显存。`;
    }
    if (field === "avoidNote") {
      if (model.gpuImportance === "required" || model.gpuImportance === "high") return "如果没有合适 GPU 或显存不足，不建议把它作为第一个本地方案。";
      if (model.sizeClass === "large") return "如果只是基础笔记本或仅 CPU 机器，不建议从这个较重模型开始。";
      return "如果你需要权威基准第一名或生产级保证，不应把这个起点当成最终结论。";
    }
    return starter[field];
  };

  const localFitText = (model) => language !== "zh"
    ? model.localFitNotes
    : `本地建议范围：至少 ${model.minRamGb}GB 内存、${model.minVramGb}GB 显存/统一内存，约 ${model.estimatedStorageGb}GB 存储；更舒适的目标是 ${model.recommendedRamGb}GB 内存、${model.recommendedVramGb}GB 显存/统一内存。`;

  const avoidText = (model) => {
    if (language !== "zh") return model.avoidNotes;
    if (model.gpuImportance === "required" || model.gpuImportance === "high") return "避免在仅 CPU、低显存或驱动/运行时不明确的机器上优先尝试。";
    if (model.sizeClass === "large") return "避免在基础笔记本上期待流畅体验。";
    return "避免把它理解为最佳模型排行；仍需按你的任务验证效果。";
  };

  const hardwareReason = (model, state) => language === "zh"
    ? `${state.cpuProfile.label}；${state.gpuProfile.label}；${state.ram}GB 内存、${state.vram}GB 显存/统一内存、${state.storage}GB 存储。模型最低要求：${model.minRamGb}GB 内存、${model.minVramGb}GB 显存、约 ${model.estimatedStorageGb}GB 存储。`
    : `${state.cpuProfile.label}; ${state.gpuProfile.label}; ${state.ram}GB RAM, ${state.vram}GB VRAM/unified memory, ${state.storage}GB storage. Model minimums: ${model.minRamGb}GB RAM, ${model.minVramGb}GB VRAM, about ${model.estimatedStorageGb}GB storage.`;

  const workloadReason = (model, state) => {
    const exact = model.workloadFit.includes(state.workload);
    if (language === "zh") return exact ? "目录将该条目标记为适合当前负载。" : "目录没有把它标记为当前负载的直接适配项；请把分数视为谨慎估计。";
    return exact
      ? `The catalog marks this entry as suitable for ${state.workload} workloads.`
      : `The catalog does not mark this as a direct ${state.workload} fit; treat the score as a cautious estimate.`;
  };

  const prioritySummary = (model, state) => {
    if (!state.priorities.length) return language === "zh" ? "未选择额外优先级。" : "No optional priorities selected.";
    const labels = {
      privacy: t("priorityPrivacy"), quality: t("priorityQuality"), speed: t("prioritySpeed"),
      ease: t("priorityEase"), commercial: t("priorityCommercial"), "low-cost": t("priorityLowCost"),
      "low-hardware": t("priorityLowHardware")
    };
    const selected = state.priorities.map((priority) => labels[priority] || priority).join(", ");
    return language === "zh"
      ? `已选优先级：${selected}。质量层级 ${model.qualityTier}/5，速度层级 ${model.speedTier}/5，安装难度 ${setupDifficultyLabel(model.setupDifficulty)}。`
      : `Selected priorities: ${selected}. Quality tier ${model.qualityTier}/5, speed tier ${model.speedTier}/5, setup ${model.setupDifficulty}.`;
  };

  const licenseSummary = (model) => {
    if (language === "zh") {
      const status = {
        "likely-allowed": "此静态目录显示商业使用可能允许。",
        "check-license": "商业使用前请核对链接中的许可证。",
        restricted: "该条目可能有商业或再分发限制。",
        unknown: "商业使用状态未知。"
      }[model.commercialUse] || "商业使用状态需要复核。";
      return `${status} 这不是法律建议。`;
    }
    const status = {
      "likely-allowed": "Commercial use appears likely allowed in this static catalog.",
      "check-license": "Check the linked license before commercial use.",
      restricted: "This entry may have commercial or redistribution restrictions.",
      unknown: "Commercial-use status is unknown."
    }[model.commercialUse] || "Commercial-use status needs review.";
    return `${status} ${model.licenseNotes} This is not legal advice.`;
  };

  const fallbackSummary = (model, state, score) => {
    if (language === "zh") {
      if (state.deployment === "local-only") return "由于选择仅本地，已隐藏托管备用方案。请先考虑更轻设置或更强本地硬件。";
      if (score >= 60 && state.deployment !== "cloud-ok") return "当前本地适配不需要备用方案；如果要扩展规模或简化运维，可再考虑托管开放权重服务。";
      return "本地运行不现实或体验较弱时，可考虑托管开放权重服务。服务商可能接收你发送的提示、文件或输出；使用前仍需核对许可证。";
    }
    if (state.deployment === "local-only") return "Hidden by local-only preference. Consider lighter settings or stronger local hardware before hosted options.";
    if (score >= 60 && state.deployment !== "cloud-ok") return "Not needed for this local fit, but hosted open-weight options may help with scale or convenience.";
    const note = model.cloudFallback?.note || "Use a hosted open-weight option when local execution is not practical.";
    return `${note} Hosted providers may receive prompts, files, or outputs you send to them. Verify license terms first.`;
  };

  return {
    setupDifficultyLabel,
    modelCategoryText,
    modelSizeNoteText,
    starterRecommendationText,
    localFitText,
    avoidText,
    hardwareReason,
    workloadReason,
    prioritySummary,
    licenseSummary,
    fallbackSummary
  };
}
