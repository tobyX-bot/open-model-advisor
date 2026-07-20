const requiredFields = [
  "id", "familyId", "displayName", "category", "categoryLabel", "modelCategory", "recommendationCategory",
  "taskCategories", "modalities", "exampleModels", "sizeClass", "memoryTier", "minRamGb",
  "recommendedRamGb", "minVramGb", "recommendedVramGb", "estimatedStorageGb", "gpuImportance",
  "supportedGpuVendors", "runtimeOptions", "setupDifficulty", "qualityTier", "speedTier",
  "commercialUse", "deploymentModes", "workloadFit", "localFitNotes", "licenseNotes",
  "supportedLanguages", "evidenceConfidence", "sourceLinks", "runtimeGuides", "lastReviewed",
  "avoidNotes", "cloudFallback", "starterRecommendation"
];

const starterFields = ["family", "sizeAndQuantization", "preferredRuntime", "hardwareFitNote", "avoidNote"];
const allowedCategories = new Set(["chat-llm", "coding-llm", "image-generation", "speech-to-text", "embeddings"]);
const allowedCommercial = new Set(["likely-allowed", "check-license", "restricted", "unknown"]);
const allowedWorkloads = new Set(["casual", "daily", "batch", "production", "latency", "quality"]);
const allowedGpuVendors = new Set(["none", "apple", "nvidia", "amd", "intel"]);
const allowedGpuImportance = new Set(["none", "low", "medium", "high", "required"]);
const allowedLanguages = new Set(["en", "zh"]);
const allowedEvidenceConfidence = new Set(["low", "medium", "high"]);
const allowedSourceKinds = new Set([
  "official-model-card",
  "official-documentation",
  "official-repository",
  "official-announcement",
  "official-site",
  "research-paper"
]);
const reviewedDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

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
    if (!Array.isArray(model.supportedLanguages) || !model.supportedLanguages.length) {
      throw new Error(`${model.id} supportedLanguages must be a non-empty array`);
    }
    if (new Set(model.supportedLanguages).size !== model.supportedLanguages.length) {
      throw new Error(`${model.id} supportedLanguages must not contain duplicates`);
    }
    model.supportedLanguages.forEach((language) => {
      if (!allowedLanguages.has(language)) throw new Error(`${model.id} has unsupported supportedLanguages code ${language}`);
    });
    if (!allowedEvidenceConfidence.has(model.evidenceConfidence)) throw new Error(`${model.id} has unsupported evidenceConfidence`);
    ["taskCategories", "exampleModels", "supportedGpuVendors", "runtimeOptions", "deploymentModes", "workloadFit", "sourceLinks", "runtimeGuides"].forEach((field) => {
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
    if (model.sourceLinks[0]?.kind !== "official-model-card") {
      throw new Error(`${model.id} first source must be an official model card`);
    }
    if (!model.sourceLinks.some((link) => link.kind === "official-model-card")) {
      throw new Error(`${model.id} requires an official model card`);
    }
    model.sourceLinks.forEach((link, index) => {
      if (!link || typeof link !== "object") throw new Error(`${model.id} sourceLinks[${index}] must be an object`);
      if (typeof link.label !== "string" || !link.label || typeof link.publisher !== "string" || !link.publisher) {
        throw new Error(`${model.id} sourceLinks[${index}] requires label and publisher`);
      }
      if (!isHttpsUrl(link.url)) throw new Error(`${model.id} sourceLinks[${index}] requires an HTTPS url`);
      if (!allowedSourceKinds.has(link.kind)) throw new Error(`${model.id} sourceLinks[${index}] has unsupported kind`);
      if (!reviewedDatePattern.test(link.verifiedAt)) throw new Error(`${model.id} sourceLinks[${index}] requires verifiedAt YYYY-MM-DD`);
    });
    if (!model.runtimeGuides.length) throw new Error(`${model.id} requires at least one runtime guide`);
    model.runtimeGuides.forEach((guide, index) => {
      if (!guide || typeof guide !== "object") throw new Error(`${model.id} runtimeGuides[${index}] must be an object`);
      ["runtime", "label", "publisher"].forEach((field) => {
        if (typeof guide[field] !== "string" || !guide[field]) {
          throw new Error(`${model.id} runtimeGuides[${index}] requires ${field}`);
        }
      });
      if (!isHttpsUrl(guide.url)) throw new Error(`${model.id} runtimeGuides[${index}] requires an HTTPS url`);
      if (guide.official !== true) throw new Error(`${model.id} runtimeGuides[${index}] must be official`);
    });
  });

  return data;
}

export async function loadCatalog(url = "models.json") {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return validateCatalog(await response.json());
}
