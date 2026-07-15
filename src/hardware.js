export function deriveCpuProfile(cpuModel) {
  const text = cpuModel.toLowerCase();
  if (!text) return { level: "unknown", label: "Unknown CPU", confidence: "low" };
  if (/threadripper|epyc|xeon/.test(text)) return { level: "server", label: cpuModel, confidence: "high" };
  if (/m[1-4]\s*(ultra|max)/.test(text)) return { level: "server", label: cpuModel, confidence: "high" };
  if (/m[1-4]\s*pro/.test(text)) return { level: "high", label: cpuModel, confidence: "high" };
  if (/apple|m[1-4]/.test(text)) return { level: "mid", label: cpuModel, confidence: "medium" };
  if (/i9|ryzen\s*9/.test(text)) return { level: "high", label: cpuModel, confidence: "high" };
  if (/i7|ryzen\s*7/.test(text)) return { level: "high", label: cpuModel, confidence: "high" };
  if (/i5|ryzen\s*5/.test(text)) return { level: "mid", label: cpuModel, confidence: "high" };
  if (/i3|ryzen\s*3|celeron|pentium/.test(text)) return { level: "low", label: cpuModel, confidence: "high" };
  return { level: "unknown", label: cpuModel, confidence: "low" };
}

export function deriveGpuProfile(gpuModel, selectedVendor) {
  const text = gpuModel.toLowerCase();
  if (/no dedicated|cpu only|cpu-only|none|without gpu|no gpu|无独立显卡|没有独显|仅\s*cpu/.test(text) || (selectedVendor === "none" && !text)) {
    return { vendor: "none", level: "none", label: gpuModel || "CPU only", confidence: "high" };
  }

  let vendor = selectedVendor === "none" ? "" : selectedVendor;
  if (/rtx|gtx|nvidia|quadro|tesla|a\d{3,5}/.test(text)) vendor = "nvidia";
  if (/radeon|rx\s*\d|amd/.test(text)) vendor = "amd";
  if (/arc\s*[a-z]?\d|iris|uhd|intel/.test(text)) vendor = vendor || "intel";
  if (/apple|m[1-4]\s*(pro|max|ultra)?/.test(text)) vendor = "apple";
  if (!vendor) return { vendor: selectedVendor, level: "unknown", label: gpuModel || "Unknown GPU", confidence: "low" };

  let level = "unknown";
  if (vendor === "apple") level = /ultra|max/.test(text) ? "high" : /pro/.test(text) ? "mid" : "integrated";
  if (vendor === "nvidia") {
    if (/4090|4080|3090|3080|a5000|a6000/.test(text)) level = "high";
    else if (/4070|4060|3070|3060|2080|2070/.test(text)) level = "mid";
    else if (/gtx|3050|2060/.test(text)) level = "entry";
  }
  if (vendor === "amd") {
    if (/7900|6900|6800/.test(text)) level = "high";
    else if (/7800|7700|6700|6600/.test(text)) level = "mid";
    else level = "entry";
  }
  if (vendor === "intel") level = /arc/.test(text) ? "mid" : "integrated";
  return { vendor, level, label: gpuModel || vendor, confidence: level === "unknown" ? "low" : "high" };
}
