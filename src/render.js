import { fitLabel, performanceLabel, stale } from "./scoring.js";

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export function renderNotice(type, title, body) {
  return `
    <div class="notice ${escapeAttr(type || "info")}" role="note">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </div>`;
}

export function formatDetectedValue(field, value, taskNames) {
  if (field === "task") return taskNames[value] || value;
  if (["ram", "vram", "storage"].includes(field)) return `${value}GB`;
  return value;
}

const ISSUE_KEYS = Object.freeze({
  "conflict.ram": "warningRamConflict",
  "conflict.vram": "warningVramConflict",
  "conflict.storage": "warningStorageConflict",
  "conflict.cpu": "warningCpuConflict",
  "conflict.gpuVendor": "warningGpuVendorConflict",
  "conflict.gpuModel": "warningGpuModelConflict",
  "conflict.os": "warningOsConflict",
  "conflict.device": "warningDeviceConflict",
  "conflict.task": "warningTaskConflict",
  "unknown.cpu": "warningUnknownCpu",
  "unknown.gpuModel": "warningUnknownGpu",
  "missing.cpuModel": "warningMissingCpu",
  "missing.os": "warningMissingOs",
  "missing.deviceType": "warningMissingDevice",
  "missing.ram": "warningMissingRam",
  "missing.vram": "warningMissingVram",
  "missing.storage": "warningMissingStorage",
  "missing.gpuVendor": "warningMissingGpuVendor",
  "missing.gpuModel": "warningMissingGpuModel",
  "invalid.range": "warningInvalidRange",
  "input.truncated": "warningInputTruncated"
});

function fieldNames(t) {
  return {
    os: t("osLabel"),
    deviceType: t("deviceLabel"),
    cpuModel: t("cpuModelLabel"),
    gpuVendor: t("gpuVendorLabel"),
    gpuModel: t("gpuModelLabel"),
    ram: t("ramLabel"),
    vram: t("vramLabel"),
    storage: t("storageLabel"),
    task: t("taskLabel")
  };
}

function statusKey(status) {
  return {
    resolved: "fieldRecognized",
    conflict: "fieldNeedsReview",
    unknown: "fieldNeedsReview",
    missing: "fieldMissing",
    invalid: "fieldInvalid",
    "not-applicable": "fieldNotApplicable"
  }[status] || "fieldNeedsReview";
}

function candidateValues(field, fieldState, taskNames) {
  const values = [];
  const seen = new Set();
  for (const candidate of fieldState?.candidates || []) {
    const value = formatDetectedValue(field, candidate.value, taskNames);
    const key = `${typeof value}:${String(value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
  }
  return values;
}

export function renderScanReview(pendingScan, { t, taskNames }) {
  if (!pendingScan) return "";
  const names = fieldNames(t);
  return Object.entries(pendingScan.fieldStates).map(([field, fieldState], index) => {
    const resolved = fieldState.resolved?.value;
    const alternatives = candidateValues(field, fieldState, taskNames);
    const displayed = resolved !== undefined && resolved !== null
      ? formatDetectedValue(field, resolved, taskNames)
      : alternatives.length ? alternatives.join(" / ") : t("noValueDetected");
    const status = statusKey(fieldState.status);
    return `
      <li class="detected-item status-${escapeAttr(fieldState.status)}">
        <span class="field-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        <div class="detected-value">
          <b>${escapeHtml(names[field] || field)}</b>
          <span class="machine-data">${escapeHtml(displayed)}</span>
        </div>
        <span class="field-status">${escapeHtml(t(status))}</span>
      </li>`;
  }).join("");
}

export function renderScanIssues(pendingScan, { t, taskNames }) {
  if (!pendingScan?.issues?.length) return "";
  const names = fieldNames(t);
  return pendingScan.issues.map((issue) => {
    const related = issue.fields.flatMap((field) => candidateValues(field, pendingScan.fieldStates[field], taskNames));
    const fieldLabel = issue.fields.map((field) => names[field] || field).join(" / ");
    return `
      <li class="scan-issue severity-${escapeAttr(issue.severity)}">
        <strong>${escapeHtml(t(issue.severity === "blocking" ? "issueBlocking" : issue.severity === "review" ? "issueReview" : "issueInfo"))}</strong>
        <span>${escapeHtml(t(ISSUE_KEYS[issue.code] || issue.messageKey))}</span>
        ${fieldLabel ? `<small>${escapeHtml(fieldLabel)}${related.length ? `: ${escapeHtml(related.join(" / "))}` : ""}</small>` : ""}
      </li>`;
  }).join("");
}

export function renderHardwareFacts(state, { t, profileState }) {
  const gpu = state.gpuVendor === "none" ? t("noGpuValue") : (state.gpuModel || t("unknownValue"));
  const facts = [
    ["cpuModel", t("cpuShort"), state.cpuModel || t("unknownValue")],
    ["gpuModel", t("gpuShort"), gpu],
    ["ram", t("ramShort"), Number.isFinite(state.ram) ? `${state.ram}GB` : t("unknownValue")],
    ["storage", t("storageShort"), Number.isFinite(state.storage) ? `${state.storage}GB` : t("unknownValue")]
  ];
  return facts.map(([field, label, value]) => {
    const blocked = profileState?.blockingFields?.includes(field);
    return `
      <div class="hardware-fact${blocked ? " is-blocked" : ""}">
        <span>${escapeHtml(label)}</span>
        <strong class="machine-data">${escapeHtml(value)}</strong>
        ${blocked ? `<small>${escapeHtml(t("fieldNeedsReview"))}</small>` : ""}
      </div>`;
  }).join("");
}

function safeHttps(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function renderSourceLink(link, t) {
  const label = escapeHtml(link.label || t("sources"));
  const url = safeHttps(link.url);
  if (!url) return `<li>${label}: ${escapeHtml(t("sourceUnavailable"))}</li>`;
  const provenance = [link.publisher, link.verifiedAt].filter(Boolean).join(" · ");
  return `<li><a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${label}</a>${provenance ? ` <small>${escapeHtml(provenance)}</small>` : ""}</li>`;
}

function actionLink(link, label, className = "") {
  const url = safeHttps(link?.url);
  if (!url) return "";
  return `<a class="result-action ${escapeAttr(className)}" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)} <span aria-hidden="true">↗</span></a>`;
}

function renderActions(model, t) {
  const modelPage = model.sourceLinks.find(({ kind }) => kind === "official-model-card");
  const runtimeGuide = model.runtimeGuides[0];
  return `
    <div class="result-actions">
      ${actionLink(modelPage, t("modelPage"), "primary-action")}
      ${actionLink(runtimeGuide, t("runtimeGuide"))}
    </div>`;
}

function renderScoreTable(score, t) {
  return `
    <div class="table-scroll" tabindex="0">
      <table class="score-table">
        <thead><tr><th>${escapeHtml(t("rule"))}</th><th>${escapeHtml(t("reason"))}</th><th>${escapeHtml(t("points"))}</th></tr></thead>
        <tbody>${score.breakdown.map((row) => `
          <tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.reason)}</td><td>${row.value}/${row.max}</td></tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function renderTechnicalFacts(model, state, score, context) {
  const { t, copy } = context;
  const facts = [
    [t("category"), copy.modelCategoryText(model)],
    [t("family"), `${model.displayName} · ${copy.modelSizeNoteText(model)}`],
    [t("hardwareReasoning"), copy.hardwareReason(model, state)],
    [t("workloadReasoning"), copy.workloadReason(model, state)],
    [t("priorityMatch"), copy.prioritySummary(model, state)],
    [t("licenseNote"), copy.licenseSummary(model)],
    [t("lastReviewed"), model.lastReviewed]
  ];
  return `
    <div class="technical-grid">
      ${facts.map(([label, value]) => `<div class="technical-fact"><b>${escapeHtml(label)}</b><p>${escapeHtml(value)}</p></div>`).join("")}
      <div class="technical-fact sources-fact"><b>${escapeHtml(t("sourceProvenance"))}</b><ul>${model.sourceLinks.map((link) => renderSourceLink(link, t)).join("")}</ul></div>
    </div>
    <details class="score-details"><summary>${escapeHtml(t("scoreBreakdown"))}</summary>${renderScoreTable(score, t)}</details>`;
}

function fitClass(fit) {
  return fit === "notRecommended" ? "not" : fit;
}

function cardMeta(item, state, context) {
  const { model, score, compatibility } = item;
  const { t } = context;
  const fit = fitLabel(score.total);
  const performance = performanceLabel(model, state, score.total);
  const cpuFallback = compatibility.executionVendor === "none" && state.selectedGpuVendor !== "none";
  return `
    <div class="fit-estimate ${fitClass(fit)}">
      <span>${escapeHtml(t("localFitEstimate"))}</span>
      <strong>${escapeHtml(t(fit))} · ${score.total}/100</strong>
      <small>${escapeHtml(t(performance))}</small>
    </div>
    ${item.semanticTie ? `<p class="tie-note">${escapeHtml(t("semanticTie"))}</p>` : ""}
    ${cpuFallback ? `<p class="cpu-fallback">${escapeHtml(t("cpuFallback"))}</p>` : ""}`;
}

function renderWarnings(model, score, t) {
  const staleWarning = stale(model) ? renderNotice("warn", t("staleTitle"), t("staleBody")) : "";
  const capWarning = score.caps.length ? renderNotice("warn", t("capTitle"), score.caps.join(" ")) : "";
  return `${staleWarning}${capWarning}`;
}

function renderPrimaryCard(item, state, rank, context) {
  const { model, score } = item;
  const { t, copy } = context;
  return `
    <article class="result-card result-primary" id="primaryRecommendation" tabindex="-1">
      <header class="result-card-head">
        <span class="rank" aria-label="${escapeAttr(t("rankLabel", { rank }))}">${rank}</span>
        <div class="result-title"><span>${escapeHtml(t("tryFirst"))}</span><h3 class="model-name">${escapeHtml(copy.starterRecommendationText(model, "family"))}</h3></div>
        ${cardMeta(item, state, context)}
      </header>
      <div class="starter-grid">
        <div><b>${escapeHtml(t("sizeQuantization"))}</b><p>${escapeHtml(copy.starterRecommendationText(model, "sizeAndQuantization"))}</p></div>
        <div><b>${escapeHtml(t("preferredRuntime"))}</b><p>${escapeHtml(copy.starterRecommendationText(model, "preferredRuntime"))}</p></div>
      </div>
      <p class="practical-fit"><b>${escapeHtml(t("practicalFit"))}</b> ${escapeHtml(copy.starterRecommendationText(model, "hardwareFitNote"))}</p>
      <p class="avoid-line"><b>${escapeHtml(t("avoidGuidance"))}</b> ${escapeHtml(copy.starterRecommendationText(model, "avoidNote"))}</p>
      ${renderActions(model, t)}
      ${renderWarnings(model, score, t)}
      <details class="technical-details"><summary>${escapeHtml(t("technicalDetails"))}</summary>${renderTechnicalFacts(model, state, score, context)}</details>
    </article>`;
}

function renderAlternativeCard(item, state, rank, context) {
  const { model, score } = item;
  const { t, copy } = context;
  return `
    <article class="result-card result-alternative">
      <header class="result-card-head compact">
        <span class="rank" aria-label="${escapeAttr(t("rankLabel", { rank }))}">${rank}</span>
        <div class="result-title"><span>${escapeHtml(t("alternative"))}</span><h3 class="model-name">${escapeHtml(copy.starterRecommendationText(model, "family"))}</h3></div>
        ${cardMeta(item, state, context)}
      </header>
      <p class="starter-spec">${escapeHtml(copy.starterRecommendationText(model, "sizeAndQuantization"))} · ${escapeHtml(copy.starterRecommendationText(model, "preferredRuntime"))}</p>
      <p class="avoid-line"><b>${escapeHtml(t("avoidGuidance"))}</b> ${escapeHtml(copy.starterRecommendationText(model, "avoidNote"))}</p>
      ${renderActions(model, t)}
      ${renderWarnings(model, score, t)}
      <details class="technical-details"><summary>${escapeHtml(t("technicalDetails"))}</summary>${renderTechnicalFacts(model, state, score, context)}</details>
    </article>`;
}

export function renderRecommendations(items, state, context) {
  return items.map((item, index) => index === 0
    ? renderPrimaryCard(item, state, index + 1, context)
    : renderAlternativeCard(item, state, index + 1, context)).join("");
}

export function renderHostedFallback(fallback, { t }) {
  if (!fallback) return "";
  return `
    <aside class="hosted-fallback" aria-label="${escapeAttr(t("hostedFallbackTitle"))}">
      <strong>${escapeHtml(t("hostedFallbackTitle"))}</strong>
      <p>${escapeHtml(t("hostedFallbackSeparate"))}</p>
      <ul><li>${escapeHtml(t("fallbackPrivacy"))}</li><li>${escapeHtml(t("fallbackAccess"))}</li><li>${escapeHtml(t("fallbackLicense"))}</li></ul>
    </aside>`;
}

export function renderExcludedSummary(excluded, { t }) {
  if (!excluded?.length) return "";
  const counts = new Map();
  excluded.forEach(({ compatibility }) => counts.set(compatibility.code, (counts.get(compatibility.code) || 0) + 1));
  const reasons = [...counts.entries()].map(([code, count]) => `${t(`excluded_${code}`)} (${count})`);
  return `<div class="excluded-summary"><strong>${escapeHtml(t("excludedReasons"))}</strong><p>${escapeHtml(reasons.join(" · "))}</p></div>`;
}
