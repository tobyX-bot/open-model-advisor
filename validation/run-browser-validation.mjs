import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "computer_setups_200.json"), "utf8"));
const moduleResults = JSON.parse(fs.readFileSync(path.join(ROOT, "results", "module-results.json"), "utf8"));
const moduleById = new Map(moduleResults.recordResults.map((result) => [result.id, result]));
const outputPath = path.join(ROOT, "results", "browser-results.json");
const baseUrl = process.env.MODEL_DIGGER_URL || "http://127.0.0.1:8000/";
const executablePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce"
});
const page = await context.newPage();
const failures = [];
const recordResults = [];
const invalidFieldChecked = new Set();
const taskPreservationChecked = new Set();
let currentRecord = null;
let runtimeErrors = [];

page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
});

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
    severity: ["G1", "G4", "G7"].includes(gate) ? "high" : "medium",
    fold: record.fold,
    id: record.id,
    segment: segment(record),
    setupText: record.setupText,
    issue,
    ...details
  });
}

async function setExactProfile(record) {
  const profile = record.profile;
  await page.locator("#reviewDetails").click();
  await page.locator("#os").selectOption(profile.os);
  await page.locator("#deviceType").selectOption(profile.deviceType);
  await page.locator("#cpuModel").fill(profile.cpuModel);
  await page.locator("#ram").fill(String(profile.ram));
  await page.locator("#gpuVendor").selectOption(profile.gpuVendor);
  await page.locator("#gpuModel").fill(profile.gpuModel);
  if (profile.gpuVendor !== "none") await page.locator("#vram").fill(String(profile.vram));
  await page.locator("#storage").fill(String(profile.storage));
  await page.locator("#internet").selectOption(profile.internet);
  await page.locator("#deployment").selectOption(profile.deployment);
}

async function setJob(record) {
  const profile = record.profile;
  await page.locator("#task").selectOption(profile.task);
  await page.locator("#workload").selectOption(profile.workload);
  await page.locator("#deployment").selectOption(profile.deployment);
  const priorityInputs = page.locator('input[name="priority"]');
  const count = await priorityInputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = priorityInputs.nth(index);
    const value = await input.getAttribute("value");
    const shouldCheck = profile.priorities.includes(value);
    if (shouldCheck && !(await input.isChecked())) await input.check();
    if (!shouldCheck && await input.isChecked()) await input.uncheck();
  }
}

for (const record of dataset.records) {
  currentRecord = record;
  runtimeErrors = [];
  const gates = {
    G1: { applicable: true, passed: true },
    G4: { applicable: true, passed: true },
    G7: { applicable: true, passed: true },
    G8: { applicable: true, passed: true }
  };
  const journeyIssues = [];
  const moduleResult = moduleById.get(record.id);

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 15000 });
    const language = record.languageStyle === "en" ? "en" : "zh";
    await page.locator(`[data-language="${language}"]`).click();

    if (!(await page.locator("#task").isDisabled())) journeyIssues.push("Task control was unlocked before hardware confirmation");
    if (await page.locator(".result-card").count()) journeyIssues.push("Recommendations appeared before hardware confirmation");

    if (record.journey.entryMode === "paste") {
      await page.locator("#setupPaste").fill(record.setupText);
      await page.locator("#scanSetup").click();
      await page.waitForTimeout(20);
      if (!(await page.locator("#task").isDisabled())) journeyIssues.push("Scan silently unlocked the task control");
      if (await page.locator(".result-card").count()) journeyIssues.push("Scan silently produced recommendations");
      if (await page.locator("#applyDetected").isEnabled()) await page.locator("#applyDetected").click();
      else journeyIssues.push("Detected setup could not be applied");
      if (!(await page.locator("#task").isDisabled())) journeyIssues.push("Applying scan silently confirmed hardware");
    } else if (record.journey.entryMode === "preset-edit") {
      const preset = record.profile.os === "macos" ? "apple-16"
        : record.profile.deviceType === "server" ? "server-24"
          : record.profile.gpuVendor === "none" ? "cpu-only" : "gaming-8";
      await page.locator("#reviewDetails").click();
      await page.locator("#preset").selectOption(preset);
    }

    await setExactProfile(record);

    if (!invalidFieldChecked.has(record.fold)) {
      invalidFieldChecked.add(record.fold);
      await page.locator("#ram").fill("");
      await page.locator("#confirmSpecs").click();
      if (!(await page.locator("#task").isDisabled())) journeyIssues.push("Invalid RAM did not block confirmation");
      if (await page.locator(".result-card").count()) journeyIssues.push("Invalid RAM did not block scoring");
      await page.locator("#ram").fill(String(record.profile.ram));
    }

    await page.locator("#confirmSpecs").click();
    if (await page.locator("#task").isDisabled()) journeyIssues.push("Valid hardware confirmation did not unlock task selection");
    await setJob(record);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(10);

    const uiLanguage = language === "zh" ? "zh" : "en";
    const hostedTitle = translate(uiLanguage, "hostedFallbackTitle");
    const noticeTitles = await page.locator("#messageArea .notice strong").allTextContents();
    const hostedNoticePresent = noticeTitles.includes(hostedTitle);
    const expectedHosted = moduleResult.recommendation.hostedFallbackShown;
    const hostedNoticeIsSecondary = hostedNoticePresent
      ? await page.locator("#messageArea .notice.info").filter({ hasText: hostedTitle }).count() > 0
      : true;
    if (hostedNoticePresent !== expectedHosted || !hostedNoticeIsSecondary || (record.profile.deployment === "local-only" && hostedNoticePresent)) {
      gates.G7.passed = false;
      addFailure(record, "G7", "Rendered hosted fallback did not match the deployment policy", {
        expected: { hostedNotice: expectedHosted, localOnly: record.profile.deployment === "local-only", secondaryNotice: true },
        observed: { hostedNoticePresent, hostedNoticeIsSecondary, noticeTitles }
      });
    }

    const resultCards = await page.locator(".result-card").count();
    const expectedCards = moduleResult.recommendation.top.length;
    const contentChecks = expectedCards ? {
      modelName: await page.locator(".result-primary .model-name").count() > 0,
      starterSpec: await page.locator(".result-primary .starter-spec").count() > 0,
      avoidNote: await page.locator(".result-primary .avoid-line").count() > 0,
      sourceLink: await page.locator(".result-primary .sources-fact a").count() > 0,
      primaryFacts: await page.locator(".result-primary .primary-facts").count() > 0
    } : {};
    const noFitNotice = await page.locator("#messageArea .notice.bad").count() > 0;
    if (resultCards !== expectedCards
      || Object.values(contentChecks).some((value) => !value)
      || (!expectedCards && !noFitNotice)) {
      gates.G8.passed = false;
      addFailure(record, "G8", "Rendered recommendation content was incomplete or inconsistent", {
        expected: { resultCards: expectedCards, noFitNotice: expectedCards === 0 },
        observed: { resultCards, noFitNotice, contentChecks }
      });
    }

    if (!taskPreservationChecked.has(record.fold)
      && record.journey.entryMode === "paste"
      && record.parserExpected.fields.task) {
      taskPreservationChecked.add(record.fold);
      const selectedTask = record.parserExpected.fields.task === "coding-llm" ? "chat-llm" : "coding-llm";
      await page.locator("#task").selectOption(selectedTask);
      await page.locator("#setupPaste").fill(record.setupText);
      await page.locator("#scanSetup").click();
      await page.waitForTimeout(20);
      if (await page.locator("#task").inputValue() !== selectedTask) {
        journeyIssues.push("Scanning text overwrote a previously selected task before apply");
      }
      if (await page.locator("#applyDetected").isEnabled()) {
        await page.locator("#applyDetected").click();
        if (await page.locator("#task").inputValue() !== selectedTask) {
          journeyIssues.push("Applying a scan overwrote a previously selected task");
        }
      } else {
        journeyIssues.push("Task-preservation scan could not be applied");
      }
    }

    if (journeyIssues.length) {
      gates.G4.passed = false;
      addFailure(record, "G4", "User journey integrity failed", { journeyIssues });
    }

    if (runtimeErrors.length) {
      gates.G1.passed = false;
      addFailure(record, "G1", "Browser journey emitted runtime errors", { observed: runtimeErrors });
    }
  } catch (error) {
    gates.G1.passed = false;
    addFailure(record, "G1", "Browser journey threw an exception", { observed: error.message, runtimeErrors });
  }

  recordResults.push({ id: record.id, fold: record.fold, segment: segment(record), gates });
}

function gateSummary(gate) {
  const byFold = {};
  for (let fold = 1; fold <= 5; fold += 1) {
    const rows = recordResults.filter((result) => result.fold === fold && result.gates[gate].applicable);
    const passed = rows.filter((result) => result.gates[gate].passed).length;
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

const gates = Object.fromEntries(["G1", "G4", "G7", "G8"].map((gate) => [gate, gateSummary(gate)]));
const result = {
  metadata: {
    generatedAt: new Date().toISOString(),
    baseUrl,
    records: dataset.records.length,
    browser: "Google Chrome via Playwright",
    reducedMotion: true,
    taskPreservationChecks: taskPreservationChecked.size
  },
  gates,
  failureCount: failures.length,
  failures,
  recordResults
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
await browser.close();

console.log(JSON.stringify({
  outputPath,
  failureCount: result.failureCount,
  gates: Object.fromEntries(Object.entries(gates).map(([gate, summary]) => [gate, summary.passed]))
}, null, 2));
