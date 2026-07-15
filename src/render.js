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

export function renderScanReview(pendingScan, { t, taskNames }) {
  if (!pendingScan) return "";
  const names = {
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
  return Object.entries(pendingScan.fields).map(([field, detected]) => {
    const confidenceKey = `confidence${detected.confidence[0].toUpperCase()}${detected.confidence.slice(1)}`;
    return `
      <li class="detected-item">
        <div class="detected-value">
          <b>${escapeHtml(names[field] || field)}</b>
          <span class="machine-data">${escapeHtml(formatDetectedValue(field, detected.value, taskNames))}</span>
        </div>
        <span class="confidence confidence-${escapeAttr(detected.confidence)}">${escapeHtml(t(confidenceKey))}</span>
        <small>${escapeHtml(t(detected.reasonKey))}</small>
      </li>`;
  }).join("");
}

export function renderHardwareFacts(state, { t }) {
  const gpu = state.gpuVendor === "none" ? t("noGpuValue") : (state.gpuModel || t("unknownValue"));
  const facts = [
    [t("cpuShort"), state.cpuModel || t("unknownValue")],
    [t("gpuShort"), gpu],
    [t("ramShort"), `${state.ram || 0}GB`],
    [t("storageShort"), `${state.storage || 0}GB`]
  ];
  return facts.map(([label, value]) => `
    <div class="hardware-fact">
      <span>${escapeHtml(label)}</span>
      <strong class="machine-data">${escapeHtml(value)}</strong>
    </div>`).join("");
}

function renderSourceLink(link, t) {
  const label = escapeHtml(link.label || t("sources"));
  try {
    const url = new URL(link.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported URL scheme");
    return `<li><a href="${escapeAttr(url.href)}" rel="noreferrer">${label}</a></li>`;
  } catch (error) {
    return `<li>${label}: ${escapeHtml(t("sourceUnavailable"))}</li>`;
  }
}

function fitClass(fit) {
  return fit === "notRecommended" ? "not" : fit;
}

function renderTags(score, fit, performance, t) {
  return `
    <div class="tag-stack" aria-label="${escapeAttr(t("scoreBreakdown"))}">
      <span class="tag ${fitClass(fit)}"><b>${escapeHtml(t("fit"))}</b> ${escapeHtml(t(fit))}</span>
      <span class="tag ${escapeAttr(performance)}"><b>${escapeHtml(t("performance"))}</b> ${escapeHtml(t(performance))}</span>
      <span class="tag score-tag"><b>${escapeHtml(t("score"))}</b> ${score.total}/100</span>
    </div>`;
}

function renderScoreTable(score, t) {
  return `
    <div class="table-scroll" tabindex="0">
      <table class="score-table">
        <thead>
          <tr><th>${escapeHtml(t("rule"))}</th><th>${escapeHtml(t("reason"))}</th><th>${escapeHtml(t("points"))}</th></tr>
        </thead>
        <tbody>
          ${score.breakdown.map((row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td>${escapeHtml(row.reason)}</td>
              <td>${row.value}/${row.max}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderTechnicalFacts(model, state, score, context) {
  const { t, copy } = context;
  const facts = [
    [t("category"), copy.modelCategoryText(model)],
    [t("family"), `${model.displayName} — ${copy.modelSizeNoteText(model)}`],
    [t("localFeasibility"), copy.localFitText(model)],
    [t("setupPath"), model.runtimeOptions.join(" / ")],
    [t("hardwareReasoning"), copy.hardwareReason(model, state)],
    [t("workloadReasoning"), copy.workloadReason(model, state)],
    [t("priorityMatch"), copy.prioritySummary(model, state)],
    [t("privacyNote"), t("privacyBody")],
    [t("licenseNote"), copy.licenseSummary(model)],
    [t("avoidGuidance"), copy.avoidText(model)],
    [t("hostedFallback"), copy.fallbackSummary(model, state, score.total)],
    [t("lastReviewed"), model.lastReviewed]
  ];
  return `
    <div class="technical-grid">
      ${facts.map(([label, value]) => `
        <div class="technical-fact">
          <b>${escapeHtml(label)}</b>
          <p>${escapeHtml(value)}</p>
        </div>`).join("")}
      <div class="technical-fact sources-fact">
        <b>${escapeHtml(t("sources"))}</b>
        <ul>${model.sourceLinks.map((link) => renderSourceLink(link, t)).join("")}</ul>
      </div>
    </div>
    <details class="score-details">
      <summary>${escapeHtml(t("scoreBreakdown"))}</summary>
      ${renderScoreTable(score, t)}
    </details>`;
}

function renderWarnings(model, score, t) {
  const staleWarning = stale(model) ? renderNotice("warn", t("staleTitle"), t("staleBody")) : "";
  const capWarning = score.caps.length ? renderNotice("warn", t("capTitle"), score.caps.join(" ")) : "";
  return `${staleWarning}${capWarning}`;
}

function renderPrimaryCard(item, state, rank, context) {
  const { model, score } = item;
  const { t, copy } = context;
  const fit = fitLabel(score.total);
  const performance = performanceLabel(model, state, score.total);
  return `
    <article class="result-card result-primary" id="primaryRecommendation" tabindex="-1">
      <header class="result-card-head">
        <span class="rank" aria-label="${escapeAttr(t("rankLabel", { rank }))}">${rank}</span>
        <div class="result-title">
          <span class="result-kicker">${escapeHtml(copy.modelCategoryText(model))}</span>
          <h3 class="model-name">${escapeHtml(copy.starterRecommendationText(model, "family"))}</h3>
          <p>${escapeHtml(t("examples"))}: ${escapeHtml(model.exampleModels.join(", "))}</p>
        </div>
        ${renderTags(score, fit, performance, t)}
      </header>

      <section class="try-first-primary">
        <div class="try-first-label">${escapeHtml(t("tryFirst"))}</div>
        <p class="starter-spec machine-data">${escapeHtml(t("sizeRuntime", {
          size: copy.starterRecommendationText(model, "sizeAndQuantization"),
          runtime: copy.starterRecommendationText(model, "preferredRuntime")
        }))}</p>
        <p>${escapeHtml(copy.starterRecommendationText(model, "hardwareFitNote"))}</p>
        <p class="avoid-line"><b>${escapeHtml(t("avoidGuidance"))}:</b> ${escapeHtml(copy.starterRecommendationText(model, "avoidNote"))}</p>
      </section>

      ${renderWarnings(model, score, t)}

      <div class="primary-facts">
        <div><b>${escapeHtml(t("localFeasibility"))}</b><p>${escapeHtml(copy.localFitText(model))}</p></div>
        <div><b>${escapeHtml(t("setupPath"))}</b><p>${escapeHtml(model.runtimeOptions.join(" / "))}</p></div>
        <div><b>${escapeHtml(t("licenseNote"))}</b><p>${escapeHtml(copy.licenseSummary(model))}</p></div>
        <div><b>${escapeHtml(t("lastReviewed"))}</b><p class="machine-data">${escapeHtml(model.lastReviewed)}</p></div>
      </div>

      <details class="technical-details">
        <summary>${escapeHtml(t("technicalDetails"))}</summary>
        ${renderTechnicalFacts(model, state, score, context)}
      </details>
    </article>`;
}

function renderAlternativeCard(item, state, rank, context) {
  const { model, score } = item;
  const { t, copy } = context;
  const fit = fitLabel(score.total);
  const performance = performanceLabel(model, state, score.total);
  return `
    <article class="result-card result-alternative">
      <header class="result-card-head compact">
        <span class="rank" aria-label="${escapeAttr(t("rankLabel", { rank }))}">${rank}</span>
        <div class="result-title">
          <span class="result-kicker">${escapeHtml(copy.modelCategoryText(model))}</span>
          <h3 class="model-name">${escapeHtml(copy.starterRecommendationText(model, "family"))}</h3>
          <p class="machine-data">${escapeHtml(t("sizeRuntime", {
            size: copy.starterRecommendationText(model, "sizeAndQuantization"),
            runtime: copy.starterRecommendationText(model, "preferredRuntime")
          }))}</p>
        </div>
        ${renderTags(score, fit, performance, t)}
      </header>
      ${renderWarnings(model, score, t)}
      <details class="alternative-details">
        <summary>${escapeHtml(t("exploreAlternative"))}</summary>
        <div class="alternative-fit">
          <p>${escapeHtml(copy.starterRecommendationText(model, "hardwareFitNote"))}</p>
          <p><b>${escapeHtml(t("avoidGuidance"))}:</b> ${escapeHtml(copy.starterRecommendationText(model, "avoidNote"))}</p>
        </div>
        ${renderTechnicalFacts(model, state, score, context)}
      </details>
    </article>`;
}

export function renderRecommendations(items, state, context) {
  return items.map((item, index) => index === 0
    ? renderPrimaryCard(item, state, index + 1, context)
    : renderAlternativeCard(item, state, index + 1, context)).join("");
}
