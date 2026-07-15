function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function scanSetupText(text) {
  const fields = {};
  const warnings = [];
  const add = (field, value, confidence, reasonKey) => {
    fields[field] = { value, confidence, reasonKey };
  };
  const normalized = compact(text);
  const lower = normalized.toLowerCase();

  if (/macbook|macos|mac os|apple silicon|苹果电脑|蘋果電腦|苹果系统|蘋果系統|m[1-4]\s*(pro|max|ultra)?/.test(lower)) {
    add("os", "macos", "high", "reasonAppleOs");
  } else if (/windows|win11|win10|微软系统|微軟系統|视窗系统|視窗系統/.test(lower)) {
    add("os", "windows", "high", "reasonWindowsOs");
  } else if (/linux|ubuntu|debian|fedora|arch|麒麟|统信|統信/.test(lower)) {
    add("os", "linux", "high", "reasonLinuxOs");
  }

  if (/macbook|laptop|notebook|笔记本|筆記本|笔电|筆電/.test(lower)) {
    add("deviceType", "laptop", "high", "reasonLaptop");
  } else if (/server|rack|服务器|伺服器|机架|機架/.test(lower)) {
    add("deviceType", "server", "high", "reasonServer");
  } else if (/workstation|工作站/.test(lower)) {
    add("deviceType", "workstation", "high", "reasonWorkstation");
  } else if (/desktop|\bpc\b|tower|台式机|台式機|台式电脑|台式電腦|主机|主機/.test(lower)) {
    add("deviceType", "desktop", "medium", "reasonDesktop");
  }

  const appleCpu = normalized.match(/\b(?:Apple\s*)?M[1-4]\s*(?:Ultra|Max|Pro)?\b/i);
  const ryzenCpu = normalized.match(/\b(?:AMD\s*)?Ryzen\s*(?:Threadripper\s*)?[3579]\s*[A-Z0-9-]*\b/i);
  const intelCpu = normalized.match(/\b(?:Intel\s*)?(?:Core\s*)?i[3579][-\s]?[0-9A-Z]{3,8}\b/i)
    || normalized.match(/\b(?:Intel\s*)?(?:Core\s*)?i[3579]\b/i);
  const serverCpu = normalized.match(/\b(?:Xeon|Threadripper|EPYC)\s*[A-Z0-9-]*\b/i);
  const appleCpuLabel = appleCpu
    ? (appleCpu[0].match(/^Apple\s/i) ? compact(appleCpu[0]) : `Apple ${compact(appleCpu[0])}`)
    : "";

  if (appleCpu) add("cpuModel", appleCpuLabel, "high", "reasonAppleCpu");
  else if (serverCpu) add("cpuModel", serverCpu[0], "high", "reasonServerCpu");
  else if (ryzenCpu) add("cpuModel", ryzenCpu[0], "high", "reasonRyzenCpu");
  else if (intelCpu) add("cpuModel", intelCpu[0], "medium", "reasonIntelCpu");

  const noDedicatedGpu = /no dedicated gpu|no gpu|cpu only|cpu-only|integrated graphics only|无独立显卡|無獨立顯卡|没有独显|沒有獨顯|仅\s*cpu|只有\s*cpu|核显|核顯|集成显卡|集成顯卡/.test(lower);
  if (noDedicatedGpu) {
    add("gpuVendor", "none", "high", "reasonNoDedicatedGpu");
    add("gpuModel", "No dedicated GPU", "high", "reasonCpuOnlyGraphics");
    add("vram", 0, "high", "reasonZeroVram");
  } else {
    const nvidiaGpu = normalized.match(/\b(?:NVIDIA\s*)?(?:RTX|GTX)\s*[0-9]{3,4}\s*(?:Ti|SUPER|Super)?\b/i);
    const amdGpu = normalized.match(/\b(?:AMD\s*)?(?:Radeon\s*)?RX\s*[0-9]{3,4}\s*(?:XT)?\b/i);
    const intelGpu = normalized.match(/\bIntel\s*(?:Arc\s*[A-Z]?[0-9]{3,4}|Iris|UHD)[A-Z0-9\s-]*\b/i);

    if (nvidiaGpu) {
      add("gpuVendor", "nvidia", "high", "reasonNvidiaGpu");
      add("gpuModel", compact(nvidiaGpu[0]), "high", "reasonGpuModel");
    } else if (amdGpu) {
      add("gpuVendor", "amd", "high", "reasonAmdGpu");
      add("gpuModel", compact(amdGpu[0]), "high", "reasonGpuModel");
    } else if (intelGpu) {
      add("gpuVendor", "intel", "medium", "reasonIntelGpu");
      add("gpuModel", compact(intelGpu[0]), "medium", "reasonGpuModel");
    } else if (appleCpu) {
      add("gpuVendor", "apple", "high", "reasonAppleGpu");
      add("gpuModel", `${appleCpuLabel} GPU`, "medium", "reasonAppleGpuInferred");
    } else if (/独显|獨顯|dedicated gpu/.test(lower)) {
      warnings.push("warningDedicatedGpuUnknown");
    }
  }

  const unified = normalized.match(/(\d{1,3})\s*(?:gb|g)\s*(?:unified memory|统一内存|統一記憶體)/i)
    || normalized.match(/(?:unified memory|统一内存|統一記憶體)[^0-9]{0,12}(\d{1,3})\s*(?:gb|g)/i);
  const ramMatches = [...normalized.matchAll(/(\d{1,3})\s*(?:gb|g)\s*(?:\bram\b|\bmemory\b|内存|記憶體)/gi)].map((match) => Number(match[1]));
  const ramLabeled = normalized.match(/(?:\bram\b|(?<!gpu\s)(?<!graphics\s)(?<!video\s)\bmemory\b|(?<!gpu)(?<!gpu\s)(?<!显)(?<!顯)内存|(?<!gpu)(?<!gpu\s)記憶體)[^0-9]{0,12}(\d{1,3})\s*(?:gb|g)/i);

  if (unified) {
    const ram = Number(unified[1]);
    add("ram", ram, "high", "reasonUnifiedMemory");
    add("vram", Math.max(4, Math.floor(ram * 0.75)), "medium", "reasonUnifiedVramEstimate");
  } else if (ramLabeled) {
    add("ram", Number(ramLabeled[1]), "high", "reasonRamLabel");
  } else if (ramMatches.length) {
    add("ram", Math.max(...ramMatches), "medium", "reasonMemoryWording");
  }
  if (ramMatches.length > 1 && new Set(ramMatches).size > 1) warnings.push("warningMultipleRam");

  const labeledVram = normalized.match(/(\d{1,3})\s*(?:gb|g)\s*(?:vram|gpu memory|graphics memory|video memory|gddr|显存|顯存|gpu内存|gpu記憶體)/i)
    || normalized.match(/(?:vram|gpu memory|graphics memory|video memory|gddr|显存|顯存|gpu内存|gpu記憶體)[^0-9]{0,20}(\d{1,3})\s*(?:gb|g)/i);
  if (labeledVram) {
    add("vram", Number(labeledVram[1]), "high", "reasonVramLabel");
  } else if (fields.gpuModel && fields.gpuVendor && fields.gpuVendor.value !== "apple") {
    const modelText = String(fields.gpuModel.value).toLowerCase();
    const gpuIndex = lower.indexOf(modelText);
    const nearGpu = gpuIndex >= 0 ? normalized.slice(gpuIndex, gpuIndex + Math.min(64, fields.gpuModel.value.length + 24)) : "";
    const nearby = nearGpu.match(/(\d{1,2})\s*(?:gb|g)\b(?!\s*(?:ram|memory|内存|記憶體))/i);
    if (nearby) add("vram", Number(nearby[1]), "medium", "reasonVramNearGpu");
  }

  const storage = normalized.match(/(\d+(?:\.\d+)?)\s*(tb|gb|t|g)\s*(?:ssd|storage|drive|disk|存储|存儲|硬盘|硬碟|固态硬盘|固態硬碟)/i)
    || normalized.match(/(?:ssd|storage|drive|disk|存储|存儲|硬盘|硬碟|固态硬盘|固態硬碟)[^0-9]{0,16}(\d+(?:\.\d+)?)\s*(tb|gb|t|g)/i);
  if (storage) {
    const unit = storage[2].toLowerCase();
    add("storage", Math.round(Number(storage[1]) * (unit === "tb" || unit === "t" ? 1000 : 1)), "medium", "reasonStorage");
  }

  if (/coding assistant|code assistant|programming|coding|编程|編程|代码助手|代碼助手|写代码|寫代碼/.test(lower)) {
    add("task", "coding-llm", "medium", "reasonCodingTask");
  } else if (/image generation|stable diffusion|sdxl|flux|text-to-image|图像生成|圖像生成|文生图|文生圖|绘图|繪圖/.test(lower)) {
    add("task", "image-generation", "medium", "reasonImageTask");
  } else if (/transcription|speech to text|speech-to-text|whisper|转录|轉錄|语音转文字|語音轉文字|语音识别|語音識別/.test(lower)) {
    add("task", "speech-to-text", "medium", "reasonSpeechTask");
  } else if (/rag|search|embedding|retrieval|检索|檢索|搜索|向量|知识库|知識庫/.test(lower)) {
    add("task", "embeddings", "medium", "reasonEmbeddingTask");
  } else if (/chat|writing|assistant|对话|對話|写作|寫作|聊天/.test(lower)) {
    add("task", "chat-llm", "low", "reasonChatTask");
  }

  return { fields, warnings };
}
