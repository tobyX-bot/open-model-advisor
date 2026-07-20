import { helperSetups, presets, stageIds } from "./config.js";
import { loadCatalog } from "./catalog.js";
import { deriveCpuProfile, deriveGpuProfile } from "./hardware.js";
import { readStoredLanguage, taskLabels, translate, writeStoredLanguage } from "./i18n.js";
import { createModelCopy } from "./model-copy.js";
import {
  applyProfileOperations,
  confirmProfile,
  editProfileField,
  isCurrentProfileConfirmed,
  operationsFromScan,
  registerScanSession
} from "./profile-state.js";
import {
  renderExcludedSummary,
  renderHardwareFacts,
  renderHostedFallback,
  renderNotice,
  renderRecommendations,
  renderScanIssues,
  renderScanReview
} from "./render.js";
import { rankModels } from "./scoring.js";
import { scanSetupText } from "./scanner.js";

const HARDWARE_FIELDS = ["os", "deviceType", "cpuModel", "gpuVendor", "gpuModel", "ram", "vram", "storage"];
const NUMERIC_FIELDS = new Set(["ram", "vram", "storage"]);

let catalog = null;
let catalogStatus = "loading";
let currentLanguage = readStoredLanguage();
let profileState = null;
let profileOrigin = "example";
let pendingScan = null;
let scanInProgress = false;
let scanTimer = null;
let scanCounter = 0;
let scanMessage = { key: "scanIdle", variables: {} };

const form = document.getElementById("advisorForm");
const resultsEl = document.getElementById("results");
const fallbackEl = document.getElementById("hostedFallback");
const messageArea = document.getElementById("messageArea");
const summaryText = document.getElementById("summaryText");
const selectedPreset = document.getElementById("selectedPreset");
const scanSummary = document.getElementById("scanSummary");
const scanIssues = document.getElementById("scanIssues");
const detectedFields = document.getElementById("detectedFields");
const applyDetected = document.getElementById("applyDetected");
const hardwareFacts = document.getElementById("hardwareFacts");
const provenanceLabel = document.getElementById("provenanceLabel");
const profileNote = document.getElementById("profileNote");
const confirmSpecs = document.getElementById("confirmSpecs");
const taskLockHint = document.getElementById("taskLockHint");
const digRail = document.getElementById("digRail");
const scanChamber = document.getElementById("scanChamber");
const statusRegion = document.getElementById("statusRegion");
const manualDetails = document.getElementById("manualDetails");
const setupPaste = document.getElementById("setupPaste");
const setupCount = document.getElementById("setupCount");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function t(key, variables = {}) {
  return translate(currentLanguage, key, variables);
}

function announce(message) {
  statusRegion.textContent = "";
  window.requestAnimationFrame(() => { statusRegion.textContent = message; });
}

function setField(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value ?? "";
}

function fieldValue(field) {
  const element = form.elements[field];
  if (!element) return null;
  if (NUMERIC_FIELDS.has(field)) return element.value === "" ? null : Number(element.value);
  return element.value;
}

function selectedPriorities() {
  return Array.from(form.querySelectorAll('input[name="priority"]:checked')).map((input) => input.value);
}

function createProfile(provenance, hardwareRevision, currentScanSessionId = null) {
  const fields = Object.fromEntries(HARDWARE_FIELDS.map((field) => [field, {
    value: fieldValue(field),
    provenance
  }]));
  Object.assign(fields, {
    task: { value: form.task.value, provenance: "manual" },
    taskLanguage: { value: form.taskLanguage.value, provenance: "manual" },
    workload: { value: form.workload.value, provenance: "manual" },
    deployment: { value: form.deployment.value, provenance: "manual" },
    priorities: { value: selectedPriorities(), provenance: "manual" },
    internet: { value: form.internet.value, provenance: "manual" }
  });
  return {
    fields,
    hardwareRevision,
    confirmedRevision: null,
    blockingFields: [],
    currentScanSessionId
  };
}

function getState() {
  const selectedGpuVendor = form.gpuVendor.value;
  const cpuModel = form.cpuModel.value.trim();
  const gpuModel = form.gpuModel.value.trim();
  return {
    os: form.os.value,
    deviceType: form.deviceType.value,
    cpuModel,
    gpuModel,
    cpuProfile: deriveCpuProfile(cpuModel),
    gpuProfile: deriveGpuProfile(gpuModel, selectedGpuVendor),
    ram: form.ram.value === "" ? Number.NaN : Number(form.ram.value),
    gpuVendor: selectedGpuVendor,
    selectedGpuVendor,
    vram: selectedGpuVendor === "none" ? 0 : form.vram.value === "" ? Number.NaN : Number(form.vram.value),
    storage: form.storage.value === "" ? Number.NaN : Number(form.storage.value),
    internet: form.internet.value,
    deployment: form.deployment.value,
    task: form.task.value,
    taskLanguage: form.taskLanguage.value,
    workload: form.workload.value,
    priorities: selectedPriorities(),
    requireCommercialClearance: false
  };
}

function syncVramAvailability() {
  const noGpu = form.gpuVendor.value === "none";
  form.vram.disabled = noGpu;
  form.vram.setAttribute("aria-disabled", String(noGpu));
}

function hardwareInputsValid(state = getState()) {
  const requiredText = [state.os, state.deviceType, state.cpuModel, state.gpuVendor, state.gpuModel];
  return requiredText.every((value) => typeof value === "string" && value.trim())
    && [state.ram, state.vram, state.storage].every(Number.isFinite)
    && ["ram", "vram", "storage"].every((id) => form.elements[id].disabled || form.elements[id].checkValidity());
}

function applyPreset(name, origin = "preset") {
  const preset = presets[name] || presets["basic-laptop"];
  Object.entries(preset).forEach(([key, value]) => setField(key, value));
  syncVramAvailability();
  form.preset.value = name;
  const revision = profileState ? profileState.hardwareRevision + 1 : 0;
  const session = profileState?.currentScanSessionId || null;
  profileState = createProfile(origin, revision, session);
  profileOrigin = origin;
}

function updatePresetLabel() {
  const option = form.preset.options[form.preset.selectedIndex];
  selectedPreset.textContent = t("selectedPreset", { preset: option ? option.textContent : t("presetCustom") });
}

function provenanceKey(confirmed) {
  if (confirmed && profileOrigin === "scan") return "provenanceScan";
  if (profileOrigin === "scan") return "provenanceScanPending";
  if (confirmed) return "provenanceConfirmed";
  if (profileOrigin === "preset") return "provenancePreset";
  if (profileOrigin === "manual") return "provenanceManual";
  return "provenanceExample";
}

function setJobControlsLocked(locked) {
  [form.task, form.taskLanguage, form.workload, form.deployment].forEach((control) => {
    control.disabled = locked;
    control.setAttribute("aria-disabled", String(locked));
  });
  form.querySelectorAll('input[name="priority"]').forEach((control) => { control.disabled = locked; });
  document.getElementById("updateRecommendations").disabled = locked;
}

function updateProfileState() {
  const confirmed = isCurrentProfileConfirmed(profileState);
  provenanceLabel.textContent = t(provenanceKey(confirmed));
  profileNote.textContent = confirmed
    ? t("specsConfirmed")
    : profileState.confirmedRevision !== null
      ? t("profileChangedReconfirm")
      : profileOrigin === "scan" ? t("scanReviewNeeded") : t("confirmationNeeded");
  confirmSpecs.disabled = confirmed;
  confirmSpecs.querySelector("span").textContent = confirmed ? t("specsConfirmed") : t("confirmSpecs");
  setJobControlsLocked(!confirmed);
  taskLockHint.hidden = confirmed;
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
  if (isCurrentProfileConfirmed(profileState) && state.task) return "match";
  if (isCurrentProfileConfirmed(profileState)) return "match";
  if (pendingScan) return "extract";
  return "raw";
}

function setScanMessage(key, variables = {}) {
  scanMessage = { key, variables };
  scanSummary.textContent = t(key, variables);
}

function renderScan() {
  const context = { t, taskNames: taskLabels(t) };
  detectedFields.innerHTML = renderScanReview(pendingScan, context);
  scanIssues.innerHTML = renderScanIssues(pendingScan, context);
  applyDetected.disabled = scanInProgress || !pendingScan || !pendingScan.scanSessionId;
  scanSummary.textContent = t(scanMessage.key, scanMessage.variables);
}

function renderHardware() {
  const state = getState();
  hardwareFacts.innerHTML = renderHardwareFacts(state, { t, profileState });
  updateProfileState();
  return state;
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  document.title = t("documentTitle");
  document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder)));
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel)));
  document.querySelectorAll("[data-i18n-title]").forEach((node) => node.setAttribute("title", t(node.dataset.i18nTitle)));
  document.querySelectorAll("[data-language]").forEach((button) => {
    const active = button.dataset.language === currentLanguage;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateCatalogFreshness() {
  const freshness = document.getElementById("catalogFreshness");
  freshness.textContent = catalogStatus === "ready"
    ? t("catalogFreshness", { freshness: catalog.catalogFreshness || t("unknownValue") })
    : catalogStatus === "error" ? t("catalogUnavailable") : t("catalogLoading");
}

function applyLanguage(language) {
  currentLanguage = language === "zh" ? "zh" : "en";
  writeStoredLanguage(currentLanguage);
  applyStaticTranslations();
  updateCatalogFreshness();
  renderScan();
  render();
}

function nextScanSession() {
  scanCounter += 1;
  const scanSessionId = `scan-${scanCounter}`;
  profileState = registerScanSession(profileState, scanSessionId);
  return scanSessionId;
}

function invalidatePendingScan() {
  window.clearTimeout(scanTimer);
  nextScanSession();
  pendingScan = null;
  scanInProgress = false;
  scanChamber.classList.remove("is-scanning");
}

function runScan(text) {
  window.clearTimeout(scanTimer);
  const scanSessionId = nextScanSession();
  pendingScan = null;
  applyDetected.disabled = true;
  const input = text.trim();
  if (!input) {
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
  setScanMessage("scanWorking");
  renderScan();
  setStage("scan");
  const delay = prefersReducedMotion.matches ? 0 : 360;
  scanTimer = window.setTimeout(() => {
    if (profileState.currentScanSessionId !== scanSessionId) return;
    const result = scanSetupText(input);
    pendingScan = { ...result, scanSessionId };
    scanInProgress = false;
    scanChamber.classList.remove("is-scanning");
    const resolvedCount = Object.keys(result.fields).length;
    setScanMessage(result.issues.length ? "scanNeedsReview" : resolvedCount ? "scanFound" : "scanNoFields", {
      count: resolvedCount,
      issues: result.issues.length
    });
    renderScan();
    setStage(resolvedCount ? "extract" : "raw");
    announce(scanSummary.textContent);
  }, delay);
}

function writeProfileToForm() {
  HARDWARE_FIELDS.forEach((field) => setField(field, profileState.fields[field]?.value));
  const task = profileState.fields.task?.value;
  if (task) form.task.value = task;
  syncVramAvailability();
}

function applyPendingScan() {
  if (!pendingScan || pendingScan.scanSessionId !== profileState.currentScanSessionId) return;
  const taskWasSelected = Boolean(profileState.fields.task?.value);
  const batch = operationsFromScan(pendingScan, profileState);
  profileState = applyProfileOperations(profileState, batch);
  writeProfileToForm();
  form.preset.value = "custom";
  profileOrigin = "scan";
  pendingScan = null;
  setScanMessage("scanApplied");
  renderScan();
  render();
  announce(`${scanSummary.textContent}${taskWasSelected ? ` ${t("scanTaskSkipped")}` : ""}`);
}

function rankingContext(state) {
  const copy = createModelCopy({ language: currentLanguage, t });
  return {
    copy,
    context: {
      t,
      language: currentLanguage,
      taskLabel: taskLabels(t)[state.task],
      setupDifficultyLabel: copy.setupDifficultyLabel,
      licenseSummary: copy.licenseSummary
    }
  };
}

function revealResults() {
  resultsEl.classList.remove("is-revealing");
  if (prefersReducedMotion.matches) return;
  window.requestAnimationFrame(() => resultsEl.classList.add("is-revealing"));
  window.setTimeout(() => resultsEl.classList.remove("is-revealing"), 600);
}

function clearRecommendationSurface() {
  resultsEl.innerHTML = "";
  fallbackEl.innerHTML = "";
}

function render(options = {}) {
  const state = renderHardware();
  messageArea.innerHTML = "";
  clearRecommendationSurface();

  if (catalogStatus === "error") {
    summaryText.textContent = t("catalogLoadSummary");
    messageArea.innerHTML = renderNotice("bad", t("catalogLoadTitle"), t("catalogLoadBody"));
    setStage(derivedStage(state));
    return;
  }
  if (!catalog) {
    summaryText.textContent = t("catalogLoading");
    messageArea.innerHTML = renderNotice("info", t("catalogLoading"), t("catalogLoadingBody"));
    setStage(derivedStage(state));
    return;
  }
  if (!isCurrentProfileConfirmed(profileState)) {
    const changed = profileState.confirmedRevision !== null;
    summaryText.textContent = changed ? t("profileChangedReconfirm") : t("chooseTask");
    messageArea.innerHTML = renderNotice("warn", changed ? t("reviewChangedTitle") : t("initialPromptTitle"), changed ? t("reviewChangedBody") : t("initialPromptBody"));
    setStage(derivedStage(state));
    return;
  }
  if (!hardwareInputsValid(state) || state.gpuProfile.conflict || profileState.blockingFields.length) {
    summaryText.textContent = t("invalidHardwareSummary");
    messageArea.innerHTML = renderNotice("bad", t("invalidHardwareTitle"), t("invalidHardwareBody"));
    setStage("match");
    return;
  }
  if (!state.task) {
    summaryText.textContent = t("chooseTask");
    messageArea.innerHTML = renderNotice("info", t("initialPromptTitle"), t("chooseTaskBody"));
    setStage("match");
    return;
  }

  const { copy, context } = rankingContext(state);
  const ranking = rankModels(catalog.models, state, context);
  const messages = [];
  if (state.workload === "production") messages.push(renderNotice("warn", t("productionTitle"), t("productionBody")));
  if (state.cpuProfile.confidence === "low" || state.gpuProfile.confidence === "low") {
    messages.push(renderNotice("warn", t("lowConfidenceTitle"), t("lowConfidenceBody")));
  }
  if (!ranking.ranked.length) {
    messages.push(renderNotice("bad", t("noLocalFitTitle"), t("noLocalFitBody")));
    if (state.deployment === "local-only") messages.push(renderNotice("warn", t("localOnlyTitle"), t("localOnlyBody")));
    messages.push(renderExcludedSummary(ranking.excluded, { t }));
  }
  messageArea.innerHTML = messages.join("");

  const taskName = taskLabels(t)[state.task];
  summaryText.textContent = ranking.ranked.length
    ? t("resultsSummary", { count: ranking.ranked.length, task: taskName })
    : t("noCompatibleSummary", { task: taskName });
  resultsEl.innerHTML = renderRecommendations(ranking.ranked, state, { t, language: currentLanguage, copy });
  fallbackEl.innerHTML = renderHostedFallback(ranking.hostedFallback, { t });
  setStage(derivedStage(state, Boolean(ranking.ranked.length)));
  if (options.reveal && ranking.ranked.length) revealResults();
}

async function initializeCatalog() {
  catalogStatus = "loading";
  updateCatalogFreshness();
  try {
    catalog = await loadCatalog("models.json");
    catalogStatus = "ready";
  } catch {
    catalog = null;
    catalogStatus = "error";
    announce(t("catalogLoadSummary"));
  }
  updateCatalogFreshness();
  render();
}

function markHardwareEdited(field) {
  let value = fieldValue(field);
  if (field === "gpuVendor" && value === "none") {
    form.vram.value = "0";
    profileState = editProfileField(profileState, "vram", 0);
  }
  profileState = editProfileField(profileState, field, value);
  form.preset.value = "custom";
  profileOrigin = "manual";
  syncVramAvailability();
  render();
}

function bindEvents() {
  document.querySelectorAll("[data-language]").forEach((button) => button.addEventListener("click", () => applyLanguage(button.dataset.language)));
  setupPaste.addEventListener("input", () => { setupCount.textContent = `${setupPaste.value.length} / 20,000`; });
  document.querySelectorAll("[data-helper]").forEach((button) => button.addEventListener("click", () => {
    invalidatePendingScan();
    const example = helperSetups[button.dataset.helper];
    setupPaste.value = example;
    setupCount.textContent = `${setupPaste.value.length} / 20,000`;
    runScan(example);
  }));
  document.getElementById("scanSetup").addEventListener("click", () => runScan(setupPaste.value));
  applyDetected.addEventListener("click", applyPendingScan);
  document.getElementById("clearDetected").addEventListener("click", () => {
    invalidatePendingScan();
    setupPaste.value = "";
    setupCount.textContent = "0 / 20,000";
    setScanMessage("scanCleared");
    renderScan();
    render();
  });
  form.preset.addEventListener("change", (event) => {
    if (event.target.value !== "custom") applyPreset(event.target.value, "preset");
    render();
  });
  HARDWARE_FIELDS.forEach((field) => {
    const eventName = form.elements[field].tagName === "SELECT" ? "change" : "input";
    form.elements[field].addEventListener(eventName, () => markHardwareEdited(field));
  });
  ["task", "taskLanguage", "workload", "deployment", "internet"].forEach((field) => {
    form.elements[field].addEventListener("change", () => {
      profileState = editProfileField(profileState, field, fieldValue(field));
      render();
    });
  });
  form.addEventListener("change", (event) => {
    if (event.target.name === "priority") {
      profileState = editProfileField(profileState, "priorities", selectedPriorities());
      render();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    render({ reveal: true });
    announce(summaryText.textContent);
    document.getElementById("primaryRecommendation")?.focus({ preventScroll: false });
  });
  confirmSpecs.addEventListener("click", () => {
    const state = getState();
    const valid = hardwareInputsValid(state);
    profileState = confirmProfile(profileState, { hardwareValid: valid, gpuConflict: state.gpuProfile.conflict });
    if (!isCurrentProfileConfirmed(profileState)) {
      manualDetails.open = true;
      profileNote.textContent = state.gpuProfile.conflict ? t("warningGpuVendorConflict") : profileState.blockingFields.length ? t("scanNeedsReview", { count: 0, issues: profileState.blockingFields.length }) : t("invalidHardwareBody");
      const invalid = HARDWARE_FIELDS.map((field) => form.elements[field]).find((field) => !field.value || (!field.disabled && !field.checkValidity()));
      invalid?.focus();
      announce(profileNote.textContent);
      render();
      return;
    }
    render();
    announce(t("specsConfirmed"));
  });
  document.getElementById("reviewDetails").addEventListener("click", () => {
    manualDetails.open = true;
    manualDetails.scrollIntoView({ behavior: prefersReducedMotion.matches ? "auto" : "smooth", block: "nearest" });
  });
  document.getElementById("resetPreset").addEventListener("click", () => {
    const preset = form.preset.value === "custom" ? "basic-laptop" : form.preset.value;
    applyPreset(preset, preset === "basic-laptop" ? "example" : "preset");
    render();
  });
  document.getElementById("clearTask").addEventListener("click", () => {
    form.task.value = "";
    profileState = editProfileField(profileState, "task", "");
    render();
  });
}

applyPreset("basic-laptop", "example");
bindEvents();
applyLanguage(currentLanguage);
initializeCatalog();
