const GPU_VENDORS = new Set(["nvidia", "amd", "intel", "apple", "none"]);

function normalizedText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function deriveCpuProfile(cpuModel) {
  const text = normalizedText(cpuModel);
  const label = typeof cpuModel === "string" && cpuModel.trim() ? cpuModel : "Unknown CPU";
  if (!text) return { level: "unknown", label, confidence: "low" };

  if (/\b(?:threadripper|epyc|xeon)\b/.test(text)) {
    return { level: "server", label, confidence: "high" };
  }

  const appleModel = /(?:\bapple\b[^;,:|]*\bm[1-4]|^m[1-4])(?:\s*(ultra|max|pro))?\b/.exec(text);
  if (appleModel) {
    const suffix = appleModel[1];
    if (suffix === "ultra" || suffix === "max") {
      return { level: "server", label, confidence: "high" };
    }
    if (suffix === "pro") return { level: "high", label, confidence: "high" };
    return { level: "mid", label, confidence: "medium" };
  }

  const coreUltra = /\bcore\s+ultra\s+(9|7|5)\b/.exec(text);
  if (coreUltra) {
    return {
      level: coreUltra[1] === "5" ? "mid" : "high",
      label,
      confidence: "high"
    };
  }

  const intelCore = /\b(?:intel\s+)?(?:core\s+)?i(9|7|5|3)(?:-\d{3,5}[a-z]{0,3})?\b/.exec(text);
  const ryzen = /\bryzen\s+(9|7|5|3)\b/.exec(text);
  const familyTier = intelCore?.[1] || ryzen?.[1];
  if (familyTier) {
    const level = familyTier === "9" || familyTier === "7"
      ? "high"
      : familyTier === "5" ? "mid" : "low";
    return { level, label, confidence: "high" };
  }

  if (/\b(?:celeron|pentium)\b/.test(text)) {
    return { level: "low", label, confidence: "high" };
  }
  return { level: "unknown", label, confidence: "low" };
}

function hasNoGpuEvidence(text) {
  return /(?:\bno\s+(?:dedicated\s+)?gpu\b|\bno\s+dedicated\b|\bcpu[ -]only\b|\bwithout\s+(?:a\s+)?(?:dedicated\s+)?gpu\b|^none$|无独立显卡|没有独显|仅\s*cpu)/.test(text);
}

function detectGpuVendors(text) {
  const detected = [];
  if (/\b(?:nvidia|geforce|quadro|tesla)\b|\b(?:rtx|gtx)\s*(?:a\s*)?\d{3,5}\b/.test(text)) {
    detected.push("nvidia");
  }
  if (/\b(?:amd|radeon)\b|\brx\s*\d{4}\b/.test(text)) detected.push("amd");
  if (/\bintel\b|\barc\s+[a-z]\d{3}\b|\biris(?:\s+xe)?\b|\buhd(?:\s+graphics)?\b/.test(text)) {
    detected.push("intel");
  }
  if (/\bapple\b|\bm[1-4](?:\s*(?:pro|max|ultra))?\b/.test(text)) detected.push("apple");
  return detected;
}

function gpuLevel(vendor, text) {
  if (vendor === "apple") {
    if (/\b(?:ultra|max)\b/.test(text)) return "high";
    if (/\bpro\b/.test(text)) return "mid";
    return "integrated";
  }

  if (vendor === "nvidia") {
    if (/\b(?:5090|5080|4090|4080|3090|3080)\b|\ba(?:5000|6000)\b|\b(?:quadro\s+)?rtx\s+(?:5000|6000)\b/.test(text)) {
      return "high";
    }
    if (/\b(?:5070|5060|4070|4060|3070|3060|2080|2070)\b|\ba(?:4000|4500)\b|\b(?:quadro\s+)?rtx\s+4000\b/.test(text)) {
      return "mid";
    }
    if (/\b5050\b|\bgtx\b|\b(?:3050|2060)\b|\ba2000\b|\b(?:quadro\s+)?rtx\s+2000\b/.test(text)) {
      return "entry";
    }
  }

  if (vendor === "amd") {
    if (/\b(?:9070|7900|6900|6800)\b/.test(text)) return "high";
    if (/\b(?:9060|7800|7700|6700|6600)\b/.test(text)) return "mid";
    if (/\b(?:radeon|rx)\b/.test(text)) return "entry";
  }

  if (vendor === "intel") {
    if (/\barc\s+[ab]\d{3}\b/.test(text) || /\barc\b/.test(text)) return "mid";
    if (/\b(?:iris|uhd|intel)\b/.test(text)) return "integrated";
  }
  return "unknown";
}

function gpuResult({ vendor, detectedVendor, level, label, confidence, conflict = false, reason = null }) {
  return { vendor, detectedVendor, level, label, confidence, conflict, reason };
}

export function deriveGpuProfile(gpuModel, selectedVendor) {
  const text = normalizedText(gpuModel);
  const label = typeof gpuModel === "string" && gpuModel.trim() ? gpuModel : "Unknown GPU";
  const normalizedSelectedVendor = normalizedText(selectedVendor);
  const hasSelectedVendor = GPU_VENDORS.has(normalizedSelectedVendor);

  if (!text) {
    if (normalizedSelectedVendor === "none") {
      return gpuResult({
        vendor: selectedVendor,
        detectedVendor: null,
        level: "none",
        label: "CPU only",
        confidence: "high"
      });
    }
    return gpuResult({
      vendor: selectedVendor,
      detectedVendor: null,
      level: "unknown",
      label,
      confidence: "low"
    });
  }

  if (hasNoGpuEvidence(text)) {
    if (hasSelectedVendor && normalizedSelectedVendor !== "none") {
      return gpuResult({
        vendor: selectedVendor,
        detectedVendor: "none",
        level: "unknown",
        label,
        confidence: "low",
        conflict: true,
        reason: "no-gpu-mismatch"
      });
    }
    return gpuResult({
      vendor: hasSelectedVendor ? selectedVendor : "none",
      detectedVendor: "none",
      level: "none",
      label: typeof gpuModel === "string" && gpuModel.trim() ? gpuModel : "CPU only",
      confidence: "high"
    });
  }

  const detectedVendors = detectGpuVendors(text);
  if (detectedVendors.length > 1) {
    return gpuResult({
      vendor: selectedVendor,
      detectedVendor: detectedVendors.join("+"),
      level: "unknown",
      label,
      confidence: "low",
      conflict: true,
      reason: "multiple-model-vendors"
    });
  }

  const detectedVendor = detectedVendors[0] || null;
  if (hasSelectedVendor && detectedVendor && normalizedSelectedVendor !== detectedVendor) {
    return gpuResult({
      vendor: selectedVendor,
      detectedVendor,
      level: "unknown",
      label,
      confidence: "low",
      conflict: true,
      reason: "vendor-mismatch"
    });
  }

  const vendor = hasSelectedVendor ? selectedVendor : detectedVendor || selectedVendor;
  const tierVendor = hasSelectedVendor ? normalizedSelectedVendor : detectedVendor;
  const level = tierVendor && tierVendor !== "none" ? gpuLevel(tierVendor, text) : "unknown";
  return gpuResult({
    vendor,
    detectedVendor,
    level,
    label,
    confidence: level === "unknown" ? "low" : "high"
  });
}
