import { helperSetups, presets, stageIds } from "./config.js";
import { loadCatalog } from "./catalog.js";
import { deriveCpuProfile, deriveGpuProfile } from "./hardware.js";
import { readStoredLanguage, taskLabels, translate, writeStoredLanguage } from "./i18n.js";
import { createModelCopy } from "./model-copy.js";
import { renderHardwareFacts, renderNotice, renderRecommendations, renderScanReview } from "./render.js";
import { compatible, scoreModel } from "./scoring.js";
import { scanSetupText } from "./scanner.js";

let catalog = null;
let catalogStatus = "loading";
let currentLanguage = readStoredLanguage();
let pendingScan = null;
let scanInProgress = false;
let scanTimer = null;
let scanMessage = { key: "scanIdle", variables: {}, warnings: [] };
let profileOrigin = "example";
let profileConfirmed = false;
let hasConfirmedOnce = false;

const form = document.getElementById("advisorForm");
const resultsEl = document.getElementById("results");
const messageArea = document.getElementById("messageArea");
const summaryText = document.getElementById("summaryText");
const selectedPreset = document.getElementById("selectedPreset");
const scanSummary = document.getElementById("scanSummary");
const detectedFields = document.getElementById("detectedFields");
const applyDetected = document.getElementById("applyDetected");
const hardwareFacts = document.getElementById("hardwareFacts");
const provenanceLabel = document.getElementById("provenanceLabel");
const profileNote = document.getElementById("profileNote");
const confirmSpecs = document.getElementById("confirmSpecs");
const taskControl = document.getElementById("task");
const taskLockHint = document.getElementById("taskLockHint");
const digRail = document.getElementById("digRail");
const scanChamber = document.getElementById("scanChamber");
const statusRegion = document.getElementById("statusRegion");
const manualDetails = document.getElementById("manualDetails");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function t(key, variables = {}) {
  return translate(currentLanguage, key, variables);
}

function announce(message) {
  statusRegion.textContent = "";
  window.requestAnimationFrame(() => {
    statusRegion.textContent = message;
  });
}

function setField(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value;
}

function getState() {
  const selectedGpuVendor = form.gpuVendor.value;
  const cpuModel = form.cpuModel.value.trim();
  const gpuModel = form.gpuModel.value.trim();
  const cpuProfile = deriveCpuProfile(cpuModel);
  const gpuProfile = deriveGpuProfile(gpuModel, selectedGpuVendor);
  const effectiveGpuVendor = gpuProfile.vendor || selectedGpuVendor;
  return {
    os: form.os.value,
    deviceType: form.deviceType.value,
    cpuModel,
    gpuModel,
    cpuProfile,
    gpuProfile,
    ram: Number(form.ram.value || 0),
    gpuVendor: effectiveGpuVendor,
    selectedGpuVendor,
    vram: effectiveGpuVendor === "none" ? 0 : Number(form.vram.value || 0),
    storage: Number(form.storage.value || 0),
    internet: form.internet.value,
    deployment: form.deployment.value,
    task: form.task.value,
    workload: form.workload.value,
    priorities: Array.from(form.querySelectorAll('input[name="priority"]:checked')).map((input) => input.value)
  };
}

function syncVramAvailability() {
  const vramInput = document.getElementById("vram");
  const gpuVendorInput = document.getElementById("gpuVendor");
  const gpuProfile = deriveGpuProfile(document.getElementById("gpuModel").value, gpuVendorInput.value);
  if (gpuProfile.confidence !== "low" && gpuProfile.vendor && gpuProfile.vendor !== gpuVendorInput.value) {
    gpuVendorInput.value = gpuProfile.vendor;
  }
  const noGpu = gpuProfile.vendor === "none";
  if (noGpu) vramInput.value = 0;
  vramInput.disabled = noGpu;
  vramInput.setAttribute("aria-disabled", String(noGpu));
}

function hardwareInputsValid() {
  return ["ram", "vram", "storage"].every((id) => {
    const field = document.getElementById(id);
    return field.disabled || field.checkValidity();
  });
}

function applyPreset(name, options = {}) {
  const { origin = "preset", confirmed = false, renderNow = true } = options;
  const preset = presets[name] || presets["basic-laptop"];
  Object.entries(preset).forEach(([key, value]) => setField(key, value));
  syncVramAvailability();
  document.getElementById("preset").value = name;
  profileOrigin = origin;
  profileConfirmed = confirmed;
  if (confirmed) hasConfirmedOnce = true;
  updateProfileState();
  if (renderNow) render();
}

function markCustom() {
  document.getElementById("preset").value = "custom";
  profileOrigin = "manual";
  profileConfirmed = false;
  updateProfileState();
}

function updatePresetLabel() {
  const select = document.getElementById("preset");
  const option = select.options[select.selectedIndex];
  selectedPreset.textContent = t("selectedPreset", { preset: option ? option.textContent : t("presetCustom") });
}

function provenanceKey() {
  if (profileConfirmed && profileOrigin === "scan") return "provenanceScan";
  if (profileOrigin === "scan") return "provenanceScanPending";
  if (profileConfirmed) return "provenanceConfirmed";
  if (profileOrigin === "preset") return "provenancePreset";
  if (profileOrigin === "manual") return "provenanceManual";
  return "provenanceExample";
}

function updateProfileState() {
  provenanceLabel.textContent = t(provenanceKey());
  profileNote.textContent = profileConfirmed
    ? t("specsConfirmed")
    : profileOrigin === "scan"
      ? t("scanReviewNeeded")
    : hasConfirmedOnce
      ? t("changedAfterConfirmation")
      : t("confirmationNeeded");
  confirmSpecs.disabled = profileConfirmed;
  confirmSpecs.querySelector("span").textContent = profileConfirmed ? t("specsConfirmed") : t("confirmSpecs");
  taskControl.disabled = !hasConfirmedOnce;
  taskControl.setAttribute("aria-disabled", String(!hasConfirmedOnce));
  taskLockHint.hidden = hasConfirmedOnce;
  updatePresetLabel();
}

function setStage(stage) {
  const activeIndex = Math.max(0, stageIds.indexOf(stage));
  digRail.dataset.stage = stageIds[activeIndex];
  digRail.querySelectorAll("[data-stage-id]").forEach((node, index) => {
    node.classList.toggle("is-active", index === activeIndex);
    node.classList.toggle("is-complete", index < activeIndex);
    if (index === activeIndex) node.setAttribute("aria-current", "step");
    else node.removeAttribute("aria-current");
  });
}

function derivedStage(state, hasResults = false) {
  if (scanInProgress) return "scan";
  if (hasResults) return "recommendation";
  if (profileConfirmed && state.task) return "match";
  if (hasConfirmedOnce) return "match";
  if (pendingScan) return "extract";
  return "raw";
}

function setScanMessage(key, variables = {}, warnings = []) {
  scanMessage = { key, variables, warnings };
  updateScanSummary();
}

function updateScanSummary() {
  const warningText = scanMessage.warnings.map((key) => t(key)).join(" ");
  scanSummary.textContent = `${t(scanMessage.key, scanMessage.variables)}${warningText ? ` ${warningText}` : ""}`;
}

function renderScan() {
  detectedFields.innerHTML = renderScanReview(pendingScan, { t, taskNames: taskLabels(t) });
  applyDetected.disabled = !pendingScan || !Object.keys(pendingScan.fields).length;
  updateScanSummary();
}

function renderHardware() {
  const state = getState();
  hardwareFacts.innerHTML = renderHardwareFacts(state, { t });
  updateProfileState();
  return state;
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  document.title = t("documentTitle");
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    const isActive = button.dataset.language === currentLanguage;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateCatalogFreshness() {
  const freshness = document.getElementById("catalogFreshness");
  if (catalogStatus === "ready") freshness.textContent = t("catalogFreshness", { freshness: catalog.catalogFreshness || "unknown" });
  else if (catalogStatus === "error") freshness.textContent = t("catalogUnavailable");
  else freshness.textContent = t("catalogLoading");
}

function applyLanguage(language) {
  currentLanguage = language === "zh" ? "zh" : "en";
  writeStoredLanguage(currentLanguage);
  applyStaticTranslations();
  updateCatalogFreshness();
  updateProfileState();
  renderScan();
  render();
}

function runScan(text) {
  window.clearTimeout(scanTimer);
  const input = text.trim();
  if (!input) {
    pendingScan = null;
    scanInProgress = false;
    scanChamber.classList.remove("is-scanning");
    setScanMessage("scanEmpty");
    renderScan();
    setStage("raw");
    announce(t("scanEmpty"));
    return;
  }

  scanInProgress = true;
  scanChamber.classList.add("is-scanning");
  setStage("scan");
  const delay = prefersReducedMotion.matches ? 0 : 520;
  scanTimer = window.setTimeout(() => {
    pendingScan = scanSetupText(input);
    scanInProgress = false;
    scanChamber.classList.remove("is-scanning");
    const count = Object.keys(pendingScan.fields).length;
    setScanMessage(count ? "scanFound" : "scanNoFields", count ? { count } : {}, pendingScan.warnings);
    renderScan();
    setStage(count ? "extract" : "raw");
    announce(scanSummary.textContent);
  }, delay);
}

function applyPendingScan() {
  if (!pendingScan) return;
  const currentTask = form.task.value;
  Object.entries(pendingScan.fields).forEach(([field, detected]) => {
    if (field === "task" && currentTask) return;
    setField(field, detected.value);
  });
  syncVramAvailability();
  document.getElementById("preset").value = "custom";
  profileOrigin = "scan";
  profileConfirmed = false;
  const skippedTask = Boolean(pendingScan.fields.task && currentTask);
  pendingScan = null;
  setScanMessage(skippedTask ? "scanApplied" : "scanApplied", {}, skippedTask ? ["scanTaskSkipped"] : []);
  renderScan();
  render({ reveal: Boolean(form.task.value) });
  announce(scanSummary.textContent);
}

function scoreCatalog(state) {
  const copy = createModelCopy({ language: currentLanguage, t });
  const scoreContext = {
    t,
    language: currentLanguage,
    taskLabel: taskLabels(t)[state.task],
    setupDifficultyLabel: copy.setupDifficultyLabel,
    licenseSummary: copy.licenseSummary
  };
  return {
    copy,
    scored: catalog.models
      .map((model) => ({ model, compatibility: compatible(model, state) }))
      .filter((item) => item.compatibility.ok)
      .map((item) => ({ ...item, score: scoreModel(item.model, state, scoreContext) }))
      .sort((a, b) => b.score.total - a.score.total || a.model.displayName.localeCompare(b.model.displayName))
  };
}

function revealResults() {
  resultsEl.classList.remove("is-revealing");
  if (prefersReducedMotion.matches) return;
  window.requestAnimationFrame(() => resultsEl.classList.add("is-revealing"));
  window.setTimeout(() => resultsEl.classList.remove("is-revealing"), 760);
}

function render(options = {}) {
  const { reveal = false } = options;
  const state = renderHardware();
  messageArea.innerHTML = "";

  if (catalogStatus === "error") {
    summaryText.textContent = t("catalogLoadSummary");
    resultsEl.innerHTML = "";
    setStage(derivedStage(state));
    return;
  }
  if (!catalog) {
    summaryText.textContent = t("chooseTask");
    resultsEl.innerHTML = "";
    setStage(derivedStage(state));
    return;
  }
  if (!hasConfirmedOnce) {
    summaryText.textContent = t("chooseTask");
    messageArea.innerHTML = renderNotice("info", t("initialPromptTitle"), t("initialPromptBody"));
    resultsEl.innerHTML = "";
    setStage(derivedStage(state));
    return;
  }
  if (!hardwareInputsValid()) {
    summaryText.textContent = t("invalidHardwareSummary");
    messageArea.innerHTML = renderNotice("bad", t("invalidHardwareTitle"), t("invalidHardwareBody"));
    resultsEl.innerHTML = "";
    setStage("match");
    return;
  }
  if (!state.task) {
    summaryText.textContent = t("chooseTask");
    messageArea.innerHTML = renderNotice("info", t("initialPromptTitle"), t("initialPromptBody"));
    resultsEl.innerHTML = "";
    setStage(derivedStage(state));
    return;
  }

  const categoryCount = catalog.models.filter((model) => model.taskCategories.includes(state.task)).length;
  if (categoryCount === 0) {
    summaryText.textContent = t("noCoverageSummary");
    messageArea.innerHTML = renderNotice("bad", t("noCoverageTitle"), t("noCoverageBody"));
    resultsEl.innerHTML = "";
    setStage("match");
    return;
  }

  const { copy, scored } = scoreCatalog(state);
  const top = scored.filter((item) => item.model.deploymentModes.includes("local")).slice(0, 3);
  const weakHardware = top.length > 0 && top.every((item) => item.score.total < 60);
  const noLocalFit = !top.length || top.every((item) => item.score.total < 40);
  const fallbackNeeded = noLocalFit || weakHardware;
  const messages = [];

  if (!profileConfirmed && hasConfirmedOnce) messages.push(renderNotice("warn", t("reviewChangedTitle"), t("reviewChangedBody")));
  if (state.workload === "production") messages.push(renderNotice("warn", t("productionTitle"), t("productionBody")));
  if (state.cpuProfile.confidence === "low" || state.gpuProfile.confidence === "low") {
    messages.push(renderNotice("warn", t("lowConfidenceTitle"), t("lowConfidenceBody")));
  }
  if (weakHardware) messages.push(renderNotice("warn", t("weakHardwareTitle"), t("weakHardwareBody")));
  if (noLocalFit) messages.push(renderNotice("bad", t("noLocalFitTitle"), t("noLocalFitBody")));
  if (state.deployment === "local-only" && noLocalFit) messages.push(renderNotice("warn", t("localOnlyTitle"), t("localOnlyBody")));
  if (state.deployment !== "local-only" && fallbackNeeded) {
    messages.push(renderNotice("info", t("hostedFallbackTitle"), t("hostedFallbackWeak")));
  } else if (state.deployment === "cloud-ok") {
    messages.push(renderNotice("info", t("hostedFallbackTitle"), t("hostedFallbackOk")));
  }
  messageArea.innerHTML = messages.join("");

  const taskName = taskLabels(t)[state.task];
  summaryText.textContent = !top.length
    ? t("noCompatibleSummary", { task: taskName })
    : noLocalFit
      ? t("leastBadSummary", { count: top.length, task: taskName })
      : t("resultsSummary", { count: top.length, task: taskName });

  resultsEl.innerHTML = renderRecommendations(top, state, { t, language: currentLanguage, copy });
  setStage(derivedStage(state, Boolean(top.length)));
  if (reveal && top.length) revealResults();
}

async function initializeCatalog() {
  catalogStatus = "loading";
  updateCatalogFreshness();
  try {
    catalog = await loadCatalog("models.json");
    catalogStatus = "ready";
    updateCatalogFreshness();
    render();
  } catch (error) {
    catalog = null;
    catalogStatus = "error";
    updateCatalogFreshness();
    summaryText.textContent = t("catalogLoadSummary");
    messageArea.innerHTML = renderNotice("bad", t("catalogLoadTitle"), t("catalogLoadBody"));
    resultsEl.innerHTML = "";
    announce(t("catalogLoadSummary"));
  }
}

function bindEvents() {
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => applyLanguage(button.dataset.language));
  });

  document.querySelectorAll("[data-helper]").forEach((button) => {
    button.addEventListener("click", () => {
      const example = helperSetups[button.dataset.helper];
      document.getElementById("setupPaste").value = example;
      runScan(example);
    });
  });

  document.getElementById("scanSetup").addEventListener("click", () => {
    runScan(document.getElementById("setupPaste").value);
  });

  applyDetected.addEventListener("click", applyPendingScan);

  document.getElementById("clearDetected").addEventListener("click", () => {
    window.clearTimeout(scanTimer);
    document.getElementById("setupPaste").value = "";
    pendingScan = null;
    scanInProgress = false;
    scanChamber.classList.remove("is-scanning");
    setScanMessage("scanCleared");
    renderScan();
    render();
  });

  document.getElementById("preset").addEventListener("change", (event) => {
    if (event.target.value !== "custom") applyPreset(event.target.value, { origin: "preset", renderNow: false });
    updateProfileState();
    render();
  });

  ["os", "deviceType", "cpuModel", "ram", "gpuModel", "vram", "storage"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      syncVramAvailability();
      markCustom();
      render();
    });
  });

  document.getElementById("gpuVendor").addEventListener("change", (event) => {
    document.getElementById("gpuModel").value = event.target.value === "apple" ? "Apple unified GPU" : "";
    syncVramAvailability();
    markCustom();
    render();
  });

  ["internet", "deployment"].forEach((id) => {
    document.getElementById(id).addEventListener("change", render);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render({ reveal: true });
    announce(summaryText.textContent);
    document.getElementById("primaryRecommendation")?.focus({ preventScroll: false });
  });

  form.addEventListener("change", (event) => {
    if (["task", "workload", "priority"].includes(event.target.name)) render();
  });

  confirmSpecs.addEventListener("click", () => {
    const invalidField = ["ram", "vram", "storage"]
      .map((id) => document.getElementById(id))
      .find((field) => !field.disabled && !field.checkValidity());
    if (invalidField) {
      profileConfirmed = false;
      manualDetails.open = true;
      profileNote.textContent = t("invalidHardwareBody");
      invalidField.reportValidity();
      invalidField.focus();
      announce(t("invalidHardwareBody"));
      return;
    }
    profileConfirmed = true;
    hasConfirmedOnce = true;
    updateProfileState();
    render();
  });

  document.getElementById("reviewDetails").addEventListener("click", () => {
    manualDetails.open = true;
    manualDetails.scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth", block: "start" });
  });

  document.getElementById("resetPreset").addEventListener("click", () => {
    const preset = document.getElementById("preset").value === "custom" ? "basic-laptop" : document.getElementById("preset").value;
    applyPreset(preset, { origin: preset === "basic-laptop" ? "example" : "preset", renderNow: false });
    render();
  });

  document.getElementById("clearTask").addEventListener("click", () => {
    form.task.value = "";
    render();
  });
}

applyPreset("basic-laptop", { origin: "example", confirmed: false, renderNow: false });
bindEvents();
applyLanguage(currentLanguage);
initializeCatalog();
