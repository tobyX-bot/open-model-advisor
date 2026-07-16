import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateCatalog } from "../src/catalog.js";
import { deriveCpuProfile, deriveGpuProfile } from "../src/hardware.js";
import { taskLabels, translate } from "../src/i18n.js";
import { createModelCopy } from "../src/model-copy.js";
import { compatible, fitLabel, performanceLabel, scoreModel } from "../src/scoring.js";
import { scanSetupText } from "../src/scanner.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(ROOT, "fixtures", "computer_setups_200.json");
const catalogPath = path.join(ROOT, "..", "models.json");
const outputDirectory = path.join(ROOT, "results");
const outputPath = path.join(outputDirectory, "module-results.json");
const dataset = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const catalog = validateCatalog(JSON.parse(fs.readFileSync(catalogPath, "utf8")));
const fixtureCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.join(ROOT, ".."), encoding: "utf8" }).trim();

const failures = [];
const recordResults = [];
const gateIds = ["G1", "G2", "G3", "G5", "G6", "G7", "G8"];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${key}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function plainScan(scan) {
  return {
    fields: Object.fromEntries(Object.entries(scan.fields).map(([field, detail]) => [field, {
      value: detail.value,
      confidence: detail.confidence,
      reasonKey: detail.reasonKey
    }])),
    warnings: [...scan.warnings]
  };
}

function scanValues(scan) {
  return Object.fromEntries(Object.entries(scan.fields).map(([field, detail]) => [field, detail.value]));
}

function stateFromProfile(profile) {
  const cpuProfile = deriveCpuProfile(profile.cpuModel);
  const gpuProfile = deriveGpuProfile(profile.gpuModel, profile.gpuVendor);
  const gpuVendor = gpuProfile.vendor || profile.gpuVendor;
  return {
    ...profile,
    cpuProfile,
    gpuProfile,
    selectedGpuVendor: profile.gpuVendor,
    gpuVendor,
    vram: gpuVendor === "none" ? 0 : profile.vram
  };
}

const language = "en";
const t = (key, variables = {}) => translate(language, key, variables);
const copy = createModelCopy({ language, t });

function recommendation(state) {
  const context = {
    t,
    language,
    taskLabel: taskLabels(t)[state.task],
    setupDifficultyLabel: copy.setupDifficultyLabel,
    licenseSummary: copy.licenseSummary
  };
  const scored = catalog.models
    .map((model) => ({ model, compatibility: compatible(model, state) }))
    .filter((item) => item.compatibility.ok)
    .map((item) => ({ ...item, score: scoreModel(item.model, state, context) }))
    .sort((a, b) => b.score.total - a.score.total || a.model.displayName.localeCompare(b.model.displayName));
  const top = scored.filter((item) => item.model.deploymentModes.includes("local")).slice(0, 3);
  const weakHardware = top.length > 0 && top.every((item) => item.score.total < 60);
  const noLocalFit = !top.length || top.every((item) => item.score.total < 40);
  const fallbackNeeded = noLocalFit || weakHardware;
  const hostedFallbackShown = (state.deployment !== "local-only" && fallbackNeeded) || state.deployment === "cloud-ok";
  return {
    top: top.map(({ model, score }) => ({
      id: model.id,
      category: model.category,
      score: score.total,
      caps: score.caps,
      fit: fitLabel(score.total),
      performance: performanceLabel(model, state, score.total),
      starterFamily: model.starterRecommendation.family
    })),
    weakHardware,
    noLocalFit,
    fallbackNeeded,
    hostedFallbackShown
  };
}

function feasible(model, state) {
  if (!model.taskCategories.includes(state.task)) return false;
  if (!model.deploymentModes.includes("local")) return false;
  if (model.internetRequired && state.internet !== "available") return false;
  if (state.ram < model.minRamGb || state.storage < model.estimatedStorageGb) return false;
  if (model.minVramGb > 0 && state.vram < model.minVramGb) return false;
  if (model.gpuImportance === "required" && !model.supportedGpuVendors.includes(state.gpuVendor)) return false;
  return true;
}

function segment(record) {
  return {
    languageStyle: record.languageStyle,
    scenarioClass: record.scenarioClass,
    adversarialKind: record.adversarialKind,
    task: record.profile.task,
    hardwareTier: record.hardwareTier,
    entryMode: record.journey.entryMode,
    os: record.profile.os,
    gpuVendor: record.profile.gpuVendor
  };
}

function addFailure(record, gate, issue, details = {}) {
  failures.push({
    gate,
    severity: gate === "G3" || gate === "G6" || gate === "G7" ? "high" : "medium",
    fold: record.fold,
    id: record.id,
    segment: segment(record),
    setupText: record.setupText,
    issue,
    ...details
  });
}

function newGateState() {
  return Object.fromEntries(gateIds.map((gate) => [gate, { applicable: true, passed: true }]));
}

for (const record of dataset.records) {
  const gates = newGateState();
  const scannerCounts = { truePositive: 0, falsePositive: 0, falseNegative: 0 };
  const expected = record.parserExpected;
  const expectedFields = expected.fields;
  const ambiguous = new Set(expected.ambiguousFields);
  const allowedInferred = new Set(expected.allowedInferredFields);
  let scan;
  let scanAgain;
  let state;
  let recommendationResult;
  let recommendationAgain;

  try {
    scan = scanSetupText(record.setupText);
    scanAgain = scanSetupText(record.setupText);
    state = stateFromProfile(record.profile);
    recommendationResult = recommendation(state);
    recommendationAgain = recommendation(state);
  } catch (error) {
    gates.G1.passed = false;
    addFailure(record, "G1", "Execution threw an exception", { observed: error.message });
    recordResults.push({ id: record.id, fold: record.fold, gates, scannerCounts, exception: error.message });
    continue;
  }

  if (canonical(plainScan(scan)) !== canonical(plainScan(scanAgain))
    || canonical(recommendationResult) !== canonical(recommendationAgain)) {
    gates.G1.passed = false;
    addFailure(record, "G1", "Repeated identical input produced a different result", {
      observed: { firstScan: plainScan(scan), secondScan: plainScan(scanAgain), firstRecommendation: recommendationResult, secondRecommendation: recommendationAgain }
    });
  }

  const detected = scanValues(scan);
  const nonAmbiguousRecord = ambiguous.size === 0;
  gates.G2.applicable = nonAmbiguousRecord;

  if (nonAmbiguousRecord) {
    const mismatches = [];
    Object.entries(expectedFields).forEach(([field, value]) => {
      if (!(field in detected)) {
        scannerCounts.falseNegative += 1;
        mismatches.push({ field, expected: value, observed: "missing" });
      } else if (canonical(detected[field]) !== canonical(value)) {
        scannerCounts.falseNegative += 1;
        scannerCounts.falsePositive += 1;
        mismatches.push({ field, expected: value, observed: detected[field] });
      } else {
        scannerCounts.truePositive += 1;
      }
    });
    Object.entries(detected).forEach(([field, value]) => {
      if (!(field in expectedFields) && !allowedInferred.has(field)) {
        scannerCounts.falsePositive += 1;
        mismatches.push({ field, expected: "not detected", observed: value });
      }
      if (allowedInferred.has(field) && field in record.profile && canonical(value) !== canonical(record.profile[field])) {
        scannerCounts.falsePositive += 1;
        mismatches.push({ field, expected: record.profile[field], observed: value, inference: true });
      }
    });
    if (mismatches.length) {
      gates.G2.passed = false;
      addFailure(record, "G2", "Non-ambiguous scan did not exactly match expected fields", { mismatches, observed: detected });
    }
  }

  gates.G3.applicable = record.scenarioClass === "adversarial";
  if (gates.G3.applicable) {
    const safetyIssues = [];
    Object.entries(expectedFields).forEach(([field, value]) => {
      if (!(field in detected)) safetyIssues.push({ field, expected: value, observed: "missing", type: "stable-field-miss" });
      else if (canonical(detected[field]) !== canonical(value)) safetyIssues.push({ field, expected: value, observed: detected[field], type: "stable-field-mismatch" });
    });
    if (expected.shouldWarn && !scan.warnings.length) safetyIssues.push({ type: "missing-warning" });
    if (["unknown-cpu", "unknown-gpu", "omitted-memory"].includes(record.adversarialKind)) {
      expected.ambiguousFields.forEach((field) => {
        if (scan.fields[field]?.confidence === "high") {
          safetyIssues.push({ field, observed: scan.fields[field], type: "confident-unknown" });
        }
      });
    }
    if (safetyIssues.length) {
      gates.G3.passed = false;
      addFailure(record, "G3", "Adversarial input was not handled safely", { safetyIssues, warnings: scan.warnings, observed: detected });
    }
  }

  if (recommendationResult.top.some((item) => !catalog.models.find((model) => model.id === item.id)?.taskCategories.includes(state.task))) {
    gates.G5.passed = false;
    addFailure(record, "G5", "Recommendation category did not match the selected task", { observed: recommendationResult.top });
  }

  const unsafeLabels = recommendationResult.top.flatMap((item) => {
    if (!["strong", "usable"].includes(item.fit)) return [];
    const model = catalog.models.find((candidate) => candidate.id === item.id);
    const reasons = [];
    if (state.ram < model.minRamGb) reasons.push(`RAM ${state.ram}<${model.minRamGb}`);
    if (state.vram < model.minVramGb) reasons.push(`VRAM ${state.vram}<${model.minVramGb}`);
    if (state.storage < model.estimatedStorageGb) reasons.push(`storage ${state.storage}<${model.estimatedStorageGb}`);
    if (model.gpuImportance === "required" && !model.supportedGpuVendors.includes(state.gpuVendor)) reasons.push("unsupported required GPU");
    return reasons.length ? [{ model: model.id, fit: item.fit, score: item.score, reasons }] : [];
  });
  if (unsafeLabels.length) {
    gates.G6.passed = false;
    addFailure(record, "G6", "Hardware-infeasible model received a usable or strong label", { unsafeLabels, observed: recommendationResult.top });
  }
  const practicalLocalFit = recommendationResult.top.some((item) => item.score >= 40);
  if (!practicalLocalFit && !recommendationResult.noLocalFit) {
    gates.G6.passed = false;
    addFailure(record, "G6", "No practical local fit existed but the limitation state was not set", { observed: recommendationResult });
  }

  if ((state.deployment === "local-only" && recommendationResult.hostedFallbackShown)
    || (state.deployment !== "local-only" && record.policyExpected.cloudAllowed === false && recommendationResult.hostedFallbackShown)) {
    gates.G7.passed = false;
    addFailure(record, "G7", "Hosted fallback violated the user's deployment boundary", { observed: recommendationResult });
  }

  const feasibleModels = catalog.models.filter((model) => feasible(model, state));
  if (feasibleModels.length && !recommendationResult.top.length) {
    gates.G8.passed = false;
    addFailure(record, "G8", "A feasible profile received no local recommendation", { expected: feasibleModels.map((model) => model.id) });
  }
  const incomplete = recommendationResult.top.flatMap((item) => {
    const model = catalog.models.find((candidate) => candidate.id === item.id);
    const missing = [];
    if (!model.starterRecommendation?.family) missing.push("starter family");
    if (!model.starterRecommendation?.preferredRuntime) missing.push("runtime");
    if (!model.starterRecommendation?.hardwareFitNote) missing.push("fit explanation");
    if (!model.starterRecommendation?.avoidNote) missing.push("avoid note");
    if (!model.licenseNotes) missing.push("license note");
    if (!model.sourceLinks?.length) missing.push("source link");
    if (!model.lastReviewed) missing.push("review date");
    return missing.length ? [{ model: model.id, missing }] : [];
  });
  if (incomplete.length) {
    gates.G8.passed = false;
    addFailure(record, "G8", "Recommendation content was incomplete", { incomplete });
  }

  recordResults.push({
    id: record.id,
    fold: record.fold,
    segment: segment(record),
    gates,
    scannerCounts,
    scan: plainScan(scan),
    recommendation: recommendationResult,
    feasibleModels: feasibleModels.map((model) => model.id)
  });
}

const pairResults = [];
const groups = new Map();
dataset.records.forEach((record) => {
  if (!record.equivalenceGroup) return;
  const members = groups.get(record.equivalenceGroup) || [];
  members.push(record);
  groups.set(record.equivalenceGroup, members);
});

groups.forEach((members, group) => {
  const [first, second] = members;
  const firstScan = scanValues(scanSetupText(first.setupText));
  const secondScan = scanValues(scanSetupText(second.setupText));
  const firstRecommendation = recommendation(stateFromProfile(first.profile));
  const secondRecommendation = recommendation(stateFromProfile(second.profile));
  const scanMatch = canonical(firstScan) === canonical(secondScan);
  const topMatch = firstRecommendation.top[0]?.starterFamily === secondRecommendation.top[0]?.starterFamily;
  const passed = scanMatch && topMatch;
  if (!passed) {
    failures.push({
      gate: "G9",
      severity: "medium",
      fold: first.fold,
      id: group,
      segment: { first: segment(first), second: segment(second) },
      issue: "Equivalent inputs did not normalize to the same scan and top starter",
      expected: { sameProfile: true, sameTopStarter: true },
      observed: { firstScan, secondScan, firstTop: firstRecommendation.top[0], secondTop: secondRecommendation.top[0] },
      setupText: [first.setupText, second.setupText]
    });
  }
  pairResults.push({ group, fold: first.fold, ids: members.map((record) => record.id), passed, scanMatch, topMatch });
});

const categoryCoverageFailures = [];
for (let fold = 1; fold <= 5; fold += 1) {
  const foldResults = recordResults.filter((result) => result.fold === fold);
  for (const task of ["chat-llm", "coding-llm", "image-generation", "speech-to-text", "embeddings"]) {
    const feasibleResult = foldResults.some((result) => result.segment.task === task && result.feasibleModels.length && result.recommendation.top.length);
    if (!feasibleResult) {
      categoryCoverageFailures.push({ fold, task });
      failures.push({ gate: "G5", severity: "medium", fold, id: `fold-${fold}-${task}`, issue: "Fold lacked a feasible result for a supported category" });
    }
  }
}

function gateSummary(gate) {
  const byFold = {};
  for (let fold = 1; fold <= 5; fold += 1) {
    if (gate === "G9") {
      const rows = pairResults.filter((result) => result.fold === fold);
      const passed = rows.filter((result) => result.passed).length;
      byFold[fold] = { passed, total: rows.length, rate: rows.length ? passed / rows.length : null };
      continue;
    }
    const rows = recordResults.filter((result) => result.fold === fold && result.gates[gate]?.applicable);
    const passed = rows.filter((result) => result.gates[gate]?.passed).length;
    byFold[fold] = { passed, total: rows.length, rate: rows.length ? passed / rows.length : null };
  }
  const rates = Object.values(byFold).map((value) => value.rate).filter((value) => value !== null);
  const mean = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  const variance = rates.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / rates.length;
  return {
    byFold,
    mean,
    minimum: Math.min(...rates),
    maximum: Math.max(...rates),
    standardDeviation: Math.sqrt(variance),
    passed: rates.every((value) => value === 1)
  };
}

const gates = {};
for (const gate of [...gateIds, "G9"]) gates[gate] = gateSummary(gate);
gates.G10 = {
  passed: Object.values(gates).every((gate) => gate.passed),
  reason: "All measured gates must pass in every fold with zero standard deviation."
};

function scannerMetricSummary(rows) {
  const totals = rows.reduce((sum, row) => ({
    truePositive: sum.truePositive + row.scannerCounts.truePositive,
    falsePositive: sum.falsePositive + row.scannerCounts.falsePositive,
    falseNegative: sum.falseNegative + row.scannerCounts.falseNegative
  }), { truePositive: 0, falsePositive: 0, falseNegative: 0 });
  const precisionDenominator = totals.truePositive + totals.falsePositive;
  const recallDenominator = totals.truePositive + totals.falseNegative;
  return {
    ...totals,
    precision: precisionDenominator ? totals.truePositive / precisionDenominator : null,
    recall: recallDenominator ? totals.truePositive / recallDenominator : null
  };
}

const nonAmbiguousResults = recordResults.filter((result) => result.gates.G2.applicable);
const scannerMetrics = {
  overall: scannerMetricSummary(nonAmbiguousResults),
  byFold: Object.fromEntries([1, 2, 3, 4, 5].map((fold) => [fold, scannerMetricSummary(nonAmbiguousResults.filter((result) => result.fold === fold))]))
};

const result = {
  metadata: {
    generatedAt: new Date().toISOString(),
    codeCommit: "5dd494c",
    fixtureCommit,
    fixtureSha256: "25830784aef309a75217d4d3a5936a806a2d5b8f2da33379b9f3263e28d34539",
    records: dataset.records.length,
    folds: 5,
    note: "Deterministic five-fold scenario validation; no model training occurred."
  },
  gates,
  scannerMetrics,
  failureCount: failures.length,
  failures,
  categoryCoverageFailures,
  pairResults,
  recordResults
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  failureCount: result.failureCount,
  gates: Object.fromEntries(Object.entries(gates).map(([gate, summary]) => [gate, summary.passed]))
}, null, 2));
