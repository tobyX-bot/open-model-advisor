import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.dirname(ROOT);
const outputDirectory = process.env.VALIDATION_OUTPUT_DIR
  ? path.resolve(process.env.VALIDATION_OUTPUT_DIR)
  : path.join(ROOT, "results", "current");
const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "computer_setups_200_v1_1.json"), "utf8"));
const moduleResults = JSON.parse(fs.readFileSync(path.join(outputDirectory, "module-results.json"), "utf8"));
const moduleById = new Map(moduleResults.recordResults.map((result) => [result.id, result]));
const outputPath = path.join(outputDirectory, "browser-results.json");
const executablePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(REPOSITORY_ROOT, `.${requested}`);
    if (!filePath.startsWith(`${REPOSITORY_ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/` });
    });
  });
}

const owned = process.env.MODEL_DIGGER_URL ? null : await startServer();
const baseUrl = process.env.MODEL_DIGGER_URL || owned.baseUrl;
if (!process.env.MODEL_DIGGER_URL) {
  const sentinel = await fetch(baseUrl).then((response) => response.text());
  if (!sentinel.includes('id="advisorForm"') || !sentinel.includes("Model Digger")) {
    await new Promise((resolve) => owned.server.close(resolve));
    throw new Error("Owned server did not return the Model Digger app sentinel");
  }
}

let browser;
try {
browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce"
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const failures = [];
const recordResults = [];
const invalidFieldChecked = new Set();
const taskPreservationChecked = new Set();
const revisionInvalidationChecked = new Set();
const staleScanChecked = new Set();
const mobileLayoutChecked = new Set();
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
}

async function setJob(record) {
  const profile = record.profile;
  await page.locator("#task").selectOption(profile.task);
  await page.locator("#workload").selectOption(profile.workload);
  await page.locator("#deployment").selectOption(profile.deployment);
  await page.locator("#internet").selectOption(profile.internet);
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
    const hostedNoticePresent = await page.locator("#hostedFallback .hosted-fallback").count() > 0;
    const expectedHosted = moduleResult.recommendation.hostedFallbackShown;
    const hostedNoticeIsSecondary = hostedNoticePresent
      ? await page.locator("#hostedFallback .hosted-fallback").filter({ hasText: hostedTitle }).count() > 0
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
      starterSpec: await page.locator(".result-primary .starter-grid").count() > 0,
      avoidNote: await page.locator(".result-primary .avoid-line").count() > 0,
      sourceLink: await page.locator(".result-primary .sources-fact a").count() > 0,
      modelPage: await page.locator(".result-primary .result-action.primary-action").count() > 0,
      runtimeGuide: await page.locator(".result-primary .result-actions a").count() > 1
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

    if (!revisionInvalidationChecked.has(record.fold)) {
      revisionInvalidationChecked.add(record.fold);
      await page.locator("#ram").fill(String(record.profile.ram + 1));
      if (await page.locator(".result-card").count()) journeyIssues.push("Hardware edit retained stale recommendations");
      if (!(await page.locator("#task").isDisabled())) journeyIssues.push("Hardware edit did not lock ranking controls");
      await page.locator("#ram").fill(String(record.profile.ram));
      await page.locator("#confirmSpecs").click();
    }

    if (!staleScanChecked.has(record.fold)) {
      staleScanChecked.add(record.fold);
      await page.evaluate(() => {
        const input = document.querySelector("#setupPaste");
        input.value = "Windows laptop; CPU Intel i5; RAM 16GB; no dedicated GPU; SSD free 100GB";
        document.querySelector("#scanSetup").click();
        input.value = "macOS MacBook; Apple M3 Pro; 36GB unified memory; SSD free 200GB";
        document.querySelector("#scanSetup").click();
      });
      await page.waitForTimeout(20);
      const reviewText = await page.locator("#detectedFields").innerText();
      if (!reviewText.includes("M3 Pro") || reviewText.includes("Intel i5")) journeyIssues.push("Second scan did not replace the first pending result");
    }

    if (!mobileLayoutChecked.has(record.fold)) {
      mobileLayoutChecked.add(record.fold);
      await page.setViewportSize({ width: 360, height: 780 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const issueReachable = await page.locator("#scanIssues").evaluate((node) => node.getBoundingClientRect().width <= document.documentElement.clientWidth);
      if (overflow || !issueReachable) journeyIssues.push("Scanner review overflows the 360px viewport");
      await page.setViewportSize({ width: 1280, height: 900 });
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

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);

console.log(JSON.stringify({
  outputPath,
  failureCount: result.failureCount,
  gates: Object.fromEntries(Object.entries(gates).map(([gate, summary]) => [gate, summary.passed]))
}, null, 2));
} finally {
  if (browser) await browser.close();
  if (owned) await new Promise((resolve) => owned.server.close(resolve));
}
