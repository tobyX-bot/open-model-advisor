const requiredFields = [
  "id", "displayName", "category", "categoryLabel", "modelCategory", "recommendationCategory",
  "taskCategories", "modalities", "exampleModels", "sizeClass", "memoryTier", "minRamGb",
  "recommendedRamGb", "minVramGb", "recommendedVramGb", "estimatedStorageGb", "gpuImportance",
  "supportedGpuVendors", "runtimeOptions", "setupDifficulty", "qualityTier", "speedTier",
  "commercialUse", "deploymentModes", "workloadFit", "localFitNotes", "licenseNotes",
  "sourceLinks", "lastReviewed", "avoidNotes", "cloudFallback", "starterRecommendation"
];

const starterFields = ["family", "sizeAndQuantization", "preferredRuntime", "hardwareFitNote", "avoidNote"];
const allowedCategories = new Set(["chat-llm", "coding-llm", "image-generation", "speech-to-text", "embeddings"]);
const allowedCommercial = new Set(["likely-allowed", "check-license", "restricted", "unknown"]);
const allowedWorkloads = new Set(["casual", "daily", "batch", "production", "latency", "quality"]);
const allowedGpuVendors = new Set(["none", "apple", "nvidia", "amd", "intel"]);
const allowedGpuImportance = new Set(["none", "low", "medium", "high", "required"]);

export function validateCatalog(data) {
  if (!data || !Array.isArray(data.models)) throw new Error("Catalog root must include models array");

  data.models.forEach((model) => {
    requiredFields.forEach((field) => {
      if (!(field in model)) throw new Error(`Catalog entry ${model.id || "unknown"} is missing ${field}`);
    });
    starterFields.forEach((field) => {
      if (!model.starterRecommendation[field]) throw new Error(`${model.id} starterRecommendation is missing ${field}`);
    });
    if (!allowedCategories.has(model.category)) throw new Error(`Unsupported category ${model.category}`);
    if (!allowedCommercial.has(model.commercialUse)) throw new Error(`Unsupported commercialUse ${model.commercialUse}`);
    ["taskCategories", "exampleModels", "supportedGpuVendors", "runtimeOptions", "deploymentModes", "workloadFit", "sourceLinks"].forEach((field) => {
      if (!Array.isArray(model[field])) throw new Error(`${model.id} ${field} must be an array`);
    });
    if (!allowedGpuImportance.has(model.gpuImportance)) throw new Error(`${model.id} has unsupported gpuImportance`);
    model.supportedGpuVendors.forEach((vendor) => {
      if (!allowedGpuVendors.has(vendor)) throw new Error(`${model.id} has unsupported GPU vendor ${vendor}`);
    });
    model.workloadFit.forEach((workload) => {
      if (!allowedWorkloads.has(workload)) throw new Error(`${model.id} has unsupported workload ${workload}`);
    });
    if (!model.sourceLinks.length) throw new Error(`${model.id} requires at least one source link`);
    model.sourceLinks.forEach((link, index) => {
      if (!link || typeof link !== "object") throw new Error(`${model.id} sourceLinks[${index}] must be an object`);
      if (typeof link.url !== "string" || typeof link.label !== "string") {
        throw new Error(`${model.id} sourceLinks[${index}] requires string label and url`);
      }
    });
  });

  return data;
}

export async function loadCatalog(url = "models.json") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return validateCatalog(await response.json());
}
