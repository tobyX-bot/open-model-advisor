import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  extractCapacityCandidates,
  extractCandidates,
  extractCpuCandidates,
  extractGpuCandidates,
  extractMemoryCandidates,
  extractStorageCandidates,
  extractSystemCandidates,
  extractTaskCandidates
} from "../src/scanner/extractors.js";
import { normalizeSetupText } from "../src/scanner/normalize.js";
import * as scannerPatterns from "../src/scanner/patterns.js";
import {
  CAPACITY_AMOUNT_PATTERNS,
  CAPACITY_CLAUSE_PATTERNS,
  CAPACITY_LABEL_PATTERNS,
  CAPACITY_RANGE_PATTERNS,
  CPU_MODEL_PATTERNS,
  GPU_MODEL_PATTERNS,
  STORAGE_KIND_PATTERNS,
  SYSTEM_PATTERNS,
  TASK_PATTERNS
} from "../src/scanner/patterns.js";

function segmentTexts(result) {
  return result.segments.map((segment) => segment.text);
}

function assertResultIsWellFormed(result) {
  assert.equal(result.raw.isWellFormed(), true);
  assert.equal(result.normalized.isWellFormed(), true);
  assert.equal(result.lower.isWellFormed(), true);
  result.segments.forEach((segment) => {
    assert.equal(segment.text.isWellFormed(), true);
    assert.equal(segment.lower.isWellFormed(), true);
  });
}

test("splits newline-separated setup fields", () => {
  const result = normalizeSetupText("RAM: 64GB\nSSD free: 1024GB");

  assert.deepEqual(segmentTexts(result), ["RAM: 64GB", "SSD free: 1024GB"]);
});

test("normalizes full-width punctuation and splits Chinese boundaries", () => {
  const result = normalizeSetupText("内存：32GB；显存：12GB｜硬盘：512GB");

  assert.equal(result.normalized, "内存:32GB;显存:12GB|硬盘:512GB");
  assert.deepEqual(segmentTexts(result), ["内存:32GB", "显存:12GB", "硬盘:512GB"]);
});

test("caps normalized text at 20,000 UTF-16 code units", () => {
  const overLimit = normalizeSetupText("x".repeat(20_001));
  const atLimit = normalizeSetupText("x".repeat(20_000));

  assert.equal(overLimit.raw.length, 20_000);
  assert.equal(overLimit.normalized.length, 20_000);
  assert.equal(overLimit.truncated, true);
  assert.equal(atLimit.raw.length, 20_000);
  assert.equal(atLimit.normalized.length, 20_000);
  assert.equal(atLimit.truncated, false);
});

test("caps supplementary characters safely before, at, and across boundaries", () => {
  const cases = [
    {
      name: "before boundary",
      input: `${"x".repeat(19_997)}😀x`,
      expected: `${"x".repeat(19_997)}😀x`,
      expectedLength: 20_000,
      truncated: false
    },
    {
      name: "at boundary",
      input: `${"x".repeat(19_998)}😀`,
      expected: `${"x".repeat(19_998)}😀`,
      expectedLength: 20_000,
      truncated: false
    },
    {
      name: "across boundary",
      input: `${"x".repeat(19_999)}😀`,
      expected: "x".repeat(19_999),
      expectedLength: 19_999,
      truncated: true
    }
  ];

  for (const boundaryCase of cases) {
    const result = normalizeSetupText(boundaryCase.input);

    assert.equal(result.raw.length, boundaryCase.expectedLength, `${boundaryCase.name}: raw length`);
    assert.equal(result.normalized.length, boundaryCase.expectedLength, `${boundaryCase.name}: normalized length`);
    assert.equal(result.raw, boundaryCase.expected, `${boundaryCase.name}: raw slice`);
    assert.equal(result.normalized, boundaryCase.expected, `${boundaryCase.name}: normalized slice`);
    assert.equal(result.truncated, boundaryCase.truncated, `${boundaryCase.name}: truncated`);
    assertResultIsWellFormed(result);
    assert.deepEqual(segmentTexts(result), [boundaryCase.expected]);
    assert.equal(result.normalized.slice(result.segments[0].start, result.segments[0].end), boundaryCase.expected);
  }
});

test("preserves NFKC composition across the raw snapshot boundary", () => {
  const input = `${"x".repeat(19_999)}A\u030A`;
  const fullNfkc = input.normalize("NFKC");
  const result = normalizeSetupText(input);

  assert.equal(input.length, 20_001);
  assert.equal(fullNfkc.length, 20_000);
  assert.ok(fullNfkc.endsWith("Å"));
  assert.equal(result.raw.length, 20_000);
  assert.equal(result.normalized, fullNfkc);
  assert.ok(result.normalized.endsWith("Å"));
  assert.equal(result.truncated, false);
});

test("caps NFKC expansion without exceeding the normalized limit", () => {
  const input = `${"x".repeat(19_999)}\uFDFA`;
  const fullNfkc = input.normalize("NFKC");
  const result = normalizeSetupText(input);

  assert.ok(fullNfkc.length > 20_000);
  assert.equal(result.raw.length, 20_000);
  assert.ok(result.raw.endsWith("\uFDFA"));
  assert.equal(result.normalized, fullNfkc.slice(0, 20_000));
  assert.equal(result.truncated, true);
});

test("applies a deterministic pre-normalization safety ceiling to large direct input", () => {
  const boundaryPrefix = `${"x".repeat(19_999)}A`;
  const input = `${boundaryPrefix}${"\u0334".repeat(80_000)}\u030A`;
  const first = normalizeSetupText(input);
  const second = normalizeSetupText(input);

  assert.equal(input.length, 100_001);
  // The trailing ring would change the boundary A to Å if normalization read past the safety ceiling.
  assert.equal(first.normalized.at(-1), "A");
  assert.equal(first.raw, boundaryPrefix);
  assert.equal(first.normalized, boundaryPrefix);
  assert.equal(first.raw.length, 20_000);
  assert.equal(first.normalized.length, 20_000);
  assert.equal(first.truncated, true);
  assertResultIsWellFormed(first);
  assert.deepEqual(first, second);
  assert.equal(first.normalized.slice(first.segments[0].start, first.segments[0].end), first.segments[0].text);
});

test("does not retain an oversized caller string through returned slices", () => {
  const inputLength = 32_000_000;
  const retainedHeapThresholdBytes = 12 * 1024 * 1024;
  const moduleUrl = new URL("../src/scanner/normalize.js", import.meta.url).href;
  const probeSource = `
    import { normalizeSetupText } from ${JSON.stringify(moduleUrl)};

    const inputLength = ${inputLength};
    const forceGc = () => {
      for (let index = 0; index < 8; index += 1) globalThis.gc();
    };

    forceGc();
    const baselineHeapBytes = process.memoryUsage().heapUsed;
    let input = "x".repeat(inputLength);
    input.charCodeAt(inputLength - 1);
    const document = normalizeSetupText(input);
    input = null;
    forceGc();

    const values = [
      document.raw,
      document.normalized,
      document.lower,
      ...document.segments.flatMap((segment) => [segment.text, segment.lower])
    ];
    const retainedHeapBytes = Math.max(0, process.memoryUsage().heapUsed - baselineHeapBytes);
    const expectedText = "x".repeat(20_000);

    console.log(JSON.stringify({
      retainedHeapBytes,
      rawLength: document.raw.length,
      normalizedLength: document.normalized.length,
      truncated: document.truncated,
      wellFormed: values.every((value) => value.isWellFormed()),
      contentMatches: document.raw === expectedText && document.normalized === expectedText,
      segmentMatches: document.segments.length === 1
        && document.segments[0].start === 0
        && document.segments[0].end === 20_000
        && document.segments[0].text === expectedText
    }));
  `;
  const probe = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "--eval", probeSource], {
    encoding: "utf8",
    timeout: 30_000
  });

  assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
  const metrics = JSON.parse(probe.stdout.trim());
  assert.equal(metrics.rawLength, 20_000);
  assert.equal(metrics.normalizedLength, 20_000);
  assert.equal(metrics.truncated, true);
  assert.equal(metrics.wellFormed, true);
  assert.equal(metrics.contentMatches, true);
  assert.equal(metrics.segmentMatches, true);
  assert.ok(
    metrics.retainedHeapBytes < retainedHeapThresholdBytes,
    `retained ${metrics.retainedHeapBytes} bytes; threshold ${retainedHeapThresholdBytes} bytes`
  );
});

test("recognizes CRLF, CR, and LF as single boundaries", () => {
  const result = normalizeSetupText("one\r\ntwo\rthree\nfour");

  assert.deepEqual(segmentTexts(result), ["one", "two", "three", "four"]);
});

test("splits semicolons, pipes, and every supported arrow", () => {
  const result = normalizeSetupText("a;b|c；d｜e->f=>g→h⇒i➜j➔k");

  assert.deepEqual(segmentTexts(result), ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]);
});

test("splits only slashes surrounded by whitespace", () => {
  const result = normalizeSetupText("AMD/Radeon / C:/models / 16/32\t/\tfinal");

  assert.deepEqual(segmentTexts(result), ["AMD/Radeon", "C:/models", "16/32", "final"]);
});

test("keeps commas inside segments and removes empty segments", () => {
  const withComma = normalizeSetupText("RAM: 64GB, DDR5");
  const blanks = normalizeSetupText("\n ; ｜ -> \r\n => \n");

  assert.deepEqual(segmentTexts(withComma), ["RAM: 64GB, DDR5"]);
  assert.deepEqual(blanks.segments, []);
});

test("preserves global and internal whitespace", () => {
  const input = "  RAM:  64GB\t \tDDR5  ";
  const result = normalizeSetupText(input);

  assert.equal(result.raw, input);
  assert.equal(result.normalized, input);
  assert.equal(result.segments[0].text, "RAM:  64GB\t \tDDR5");
});

test("applies Unicode NFKC compatibility conversion", () => {
  const result = normalizeSetupText("ＧＰＵ：①｜ＲＡＭ：３２ＧＢ");

  assert.equal(result.normalized, "GPU:1|RAM:32GB");
  assert.deepEqual(segmentTexts(result), ["GPU:1", "RAM:32GB"]);
});

test("keeps evidence offsets tied to normalized when lowercase length changes", () => {
  const result = normalizeSetupText("İ;GPU: RTX 4090");
  const evidenceMatch = /gpu: rtx 4090/i.exec(result.normalized);

  assert.equal(result.lower, result.normalized.toLowerCase());
  assert.equal(result.lower.length, result.normalized.length + 1);
  assert.equal(result.segments[0].lower, result.segments[0].text.toLowerCase());
  assert.equal(result.segments[0].lower.length, result.segments[0].text.length + 1);
  assert.equal(result.normalized.slice(result.segments[0].start, result.segments[0].end), "İ");
  assert.equal(result.normalized.slice(result.segments[1].start, result.segments[1].end), "GPU: RTX 4090");
  assert.equal(evidenceMatch?.index, result.segments[1].start);
  assert.notEqual(result.lower.indexOf("gpu: rtx 4090"), evidenceMatch?.index);

  // Contract: evidence-producing matches use normalized or segment.text with /i, never lower offsets.
  assert.equal(/gpu: rtx 4090/i.test(result.segments[1].text), true);
});

test("returns exact, sequential, monotonic segment ranges deterministically", () => {
  const input = "  RAM: 64GB  ; \r\n  GPU: RTX 4090 | SSD: 2TB  ";
  const first = normalizeSetupText(input);
  const second = normalizeSetupText(input);

  assert.deepEqual(first, second);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  first.segments.forEach((segment, index) => {
    assert.equal(segment.index, index);
    assert.equal(first.normalized.slice(segment.start, segment.end), segment.text);
    assert.equal(segment.lower, segment.text.toLowerCase());
    if (index > 0) assert.ok(segment.start >= first.segments[index - 1].end);
  });
});

test("handles null and undefined without literal placeholder words", () => {
  for (const input of [null, undefined]) {
    assert.deepEqual(normalizeSetupText(input), {
      raw: "",
      normalized: "",
      lower: "",
      truncated: false,
      segments: []
    });
  }
});

test("coerces other inputs, caps the raw snapshot, and exposes lowercase fields", () => {
  const coerced = normalizeSetupText(42);
  const capped = normalizeSetupText(`${"A".repeat(20_000)}B`);
  const lowercase = normalizeSetupText("RAM: 64GB\nGPU: RTX 4090");

  assert.equal(coerced.raw, "42");
  assert.equal(coerced.normalized, "42");
  assert.equal(capped.raw, "A".repeat(20_000));
  assert.equal(capped.raw.length, 20_000);
  assert.equal(capped.truncated, true);
  assert.equal(lowercase.lower, lowercase.normalized.toLowerCase());
  assert.deepEqual(lowercase.segments.map((segment) => segment.lower), ["ram: 64gb", "gpu: rtx 4090"]);
});

function candidateValues(candidates, field) {
  return candidates.filter((candidate) => candidate.field === field).map((candidate) => candidate.value);
}

function assertCandidateContract(document, candidate) {
  assert.equal(Object.getPrototypeOf(candidate), Object.prototype);
  assert.equal(typeof candidate.field, "string");
  assert.ok(typeof candidate.value === "string" || typeof candidate.value === "number");
  assert.equal(typeof candidate.raw, "string");
  assert.equal(typeof candidate.segmentIndex, "number");
  assert.equal(typeof candidate.start, "number");
  assert.equal(typeof candidate.end, "number");
  assert.equal(typeof candidate.source, "string");
  assert.equal(typeof candidate.specificity, "number");
  assert.ok(["high", "medium", "low"].includes(candidate.confidence));
  assert.equal(candidate.inferred, false);
  assert.equal(document.normalized.slice(candidate.start, candidate.end), candidate.raw);
  assert.equal(document.segments[candidate.segmentIndex].text.includes(candidate.raw), true);
}

function assertCapacityCandidateContract(document, candidate) {
  assert.equal(Object.getPrototypeOf(candidate), Object.prototype);
  assert.ok(["ram", "vram", "storage"].includes(candidate.field));
  assert.equal(typeof candidate.value, "number");
  assert.equal(typeof candidate.raw, "string");
  assert.equal(typeof candidate.segmentIndex, "number");
  assert.equal(typeof candidate.start, "number");
  assert.equal(typeof candidate.end, "number");
  assert.equal(typeof candidate.source, "string");
  assert.equal(typeof candidate.specificity, "number");
  assert.ok(["high", "medium", "low"].includes(candidate.confidence));
  assert.equal(typeof candidate.inferred, "boolean");
  assert.ok(["before-label", "after-label"].includes(candidate.amountPosition));
  assert.ok(["GB", "GiB", "TB", "TiB", "G", "gig", "gigabyte"].includes(candidate.sourceUnit));
  if (candidate.field === "storage") {
    assert.ok(["free", "total", "unknown"].includes(candidate.storageKind));
  } else {
    assert.equal("storageKind" in candidate, false);
  }
  assert.equal(document.normalized.slice(candidate.start, candidate.end), candidate.raw);
  assert.equal(document.segments[candidate.segmentIndex].text.includes(candidate.raw), true);
}

test("exports all pure scanner candidate extractor entry points", () => {
  for (const extractor of [
    extractSystemCandidates,
    extractCpuCandidates,
    extractGpuCandidates,
    extractMemoryCandidates,
    extractStorageCandidates,
    extractCapacityCandidates,
    extractTaskCandidates,
    extractCandidates
  ]) {
    assert.equal(typeof extractor, "function");
  }
});

test("defines ordered declarative CPU and GPU model pattern data", () => {
  const requiredKeys = ["id", "field", "vendor", "regex", "confidence", "specificity", "normalize"];

  for (const patterns of [CPU_MODEL_PATTERNS, GPU_MODEL_PATTERNS]) {
    let sawGenericPattern = false;
    for (const pattern of patterns) {
      requiredKeys.forEach((key) => assert.equal(key in pattern, true, `${pattern.id}.${key}`));
      assert.equal(pattern.regex instanceof RegExp, true);
      assert.equal(pattern.regex.global, false);
      assert.equal(typeof pattern.normalize, "function");
      if (pattern.specificity < 100) sawGenericPattern = true;
      else assert.equal(sawGenericPattern, false, `${pattern.id} follows a generic pattern`);
    }
  }
});

test("deep freezes every exported pattern collection", () => {
  for (const patterns of [
    SYSTEM_PATTERNS,
    CPU_MODEL_PATTERNS,
    GPU_MODEL_PATTERNS,
    CAPACITY_LABEL_PATTERNS,
    CAPACITY_AMOUNT_PATTERNS,
    CAPACITY_CLAUSE_PATTERNS,
    CAPACITY_RANGE_PATTERNS,
    scannerPatterns.CAPACITY_DISQUALIFIER_PATTERNS,
    scannerPatterns.DEDICATED_GPU_EVIDENCE_PATTERNS,
    STORAGE_KIND_PATTERNS,
    TASK_PATTERNS
  ]) {
    assert.equal(Object.isFrozen(patterns), true);
    for (const pattern of patterns) {
      assert.equal(Object.isFrozen(pattern), true, pattern.id);
      assert.equal(Object.isFrozen(pattern.regex), true, `${pattern.id}.regex`);
    }
  }
});

test("attempted GPU pattern mutation cannot alter later extraction", () => {
  const document = normalizeSetupText("NVIDIA RTX 4090");
  const before = extractGpuCandidates(document);
  const pattern = GPU_MODEL_PATTERNS[0];
  const originalVendor = pattern.vendor;
  let mutationError;
  let after;

  try {
    pattern.vendor = "amd";
    after = extractGpuCandidates(document);
  } catch (error) {
    mutationError = error;
    after = extractGpuCandidates(document);
  } finally {
    if (!Object.isFrozen(pattern)) pattern.vendor = originalVendor;
  }

  assert.equal(mutationError instanceof TypeError, true);
  assert.deepEqual(after, before);
  assert.deepEqual(candidateValues(after, "gpuModel"), ["NVIDIA RTX 4090"]);
  assert.deepEqual(candidateValues(after, "gpuVendor"), ["nvidia"]);
});

test("canonicalizes exact CPU models in English, Chinese, and mixed ordering", () => {
  const document = normalizeSetupText([
    "GPU: NVIDIA RTX 4060 Laptop GPU",
    "处理器: amd ryzen 7 7800x3d",
    "CPU intel core ultra 7 155h",
    "處理器 Intel Core i5 13500h",
    "服务器处理器: xeon gold 5318y",
    "CPU: epyc 7232p",
    "芯片 Apple m3 pro"
  ].join(";"));
  const candidates = extractCpuCandidates(document);

  assert.deepEqual(candidateValues(candidates, "cpuModel"), [
    "AMD Ryzen 7 7800X3D",
    "Intel Core Ultra 7 155H",
    "Intel Core i5-13500H",
    "Xeon Gold 5318Y",
    "AMD EPYC 7232P",
    "Apple M3 Pro"
  ]);
  candidates.forEach((candidate) => assertCandidateContract(document, candidate));
  assert.deepEqual(candidates[1], {
    field: "cpuModel",
    value: "Intel Core Ultra 7 155H",
    raw: "intel core ultra 7 155h",
    segmentIndex: 2,
    start: document.normalized.indexOf("intel core ultra 7 155h"),
    end: document.normalized.indexOf("intel core ultra 7 155h") + "intel core ultra 7 155h".length,
    source: "cpu.intel-core-ultra",
    specificity: 100,
    confidence: "high",
    inferred: false
  });
});

test("canonicalizes exact GPU models and preserves supported suffixes", () => {
  const document = normalizeSetupText([
    "显卡 nvidia rtx 4060 laptop gpu",
    "GPU: NVIDIA RTX 4070 ti super",
    "顯卡 amd radeon rx 7900 xt",
    "GPU intel arc a750",
    "显卡 Intel iris xe"
  ].join("|"));
  const candidates = extractGpuCandidates(document);

  assert.deepEqual(candidateValues(candidates, "gpuModel"), [
    "NVIDIA RTX 4060 Laptop GPU",
    "NVIDIA RTX 4070 Ti SUPER",
    "AMD Radeon RX 7900 XT",
    "Intel Arc A750",
    "Intel Iris Xe"
  ]);
  assert.deepEqual(candidateValues(candidates, "gpuVendor"), ["nvidia", "nvidia", "amd", "intel", "intel"]);
  candidates.forEach((candidate) => assertCandidateContract(document, candidate));
  for (let index = 0; index < candidates.length; index += 2) {
    assert.equal(candidates[index].field, "gpuModel");
    assert.equal(candidates[index + 1].field, "gpuVendor");
    assert.deepEqual(
      [candidates[index + 1].raw, candidates[index + 1].start, candidates[index + 1].end],
      [candidates[index].raw, candidates[index].start, candidates[index].end]
    );
  }

  const model = candidates.find((candidate) => candidate.value === "NVIDIA RTX 4070 Ti SUPER");
  assert.deepEqual(model, {
    field: "gpuModel",
    value: "NVIDIA RTX 4070 Ti SUPER",
    raw: "NVIDIA RTX 4070 ti super",
    segmentIndex: 1,
    start: document.normalized.indexOf("NVIDIA RTX 4070 ti super"),
    end: document.normalized.indexOf("NVIDIA RTX 4070 ti super") + "NVIDIA RTX 4070 ti super".length,
    source: "gpu.nvidia-rtx",
    specificity: 100,
    confidence: "high",
    inferred: false
  });
});

test("GPU model evidence does not absorb VRAM, Chinese, or RAM tails", () => {
  const cases = [
    ["GPU: NVIDIA RTX 4060 Laptop GPU with 8GB VRAM", "NVIDIA RTX 4060 Laptop GPU"],
    ["NVIDIA RTX 4070 Ti SUPER 显卡，8GB 显存", "NVIDIA RTX 4070 Ti SUPER"],
    ["GPU AMD Radeon RX 7900 XT RAM 64GB", "AMD Radeon RX 7900 XT"]
  ];

  for (const [input, expectedRaw] of cases) {
    const document = normalizeSetupText(input);
    const models = extractGpuCandidates(document).filter((candidate) => candidate.field === "gpuModel");

    assert.equal(models.length, 1);
    assert.equal(models[0].raw, expectedRaw);
    assert.equal(models[0].raw.includes("8GB"), false);
    assert.equal(models[0].raw.includes("RAM"), false);
  }
});

test("retains constrained labeled unknown CPU and GPU models without exact-pattern duplicates", () => {
  const document = normalizeSetupText([
    "CPU NovaCore NX-17H RAM 64GB coding assistant",
    "NVIDIA MysteryGPU Z-10 image generation",
    "GPU: Intel Arc A750 with 8GB VRAM"
  ].join(";"));
  const cpuCandidates = extractCpuCandidates(document);
  const gpuCandidates = extractGpuCandidates(document);

  assert.deepEqual(cpuCandidates, [{
    field: "cpuModel",
    value: "NovaCore NX-17H",
    raw: "NovaCore NX-17H",
    segmentIndex: 0,
    start: document.normalized.indexOf("NovaCore NX-17H"),
    end: document.normalized.indexOf("NovaCore NX-17H") + "NovaCore NX-17H".length,
    source: "cpu.labeled-unknown",
    specificity: 10,
    confidence: "low",
    inferred: false
  }]);
  assert.deepEqual(candidateValues(gpuCandidates, "gpuModel"), ["NVIDIA MysteryGPU Z-10", "Intel Arc A750"]);
  assert.deepEqual(candidateValues(gpuCandidates, "gpuVendor"), ["nvidia", "intel"]);
  assert.equal(gpuCandidates.filter((candidate) => candidate.value === "Intel Arc A750").length, 1);
  assert.equal(gpuCandidates.some((candidate) => candidate.source === "gpu.labeled-unknown"), false);

  const unknownModel = gpuCandidates.find((candidate) => candidate.field === "gpuModel" && candidate.confidence === "low");
  assert.equal(unknownModel?.raw, "NVIDIA MysteryGPU Z-10");
  assert.equal(unknownModel?.source, "gpu.nvidia-labeled-unknown");
  gpuCandidates.forEach((candidate) => assertCandidateContract(document, candidate));
});

test("generic unknown capture requires a label and cannot cross boundaries or consume trailing fields", () => {
  const unlabeled = normalizeSetupText("NovaCore NX-17H;MysteryGPU Z-10");
  const bounded = normalizeSetupText(
    "CPU NovaCore NX-17H RAM 64GB coding;GPU: Photon Z-20 storage 2TB chat"
  );

  assert.deepEqual(extractCpuCandidates(unlabeled), []);
  assert.deepEqual(extractGpuCandidates(unlabeled), []);
  assert.deepEqual(candidateValues(extractCpuCandidates(bounded), "cpuModel"), ["NovaCore NX-17H"]);
  assert.deepEqual(candidateValues(extractGpuCandidates(bounded), "gpuModel"), ["Photon Z-20"]);
  for (const candidate of [...extractCpuCandidates(bounded), ...extractGpuCandidates(bounded)]) {
    assert.equal(/RAM|storage|chat/i.test(candidate.raw), false);
  }
});

test("rejects generic CPU models contaminated by memory or storage evidence", () => {
  const inputs = [
    "CPU NovaCore 64GB RAM",
    "CPU NovaCore 2TB storage",
    "processor NovaCore 512GB SSD",
    "处理器 NovaCore 64GB 内存"
  ];

  for (const input of inputs) {
    const candidates = extractCpuCandidates(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "cpuModel"), [], input);
  }
});

test("rejects generic vendor GPU models contaminated by memory evidence", () => {
  const inputs = [
    "NVIDIA MysteryGPU 8GB VRAM",
    "NVIDIA MysteryGPU 2TB storage",
    "NVIDIA MysteryGPU 8GB 显存"
  ];

  for (const input of inputs) {
    const candidates = extractGpuCandidates(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "gpuModel"), [], input);
    assert.equal(candidates.some((candidate) => /8GB|2TB|VRAM|storage|显存/i.test(candidate.raw)), false, input);
  }
});

test("rejects generic models whose trailing number is followed by a spaced capacity context", () => {
  const cases = [
    ["CPU NovaCore 64-GB RAM", extractCpuCandidates],
    ["NVIDIA MysteryGPU 8-GB VRAM", extractGpuCandidates],
    ["graphics card Photon 24-GiB memory", extractGpuCandidates],
    ["CPU NovaCore 64 GB RAM", extractCpuCandidates],
    ["NVIDIA MysteryGPU 8 GB VRAM", extractGpuCandidates],
    ["graphics card Photon 24 GiB memory", extractGpuCandidates],
    ["CPU NovaCore 32 gb RAM", extractCpuCandidates],
    ["CPU NovaCore 64 gIb RAM", extractCpuCandidates],
    ["CPU NovaCore 4 G RAM", extractCpuCandidates],
    ["CPU NovaCore 2-TB storage", extractCpuCandidates],
    ["graphics card Photon 2 TiB memory", extractGpuCandidates],
    ["graphics card Photon 2—T storage", extractGpuCandidates],
    ["CPU NovaCore 64 gig RAM", extractCpuCandidates],
    ["CPU NovaCore 64 gigs RAM", extractCpuCandidates],
    ["CPU NovaCore 64-gigabyte memory", extractCpuCandidates],
    ["CPU NovaCore 64-gigabytes storage", extractCpuCandidates],
    ["CPU NovaCore 64gigs RAM", extractCpuCandidates],
    ["CPU NovaCore 64–GB RAM", extractCpuCandidates],
    ["NVIDIA MysteryGPU 8—GiB VRAM", extractGpuCandidates],
    ["graphics card Photon 24, GB memory", extractGpuCandidates],
    ["graphics card Photon 24:storage", extractGpuCandidates],
    ["CPU NovaCore 64 RAM", extractCpuCandidates],
    ["NVIDIA MysteryGPU 8 VRAM", extractGpuCandidates],
    ["处理器 NovaCore 64 GB 内存", extractCpuCandidates],
    ["显卡 Photon 12 GB 显存", extractGpuCandidates]
  ];

  for (const [input, extractor] of cases) {
    const candidates = extractor(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "cpuModel"), [], input);
    assert.deepEqual(candidateValues(candidates, "gpuModel"), [], input);
    assert.deepEqual(candidateValues(candidates, "gpuVendor"), [], input);
  }

  assert.deepEqual(
    candidateValues(extractCpuCandidates(normalizeSetupText("CPU NovaCore 64")), "cpuModel"),
    ["NovaCore 64"]
  );
  assert.deepEqual(
    candidateValues(extractGpuCandidates(normalizeSetupText("graphics card Photon 24")), "gpuModel"),
    ["Photon 24"]
  );
});

test("rejects generic model evidence truncated before a decimal continuation", () => {
  const cases = [
    ["CPU NovaCore 64.0GB RAM", extractCpuCandidates],
    ["NVIDIA MysteryGPU 8.0 GiB VRAM", extractGpuCandidates],
    ["graphics card Photon 1.5-TB storage", extractGpuCandidates],
    ["CPU NovaCore 8.0 gigs memory", extractCpuCandidates],
    ["CPU NovaCore 64.0", extractCpuCandidates]
  ];

  for (const [input, extractor] of cases) {
    const candidates = extractor(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "cpuModel"), [], input);
    assert.deepEqual(candidateValues(candidates, "gpuModel"), [], input);
    assert.deepEqual(candidateValues(candidates, "gpuVendor"), [], input);
  }
});

test("abstains when a generic GPU model span contains task evidence", () => {
  const inputs = [
    "GPU programming Photon Z-20",
    "GPU coding Photon Z-20",
    "GPU image generation Photon Z-20",
    "显卡 编程 Photon Z-20"
  ];

  for (const input of inputs) {
    const candidates = extractGpuCandidates(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "gpuModel"), [], input);
  }
});

test("emits every OS and device evidence item without resolving conflicts", () => {
  const document = normalizeSetupText([
    "MacBook with macOS",
    "Windows 11 微软系统",
    "Linux Ubuntu 統信",
    "笔记本 laptop",
    "工作站 workstation",
    "服务器 機架",
    "台式电脑 desktop PC"
  ].join(";"));
  const candidates = extractSystemCandidates(document);

  assert.deepEqual(candidateValues(candidates, "os"), [
    "macos", "macos", "windows", "windows", "linux", "linux", "linux"
  ]);
  assert.deepEqual(candidateValues(candidates, "deviceType"), [
    "laptop", "laptop", "laptop", "workstation", "workstation",
    "server", "server", "desktop", "desktop", "desktop"
  ]);
  candidates.forEach((candidate) => assertCandidateContract(document, candidate));
});

test("emits no-dedicated-GPU evidence without VRAM and does not infer Apple GPU", () => {
  const document = normalizeSetupText("Apple M3 Pro;no dedicated GPU;无独立显卡;無獨立顯卡;只有 CPU");
  const candidates = extractGpuCandidates(document);

  assert.deepEqual(candidateValues(candidates, "gpuVendor"), ["none", "none", "none", "none"]);
  assert.deepEqual(candidateValues(candidates, "gpuModel"), [
    "No dedicated GPU", "No dedicated GPU", "No dedicated GPU", "No dedicated GPU"
  ]);
  assert.equal(candidates.some((candidate) => candidate.field === "vram"), false);
  assert.equal(candidates.some((candidate) => candidate.value === "apple"), false);
});

test("emits all five task categories across English and Chinese evidence", () => {
  const document = normalizeSetupText([
    "coding assistant and image generation",
    "Whisper 語音轉文字",
    "RAG 知识库",
    "聊天 writing"
  ].join(";"));
  const candidates = extractTaskCandidates(document);

  assert.deepEqual(candidateValues(candidates, "task"), [
    "coding-llm",
    "image-generation",
    "speech-to-text",
    "speech-to-text",
    "embeddings",
    "embeddings",
    "chat-llm",
    "chat-llm"
  ]);
  assert.equal(candidates.some((candidate) => candidate.raw.toLowerCase() === "assistant"), false);
  candidates.forEach((candidate) => assertCandidateContract(document, candidate));
});

test("extractor offsets use normalized source when Unicode lowercase changes length", () => {
  const document = normalizeSetupText("İ;GPU: NVIDIA RTX 4060 Laptop GPU");
  const candidates = extractGpuCandidates(document);
  const model = candidates.find((candidate) => candidate.field === "gpuModel");

  assert.equal(document.lower.length, document.normalized.length + 1);
  assert.equal(model?.segmentIndex, 1);
  assert.equal(model?.start, document.normalized.indexOf("NVIDIA RTX 4060 Laptop GPU"));
  assert.equal(document.normalized.slice(model.start, model.end), model.raw);
  assert.notEqual(document.lower.indexOf("nvidia rtx 4060 laptop gpu"), model.start);
});

test("extractors are deterministic across repeated calls and do not mutate the document", () => {
  const document = normalizeSetupText("Windows laptop;CPU Intel Core i5-13500H;GPU RTX 4070 Ti SUPER;coding and chat");
  const snapshot = structuredClone(document);
  const first = extractCandidates(document);
  const second = extractCandidates(document);

  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(document, snapshot);
  first.forEach((candidate) => assertCandidateContract(document, candidate));
  assert.deepEqual(first.map((candidate) => candidate.field), [
    "os", "deviceType", "cpuModel", "gpuModel", "gpuVendor", "task", "task"
  ]);
});

test("defines ordered non-global declarative capacity patterns", () => {
  for (const pattern of CAPACITY_LABEL_PATTERNS) {
    for (const key of ["id", "field", "regex", "confidence", "specificity"]) {
      assert.equal(key in pattern, true, `${pattern.id}.${key}`);
    }
    assert.ok(["ram", "vram", "storage"].includes(pattern.field));
    assert.equal(pattern.regex instanceof RegExp, true);
    assert.equal(pattern.regex.global, false);
  }

  for (const pattern of CAPACITY_AMOUNT_PATTERNS) {
    for (const key of ["id", "sourceUnit", "regex", "multiplier"]) {
      assert.equal(key in pattern, true, `${pattern.id}.${key}`);
    }
    assert.equal(pattern.regex instanceof RegExp, true);
    assert.equal(pattern.regex.global, false);
  }

  for (const pattern of STORAGE_KIND_PATTERNS) {
    assert.ok(["free", "total"].includes(pattern.kind));
    assert.equal(pattern.regex instanceof RegExp, true);
    assert.equal(pattern.regex.global, false);
  }

  for (const pattern of CAPACITY_CLAUSE_PATTERNS) {
    assert.equal(typeof pattern.id, "string");
    assert.equal(pattern.regex instanceof RegExp, true);
    assert.equal(pattern.regex.global, false);
  }
});

test("extracts RAM and free storage only from their owning segments", () => {
  const document = normalizeSetupText("RAM: 64GB / SSD free: 1024GB");
  const candidates = extractCapacityCandidates(document);

  assert.deepEqual(candidateValues(candidates, "ram"), [64]);
  assert.deepEqual(candidateValues(candidates, "vram"), []);
  assert.deepEqual(candidateValues(candidates, "storage"), [1024]);
  assert.deepEqual(candidates, [
    {
      field: "ram",
      value: 64,
      raw: "RAM: 64GB",
      segmentIndex: 0,
      start: document.normalized.indexOf("RAM: 64GB"),
      end: document.normalized.indexOf("RAM: 64GB") + "RAM: 64GB".length,
      source: "capacity.ram.after-label",
      specificity: 100,
      confidence: "high",
      inferred: false,
      amountPosition: "after-label",
      sourceUnit: "GB"
    },
    {
      field: "storage",
      value: 1024,
      raw: "SSD free: 1024GB",
      segmentIndex: 1,
      start: document.normalized.indexOf("SSD free: 1024GB"),
      end: document.normalized.indexOf("SSD free: 1024GB") + "SSD free: 1024GB".length,
      source: "capacity.storage.after-label",
      specificity: 100,
      confidence: "high",
      inferred: false,
      amountPosition: "after-label",
      sourceUnit: "GB",
      storageKind: "free"
    }
  ]);
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("normalizes natural memory and storage units with explicit metadata", () => {
  const document = normalizeSetupText([
    "about 8 gigs of memory",
    "128GB free on the SSD",
    "1TB available storage",
    "2TiB total disk",
    "storage 256GiB",
    "storage 64GB",
    "memory 16G",
    "32 gigabytes of RAM"
  ].join(";"));
  const candidates = extractCapacityCandidates(document);
  const storage = candidates.filter((candidate) => candidate.field === "storage");

  assert.deepEqual(candidateValues(candidates, "ram"), [8, 16, 32]);
  assert.deepEqual(candidateValues(candidates, "storage"), [128, 1000, 2048, 256, 64]);
  assert.deepEqual(
    candidates.filter((candidate) => candidate.field === "ram").map((candidate) => [
      candidate.amountPosition,
      candidate.sourceUnit
    ]),
    [["before-label", "gig"], ["after-label", "G"], ["before-label", "gigabyte"]]
  );
  assert.deepEqual(
    storage.map((candidate) => [candidate.amountPosition, candidate.sourceUnit, candidate.storageKind]),
    [
      ["before-label", "GB", "free"],
      ["before-label", "TB", "free"],
      ["before-label", "TiB", "total"],
      ["after-label", "GiB", "unknown"],
      ["after-label", "GB", "unknown"]
    ]
  );
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("supports label-before and amount-before RAM and VRAM in English and Chinese", () => {
  const document = normalizeSetupText([
    "VRAM 12GB, RAM 32GB",
    "32GB RAM, 12GB VRAM",
    "32GB 系统内存, 12GB 显存",
    "系統記憶體 64GiB, 顯存 16GiB",
    "内存 24GB, 8GB 顯卡記憶體"
  ].join(";"));
  const candidates = extractMemoryCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.field, candidate.value]),
    [
      ["vram", 12], ["ram", 32],
      ["ram", 32], ["vram", 12],
      ["ram", 32], ["vram", 12],
      ["ram", 64], ["vram", 16],
      ["ram", 24], ["vram", 8]
    ]
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.amountPosition),
    [
      "after-label", "after-label",
      "before-label", "before-label",
      "before-label", "before-label",
      "after-label", "after-label",
      "after-label", "before-label"
    ]
  );
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("keeps same-segment RAM, VRAM, and storage values field-local", () => {
  const document = normalizeSetupText("RAM 64GB, SSD free 1024GB, VRAM 12GB, 128GB total HDD");
  const candidates = extractCapacityCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [
      ["ram", 64, "RAM 64GB"],
      ["storage", 1024, "SSD free 1024GB"],
      ["vram", 12, "VRAM 12GB"],
      ["storage", 128, "128GB total HDD"]
    ]
  );
  assert.equal(candidates.some((candidate) => /RAM.*SSD|SSD.*VRAM|VRAM.*HDD/i.test(candidate.raw)), false);
});

test("assigns compact capacity lists by label zones instead of nearest labels", () => {
  for (const [input, expected] of [
    [
      "RAM 16GB VRAM 8GB SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "VRAM 8GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 16GB SSD 512GB VRAM 8GB",
      [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"], ["vram", 8, "VRAM 8GB"]]
    ],
    [
      "16GB RAM 8GB VRAM 512GB SSD",
      [["ram", 16, "16GB RAM"], ["vram", 8, "8GB VRAM"], ["storage", 512, "512GB SSD"]]
    ],
    [
      "RAM: 16GB SSD: 512GB",
      [["ram", 16, "RAM: 16GB"], ["storage", 512, "SSD: 512GB"]]
    ],
    [
      "RAM 16GB SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "16GB RAM 512GB SSD",
      [["ram", 16, "16GB RAM"], ["storage", 512, "512GB SSD"]]
    ],
    [
      "RAM 16GB and SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 16GB and VRAM 8GB and SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "VRAM 8GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 32GB SSD 512GB NVIDIA RTX 4070 12GB",
      [["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    assert.deepEqual(
      candidates.map((candidate) => [candidate.start, candidate.end]),
      expected.map(([, , raw]) => {
        const start = document.normalized.indexOf(raw);
        return [start, start + raw.length];
      }),
      `${input} exact spans`
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("NVIDIA RTX 4070 RAM 12GB VRAM")),
    []
  );
});

test("pairs mixed-orientation capacity lists into non-crossing field zones", () => {
  const cases = [
    [
      "16GB RAM VRAM 8GB SSD 512GB",
      [["ram", 16, "16GB RAM"], ["vram", 8, "VRAM 8GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "16GB RAM 8GB VRAM SSD 512GB",
      [["ram", 16, "16GB RAM"], ["vram", 8, "8GB VRAM"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 16GB VRAM 8GB SSD",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "VRAM 8GB"]]
    ],
    [
      "16GB RAM RAM 32GB SSD 512GB",
      [["ram", 16, "16GB RAM"], ["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 16GB 8GB VRAM SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "8GB VRAM"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "16GB RAM VRAM 8GB 512GB SSD RAM 32GB",
      [["ram", 16, "16GB RAM"], ["vram", 8, "VRAM 8GB"], ["storage", 512, "512GB SSD"], ["ram", 32, "RAM 32GB"]]
    ],
    [
      "RAM 16GB 8GB VRAM SSD 512GB 32GB RAM VRAM 12GB",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "8GB VRAM"], ["storage", 512, "SSD 512GB"], ["ram", 32, "32GB RAM"], ["vram", 12, "VRAM 12GB"]]
    ]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    assert.deepEqual(
      candidates.map((candidate) => [candidate.start, candidate.end]),
      expected.map(([, , raw]) => {
        const start = document.normalized.indexOf(raw);
        return [start, start + raw.length];
      }),
      `${input} exact spans`
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("covers all 4,272 ordered mixed-orientation capacity permutations", () => {
  const fields = [
    { field: "ram", value: 16, label: "RAM", amount: "16GB" },
    { field: "vram", value: 8, label: "VRAM", amount: "8GB" },
    { field: "storage", value: 512, label: "SSD", amount: "512GB" },
    { field: "ram", value: 32, label: "RAM", amount: "32GB" },
    { field: "storage", value: 1000, label: "HDD", amount: "1TB" }
  ];

  function permutations(items) {
    if (items.length < 2) return [items];
    return items.flatMap((item, index) => (
      permutations(items.filter((_, itemIndex) => itemIndex !== index))
        .map((rest) => [item, ...rest])
    ));
  }

  let covered = 0;
  for (let fieldCount = 3; fieldCount <= 5; fieldCount += 1) {
    for (const ordering of permutations(fields.slice(0, fieldCount))) {
      for (let orientation = 0; orientation < 2 ** fieldCount; orientation += 1) {
        const evidence = ordering.map((item, index) => (
          orientation & (1 << index)
            ? `${item.amount} ${item.label}`
            : `${item.label} ${item.amount}`
        ));
        const input = evidence.join(" ");
        const document = normalizeSetupText(input);
        const candidates = extractCapacityCandidates(document);

        assert.deepEqual(
          candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
          ordering.map((item, index) => [item.field, item.value, evidence[index]]),
          input
        );
        candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
        covered += 1;
      }
    }
  }

  assert.equal(covered, 4272);
});

test("does not use semantic field specificity to invent incomplete-label ownership", () => {
  const cases = [
    [
      "16GB RAM VRAM 512GB SSD",
      [["ram", 16, "16GB RAM"], ["storage", 512, "512GB SSD"]]
    ],
    [
      "16GB RAM VRAM 512GB SSD 1TB HDD",
      [["ram", 16, "16GB RAM"], ["storage", 512, "512GB SSD"], ["storage", 1000, "1TB HDD"]]
    ],
    [
      "RAM 16GB VRAM SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 16GB VRAM SSD 512GB HDD 1TB",
      [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"], ["storage", 1000, "HDD 1TB"]]
    ],
    [
      "RAM VRAM 8GB SSD 512GB",
      [["vram", 8, "VRAM 8GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 16GB VRAM 8GB SSD",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "VRAM 8GB"]]
    ],
    ["RAM 16GB VRAM", []],
    [
      "RAM 16GB;VRAM 8GB;SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["vram", 8, "VRAM 8GB"], ["storage", 512, "SSD 512GB"]]
    ]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    assert.deepEqual(
      candidates.map((candidate) => [candidate.start, candidate.end]),
      expected.map(([, , raw]) => {
        const start = document.normalized.indexOf(raw);
        return [start, start + raw.length];
      }),
      `${input} exact spans`
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("leaves incomplete labels unpaired across a structural 144-case matrix", () => {
  const fieldSets = [
    [
      { field: "ram", value: 16, label: "RAM", amount: "16GB" },
      { field: "vram", value: 8, label: "VRAM", amount: "8GB" },
      { field: "storage", value: 512, label: "SSD", amount: "512GB" }
    ],
    [
      { field: "ram", value: 16, label: "RAM", amount: "16GB" },
      { field: "vram", value: 8, label: "VRAM", amount: "8GB" },
      { field: "storage", value: 512, label: "SSD", amount: "512GB" },
      { field: "storage", value: 1000, label: "HDD", amount: "1TB" }
    ],
    [
      { field: "ram", value: 16, label: "RAM", amount: "16GB" },
      { field: "vram", value: 8, label: "VRAM", amount: "8GB" },
      { field: "storage", value: 512, label: "SSD", amount: "512GB" },
      { field: "ram", value: 32, label: "RAM", amount: "32GB" },
      { field: "storage", value: 1000, label: "HDD", amount: "1TB" }
    ]
  ];
  const orientationProfiles = [
    () => "after-label",
    () => "before-label",
    (index) => index % 2 ? "before-label" : "after-label",
    (index) => index % 2 ? "after-label" : "before-label"
  ];

  function structuralConsensus(parts) {
    let cursor = 0;
    const owners = [];
    const amounts = [];
    const input = parts.map((part, index) => {
      const start = cursor;
      cursor += part.text.length + Number(index < parts.length - 1);
      const token = { ...part, start, end: start + part.text.length };
      (part.kind === "label" ? owners : amounts).push(token);
      return part.text;
    }).join(" ");
    const edges = amounts.map((amount, amountIndex) => {
      const preceding = owners.findLast((owner) => owner.end <= amount.start);
      const following = owners.find((owner) => owner.start >= amount.end);
      return [preceding, following].filter(Boolean).map((owner) => ({
        amount,
        amountIndex,
        owner,
        ownerIndex: owners.indexOf(owner),
        gap: owner.end <= amount.start
          ? amount.start - owner.end
          : owner.start - amount.end,
        boundary: Number(Math.min(owner.start, amount.start) === 0),
        orientation: owner.end <= amount.start ? "after-label" : "before-label"
      }));
    });
    const matchings = [];

    function visit(amountIndex, lastOwnerIndex, selected) {
      if (amountIndex === amounts.length) {
        const gap = selected.reduce((sum, edge) => sum + edge.gap, 0);
        const boundary = selected.reduce((sum, edge) => sum + edge.boundary, 0);
        const continuity = selected.slice(1).reduce((sum, edge, index) => (
          sum + Number(edge.orientation === selected[index].orientation)
        ), 0);
        matchings.push({
          selected: [...selected],
          pairs: selected.length,
          gap,
          boundary,
          continuity
        });
        return;
      }
      visit(amountIndex + 1, lastOwnerIndex, selected);
      for (const edge of edges[amountIndex]) {
        if (edge.ownerIndex <= lastOwnerIndex) continue;
        selected.push(edge);
        visit(amountIndex + 1, edge.ownerIndex, selected);
        selected.pop();
      }
    }

    visit(0, -1, []);
    matchings.sort((left, right) => (
      right.pairs - left.pairs
      || left.gap - right.gap
      || right.boundary - left.boundary
      || right.continuity - left.continuity
    ));
    const best = matchings.filter((matching) => (
      matching.pairs === matchings[0].pairs
      && matching.gap === matchings[0].gap
      && matching.boundary === matchings[0].boundary
      && matching.continuity === matchings[0].continuity
    ));

    const expected = amounts.flatMap((amount) => {
      const assignments = best.map((matching) => (
        matching.selected.find((edge) => edge.amount === amount)?.owner ?? null
      ));
      const owner = assignments[0];
      if (!owner || assignments.some((candidate) => candidate !== owner)) return [];
      const start = Math.min(owner.start, amount.start);
      const end = Math.max(owner.end, amount.end);
      return [[owner.item.field, amount.item.value, input.slice(start, end), start, end]];
    });
    return { input, expected };
  }

  let covered = 0;
  let unresolved = 0;
  for (const fields of fieldSets) {
    const orderings = [
      fields,
      [...fields].reverse(),
      [...fields.slice(1), fields[0]]
    ];
    for (const ordering of orderings) {
      for (const orientationFor of orientationProfiles) {
        for (let missingIndex = 0; missingIndex < ordering.length; missingIndex += 1) {
          const parts = ordering.flatMap((item, index) => {
            const label = { kind: "label", text: item.label, item };
            if (index === missingIndex) return [label];
            const amount = { kind: "amount", text: item.amount, item };
            return orientationFor(index) === "after-label"
              ? [label, amount]
              : [amount, label];
          });
          const { input, expected } = structuralConsensus(parts);
          const document = normalizeSetupText(input);
          const candidates = extractCapacityCandidates(document);
          unresolved += parts.filter((part) => part.kind === "amount").length
            - expected.length;

          assert.deepEqual(
            candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
            expected.map((candidate) => candidate.slice(0, 3)),
            input
          );
          assert.deepEqual(
            candidates.map((candidate) => [candidate.start, candidate.end]),
            expected.map((candidate) => candidate.slice(3)),
            `${input} exact spans`
          );
          candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
          covered += 1;
        }
      }
    }
  }

  assert.equal(covered, 144);
  assert.ok(unresolved > 0, "matrix must include genuinely unresolved ownership");
});

test("reserves direct GPU-adjacent amounts before pairing explicit field zones", () => {
  const cases = [
    [
      "NVIDIA RTX 4070 12GB RAM 32GB SSD 512GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 32GB NVIDIA RTX 4070 12GB SSD 512GB",
      [["ram", 32, "RAM 32GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"], ["storage", 512, "SSD 512GB"]]
    ],
    [
      "RAM 32GB SSD 512GB NVIDIA RTX 4070 12GB",
      [["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ],
    [
      "AMD Vega 8 2GB RAM 16GB SSD 512GB",
      [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"]]
    ]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    assert.deepEqual(
      candidates.map((candidate) => [candidate.start, candidate.end]),
      expected.map(([, , raw]) => {
        const start = document.normalized.indexOf(raw);
        return [start, start + raw.length];
      }),
      `${input} exact spans`
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("reserves no-GPU-adjacent amounts without stealing labeled capacity fields", () => {
  const sameClauseCases = [
    ["no dedicated GPU", 12, "RAM 32GB SSD 512GB", [["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"]]],
    ["no dedicated GPU", 2, "RAM 16GB SSD 512GB", [["ram", 16, "RAM 16GB"], ["storage", 512, "SSD 512GB"]]],
    ["无独立显卡", 12, "32GB RAM 512GB SSD", [["ram", 32, "32GB RAM"], ["storage", 512, "512GB SSD"]]],
    ["無獨立顯卡", 2, "16GB RAM 512GB SSD", [["ram", 16, "16GB RAM"], ["storage", 512, "512GB SSD"]]],
    ["integrated graphics only", 12, "SSD 512GB RAM 32GB", [["storage", 512, "SSD 512GB"], ["ram", 32, "RAM 32GB"]]],
    ["只有 CPU", 2, "512GB SSD 16GB RAM", [["storage", 512, "512GB SSD"], ["ram", 16, "16GB RAM"]]]
  ];

  for (const [noGpu, reserved, fields, expected] of sameClauseCases) {
    const input = `${noGpu} ${reserved}GB ${fields}`;
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);

    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    assert.deepEqual(
      candidates.map((candidate) => [candidate.start, candidate.end]),
      expected.map(([, , raw]) => {
        const start = document.normalized.indexOf(raw);
        return [start, start + raw.length];
      }),
      `${input} exact spans`
    );
    assert.equal(candidates.some((candidate) => candidate.value === reserved), false, input);
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }

  const controls = [
    ["no dedicated GPU, RAM 32GB, SSD 512GB", [["ram", 32], ["storage", 512]]],
    ["no dedicated GPU;12GB", []],
    ["no dedicated GPU;VRAM 8GB", [["vram", 8]]],
    ["无独立显卡;12GB RAM;512GB SSD", [["ram", 12], ["storage", 512]]],
    ["無獨立顯卡。VRAM 8GB", [["vram", 8]]],
    ["NVIDIA RTX 4070 12GB RAM 32GB", [["vram", 12], ["ram", 32]]],
    ["AMD Vega 8 2GB RAM 16GB", [["ram", 16]]]
  ];
  for (const [input, expected] of controls) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("preserves complete TB and TiB evidence for labeled memory fields", () => {
  const document = normalizeSetupText("RAM: 1TB;Memory 2 TiB;1TB available storage");
  const candidates = extractCapacityCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.field,
      candidate.value,
      candidate.sourceUnit,
      candidate.raw
    ]),
    [
      ["ram", 1000, "TB", "RAM: 1TB"],
      ["ram", 2048, "TiB", "Memory 2 TiB"],
      ["storage", 1000, "TB", "1TB available storage"]
    ]
  );
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("does not cross segment boundaries to attach capacity labels and amounts", () => {
  const separated = normalizeSetupText("RAM\n64GB\nSSD\n1024GB");
  const local = normalizeSetupText("RAM 64GB\nSSD 1024GB");

  assert.deepEqual(extractCapacityCandidates(separated), []);
  assert.deepEqual(
    extractCapacityCandidates(local).map((candidate) => [candidate.field, candidate.value, candidate.segmentIndex]),
    [["ram", 64, 0], ["storage", 1024, 1]]
  );
});

test("emits duplicate and conflicting explicit capacities separately in source order", () => {
  const document = normalizeSetupText(
    "RAM 16GB, RAM 16GB, RAM 32GB;SSD 1TB, 500GB available storage, SSD 1TB"
  );
  const candidates = extractCapacityCandidates(document);

  assert.deepEqual(candidateValues(candidates, "ram"), [16, 16, 32]);
  assert.deepEqual(candidateValues(candidates, "storage"), [1000, 500, 1000]);
  assert.deepEqual(
    candidates.map((candidate) => candidate.start),
    [...candidates.map((candidate) => candidate.start)].sort((left, right) => left - right)
  );
});

test("derives marked Apple usable-memory VRAM only from safe M-series unified memory", () => {
  const document = normalizeSetupText("Apple M3 Pro;36GB unified memory;Apple M4;unified memory 4GiB");
  const candidates = extractMemoryCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.field,
      candidate.value,
      candidate.inferred,
      candidate.confidence,
      candidate.raw
    ]),
    [
      ["ram", 36, false, "high", "36GB unified memory"],
      ["vram", 27, true, "medium", "36GB unified memory"],
      ["ram", 4, false, "high", "unified memory 4GiB"],
      ["vram", 4, true, "medium", "unified memory 4GiB"]
    ]
  );
  assert.equal(candidates[1].source, "capacity.vram.apple-unified-inference");
  assert.equal(candidates[1].amountPosition, "before-label");
  assert.equal(candidates[1].sourceUnit, "GB");
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("preserves unified RAM but suppresses Apple inference without safe Apple GPU evidence", () => {
  const cases = [
    "36GB unified memory",
    "Apple M3 Pro;NVIDIA RTX 4070;36GB unified memory",
    "Apple M3 Pro;no dedicated GPU;36GB unified memory",
    "Apple M3 Pro;无独立显卡;36GB unified memory"
  ];

  for (const input of cases) {
    const candidates = extractMemoryCandidates(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "ram"), [36], input);
    assert.deepEqual(candidateValues(candidates, "vram"), [], input);
    assert.equal(candidates[0].inferred, false, input);
  }
});

test("allows complete unlabeled GB or GiB VRAM only near a same-segment dedicated GPU", () => {
  const document = normalizeSetupText("NVIDIA RTX 4070 12GB;AMD Radeon RX 7900 XT 24GiB");
  const candidates = extractMemoryCandidates(document);

  assert.deepEqual(candidateValues(candidates, "vram"), [12, 24]);
  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.raw,
      candidate.amountPosition,
      candidate.sourceUnit,
      candidate.source,
      candidate.confidence,
      candidate.inferred
    ]),
    [
      ["NVIDIA RTX 4070 12GB", "after-label", "GB", "capacity.vram.gpu-proximity", "medium", false],
      ["AMD Radeon RX 7900 XT 24GiB", "after-label", "GiB", "capacity.vram.gpu-proximity", "medium", false]
    ]
  );
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("blocks unsafe VRAM proximity and never captures a numeric suffix", () => {
  const cases = [
    ["no dedicated GPU, 128GB SSD", [], [128]],
    ["128GB SSD", [], [128]],
    ["NVIDIA RTX 4070, RAM 32GB", [], []],
    ["NVIDIA RTX 4070, 128GB SSD", [], [128]],
    ["RAM 128GB", [], []],
    ["NVIDIA RTX 4070, no GPU, 12GB", [], []],
    ["NVIDIA RTX 4070 123456GB", [], []],
    ["NVIDIA RTX 4070 12.5GB", [], []],
    ["NVIDIA RTX 4070 128GB", [128], []],
    ["NVIDIA RTX 4070 1128GB", [1128], []]
  ];

  for (const [input, expectedVram, expectedStorage] of cases) {
    const candidates = extractCapacityCandidates(normalizeSetupText(input));

    assert.deepEqual(candidateValues(candidates, "vram"), expectedVram, input);
    assert.deepEqual(candidateValues(candidates, "storage"), expectedStorage, input);
    assert.equal(candidateValues(candidates, "vram").some((value) => value === 28 || value === 8), false, input);
  }
});

test("abstains from omitted capacities and unsupported complete numeric tokens", () => {
  const document = normalizeSetupText([
    "RAM unknown",
    "VRAM not listed",
    "storage omitted",
    "RAM 8.5GB",
    "SSD 1.25TB",
    "RAM 123456GB"
  ].join(";"));

  assert.deepEqual(extractCapacityCandidates(document), []);
});

test("rejects signed prefixed and transfer-rate capacity tokens without truncating evidence", () => {
  for (const input of [
    "SSD read speed 7GB/s",
    "SSD read speed 7GBps",
    "SSD read speed 7GB/sec",
    "SSD read speed 7GB per second",
    "VRAM bandwidth 12GiB/s",
    "storage throughput 1TB/s",
    "RAM speed 7000MB/s",
    "-8GB RAM",
    "+8GB RAM",
    "−8GB RAM",
    "±8GB RAM",
    "RAM +8GB",
    "0x128GB RAM",
    "x128GB RAM",
    "abc8GB RAM"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  const valid = normalizeSetupText("RAM-8GB;RAM - 16GB;RAM 24-GB;VRAM:12GiB;SSD:512GB.");
  assert.deepEqual(
    extractCapacityCandidates(valid).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [
      ["ram", 8, "RAM-8GB"],
      ["ram", 16, "RAM - 16GB"],
      ["ram", 24, "RAM 24-GB"],
      ["vram", 12, "VRAM:12GiB"],
      ["storage", 512, "SSD:512GB"]
    ]
  );
});

test("abstains from negated bounded and required capacity language", () => {
  for (const input of [
    "RAM is not 32GB",
    "not 32GB RAM",
    "VRAM less than 12GB",
    "storage requires at least 1TB",
    "RAM 不是 32GB",
    "RAM 不等于 32GB",
    "RAM 不等於 32GB",
    "不是 32GB 内存",
    "显存小于 12GB",
    "顯存少於 12GB",
    "存储至少 1TB",
    "存儲不超過 1TB",
    "硬盘需要至少 1TB",
    "内存不超过 32GB"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
});

test("abstains from attached preposed and postposed capacity bounds", () => {
  for (const input of [
    "RAM 32GB or more",
    "RAM 32GB+",
    "RAM 32GB or greater",
    "RAM 32GB max",
    "RAM max 32GB",
    "RAM 32GB (or more)",
    "RAM 32GB-or-more",
    "RAM <32GB",
    "RAM <=32GB",
    "RAM >=32GB",
    "RAM >32GB",
    "RAM 32GB >",
    "内存32GB以上",
    "内存32GB（以上）",
    "内存32GB以下",
    "内存32GB以内",
    "顯存12GB以內"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 32GB or more, VRAM 12GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 12, "VRAM 12GB"]]
  );

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 32GB + VRAM 12GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["ram", 32, "RAM 32GB"], ["vram", 12, "VRAM 12GB"]]
  );
});

test("keeps non-exact filtering local to its owning amount and field", () => {
  const cases = [
    ["RAM 32GB but VRAM not specified", [["ram", 32, "RAM 32GB"]]],
    ["内存32GB但显存不是12GB", [["ram", 32, "内存32GB"]]],
    ["32GB RAM spread over 2 DIMMs", [["ram", 32, "32GB RAM"]]],
    ["32GB RAM not overclocked", [["ram", 32, "32GB RAM"]]],
    ["RAM 32GB not shared with GPU", [["ram", 32, "RAM 32GB"]]]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("abstains from post-capacity absence phrases without broadening negation", () => {
  for (const input of [
    "32GB RAM not installed",
    "RAM 32GB not available",
    "32GB RAM not present",
    "RAM 32GB not present",
    "32GB RAM not included",
    "RAM 32GB not included"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
});

test("classifies capacity disqualifiers by meaning rather than position", () => {
  for (const input of [
    "RAM 32GB minimum",
    "RAM 32GB required",
    "RAM 32GB is not available"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["RAM not ECC 32GB", [["ram", 32, "RAM not ECC 32GB"]]],
    ["VRAM not shared 8GB", [["vram", 8, "VRAM not shared 8GB"]]],
    ["storage not encrypted: 1TB", [["storage", 1000, "storage not encrypted: 1TB"]]],
    ["RAM is not 32GB", []],
    ["32GB RAM not installed", []]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("recognizes semantic post-capacity bounds and absence grammar", () => {
  for (const input of [
    "RAM 32GB at least",
    "32GB RAM was not installed",
    "storage 1TB currently not present",
    "RAM 32GB unavailable",
    "RAM: 16GB module not installed"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["32GB RAM not overclocked", [["ram", 32, "32GB RAM"]]],
    ["RAM 32GB not shared with GPU", [["ram", 32, "RAM 32GB"]]],
    ["RAM is not 32GB", []]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("classifies attached absence and lower-bound qualifiers across capacity fields", () => {
  for (const input of [
    "RAM 32GB is unavailable",
    "RAM 32GB was unavailable",
    "RAM 32GB currently unavailable",
    "32GB RAM is unavailable",
    "VRAM 8GiB presently unavailable",
    "vRaM 8gib PRESENTLY UNAVAILABLE",
    "8GiB VRAM is still unavailable",
    "storage 1TB is currently unavailable",
    "storage 2TiB IS NOT CURRENTLY AVAILABLE",
    "1TB storage was unavailable",
    "RAM 32GB is not currently available",
    "32GB RAM was presently not installed",
    "RAM 32GB or higher",
    "RAM 32GB or above",
    "RAM 32GB and above",
    "RAM 32GB and up",
    "VRAM 8GiB OR HIGHER",
    "8GB VRAM and above",
    "Memory 2 TiB and above",
    "RAM 16 gigabytes or higher",
    "storage 1TB and up",
    "1TB storage or more"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  const positives = [
    ["RAM 32GB available", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB installed", [["ram", 32, "RAM 32GB"]]],
    ["storage 1TB available", [["storage", 1000, "storage 1TB available"]]],
    ["RAM 32GB and VRAM 8GB", [["ram", 32, "RAM 32GB"], ["vram", 8, "VRAM 8GB"]]],
    ["RAM 32GB and SSD 512GB", [["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"]]],
    ["RAM 32GB and more storage", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB and above-average bandwidth", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB not overclocked", [["ram", 32, "RAM 32GB"]]],
    ["VRAM 8GB not shared", [["vram", 8, "VRAM 8GB"]]]
  ];
  for (const [input, expected] of positives) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("treats and bounds as qualifiers only when the complete suffix is terminal", () => {
  const positives = [
    ["RAM 32GB and up to 2TB storage", [["ram", 32, "RAM 32GB"]]],
    ["VRAM 8GiB and above average bandwidth", [["vram", 8, "VRAM 8GiB"]]],
    ["storage 1TB and up to date encryption", [["storage", 1000, "storage 1TB"]]],
    ["RAM 32GB and up-to-date firmware", [["ram", 32, "RAM 32GB"]]],
    ["Memory 2 TiB and above-average load", [["ram", 2048, "Memory 2 TiB"]]],
    ["RAM 32GB and VRAM 8GB", [["ram", 32, "RAM 32GB"], ["vram", 8, "VRAM 8GB"]]]
  ];
  for (const [input, expected] of positives) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }

  const terminalBounds = [
    ["RAM 32GB and above", []],
    ["RAM 32GB and up", []],
    ["VRAM 8GiB and above.", []],
    ["2 TiB Memory and above!", []],
    ["storage 1TB and up, RAM 32GB", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB and above, VRAM 8GB", [["vram", 8, "VRAM 8GB"]]]
  ];
  for (const [input, expected] of terminalBounds) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("rejects natural and localized transfer-rate suffixes", () => {
  for (const input of [
    "显存带宽 12GB每秒",
    "SSD speed 7GB each second",
    "SSD speed 7GB a second"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("SSD 512GB / second SSD 1TB;VRAM 8GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["storage", 512, "SSD 512GB"], ["storage", 1000, "SSD 1TB"], ["vram", 8, "VRAM 8GB"]]
  );
});

test("keeps natural ordinal inventory wording distinct from transfer rates", () => {
  for (const [input, expected] of [
    [
      "SSD 512GB a second SSD 1TB",
      [[512, "SSD 512GB"], [1000, "SSD 1TB"]]
    ],
    [
      "SSD 512GB a second drive 1TB",
      [[512, "SSD 512GB"], [1000, "drive 1TB"]]
    ]
  ]) {
    assert.deepEqual(
      extractStorageCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }

  assert.deepEqual(extractCapacityCandidates(normalizeSetupText("SSD speed 7GB a second")), []);
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("SSD 512GB / second SSD 1TB;VRAM 8GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["storage", 512, "SSD 512GB"], ["storage", 1000, "SSD 1TB"], ["vram", 8, "VRAM 8GB"]]
  );
});

test("uses preceding rate semantics to distinguish ordinal inventory wording", () => {
  for (const [input, expected] of [
    ["SSD speed 7GB a second drive 1TB", [[1000, "drive 1TB"]]],
    ["SSD throughput 7GB a second SSD 1TB", [[1000, "SSD 1TB"]]],
    ["SSD 512GB a second SSD 1TB", [[512, "SSD 512GB"], [1000, "SSD 1TB"]]],
    ["SSD 512GB a second drive 1TB", [[512, "SSD 512GB"], [1000, "drive 1TB"]]]
  ]) {
    assert.deepEqual(
      extractStorageCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
  assert.deepEqual(extractCapacityCandidates(normalizeSetupText("SSD speed 7GB a second")), []);
});

test("rejects whitespace slash rates while preserving slash field delimiters", () => {
  for (const input of [
    "SSD read speed 7GB /s",
    "SSD read speed 7 GB / second",
    "VRAM bandwidth 12GiB / sec",
    "SSD read speed 7 GB / seconds",
    "SSD read speed 7 GB per seconds",
    "显存带宽 12GB / 秒"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  const document = normalizeSetupText("SSD 512GB / RAM 32GB");
  assert.deepEqual(
    extractCapacityCandidates(document).map((candidate) => [
      candidate.field,
      candidate.value,
      candidate.raw,
      candidate.segmentIndex
    ]),
    [
      ["storage", 512, "SSD 512GB", 0],
      ["ram", 32, "RAM 32GB", 1]
    ]
  );

  for (const input of [
    "SSD 512GB / second drive 1TB",
    "SSD 512GB / second SSD 1TB"
  ]) {
    const candidates = extractStorageCandidates(normalizeSetupText(input));
    assert.deepEqual(
      candidates.map((candidate) => [candidate.value, candidate.raw]),
      [[512, "SSD 512GB"], [1000, /drive/u.test(input) ? "drive 1TB" : "SSD 1TB"]],
      input
    );
  }
});

test("capacity offsets use normalized source when Unicode lowercase changes length", () => {
  const document = normalizeSetupText("İ;RAM 64GB, 1TB available storage");
  const candidates = extractCapacityCandidates(document);

  assert.equal(document.lower.length, document.normalized.length + 1);
  assert.deepEqual(candidates.map((candidate) => candidate.raw), ["RAM 64GB", "1TB available storage"]);
  assert.deepEqual(candidates.map((candidate) => candidate.start), [2, 12]);
  for (const candidate of candidates) {
    assert.equal(document.normalized.slice(candidate.start, candidate.end), candidate.raw);
    assert.notEqual(document.lower.indexOf(candidate.raw.toLowerCase()), candidate.start);
  }
});

test("integrates capacities without changing established candidate group ordering", () => {
  const document = normalizeSetupText(
    "Windows laptop;CPU Intel Core i5-13500H;RAM 32GB;GPU RTX 4070 12GB;SSD 1TB;coding"
  );
  const candidates = extractCandidates(document);

  assert.deepEqual(candidates.map((candidate) => candidate.field), [
    "os", "deviceType", "cpuModel", "gpuModel", "gpuVendor",
    "ram", "vram", "storage", "task"
  ]);
});

test("capacity extraction is deterministic, serializable, and does not mutate documents", () => {
  const document = normalizeSetupText(
    "Apple M3 Pro;RAM 32GB, VRAM 12GB;SSD free 1TB;36GB unified memory"
  );
  const snapshot = structuredClone(document);
  const first = extractCapacityCandidates(document);
  const second = extractCapacityCandidates(document);

  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(document, snapshot);
  first.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("keeps comma-delimited ownership local while allowing same-clause GPU proximity", () => {
  const cases = [
    [
      "NVIDIA RTX 4070 12GB, RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
    ],
    [
      "RAM 32GB, NVIDIA RTX 4070 12GB",
      [["ram", 32, "RAM 32GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ],
    [
      "32GB RAM, NVIDIA RTX 4070 12GB",
      [["ram", 32, "32GB RAM"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ],
    [
      "NVIDIA RTX 4070 12GB, 512GB SSD",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["storage", 512, "512GB SSD"]]
    ],
    [
      "NVIDIA RTX 4070 12GB, RAM unknown",
      [["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ],
    [
      "NVIDIA RTX 4070 12GB，RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
    ]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);

    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("distinguishes ordinary comma and sentence punctuation from numeric continuations", () => {
  const document = normalizeSetupText("x,8GB 内存;x，2GB 显存;disk free 512GB.");
  const candidates = extractCapacityCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [
      ["ram", 8, "8GB 内存"],
      ["vram", 2, "2GB 显存"],
      ["storage", 512, "disk free 512GB"]
    ]
  );

  for (const input of [
    "RAM 8.5GB",
    "SSD 1.25TB",
    "RAM .5GB",
    "RAM 123456GB",
    "VRAM 123456GiB",
    "RAM 8GBx",
    "SSD 1TBps"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
});

test("natural memory candidates preserve the complete about phrase", () => {
  for (const value of [8, 16, 32]) {
    const evidence = `about ${value} gigs of memory`;
    const document = normalizeSetupText(evidence);
    const candidates = extractMemoryCandidates(document);

    assert.equal(candidates.length, 1);
    assert.deepEqual(
      [candidates[0].field, candidates[0].value, candidates[0].raw],
      ["ram", value, evidence]
    );
    assert.equal(document.normalized.slice(candidates[0].start, candidates[0].end), evidence);
  }
});

test("all frozen natural-memory evidence is covered by exact candidate spans", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/computer_setups_200_v1_1.json", import.meta.url),
    "utf8"
  ));
  const records = fixture.records.filter((record) => (
    record.parserExpected.sourceEvidence?.ram?.some((value) => (
      /^about (?:8|16|32) gigs of memory$/i.test(value)
    ))
  ));

  assert.equal(records.length, 10);
  for (const record of records) {
    const document = normalizeSetupText(record.setupText);
    const evidence = record.parserExpected.sourceEvidence.ram[0].normalize("NFKC");
    const candidate = extractMemoryCandidates(document).find((entry) => (
      entry.field === "ram"
      && entry.value === record.parserExpected.fields.ram
      && entry.raw === evidence
    ));

    assert.ok(candidate, record.id);
    assert.equal(document.normalized.slice(candidate.start, candidate.end), evidence, record.id);
  }
});

test("classifies scoped Simplified and Traditional Chinese remaining storage as free", () => {
  const document = normalizeSetupText([
    "硬盘还剩 512GB",
    "硬盤還剩 384GB",
    "硬碟剩 256GB",
    "硬盘不剩 128GB",
    "硬盘剩下容量 64GB"
  ].join(";"));
  const candidates = extractStorageCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
    [
      [512, "free", "硬盘还剩 512GB"],
      [384, "free", "硬盤還剩 384GB"],
      [256, "free", "硬碟剩 256GB"],
      [128, "unknown", "硬盘不剩 128GB"],
      [64, "unknown", "硬盘剩下容量 64GB"]
    ]
  );
});

test("all six frozen Chinese remaining-storage records are classified free", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/computer_setups_200_v1_1.json", import.meta.url),
    "utf8"
  ));
  const records = fixture.records.filter((record) => (
    record.parserExpected.sourceEvidence?.storage?.some((value) => (
      /(?:还剩|還剩|硬[盘盤碟]剩)/u.test(value)
    ))
  ));

  assert.equal(records.length, 6);
  for (const record of records) {
    const document = normalizeSetupText(record.setupText);
    const evidence = record.parserExpected.sourceEvidence.storage[0].normalize("NFKC");
    const candidate = extractStorageCandidates(document).find((entry) => (
      entry.value === record.parserExpected.fields.storage
      && entry.raw.includes(evidence)
    ));

    assert.ok(candidate, record.id);
    assert.equal(candidate.storageKind, "free", record.id);
    assert.equal(document.normalized.slice(candidate.start, candidate.end), candidate.raw, record.id);
  }
});

test("covers every Task 3 numeric capacity target in the frozen 200-record corpus", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("./fixtures/computer_setups_200_v1_1.json", import.meta.url),
    "utf8"
  ));
  const noGpuEvidence = /no dedicated GPU|无独立显卡|無獨立顯卡/u;
  const targetCounts = { ram: 0, vram: 0, storage: 0 };
  const coveredCounts = { ram: 0, vram: 0, storage: 0 };

  for (const record of fixture.records) {
    const document = normalizeSetupText(record.setupText);
    const candidates = extractCapacityCandidates(document);

    for (const field of ["ram", "vram", "storage"]) {
      const expectedValue = record.parserExpected.fields[field];
      if (!Number.isFinite(expectedValue)) continue;

      const evidenceItems = record.parserExpected.sourceEvidence?.[field] ?? [];
      if (field === "vram" && evidenceItems.some((value) => noGpuEvidence.test(value))) continue;
      targetCounts[field] += 1;

      const candidate = candidates.find((entry) => (
        entry.field === field
        && entry.value === expectedValue
        && evidenceItems.some((value) => entry.raw.includes(value.normalize("NFKC")))
      ));
      assert.ok(candidate, `${record.id}.${field}: ${JSON.stringify(evidenceItems)}`);
      assert.equal(document.normalized.slice(candidate.start, candidate.end), candidate.raw, `${record.id}.${field}`);
      coveredCounts[field] += 1;
    }
  }

  assert.deepEqual(targetCounts, { ram: 185, vram: 109, storage: 195 });
  assert.deepEqual(coveredCounts, targetCounts);
});

test("keeps conjunction and sentence-delimited ownership local to GPU and RAM clauses", () => {
  const cases = [
    [
      "NVIDIA RTX 4070 12GB and RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
    ],
    [
      "RAM 32GB and NVIDIA RTX 4070 12GB",
      [["ram", 32, "RAM 32GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ],
    [
      "NVIDIA RTX 4070 12GB. RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
    ],
    [
      "NVIDIA RTX 4070 12GB。RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
    ],
    [
      "NVIDIA RTX 4070 12GB 和 RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
    ],
    [
      "RAM 32GB以及NVIDIA RTX 4070 12GB",
      [["ram", 32, "RAM 32GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ]
  ];

  for (const conjunction of ["与", "與", "並且", "及", "还有", "還有"]) {
    cases.push(
      [
        `NVIDIA RTX 4070 12GB${conjunction}RAM 32GB`,
        [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
      ],
      [
        `RAM 32GB${conjunction}NVIDIA RTX 4070 12GB`,
        [["ram", 32, "RAM 32GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
      ]
    );
  }

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);

    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("keeps fully spaced Chinese capacity clauses local without a preceding B", () => {
  const cases = [
    ["16G 和 RAM 32GB", [["ram", 32, "RAM 32GB"]]],
    ["32GB RAM 与 12GB", [["ram", 32, "32GB RAM"]]],
    [
      "32GB RAM 和 NVIDIA RTX 4070 12GB",
      [["ram", 32, "32GB RAM"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
    ]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("allows GPU proximity when unrelated labels own other amounts", () => {
  const cases = [
    "NVIDIA RTX 4070 12GB with 32GB RAM",
    "NVIDIA RTX 4070 12GB + 32GB RAM",
    "NVIDIA RTX 4070 12GB & 32GB RAM",
    "NVIDIA RTX 4070 12GB with RAM 32GB"
  ];

  for (const input of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, /RAM 32GB/u.test(input) ? "RAM 32GB" : "32GB RAM"]],
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("NVIDIA RTX 4070 RAM 12GB VRAM")),
    [],
    "ambiguous field ownership must abstain instead of falling back to GPU proximity"
  );
});

test("treats English but as a capacity ownership boundary", () => {
  for (const input of [
    "NVIDIA RTX 4070 12GB but RAM unknown",
    "NVIDIA RTX 4070 12GB but RAM not specified"
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);

    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      [["vram", 12, "NVIDIA RTX 4070 12GB"]],
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("uses with as an ownership filler unless it introduces another field", () => {
  const cases = [
    ["RAM with 32GB", [["ram", 32, "RAM with 32GB", undefined]]],
    ["storage with 512GB free", [["storage", 512, "storage with 512GB free", "free"]]],
    ["NVIDIA RTX 4070 with 12GB", [["vram", 12, "NVIDIA RTX 4070 with 12GB", undefined]]],
    [
      "NVIDIA RTX 4070 12GB with RAM 32GB",
      [["vram", 12, "NVIDIA RTX 4070 12GB", undefined], ["ram", 32, "RAM 32GB", undefined]]
    ],
    [
      "NVIDIA RTX 4070 12GB with 内存 unknown",
      [["vram", 12, "NVIDIA RTX 4070 12GB", undefined]]
    ],
    ["RAM 32GB with VRAM 8GB", [["ram", 32, "RAM 32GB", undefined], ["vram", 8, "VRAM 8GB", undefined]]]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractCapacityCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw, candidate.storageKind]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("hardens Apple unified-memory inference against dedicated and false M-series evidence", () => {
  for (const input of [
    "Apple M3 Pro;NVIDIA GPU;16GB unified memory",
    "Apple M3 Pro;dedicated GPU unknown;16GB unified memory"
  ]) {
    const candidates = extractMemoryCandidates(normalizeSetupText(input));
    assert.deepEqual(candidateValues(candidates, "ram"), [16], input);
    assert.deepEqual(candidateValues(candidates, "vram"), [], input);
    assert.equal(candidates[0].inferred, false, input);
  }

  const falseApple = normalizeSetupText("Windows laptop;Intel Core m3-8100Y;8GB unified memory");
  assert.deepEqual(candidateValues(extractCpuCandidates(falseApple), "cpuModel"), []);
  assert.deepEqual(
    extractMemoryCandidates(falseApple).map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
    [["ram", 8, false]]
  );

  for (const input of [
    "apple m3 pro;16GB unified memory",
    "macOS;M1;8GB unified memory",
    "M2;Apple GPU;16GB unified memory",
    "GPU Apple M2;16GB unified memory"
  ]) {
    const candidates = extractMemoryCandidates(normalizeSetupText(input));
    assert.deepEqual(candidateValues(candidates, "ram").length, 1, input);
    assert.deepEqual(candidateValues(candidates, "vram").length, 1, input);
    assert.equal(candidates.find((candidate) => candidate.field === "vram").inferred, true, input);
  }

  const contextualFalseApple = normalizeSetupText(
    "Windows laptop;Intel Core m3-8100Y;Apple GPU;8GB unified memory"
  );
  assert.deepEqual(candidateValues(extractCpuCandidates(contextualFalseApple), "cpuModel"), []);
  assert.deepEqual(candidateValues(extractMemoryCandidates(contextualFalseApple), "vram"), []);
});

test("does not treat M2 storage notation as an Apple processor", () => {
  const cases = [
    ["iMac;Intel Core i5-8500;SSD M2 1TB;16GB unified memory", 16],
    ["Mac mini;Intel Core i7-8700;M2 SSD 1TB;32GB unified memory", 32],
    ["MacBook Pro;Intel Core i7-9750H;SSD M2 1TB;16GB unified memory", 16]
  ];

  for (const [input, ram] of cases) {
    const document = normalizeSetupText(input);
    const cpuCandidates = extractCpuCandidates(document);
    const memoryCandidates = extractMemoryCandidates(document);

    assert.equal(
      cpuCandidates.some((candidate) => candidate.value === "Apple M2"),
      false,
      input
    );
    assert.deepEqual(
      memoryCandidates.map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
      [["ram", ram, false]],
      input
    );
    memoryCandidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("treats NVMe and M2 storage notation as non-Apple processor context", () => {
  for (const [input, ram] of [
    ["macOS;NVMe M2 1TB;16GB unified memory", 16],
    ["MacBook;M2 NVMe 1TB;16GB unified memory", 16],
    ["macOS;NVMe M2 SSD 1TB;32GB unified memory", 32]
  ]) {
    const document = normalizeSetupText(input);
    assert.equal(
      extractCpuCandidates(document).some((candidate) => candidate.value === "Apple M2"),
      false,
      input
    );
    assert.deepEqual(
      extractMemoryCandidates(document).map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
      [["ram", ram, false]],
      input
    );
  }

  for (const input of [
    "MacBook M2;16GB unified memory",
    "MacBook Pro;CPU M2 Pro;16GB unified memory",
    "Mac Studio M2 Max;32GB unified memory"
  ]) {
    const document = normalizeSetupText(input);
    assert.equal(
      extractCpuCandidates(document).some((candidate) => candidate.value.startsWith("Apple M2")),
      true,
      input
    );
    assert.equal(candidateValues(extractMemoryCandidates(document), "vram").length, 1, input);
  }
});

test("preserves strong Apple M2-family evidence before trailing NVMe storage", () => {
  for (const [input, cpu, ram, vram] of [
    ["MacBook Pro M2 Pro NVMe 1TB;16GB unified memory", "Apple M2 Pro", 16, 12],
    ["MacBook Pro M2 NVMe 1TB;16GB unified memory", "Apple M2", 16, 12],
    ["Mac Studio M2 Max NVMe 1TB;32GB unified memory", "Apple M2 Max", 32, 24],
    ["Mac Studio M2 Ultra NVMe 1TB;64GB unified memory", "Apple M2 Ultra", 64, 48],
    ["macOS;M2 Max NVMe 1TB;32GB unified memory", "Apple M2 Max", 32, 24]
  ]) {
    const document = normalizeSetupText(input);
    assert.deepEqual(candidateValues(extractCpuCandidates(document), "cpuModel"), [cpu], input);
    assert.deepEqual(
      extractMemoryCandidates(document).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.inferred
      ]),
      [["ram", ram, false], ["vram", vram, true]],
      input
    );
  }

  for (const input of [
    "macOS;NVMe M2 1TB;16GB unified memory",
    "MacBook;M2 NVMe 1TB;16GB unified memory"
  ]) {
    const document = normalizeSetupText(input);
    assert.deepEqual(candidateValues(extractCpuCandidates(document), "cpuModel"), [], input);
    assert.deepEqual(
      extractMemoryCandidates(document).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.inferred
      ]),
      [["ram", 16, false]],
      input
    );
  }

  const labeledCpu = normalizeSetupText("MacBook Pro;CPU M2 Pro;16GB unified memory");
  assert.deepEqual(candidateValues(extractCpuCandidates(labeledCpu), "cpuModel"), ["Apple M2 Pro"]);
  assert.deepEqual(
    extractMemoryCandidates(labeledCpu).map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
    [["ram", 16, false], ["vram", 12, true]]
  );
});

test("recognizes strong natural Apple CPU connectors without generic fallbacks", () => {
  for (const [input, cpu] of [
    ["MacBook Pro;CPU is M2 NVMe 1TB;16GB unified memory", "Apple M2"],
    ["MacBook Pro powered by M2 NVMe 1TB;16GB unified memory", "Apple M2"],
    ["MacBook Pro;CPU is M2 Pro NVMe 1TB;16GB unified memory", "Apple M2 Pro"],
    ["Mac Studio powered by M2 Max NVMe 1TB;16GB unified memory", "Apple M2 Max"],
    ["MacBook Pro;CPU: M2 Pro NVMe 1TB;16GB unified memory", "Apple M2 Pro"]
  ]) {
    const document = normalizeSetupText(input);
    const cpuCandidates = extractCpuCandidates(document).filter((candidate) => candidate.field === "cpuModel");
    assert.deepEqual(
      cpuCandidates.map((candidate) => [candidate.value, candidate.confidence, candidate.source]),
      [[cpu, "high", "cpu.apple-m-contextual"]],
      input
    );
    assert.deepEqual(
      extractMemoryCandidates(document).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.inferred
      ]),
      [["ram", 16, false], ["vram", 12, true]],
      input
    );
  }

  for (const input of ["Windows;CPU is M2", "Linux;processor was M3"]) {
    assert.deepEqual(candidateValues(extractCpuCandidates(normalizeSetupText(input)), "cpuModel"), [], input);
  }
  assert.deepEqual(
    candidateValues(extractCpuCandidates(normalizeSetupText("Windows;CPU model ZX 9000")), "cpuModel"),
    ["ZX 9000"]
  );

  const bareStorage = normalizeSetupText("macOS;NVMe M2 1TB;16GB unified memory");
  assert.deepEqual(candidateValues(extractCpuCandidates(bareStorage), "cpuModel"), []);
  assert.deepEqual(
    extractMemoryCandidates(bareStorage).map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
    [["ram", 16, false]]
  );
});

test("blocks Apple inference on explicit nonnumeric or invalid VRAM evidence", () => {
  for (const input of [
    "Apple M3 Pro;36GB unified memory;VRAM less than 8GB",
    "Apple M3 Pro;36GB unified memory;VRAM unknown",
    "Apple M3 Pro;36GB unified memory;VRAM 8.5GB"
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractMemoryCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.inferred, candidate.raw]),
      [["ram", 36, false, "36GB unified memory"]],
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("blocks Apple inference for reversed-vendor and external GPU evidence", () => {
  for (const input of [
    "Apple M3 Pro;GPU: NVIDIA;16GB unified memory",
    "Apple M3 Pro;GPU: AMD;16GB unified memory",
    "Apple M3 Pro;external GPU;16GB unified memory",
    "Apple M3 Pro;eGPU;16GB unified memory"
  ]) {
    assert.deepEqual(
      extractMemoryCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.inferred
      ]),
      [["ram", 16, false]],
      input
    );
  }

  assert.deepEqual(
    extractMemoryCandidates(normalizeSetupText("Apple M3 Pro;16GB unified memory"))
      .map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
    [["ram", 16, false], ["vram", 12, true]]
  );
  assert.deepEqual(
    extractMemoryCandidates(normalizeSetupText("Apple M3 Pro;16GB unified memory;VRAM 8GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.inferred]),
    [["ram", 16, false], ["vram", 8, false]]
  );
});

test("requires a dedicated GPU model for unlabeled VRAM proximity", () => {
  const cases = [
    ["Intel Iris Xe 2GB", []],
    ["Intel Iris Xe with 2GB VRAM", [["vram", 2, "2GB VRAM"]]],
    ["AMD Vega 8 2GB", []],
    ["Intel Arc A550M 8GB", [["vram", 8, "Intel Arc A550M 8GB"]]],
    ["Intel Arc A370M 4GB", [["vram", 4, "Intel Arc A370M 4GB"]]],
    ["Intel Arc A750 8GB", [["vram", 8, "Intel Arc A750 8GB"]]],
    ["NVIDIA RTX 4070 12GB", [["vram", 12, "NVIDIA RTX 4070 12GB"]]],
    ["AMD Radeon RX 7900 XT 24GiB", [["vram", 24, "AMD Radeon RX 7900 XT 24GiB"]]]
  ];

  for (const [input, expected] of cases) {
    const document = normalizeSetupText(input);
    const candidates = extractMemoryCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("classifies dedicated and integrated AMD Vega families separately", () => {
  for (const [input, expected] of [
    ["AMD Radeon Vega 64 8GB", [["vram", 8, "AMD Radeon Vega 64 8GB"]]],
    ["AMD Radeon Vega 56 8GB", [["vram", 8, "AMD Radeon Vega 56 8GB"]]],
    ["AMD Vega 64 8GB", [["vram", 8, "AMD Vega 64 8GB"]]],
    ["AMD Vega 8 2GB", []],
    ["AMD Vega 8 with 2GB VRAM", [["vram", 2, "2GB VRAM"]]]
  ]) {
    assert.deepEqual(
      extractMemoryCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("recognizes safe Apple desktop context without accepting Intel Core m3", () => {
  const cases = [
    ["Mac mini M3 Pro;36GB unified memory", 36, 27],
    ["Mac Studio M2 Max;32GB unified memory", 32, 24],
    ["iMac M1;16GB unified memory", 16, 12]
  ];

  for (const [input, ram, vram] of cases) {
    const document = normalizeSetupText(input);
    assert.deepEqual(candidateValues(extractCpuCandidates(document), "cpuModel").length, 1, input);
    assert.deepEqual(
      extractMemoryCandidates(document).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.inferred,
        candidate.confidence
      ]),
      [["ram", ram, false, "high"], ["vram", vram, true, "medium"]],
      input
    );
  }

  const dedicated = extractMemoryCandidates(normalizeSetupText(
    "Mac mini M3 Pro;NVIDIA GPU;36GB unified memory"
  ));
  assert.deepEqual(dedicated.map((candidate) => [candidate.field, candidate.value]), [["ram", 36]]);

  const falseApple = normalizeSetupText("iMac;Intel Core m3-8100Y;8GB unified memory");
  assert.deepEqual(candidateValues(extractCpuCandidates(falseApple), "cpuModel"), []);
  assert.deepEqual(
    extractMemoryCandidates(falseApple).map((candidate) => [candidate.field, candidate.value]),
    [["ram", 8]]
  );
});

test("extends storage evidence to adjacent clause-local qualifiers", () => {
  const document = normalizeSetupText([
    "Storage: 512GB available",
    "storage has 512GB free",
    "total 512GB storage",
    "剩余 512GB 硬盘",
    "storage 256GB, storage 512GB available"
  ].join(";"));
  const candidates = extractStorageCandidates(document);

  assert.deepEqual(
    candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
    [
      [512, "free", "Storage: 512GB available"],
      [512, "free", "storage has 512GB free"],
      [512, "total", "total 512GB storage"],
      [512, "free", "剩余 512GB 硬盘"],
      [256, "unknown", "storage 256GB"],
      [512, "free", "storage 512GB available"]
    ]
  );
  candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
});

test("keeps one-sided Chinese conjunction spacing local to hardware clauses", () => {
  for (const conjunction of ["与", "與", "及", "和"]) {
    for (const separator of [
      ` ${conjunction}`,
      `${conjunction} `,
      `\t${conjunction}`,
      `${conjunction}\t`
    ]) {
      for (const [input, expected] of [
        [
          `NVIDIA RTX 4070 12GB${separator}RAM 32GB`,
          [["vram", 12, "NVIDIA RTX 4070 12GB"], ["ram", 32, "RAM 32GB"]]
        ],
        [
          `RAM 32GB${separator}NVIDIA RTX 4070 12GB`,
          [["ram", 32, "RAM 32GB"], ["vram", 12, "NVIDIA RTX 4070 12GB"]]
        ]
      ]) {
        const document = normalizeSetupText(input);
        const candidates = extractCapacityCandidates(document);

        assert.deepEqual(
          candidates.map((candidate) => [candidate.field, candidate.value, candidate.raw]),
          expected,
          input
        );
        candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
      }
    }
  }
});

test("does not treat short conjunction characters inside unrelated Chinese words as clauses", () => {
  for (const input of [
    "12GB与会人员",
    "12GB 與會人員",
    "12GB\t及时响应",
    "12GB和\t平设计"
  ]) {
    assert.equal(
      CAPACITY_CLAUSE_PATTERNS.some((pattern) => pattern.regex.test(input)),
      false,
      input
    );
  }
});

test("rejects numeric suffixes after digit-comma prefixes", () => {
  for (const input of [
    "128,28GB RAM",
    "128,8GB VRAM",
    "1,024GB SSD",
    "8,5GB RAM",
    "128，28GB RAM",
    "1，024GB SSD",
    "x-128,28GB RAM",
    "Intel Core 128,28GB RAM",
    "128, 28GB RAM",
    "128， 8GB VRAM",
    "1, 024GB SSD",
    "8， 5GB RAM",
    "128,\t28GB RAM",
    "128，\t8GB VRAM",
    "128,,28GB RAM",
    "128，，8GB VRAM",
    "1,，\t024GB SSD",
    "8 \t， ,\t5GB RAM"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
});

test("accepts spaced nonnumeric comma delimiters and sentence-final capacities", () => {
  const document = normalizeSetupText("x, 8GB RAM;x，\t2GB VRAM;disk free 512GB.");

  assert.deepEqual(
    extractCapacityCandidates(document).map((candidate) => [
      candidate.field,
      candidate.value,
      candidate.raw
    ]),
    [
      ["ram", 8, "8GB RAM"],
      ["vram", 2, "2GB VRAM"],
      ["storage", 512, "disk free 512GB"]
    ]
  );
});

test("abstains from exact-looking capacity bounds and ranges across fields and orientations", () => {
  const fields = [
    { label: "RAM", amount: "32GB", lower: "16GB", upper: "32GB" },
    { label: "VRAM", amount: "12GiB", lower: "8GiB", upper: "12GiB" },
    { label: "storage", amount: "2TB", lower: "1TB", upper: "2TB" }
  ];
  const suffixes = ["and higher", "and greater"];
  const rangeSeparators = ["-", " – ", " to "];

  for (const field of fields) {
    for (const suffix of suffixes) {
      for (const input of [
        `${field.label} ${field.amount} ${suffix}`,
        `${field.amount} ${field.label} ${suffix}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }

    for (const separator of rangeSeparators) {
      for (const input of [
        `${field.label} ${field.lower}${separator}${field.upper}`,
        `${field.lower}${separator}${field.upper} ${field.label}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 16 GB – 32 GB")),
    []
  );

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "RAM 16GB-32GB, VRAM 12GB;SSD 512GB"
    )).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 12, "VRAM 12GB"], ["storage", 512, "SSD 512GB"]]
  );
});

test("abstains from explicit capacity absence without suppressing unrelated wording", () => {
  const fields = [
    { label: "RAM", amount: "32GB" },
    { label: "VRAM", amount: "12GiB" },
    { label: "storage", amount: "1TB" }
  ];
  const postposed = ["absent", "missing", "is absent", "was missing"];

  for (const field of fields) {
    for (const absence of postposed) {
      for (const input of [
        `${field.label} ${field.amount} ${absence}`,
        `${field.amount} ${field.label} ${absence}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
    for (const input of [
      `without ${field.amount} ${field.label}`,
      `no ${field.amount} ${field.label}`
    ]) {
      assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
    }
  }

  const positives = [
    ["RAM 32GB without overclocking", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB missing drivers", [["ram", 32, "RAM 32GB"]]],
    ["RAM no ECC 32GB", [["ram", 32, "RAM no ECC 32GB"]]],
    ["laptop without dedicated GPU, RAM 32GB", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB available", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB installed", [["ram", 32, "RAM 32GB"]]]
  ];
  for (const [input, expected] of positives) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("rejects explicit non-second transfer rates while preserving inventory capacities", () => {
  const rateSuffixes = [
    "per minute",
    "every minute",
    "each hour",
    "/hour",
    "a minute",
    "/min",
    "/hr",
    "每分钟",
    "每分鐘",
    "每小时",
    "每小時"
  ];
  for (const suffix of rateSuffixes) {
    for (const input of [
      `SSD speed 7GB ${suffix}`,
      `SSD throughput 7GB${suffix.startsWith("/") ? "" : " "}${suffix}`,
      `7 GB ${suffix}`
    ]) {
      assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
    }
  }

  const positives = [
    ["a second drive 1TB", [["storage", 1000, "drive 1TB"]]],
    ["SSD 512GB per drive", [["storage", 512, "SSD 512GB"]]],
    ["SSD 512GB, updated an hour ago", [["storage", 512, "SSD 512GB"]]],
    ["SSD 512GB a second SSD 1TB", [["storage", 512, "SSD 512GB"], ["storage", 1000, "SSD 1TB"]]]
  ];
  for (const [input, expected] of positives) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("keeps no-GPU suppression clause-local while retaining conflicting model evidence", () => {
  for (const input of [
    "NVIDIA RTX 4070 12GB;no dedicated GPU",
    "no dedicated GPU;NVIDIA RTX 4070 12GB"
  ]) {
    const document = normalizeSetupText(input);
    assert.deepEqual(
      extractCapacityCandidates(document).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
      [["vram", 12, "NVIDIA RTX 4070 12GB"]],
      input
    );
    assert.equal(
      extractGpuCandidates(document).some((candidate) => candidate.value === "No dedicated GPU"),
      true,
      input
    );
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "no dedicated GPU 12GB RAM 32GB SSD 512GB"
    )).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"]]
  );

  for (const [input, expected] of [
    ["NVIDIA RTX 4070 12GB", [["vram", 12]]],
    ["Intel Arc A550M 8GB", [["vram", 8]]],
    ["AMD Vega 8 2GB", []],
    ["no dedicated GPU 12GB", []]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [candidate.field, candidate.value]),
      expected,
      input
    );
  }
});

test("abstains from compact and shared-unit ranges across fields and orientations", () => {
  const fields = [
    { label: "RAM", lower: "16", upper: "32", unit: "GB" },
    { label: "VRAM", lower: "8", upper: "12", unit: "GiB" },
    { label: "storage", lower: "1", upper: "2", unit: "TB" }
  ];
  const connectors = ["to", " to", "to ", " to ", "-", " -", "- ", " - ", "–", " –", "– ", " – "];

  for (const field of fields) {
    for (const connector of connectors) {
      const ranges = [
        `${field.lower}${field.unit}${connector}${field.upper}${field.unit}`,
        `${field.lower}${connector}${field.upper}${field.unit}`,
        `${field.lower}${field.unit}${connector}${field.upper}`
      ];
      for (const range of ranges) {
        for (const input of [`${field.label} ${range}`, `${range} ${field.label}`]) {
          assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
        }
      }
    }
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "RAM 16GB to32GB;VRAM 12GB;SSD 512GB"
    )).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 12, "VRAM 12GB"], ["storage", 512, "SSD 512GB"]]
  );
  const modelControl = normalizeSetupText(
    "NVIDIA RTX 4070;RAM 16-32GB;SSD 512GB;move files from 16 to 32 folders"
  );
  assert.deepEqual(candidateValues(extractGpuCandidates(modelControl), "gpuModel"), ["NVIDIA RTX 4070"]);
  assert.deepEqual(
    extractCapacityCandidates(modelControl).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["storage", 512, "SSD 512GB"]]
  );
});

test("attaches preposed absence to the complete owned capacity evidence", () => {
  const fields = [
    { label: "RAM", amount: "32GB" },
    { label: "VRAM", amount: "12GiB" },
    { label: "storage", amount: "1TB" }
  ];

  for (const field of fields) {
    for (const absence of ["without", "no"]) {
      for (const input of [
        `${absence} ${field.label} ${field.amount}`,
        `${absence} ${field.amount} ${field.label}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }

  for (const [input, expected] of [
    ["RAM 32GB without overclocking", [["ram", 32, "RAM 32GB"]]],
    ["RAM 32GB missing drivers", [["ram", 32, "RAM 32GB"]]],
    ["RAM no ECC 32GB", [["ram", 32, "RAM no ECC 32GB"]]],
    ["laptop without dedicated GPU, RAM 32GB", [["ram", 32, "RAM 32GB"]]],
    ["no concern about upgrades, RAM 32GB", [["ram", 32, "RAM 32GB"]]]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("abstains from clause-local capacity uncertainty without changing natural-memory evidence", () => {
  const fields = [
    { label: "RAM", amount: "32GB" },
    { label: "VRAM", amount: "12GiB" },
    { label: "storage", amount: "1TB" }
  ];
  const englishUncertainty = ["maybe", "approximately", "roughly", "perhaps", "about", "around"];

  for (const field of fields) {
    for (const uncertainty of englishUncertainty) {
      for (const input of [
        `${field.label} ${uncertainty} ${field.amount}`,
        `${uncertainty} ${field.amount} ${field.label}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }

  const chineseFields = [
    { label: "内存", amount: "32GB" },
    { label: "顯存", amount: "12GiB" },
    { label: "存储", amount: "1TB" }
  ];
  for (const field of chineseFields) {
    for (const uncertainty of ["约", "約", "近似", "可能", "或许", "或許"]) {
      for (const input of [
        `${field.label}${uncertainty}${field.amount}`,
        `${uncertainty}${field.amount}${field.label}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }

  for (const input of ["RAM 32GB maybe", "内存32GB左右", "顯存12GiB上下"]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
  for (const input of ["显存大概 12GiB", "大約 1TB 存储"]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["RAM 32GB, maybe upgrade later", [["ram", 32, "RAM 32GB"]]],
    ["Maybe laptop choice, RAM 32GB", [["ram", 32, "RAM 32GB"]]],
    ["about 8 gigs of memory", [["ram", 8, "about 8 gigs of memory"]]],
    ["内存大概 32GB", [["ram", 32, "内存大概 32GB"]]],
    ["記憶體大約 16GB", [["ram", 16, "記憶體大約 16GB"]]]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("emits canonical no-GPU evidence for without and discrete-graphics wording", () => {
  const conflictSeparators = [";", ", "];
  for (const separator of conflictSeparators) {
    for (const input of [
      `NVIDIA RTX 4070 12GB${separator}laptop without dedicated GPU`,
      `laptop without dedicated GPU${separator}NVIDIA RTX 4070 12GB`
    ]) {
      const document = normalizeSetupText(input);
      assert.deepEqual(
        extractCapacityCandidates(document).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
        [["vram", 12, "NVIDIA RTX 4070 12GB"]],
        input
      );
      assert.equal(
        extractGpuCandidates(document).some((candidate) => candidate.value === "No dedicated GPU"),
        true,
        input
      );
    }
  }

  for (const input of [
    "without dedicated GPU",
    "without a dedicated GPU",
    "without discrete GPU",
    "without a discrete GPU",
    "no discrete graphics",
    "没有独立显卡",
    "沒有獨立顯卡",
    "不含独立显卡",
    "不含獨立顯卡"
  ]) {
    assert.deepEqual(candidateValues(extractGpuCandidates(normalizeSetupText(input)), "gpuModel"), [
      "No dedicated GPU"
    ], input);
  }

  const sameClause = normalizeSetupText(
    "without a dedicated GPU 12GB RAM 32GB SSD 512GB"
  );
  assert.deepEqual(
    extractCapacityCandidates(sameClause).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["ram", 32, "RAM 32GB"], ["storage", 512, "SSD 512GB"]]
  );
  assert.deepEqual(candidateValues(extractGpuCandidates(sameClause), "gpuModel"), ["No dedicated GPU"]);
});

test("uses explicit integrated context to override Vega proximity dedication only", () => {
  for (const input of [
    "integrated AMD Radeon Vega 64 8GB",
    "integrated AMD Radeon Vega 56 8GB",
    "integrated Vega 56 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [], input);
  }

  for (const input of [
    "dedicated AMD Radeon Vega 64 8GB",
    "discrete AMD Radeon Vega 56 8GB",
    "AMD Radeon Vega 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [8], input);
  }

  const integrated = normalizeSetupText("integrated AMD Radeon Vega 64 8GB");
  assert.deepEqual(candidateValues(extractGpuCandidates(integrated), "gpuModel"), ["AMD Radeon Vega 64"]);
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("integrated AMD Radeon Vega 64 with 8GB VRAM"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 8, "8GB VRAM"]]
  );
});

test("marks retained natural-memory approximations as low-confidence inferred values", () => {
  for (const [input, expected] of [
    [
      "about 8 gigs of memory",
      {
        field: "ram",
        value: 8,
        raw: "about 8 gigs of memory",
        segmentIndex: 0,
        start: 0,
        end: "about 8 gigs of memory".length,
        source: "capacity.ram.before-label",
        specificity: 100,
        confidence: "low",
        inferred: true,
        amountPosition: "before-label",
        sourceUnit: "gig"
      }
    ],
    [
      "内存大概 32GB",
      {
        field: "ram",
        value: 32,
        raw: "内存大概 32GB",
        segmentIndex: 0,
        start: 0,
        end: "内存大概 32GB".length,
        source: "capacity.ram.after-label",
        specificity: 100,
        confidence: "low",
        inferred: true,
        amountPosition: "after-label",
        sourceUnit: "GB"
      }
    ],
    [
      "記憶體大約 16GB",
      {
        field: "ram",
        value: 16,
        raw: "記憶體大約 16GB",
        segmentIndex: 0,
        start: 0,
        end: "記憶體大約 16GB".length,
        source: "capacity.ram.after-label",
        specificity: 100,
        confidence: "low",
        inferred: true,
        amountPosition: "after-label",
        sourceUnit: "GB"
      }
    ]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractMemoryCandidates(document);
    assert.deepEqual(candidates, [expected], input);
    assertCapacityCandidateContract(document, candidates[0]);
  }

  for (const [input, expectedRaw, sourceUnit] of [
    ["8 gigs of memory", "8 gigs of memory", "gig"],
    ["内存 32GB", "内存 32GB", "GB"],
    ["記憶體 16GB", "記憶體 16GB", "GB"]
  ]) {
    const document = normalizeSetupText(input);
    const [candidate] = extractMemoryCandidates(document);
    assert.deepEqual(
      [candidate.raw, candidate.confidence, candidate.inferred, candidate.sourceUnit],
      [expectedRaw, "high", false, sourceUnit],
      input
    );
    assertCapacityCandidateContract(document, candidate);
  }
});

test("recognizes boundary-safe prefix and suffix integrated Vega context", () => {
  const integratedCases = [
    "integrated GPU AMD Radeon Vega 64 8GB",
    "integrated graphics using AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 64 integrated graphics 8GB",
    "AMD Radeon Vega 56 onboard GPU 8GB",
    "集成显卡 AMD Radeon Vega 64 8GB",
    "集成顯卡 AMD Radeon Vega 56 8GB",
    "共享显卡 AMD Radeon Vega 64 8GB",
    "共享顯卡 AMD Radeon Vega 56 8GB",
    "AMD Radeon Vega 64 共享显卡 8GB",
    "AMD Radeon Vega 56 共享顯卡 8GB"
  ];

  for (const input of integratedCases) {
    const document = normalizeSetupText(input);
    assert.equal(
      candidateValues(extractGpuCandidates(document), "gpuModel").includes(
        input.includes("56") ? "AMD Radeon Vega 56" : "AMD Radeon Vega 64"
      ),
      true,
      input
    );
    assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
  }

  for (const input of [
    "dedicated AMD Radeon Vega 64 8GB",
    "discrete AMD Radeon Vega 56 8GB",
    "AMD Radeon Vega 64 8GB",
    "integrated graphics, AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 64 8GB, integrated graphics",
    "integrated graphics;AMD Radeon Vega 64 8GB",
    "共享显卡，AMD Radeon Vega 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [8], input);
  }
});

test("abstains from local uncertainty capability and multilingual capacity negation", () => {
  const fields = [
    { label: "RAM", amount: "64GB" },
    { label: "VRAM", amount: "12GiB" },
    { label: "SSD", amount: "2TB" }
  ];
  for (const field of fields) {
    for (const qualifier of ["possibly", "probably", "maybe", "perhaps"]) {
      for (const input of [
        `${qualifier} ${field.amount} ${field.label}`,
        `${field.label} ${qualifier} ${field.amount}`
      ]) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
    for (const input of [
      `supports ${field.amount} ${field.label}`,
      `support for ${field.amount} ${field.label}`,
      `${field.label} supports ${field.amount}`,
      `can support up to ${field.amount} ${field.label}`
    ]) {
      assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
    }
  }

  for (const input of [
    "没有 32GB 内存",
    "没有内存 32GB",
    "沒有 16GB 記憶體",
    "沒有記憶體 16GB",
    "不含 8GB 顯存",
    "也许 32GB 内存",
    "也許 16GB 記憶體",
    "支持 2TB 固态硬盘",
    "可支援最高 1TB 固態硬碟"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["possibly 64GB RAM;SSD 512GB installed", [["storage", 512, "SSD 512GB"]]],
    ["supports 2TB SSD;RAM 32GB installed", [["ram", 32, "RAM 32GB"]]],
    ["没有独立显卡,内存 32GB installed", [["ram", 32, "内存 32GB"]]],
    ["has 64GB RAM", [["ram", 64, "64GB RAM"]]],
    ["equipped with 12GiB VRAM", [["vram", 12, "12GiB VRAM"]]],
    ["SSD 2TB installed", [["storage", 2000, "SSD 2TB"]]]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("abstains from alternative and localized capacity ranges without losing exact conflicts", () => {
  const fields = [
    { label: "RAM", left: "16", right: "64", unit: "GB" },
    { label: "VRAM", left: "8", right: "12", unit: "GiB" },
    { label: "storage", left: "1", right: "2", unit: "TB" }
  ];
  const connectors = [
    "or", " or ", "或", " 或 ", "或者", " 或者 ",
    "至", " 至 ", "~", " ~ ", "～", " ～ "
  ];

  for (const field of fields) {
    for (const connector of connectors) {
      for (const range of [
        `${field.left}${field.unit}${connector}${field.right}${field.unit}`,
        `${field.left}${connector}${field.right}${field.unit}`,
        `${field.left}${field.unit}${connector}${field.right}`
      ]) {
        for (const input of [`${field.label} ${range}`, `${range} ${field.label}`]) {
          assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
        }
      }
    }
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 16GB, old note: RAM 64GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["ram", 16, "RAM 16GB"], ["ram", 64, "RAM 64GB"]]
  );
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 16GB至64GB;VRAM 12GB;SSD 512GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 12, "VRAM 12GB"], ["storage", 512, "SSD 512GB"]]
  );
});

test("suppresses Vega proximity VRAM in clause-local copular integrated context", () => {
  const integratedCases = [
    "the integrated GPU is AMD Radeon Vega 64 8GB",
    "integrated graphics is AMD Radeon Vega 56 8GB",
    "integrated graphics uses AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 64 is onboard GPU 8GB",
    "集成显卡是 AMD Radeon Vega 64 8GB",
    "集成顯卡使用 AMD Radeon Vega 56 8GB",
    "AMD Radeon Vega 64 是集成显卡 8GB",
    "AMD Radeon Vega 56 是共享顯卡 8GB"
  ];
  for (const input of integratedCases) {
    const document = normalizeSetupText(input);
    assert.equal(
      candidateValues(extractGpuCandidates(document), "gpuModel").includes(
        input.includes("56") ? "AMD Radeon Vega 56" : "AMD Radeon Vega 64"
      ),
      true,
      input
    );
    assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
  }

  for (const input of [
    "the integrated GPU is unavailable, AMD Radeon Vega 64 8GB",
    "集成显卡不可用，AMD Radeon Vega 56 8GB",
    "dedicated GPU is AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 56 is a discrete GPU 8GB",
    "AMD Radeon Vega 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [8], input);
  }
});

test("rejects used or occupied storage while preserving total and available capacities", () => {
  for (const input of [
    "SSD 900GB used",
    "900GB occupied on SSD",
    "SSD used 900GB",
    "SSD 900GB is occupied",
    "固态硬盘 已用 900GB",
    "已使用 900GB 固態硬碟",
    "SSD 使用了 900GB",
    "用了 900GB 固態硬碟",
    "硬盘 900GB 占用",
    "900GB 已佔用 硬碟"
  ]) {
    assert.deepEqual(extractStorageCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["1TB SSD,900GB used", [[1000, "1TB SSD", "unknown"]]],
    ["SSD total 1TB;SSD 900GB used;SSD 100GB free", [[1000, "SSD total 1TB", "total"], [100, "SSD 100GB free", "free"]]],
    ["固态硬盘总容量 1TB,已用 900GB", [[1000, "固态硬盘总容量 1TB", "total"]]],
    ["SSD 512GB available", [[512, "SSD 512GB available", "free"]]],
    ["SSD 512GB remaining", [[512, "SSD 512GB remaining", "free"]]]
  ]) {
    assert.deepEqual(
      extractStorageCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.value,
        candidate.raw,
        candidate.storageKind
      ]),
      expected,
      input
    );
  }
});

test("limits retained approximations to the frozen natural-memory contract families", () => {
  for (const input of [
    "RAM 大概 32GB",
    "RAM 大約 32GB",
    "about 8 gigs RAM",
    "memory about 8 gigs",
    "VRAM 大概 8GB",
    "about 1TB storage",
    "SSD 大約 512GB"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["about 8 gigs of memory", [8, "about 8 gigs of memory", "low", true, "gig"]],
    ["内存大概 32GB", [32, "内存大概 32GB", "low", true, "GB"]],
    ["記憶體大約 16GB", [16, "記憶體大約 16GB", "low", true, "GB"]],
    ["8 gigs of memory", [8, "8 gigs of memory", "high", false, "gig"]],
    ["内存 32GB", [32, "内存 32GB", "high", false, "GB"]],
    ["記憶體 16GB", [16, "記憶體 16GB", "high", false, "GB"]]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractMemoryCandidates(document);
    assert.equal(candidates.length, 1, input);
    const [candidate] = candidates;
    assert.deepEqual(
      [candidate.value, candidate.raw, candidate.confidence, candidate.inferred, candidate.sourceUnit],
      expected,
      input
    );
    assertCapacityCandidateContract(document, candidate);
  }
});

test("attaches negation and capability to bounded owned capacity windows", () => {
  const locales = [
    {
      fields: [
        { label: "RAM", amount: "64GB" },
        { label: "VRAM", amount: "12GiB" },
        { label: "SSD", amount: "2TB" }
      ],
      inputs: ({ label, amount }) => [
        `not ${label} ${amount}`,
        `not ${amount} ${label}`,
        `does not have ${label} ${amount}`,
        `does not have ${amount} ${label}`,
        `${label} ${amount} supported`,
        `${amount} ${label} supported`,
        `${label} ${amount} not supported`,
        `${amount} ${label} not supported`
      ]
    },
    {
      fields: [
        { label: "内存", amount: "32GB" },
        { label: "显存", amount: "12GiB" },
        { label: "固态硬盘", amount: "1TB" }
      ],
      inputs: ({ label, amount }) => [
        `没有配备 ${label} ${amount}`,
        `没有配备 ${amount} ${label}`,
        `未配备 ${label} ${amount}`,
        `未配备 ${amount} ${label}`,
        `支持 ${label} ${amount}`,
        `支持 ${amount} ${label}`,
        `${label} ${amount} 未配备`,
        `${amount} ${label} 未配备`
      ]
    },
    {
      fields: [
        { label: "記憶體", amount: "16GB" },
        { label: "顯存", amount: "8GiB" },
        { label: "固態硬碟", amount: "1TB" }
      ],
      inputs: ({ label, amount }) => [
        `沒有配備 ${label} ${amount}`,
        `沒有配備 ${amount} ${label}`,
        `未配備 ${label} ${amount}`,
        `未配備 ${amount} ${label}`,
        `支援 ${label} ${amount}`,
        `支援 ${amount} ${label}`,
        `${label} ${amount} 未配備`,
        `${amount} ${label} 未配備`
      ]
    }
  ];

  for (const locale of locales) {
    for (const field of locale.fields) {
      for (const input of locale.inputs(field)) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }

  for (const [input, expected] of [
    ["not RAM 64GB SSD 512GB", [["storage", 512, "SSD 512GB"]]],
    ["does not have 64GB RAM SSD 512GB", [["storage", 512, "SSD 512GB"]]],
    ["没有配备 32GB 内存 固态硬盘 512GB", [["storage", 512, "固态硬盘 512GB"]]],
    ["沒有配備 16GB 記憶體 固態硬碟 1TB", [["storage", 1000, "固態硬碟 1TB"]]],
    ["has 64GB RAM", [["ram", 64, "64GB RAM"]]],
    ["RAM 64GB installed", [["ram", 64, "RAM 64GB"]]],
    ["equipped with 12GiB VRAM", [["vram", 12, "12GiB VRAM"]]],
    ["配备 32GB 内存", [["ram", 32, "32GB 内存"]]],
    ["已配備 16GB 記憶體", [["ram", 16, "16GB 記憶體"]]],
    ["RAM 64GB without overclocking", [["ram", 64, "RAM 64GB"]]]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value,
        candidate.raw
      ]),
      expected,
      input
    );
  }
});

test("keeps repeated-label alternatives as complete Task 3 conflict evidence", () => {
  const connectors = ["or", "至", "~", "～"];
  for (const connector of connectors) {
    for (const input of [
      `RAM 16GB ${connector} RAM 64GB`,
      `16GB RAM ${connector} 64GB RAM`
    ]) {
      assert.deepEqual(
        extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
          candidate.field,
          candidate.value,
          candidate.raw
        ]),
        input.startsWith("RAM")
          ? [["ram", 16, "RAM 16GB"], ["ram", 64, "RAM 64GB"]]
          : [["ram", 16, "16GB RAM"], ["ram", 64, "64GB RAM"]],
        input
      );
    }
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 16GB;RAM 64GB"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["ram", 16, "RAM 16GB"], ["ram", 64, "RAM 64GB"]]
  );
});

test("suppresses Vega proximity VRAM for copular and parenthetical integrated context", () => {
  const integratedCases = [
    "显卡是集成的 AMD Radeon Vega 64 8GB",
    "顯卡是集成的 AMD Radeon Vega 56 8GB",
    "顯卡是整合式 AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 64 (integrated GPU) 8GB",
    "AMD Radeon Vega 56 (onboard graphics) 8GB",
    "AMD Radeon Vega 64（集成显卡）8GB",
    "AMD Radeon Vega 56（共享顯卡）8GB"
  ];
  for (const input of integratedCases) {
    const document = normalizeSetupText(input);
    assert.equal(
      candidateValues(extractGpuCandidates(document), "gpuModel").includes(
        input.includes("56") ? "AMD Radeon Vega 56" : "AMD Radeon Vega 64"
      ),
      true,
      input
    );
    assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
  }

  for (const input of [
    "显卡是集成的，AMD Radeon Vega 64 8GB",
    "integrated GPU;AMD Radeon Vega 56 8GB",
    "dedicated AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 56 (discrete GPU) 8GB",
    "AMD Radeon Vega 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [8], input);
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "AMD Radeon Vega 64 (integrated GPU) with 8GB VRAM"
    )).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 8, "8GB VRAM"]]
  );
});

test("rejects bounded used-space grammar while retaining valid storage evidence", () => {
  const usedCases = [
    "used space on SSD: 900GB",
    "occupied space: 900GB SSD",
    "SSD used space: 900GB",
    "900GB SSD space used",
    "SSD: 900GB occupied space",
    "已占用空间: 900GB 固态硬盘",
    "固态硬盘 已用空间: 900GB",
    "900GB 固态硬盘 空间已占用",
    "已佔用空間: 900GB 固態硬碟",
    "固態硬碟 已用空間: 900GB",
    "900GB 固態硬碟 空間已佔用"
  ];
  for (const input of usedCases) {
    assert.deepEqual(extractStorageCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["used space on SSD: 900GB;SSD 100GB free", [[100, "SSD 100GB free", "free"]]],
    ["occupied space: 900GB SSD,SSD total 1TB", [[1000, "SSD total 1TB", "total"]]],
    ["已占用空间: 900GB 固态硬盘,固态硬盘剩余 100GB", [[100, "固态硬盘剩余 100GB", "free"]]],
    ["已佔用空間: 900GB 固態硬碟,固態硬碟可用 100GB", [[100, "固態硬碟可用 100GB", "free"]]],
    ["SSD capacity 1TB;SSD 100GB remaining", [[1000, "SSD capacity 1TB", "total"], [100, "SSD 100GB remaining", "free"]]]
  ]) {
    assert.deepEqual(
      extractStorageCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.value,
        candidate.raw,
        candidate.storageKind
      ]),
      expected,
      input
    );
  }
});

test("covers reconstructed 168 rejection and 99 preservation review variants", () => {
  let rejectionCount = 0;
  let preservationCount = 0;

  const qualifierLocales = [
    {
      fields: [["RAM", "64GB"], ["VRAM", "12GiB"], ["SSD", "2TB"]],
      reject: (label, amount) => [
        `not ${label} ${amount}`,
        `not ${amount} ${label}`,
        `does not have ${label} ${amount}`,
        `does not have ${amount} ${label}`,
        `${label} ${amount} supported`,
        `${amount} ${label} supported`,
        `${label} ${amount} not supported`,
        `${amount} ${label} not supported`
      ],
      preserve: (label, amount) => [
        `has ${amount} ${label}`,
        `${label} ${amount} installed`,
        `equipped with ${amount} ${label}`
      ]
    },
    {
      fields: [["内存", "32GB"], ["显存", "12GiB"], ["固态硬盘", "1TB"]],
      reject: (label, amount) => [
        `没有配备 ${label} ${amount}`,
        `没有配备 ${amount} ${label}`,
        `未配备 ${label} ${amount}`,
        `未配备 ${amount} ${label}`,
        `支持 ${label} ${amount}`,
        `支持 ${amount} ${label}`,
        `${label} ${amount} 未配备`,
        `${amount} ${label} 未配备`
      ],
      preserve: (label, amount) => [
        `配备 ${amount} ${label}`,
        `${label} ${amount} 已安装`,
        `已配备 ${label} ${amount}`
      ]
    },
    {
      fields: [["記憶體", "16GB"], ["顯存", "8GiB"], ["固態硬碟", "1TB"]],
      reject: (label, amount) => [
        `沒有配備 ${label} ${amount}`,
        `沒有配備 ${amount} ${label}`,
        `未配備 ${label} ${amount}`,
        `未配備 ${amount} ${label}`,
        `支援 ${label} ${amount}`,
        `支援 ${amount} ${label}`,
        `${label} ${amount} 未配備`,
        `${amount} ${label} 未配備`
      ],
      preserve: (label, amount) => [
        `配備 ${amount} ${label}`,
        `${label} ${amount} 已安裝`,
        `已配備 ${label} ${amount}`
      ]
    }
  ];

  for (const locale of qualifierLocales) {
    for (const [label, amount] of locale.fields) {
      for (const input of locale.reject(label, amount)) {
        rejectionCount += 1;
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
      for (const input of locale.preserve(label, amount)) {
        preservationCount += 1;
        assert.equal(extractCapacityCandidates(normalizeSetupText(input)).length, 1, input);
      }
    }
  }

  const rangeFields = [
    { label: "RAM", left: "16", right: "64", unit: "GB" },
    { label: "VRAM", left: "8", right: "12", unit: "GiB" },
    { label: "storage", left: "1", right: "2", unit: "TB" }
  ];
  const rangeConnectors = ["or", "至", "~", "～"];
  for (const field of rangeFields) {
    for (const connector of rangeConnectors) {
      for (const range of [
        `${field.left}${field.unit}${connector}${field.right}${field.unit}`,
        `${field.left}${connector}${field.right}${field.unit}`,
        `${field.left}${field.unit}${connector}${field.right}`
      ]) {
        for (const input of [`${field.label} ${range}`, `${range} ${field.label}`]) {
          rejectionCount += 1;
          assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
        }
      }
    }
  }

  const usedFamilies = [
    (gap, expanded) => [
      `used space on SSD:${gap}900GB`,
      `occupied space:${gap}900GB SSD`,
      `SSD used space:${gap}900GB`,
      expanded ? "900GB SSD space is used" : "900GB SSD space used"
    ],
    (gap, expanded) => [
      `已占用空间:${gap}900GB 固态硬盘`,
      `已用空间:${gap}900GB 固态硬盘`,
      `固态硬盘 已用空间:${gap}900GB`,
      expanded ? "900GB 固态硬盘 空间占用" : "900GB 固态硬盘 空间已占用"
    ],
    (gap, expanded) => [
      `已佔用空間:${gap}900GB 固態硬碟`,
      `已用空間:${gap}900GB 固態硬碟`,
      `固態硬碟 已用空間:${gap}900GB`,
      expanded ? "900GB 固態硬碟 空間佔用" : "900GB 固態硬碟 空間已佔用"
    ]
  ];
  for (const family of usedFamilies) {
    for (const [gap, expanded] of [["", false], [" ", true]]) {
      for (const input of family(gap, expanded)) {
        rejectionCount += 1;
        assert.deepEqual(extractStorageCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }

  for (const field of rangeFields) {
    for (const connector of rangeConnectors) {
      for (const input of [
        `${field.label} ${field.left}${field.unit} ${connector} ${field.label} ${field.right}${field.unit}`,
        `${field.left}${field.unit} ${field.label} ${connector} ${field.right}${field.unit} ${field.label}`
      ]) {
        preservationCount += 1;
        assert.equal(extractCapacityCandidates(normalizeSetupText(input)).length, 2, input);
      }
    }
  }

  for (const model of ["AMD Radeon Vega 56", "AMD Radeon Vega 64"]) {
    for (const prefix of ["", "dedicated ", "discrete "]) {
      for (const separator of [" ", " with ", ": ", " has "]) {
        const input = `${prefix}${model}${separator}8GB`;
        preservationCount += 1;
        assert.deepEqual(candidateValues(
          extractCapacityCandidates(normalizeSetupText(input)),
          "vram"
        ), [8], input);
      }
    }
  }

  const storageLocales = [
    { label: "SSD", qualifiers: [["total", "total"], ["capacity", "total"], ["free", "free"], ["remaining", "free"]] },
    { label: "固态硬盘", qualifiers: [["总容量", "total"], ["总计", "total"], ["可用", "free"], ["剩余", "free"]] },
    { label: "固態硬碟", qualifiers: [["總容量", "total"], ["總計", "total"], ["可用", "free"], ["剩餘", "free"]] }
  ];
  for (const locale of storageLocales) {
    for (const [qualifier, kind] of locale.qualifiers) {
      for (const input of [
        `${locale.label} ${qualifier} 1TB`,
        `1TB ${locale.label} ${qualifier}`
      ]) {
        preservationCount += 1;
        const candidates = extractStorageCandidates(normalizeSetupText(input));
        assert.deepEqual(candidates.map((candidate) => [
          candidate.value,
          candidate.storageKind
        ]), [[1000, kind]], input);
      }
    }
  }

  assert.equal(rejectionCount, 168);
  assert.equal(preservationCount, 99);
});

test("rejects bounded unequipped lacking and unsupported capacity vocabulary", () => {
  const locales = [
    {
      fields: [["RAM", "64GB"], ["VRAM", "12GiB"], ["SSD", "2TB"]],
      forms: (label, amount) => [
        `this laptop is not equipped with ${amount} ${label}`,
        `this laptop is not equipped with ${label} ${amount}`,
        `lacks ${amount} ${label}`,
        `lacks ${label} ${amount}`,
        `unsupported ${amount} ${label}`,
        `${label} ${amount} unsupported`
      ]
    },
    {
      fields: [["内存", "32GB"], ["显存", "12GiB"], ["固态硬盘", "1TB"]],
      forms: (label, amount) => [
        `不具备 ${amount} ${label}`,
        `不具备 ${label} ${amount}`,
        `不支持 ${amount} ${label}`,
        `不支持 ${label} ${amount}`,
        `${label} ${amount} 不具备`,
        `${amount} ${label} 不支持`
      ]
    },
    {
      fields: [["記憶體", "16GB"], ["顯存", "8GiB"], ["固態硬碟", "1TB"]],
      forms: (label, amount) => [
        `不具備 ${amount} ${label}`,
        `不具備 ${label} ${amount}`,
        `不支援 ${amount} ${label}`,
        `不支援 ${label} ${amount}`,
        `${label} ${amount} 不具備`,
        `${amount} ${label} 不支援`
      ]
    }
  ];

  for (const locale of locales) {
    for (const [label, amount] of locale.fields) {
      for (const input of locale.forms(label, amount)) {
        assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
      }
    }
  }

  for (const [input, expected] of [
    ["lacks 64GB RAM SSD 512GB", [["storage", 512]]],
    ["不具备 32GB 内存 固态硬盘 512GB", [["storage", 512]]],
    ["不具備 16GB 記憶體 固態硬碟 1TB", [["storage", 1000]]],
    ["upgraded to 64GB RAM", [["ram", 64]]],
    ["RAM upgraded to 64GB", [["ram", 64]]],
    ["has 64GB RAM", [["ram", 64]]],
    ["equipped with 12GiB VRAM", [["vram", 12]]]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value
      ]),
      expected,
      input
    );
  }
});

test("rejects in-use consumed and passive occupied storage grammar", () => {
  const usedCases = [
    "SSD 900GB in use",
    "900GB SSD in use",
    "consumed space on SSD: 900GB",
    "consuming space: 900GB SSD",
    "SSD consumed space: 900GB",
    "900GB SSD space is consumed",
    "固态硬盘 900GB 被使用",
    "900GB 固态硬盘 被占用",
    "被占用空间: 900GB 固态硬盘",
    "固态硬盘 被使用空间: 900GB",
    "固態硬碟 900GB 被使用",
    "900GB 固態硬碟 被佔用",
    "被佔用空間: 900GB 固態硬碟",
    "固態硬碟 被使用空間: 900GB"
  ];
  for (const input of usedCases) {
    assert.deepEqual(extractStorageCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["SSD 900GB in use;SSD 100GB free", [[100, "free"]]],
    ["consumed space: 900GB SSD,SSD total 1TB", [[1000, "total"]]],
    ["被占用空间: 900GB 固态硬盘,固态硬盘剩余 100GB", [[100, "free"]]],
    ["被佔用空間: 900GB 固態硬碟,固態硬碟可用 100GB", [[100, "free"]]],
    ["SSD capacity 1TB;SSD 100GB remaining", [[1000, "total"], [100, "free"]]]
  ]) {
    assert.deepEqual(
      extractStorageCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.value,
        candidate.storageKind
      ]),
      expected,
      input
    );
  }
});

test("suppresses expanded integrated Vega context without resolving the model", () => {
  const integratedCases = [
    "集成式显卡 AMD Radeon Vega 64 8GB",
    "顯卡是整合型 AMD Radeon Vega 56 8GB",
    "iGPU is AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 56 (iGPU) 8GB",
    "AMD Radeon Vega 64（集成式显卡）8GB",
    "AMD Radeon Vega 56（整合型顯卡）8GB"
  ];
  for (const input of integratedCases) {
    const document = normalizeSetupText(input);
    assert.equal(
      candidateValues(extractGpuCandidates(document), "gpuModel").includes(
        input.includes("56") ? "AMD Radeon Vega 56" : "AMD Radeon Vega 64"
      ),
      true,
      input
    );
    assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
  }

  for (const input of [
    "集成式显卡，AMD Radeon Vega 64 8GB",
    "iGPU;AMD Radeon Vega 56 8GB",
    "dedicated AMD Radeon Vega 64 8GB",
    "AMD Radeon Vega 56 (discrete GPU) 8GB",
    "AMD Radeon Vega 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [8], input);
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "AMD Radeon Vega 64 (iGPU) with 8GB VRAM"
    )).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 8, "8GB VRAM"]]
  );
});

test("abstains from compact shared-unit slash alternatives", () => {
  const fields = [
    { label: "RAM", left: "32", right: "64", unit: "GB" },
    { label: "VRAM", left: "8", right: "12", unit: "GiB" },
    { label: "storage", left: "1", right: "2", unit: "TB" },
    { label: "内存", left: "32", right: "64", unit: "GB" },
    { label: "顯存", left: "8", right: "12", unit: "GiB" },
    { label: "固態硬碟", left: "1", right: "2", unit: "TB" }
  ];
  for (const field of fields) {
    for (const connector of ["/", "/ ", " /"]) {
      for (const range of [
        `${field.left}${connector}${field.right}${field.unit}`,
        `${field.left}${field.unit}${connector}${field.right}${field.unit}`,
        `${field.left}${field.unit}${connector}${field.right}`
      ]) {
        for (const input of [`${field.label} ${range}`, `${range} ${field.label}`]) {
          assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
        }
      }
    }
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "16GB RAM / 12GiB VRAM / SSD 512GB"
    )).map((candidate) => [candidate.field, candidate.value]),
    [["ram", 16], ["vram", 12], ["storage", 512]]
  );
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 16GB/RAM 64GB"))
      .map((candidate) => [candidate.field, candidate.value]),
    [["ram", 16], ["ram", 64]]
  );
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("SSD speed 7GB/s")),
    []
  );
});

test("abstains from non-frozen approximation notation and estimate wording", () => {
  const fields = [
    { label: "RAM", amount: "64GB" },
    { label: "VRAM", amount: "12GiB" },
    { label: "SSD", amount: "2TB" }
  ];
  for (const field of fields) {
    for (const input of [
      `${field.label} ~${field.amount}`,
      `${field.label} ≈${field.amount}`,
      `~${field.amount} ${field.label}`,
      `≈${field.amount} ${field.label}`,
      `estimated ${field.amount} ${field.label}`,
      `${field.label} estimated at ${field.amount}`,
      `${field.amount} ${field.label} estimated`
    ]) {
      assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
    }
  }

  for (const [label, amount, estimate] of [
    ["内存", "32GB", "估计"],
    ["显存", "12GiB", "估计"],
    ["固态硬盘", "1TB", "估计"],
    ["記憶體", "16GB", "估計"],
    ["顯存", "8GiB", "估計"],
    ["固態硬碟", "1TB", "估計"]
  ]) {
    for (const input of [
      `${label}${estimate}${amount}`,
      `${estimate}${amount}${label}`,
      `${label}${amount}${estimate}`
    ]) {
      assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
    }
  }

  for (const input of [
    "RAM 16GB~64GB",
    "RAM 16GB～64GB",
    "RAM 16GB至64GB"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
  for (const [input, confidence, inferred] of [
    ["about 8 gigs of memory", "low", true],
    ["内存大概 32GB", "low", true],
    ["記憶體大約 16GB", "low", true],
    ["8 gigs of memory", "high", false]
  ]) {
    const [candidate] = extractMemoryCandidates(normalizeSetupText(input));
    assert.deepEqual([candidate.confidence, candidate.inferred], [confidence, inferred], input);
  }
});

test("treats plus as a separator only between complete capacity clauses", () => {
  const fields = [
    { field: "ram", label: "RAM", amount: "16GB", value: 16 },
    { field: "vram", label: "VRAM", amount: "12GiB", value: 12 },
    { field: "storage", label: "SSD", amount: "512GB", value: 512 }
  ];
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ];
  const plusStyles = ["+", " + ", "+ "];
  let matrixCount = 0;

  for (const order of permutations) {
    for (let orientationMask = 0; orientationMask < 8; orientationMask += 1) {
      const clauses = order.map((fieldIndex, position) => {
        const field = fields[fieldIndex];
        return orientationMask & (1 << position)
          ? `${field.amount} ${field.label}`
          : `${field.label} ${field.amount}`;
      });
      for (const plus of plusStyles) {
        const input = clauses.join(plus);
        matrixCount += 1;
        assert.deepEqual(
          extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
            candidate.field,
            candidate.value
          ]),
          order.map((fieldIndex) => [fields[fieldIndex].field, fields[fieldIndex].value]),
          input
        );
      }
    }
  }
  assert.equal(matrixCount, 144);

  for (const input of [
    "+64GB RAM",
    "score 5 + 64GB RAM",
    "notes + 64GB RAM",
    "CPU 8 cores + 64GB RAM"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
});

test("covers 1,837 reconstructed semantic review families", () => {
  let assertionFamilies = 0;
  const sixDecorations = [
    (input) => input,
    (input) => `(${input})`,
    (input) => `${input}.`,
    (input) => `${input}!`,
    (input) => `note;${input}`,
    (input) => `${input};note`
  ];
  const twelveDecorations = [
    ...sixDecorations,
    (input) => `note|${input}`,
    (input) => `${input}|note`,
    (input) => `note->${input}`,
    (input) => `${input}->note`,
    (input) => `note\n${input}`,
    (input) => `note, ${input}`
  ];
  const fourDecorations = sixDecorations.slice(0, 4);

  function assertCapacityAbsent(input, field, value) {
    assertionFamilies += 1;
    assert.equal(
      extractCapacityCandidates(normalizeSetupText(input)).some((candidate) => (
        candidate.field === field && candidate.value === value
      )),
      false,
      input
    );
  }

  const negationLocales = [
    {
      fields: [["ram", "RAM", "64GB", 64], ["vram", "VRAM", "12GiB", 12], ["storage", "SSD", "2TB", 2000]],
      forms: (label, amount) => [
        `not equipped with ${amount} ${label}`,
        `not equipped with ${label} ${amount}`,
        `lacks ${amount} ${label}`,
        `lacks ${label} ${amount}`,
        `unsupported ${amount} ${label}`,
        `${label} ${amount} unsupported`,
        `does not have ${amount} ${label}`,
        `${label} ${amount} not supported`
      ]
    },
    {
      fields: [["ram", "内存", "32GB", 32], ["vram", "显存", "12GiB", 12], ["storage", "固态硬盘", "1TB", 1000]],
      forms: (label, amount) => [
        `不具备 ${amount} ${label}`,
        `不具备 ${label} ${amount}`,
        `不支持 ${amount} ${label}`,
        `不支持 ${label} ${amount}`,
        `${label} ${amount} 不具备`,
        `${amount} ${label} 不支持`,
        `没有配备 ${amount} ${label}`,
        `${label} ${amount} 未配备`
      ]
    },
    {
      fields: [["ram", "記憶體", "16GB", 16], ["vram", "顯存", "8GiB", 8], ["storage", "固態硬碟", "1TB", 1000]],
      forms: (label, amount) => [
        `不具備 ${amount} ${label}`,
        `不具備 ${label} ${amount}`,
        `不支援 ${amount} ${label}`,
        `不支援 ${label} ${amount}`,
        `${label} ${amount} 不具備`,
        `${amount} ${label} 不支援`,
        `沒有配備 ${amount} ${label}`,
        `${label} ${amount} 未配備`
      ]
    }
  ];
  for (const locale of negationLocales) {
    for (const [field, label, amount, value] of locale.fields) {
      for (const base of locale.forms(label, amount)) {
        for (const decorate of sixDecorations) {
          assertCapacityAbsent(decorate(base), field, value);
        }
      }
    }
  }

  const usedLocales = [
    [
      "SSD 900GB in use",
      "900GB SSD in use",
      "consumed space on SSD: 900GB",
      "consuming space: 900GB SSD",
      "SSD consumed space: 900GB",
      "900GB SSD space consumed",
      "occupied space: 900GB SSD",
      "SSD 900GB used"
    ],
    [
      "固态硬盘 900GB 被使用",
      "900GB 固态硬盘 被占用",
      "被占用空间: 900GB 固态硬盘",
      "固态硬盘 被使用空间: 900GB",
      "已占用空间: 900GB 固态硬盘",
      "900GB 固态硬盘 空间已占用",
      "固态硬盘 已用 900GB",
      "900GB 占用 固态硬盘"
    ],
    [
      "固態硬碟 900GB 被使用",
      "900GB 固態硬碟 被佔用",
      "被佔用空間: 900GB 固態硬碟",
      "固態硬碟 被使用空間: 900GB",
      "已佔用空間: 900GB 固態硬碟",
      "900GB 固態硬碟 空間已佔用",
      "固態硬碟 已用 900GB",
      "900GB 佔用 固態硬碟"
    ]
  ];
  for (const locale of usedLocales) {
    for (const base of locale) {
      for (const decorate of twelveDecorations) {
        assertCapacityAbsent(decorate(base), "storage", 900);
      }
    }
  }

  const integratedTemplates = [
    (model) => `集成式显卡 ${model} 8GB`,
    (model) => `顯卡是整合型 ${model} 8GB`,
    (model) => `iGPU is ${model} 8GB`,
    (model) => `${model} (iGPU) 8GB`,
    (model) => `${model}（集成式显卡）8GB`,
    (model) => `${model}（整合型顯卡）8GB`
  ];
  for (const model of ["AMD Radeon Vega 56", "AMD Radeon Vega 64"]) {
    for (const createInput of integratedTemplates) {
      for (const decorate of twelveDecorations) {
        const input = decorate(createInput(model));
        assertionFamilies += 1;
        const document = normalizeSetupText(input);
        assert.equal(candidateValues(extractGpuCandidates(document), "gpuModel").includes(model), true, input);
        assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
      }
    }
  }

  const slashFields = [
    ["ram", "RAM", "32", "64", "GB", 64],
    ["vram", "VRAM", "8", "12", "GiB", 12],
    ["storage", "storage", "1", "2", "TB", 2000],
    ["ram", "内存", "32", "64", "GB", 64],
    ["vram", "顯存", "8", "12", "GiB", 12],
    ["storage", "固態硬碟", "1", "2", "TB", 2000]
  ];
  for (const [field, label, left, right, unit, leakedValue] of slashFields) {
    for (const connector of ["/", "/ ", " /"]) {
      for (const range of [
        `${left}${connector}${right}${unit}`,
        `${left}${unit}${connector}${right}${unit}`,
        `${left}${unit}${connector}${right}`
      ]) {
        for (const base of [`${label} ${range}`, `${range} ${label}`]) {
          for (const decorate of fourDecorations) {
            assertCapacityAbsent(decorate(base), field, leakedValue);
          }
        }
      }
    }
  }

  const approximationFields = [
    ["ram", "RAM", "64GB", 64, "estimated"],
    ["vram", "VRAM", "12GiB", 12, "estimated"],
    ["storage", "SSD", "2TB", 2000, "estimated"],
    ["ram", "内存", "32GB", 32, "估计"],
    ["vram", "显存", "12GiB", 12, "估计"],
    ["storage", "固态硬盘", "1TB", 1000, "估计"],
    ["ram", "記憶體", "16GB", 16, "估計"],
    ["vram", "顯存", "8GiB", 8, "估計"],
    ["storage", "固態硬碟", "1TB", 1000, "估計"]
  ];
  for (const [field, label, amount, value, estimate] of approximationFields) {
    const forms = [
      `${label} ~${amount}`,
      `${label} ～${amount}`,
      `${label} ≈${amount}`,
      `${label} ≃${amount}`,
      `~${amount} ${label}`,
      `≈${amount} ${label}`,
      `${estimate} ${amount} ${label}`,
      `${label} ${estimate}${estimate === "estimated" ? " at " : ""}${amount}`
    ];
    for (const base of forms) {
      for (const decorate of sixDecorations) {
        assertCapacityAbsent(decorate(base), field, value);
      }
    }
  }

  const plusFields = [
    { field: "ram", label: "RAM", amount: "16GB", value: 16 },
    { field: "vram", label: "VRAM", amount: "12GiB", value: 12 },
    { field: "storage", label: "SSD", amount: "512GB", value: 512 }
  ];
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ];
  for (const order of permutations) {
    for (let orientationMask = 0; orientationMask < 8; orientationMask += 1) {
      const input = order.map((fieldIndex, position) => {
        const field = plusFields[fieldIndex];
        return orientationMask & (1 << position)
          ? `${field.amount} ${field.label}`
          : `${field.label} ${field.amount}`;
      }).join(" + ");
      assertionFamilies += 1;
      assert.deepEqual(
        extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
          candidate.field,
          candidate.value
        ]),
        order.map((fieldIndex) => [plusFields[fieldIndex].field, plusFields[fieldIndex].value]),
        input
      );
    }
  }

  const repeatedFields = [
    ["RAM", "16GB", "64GB"],
    ["VRAM", "8GiB", "12GiB"],
    ["storage", "1TB", "2TB"]
  ];
  for (const [label, left, right] of repeatedFields) {
    for (const connector of ["or", "至", "~", "～"]) {
      for (const input of [
        `${label} ${left} ${connector} ${label} ${right}`,
        `${left} ${label} ${connector} ${right} ${label}`
      ]) {
        assertionFamilies += 1;
        assert.equal(extractCapacityCandidates(normalizeSetupText(input)).length, 2, input);
      }
    }
  }

  for (const [verb, fields] of [
    ["upgraded to", [["RAM", "64GB"], ["VRAM", "12GiB"], ["SSD", "2TB"]]],
    ["升级到", [["内存", "32GB"], ["显存", "12GiB"], ["固态硬盘", "1TB"]]],
    ["升級到", [["記憶體", "16GB"], ["顯存", "8GiB"], ["固態硬碟", "1TB"]]]
  ]) {
    for (const [label, amount] of fields) {
      const input = `${verb} ${amount} ${label}`;
      assertionFamilies += 1;
      assert.equal(extractCapacityCandidates(normalizeSetupText(input)).length, 1, input);
    }
  }

  for (const input of [
    "SSD total 1TB", "SSD 1TB capacity", "SSD 100GB free", "SSD 100GB remaining",
    "固态硬盘总容量 1TB", "固态硬盘 1TB 总计", "固态硬盘可用 100GB", "固态硬盘剩余 100GB",
    "固態硬碟總容量 1TB", "固態硬碟 1TB 總計", "固態硬碟可用 100GB", "固態硬碟剩餘 100GB"
  ]) {
    assertionFamilies += 1;
    assert.equal(extractStorageCandidates(normalizeSetupText(input)).length, 1, input);
  }

  for (const model of ["AMD Radeon Vega 56", "AMD Radeon Vega 64"]) {
    for (const input of [
      `${model} 8GB`,
      `dedicated ${model} 8GB`,
      `discrete ${model} 8GB`,
      `${model} with 8GB`,
      `${model} (dedicated GPU) 8GB`,
      `${model} has 8GB`
    ]) {
      assertionFamilies += 1;
      assert.deepEqual(candidateValues(
        extractCapacityCandidates(normalizeSetupText(input)),
        "vram"
      ), [8], input);
    }
  }

  for (const [input, confidence, inferred] of [
    ["about 8 gigs of memory", "low", true],
    ["内存大概 32GB", "low", true],
    ["記憶體大約 16GB", "low", true],
    ["8 gigs of memory", "high", false]
  ]) {
    assertionFamilies += 1;
    const [candidate] = extractMemoryCandidates(normalizeSetupText(input));
    assert.deepEqual([candidate.confidence, candidate.inferred], [confidence, inferred], input);
  }

  assert.equal(assertionFamilies, 1_837);
});

test("abstains across the 1,080-case wrapped shared-label range sweep", () => {
  const fields = [
    ["RAM", "16", "64", "GB"],
    ["VRAM", "8", "12", "GiB"],
    ["SSD", "1", "2", "TB"],
    ["内存", "16", "64", "GB"],
    ["显存", "8", "12", "GiB"],
    ["固态硬盘", "1", "2", "TB"],
    ["記憶體", "16", "64", "GB"],
    ["顯存", "8", "12", "GiB"],
    ["固態硬碟", "1", "2", "TB"]
  ];
  const connectorFamilies = [
    () => "to",
    () => "or",
    (wrapperIndex) => wrapperIndex % 2 === 0 ? "或" : "或者",
    () => "至",
    () => "/",
    () => "-",
    () => "–",
    () => "—",
    () => "~",
    () => "～"
  ];
  const wrappers = [
    ["(", ")"],
    ["[", "]"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["〔", "〕"]
  ];
  let sweepCount = 0;

  for (const [label, left, right, unit] of fields) {
    for (const createConnector of connectorFamilies) {
      for (const [wrapperIndex, [open, close]] of wrappers.entries()) {
        const connector = createConnector(wrapperIndex);
        const connectorText = connector === "/" ? connector : ` ${connector} `;
        const range = `${left}${unit}${connectorText}${open}${right}${unit}${close}`;
        for (const input of [`${label} ${range}`, `${range} ${label}`]) {
          sweepCount += 1;
          assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
        }
      }
    }
  }
  assert.equal(sweepCount, 1_080);

  for (const input of [
    "RAM 16GB or (RAM 64GB)",
    "16GB RAM 至【64GB RAM】",
    "VRAM 8GiB～（VRAM 12GiB）",
    "SSD 1TB / [SSD 2TB]"
  ]) {
    assert.equal(extractCapacityCandidates(normalizeSetupText(input)).length, 2, input);
  }
});

test("attaches postposed disqualifiers across bounded semantic punctuation", () => {
  for (const input of [
    "RAM 64GB, unsupported",
    "RAM 64GB, (not supported)",
    "内存 32GB，不支持",
    "記憶體 16GB，（不支援）",
    "SSD 900GB, in use",
    "SSD 900GB, (consumed)",
    "固态硬盘 900GB，已占用",
    "固態硬碟 900GB，（已佔用）"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const [input, expected] of [
    ["RAM 64GB, unsupported;SSD 512GB", [["storage", 512]]],
    ["RAM 64GB, unsupported, SSD 512GB", [["storage", 512]]],
    ["RAM 64GB, SSD 900GB, in use", [["ram", 64]]],
    ["内存 32GB，不支持；固态硬盘 1TB", [["storage", 1000]]],
    ["RAM 64GB installed, SSD 512GB", [["ram", 64], ["storage", 512]]],
    ["upgraded to 64GB RAM, SSD 512GB", [["ram", 64], ["storage", 512]]]
  ]) {
    assert.deepEqual(
      extractCapacityCandidates(normalizeSetupText(input)).map((candidate) => [
        candidate.field,
        candidate.value
      ]),
      expected,
      input
    );
  }
});

test("retains wrapped storage status in exact evidence and rejects used status", () => {
  const accepted = [
    ["SSD 100GB (free)", "free"],
    ["SSD 100GB [available]", "free"],
    ["SSD 100GB（remaining）", "free"],
    ["(total) SSD 100GB", "total"],
    ["SSD [capacity] 100GB", "total"],
    ["固态硬盘 100GB（可用）", "free"],
    ["固态硬盘【剩余】100GB", "free"],
    ["（总容量）固态硬盘 100GB", "total"],
    ["固態硬碟 100GB（可用）", "free"],
    ["固態硬碟【剩餘】100GB", "free"],
    ["（總容量）固態硬碟 100GB", "total"],
    ["SSD 100GB, (free)", "free"]
  ];

  for (const [input, kind] of accepted) {
    const document = normalizeSetupText(input);
    const candidates = extractStorageCandidates(document);
    assert.equal(candidates.length, 1, input);
    assert.equal(candidates[0].storageKind, kind, input);
    assert.equal(candidates[0].raw, document.normalized, input);
    assertCapacityCandidateContract(document, candidates[0]);
  }

  for (const input of [
    "SSD 100GB (used)",
    "SSD 100GB [occupied]",
    "固态硬盘 100GB（已占用）",
    "固態硬碟 100GB【已佔用】"
  ]) {
    assert.deepEqual(extractStorageCandidates(normalizeSetupText(input)), [], input);
  }
});

test("retains punctuation only inside the three frozen natural approximation families", () => {
  for (const [input, field, value] of [
    ["about 8 gigs: of memory", "ram", 8],
    ["about 8 gigs, of memory", "ram", 8],
    ["内存:大概 32GB", "ram", 32],
    ["内存：大概 32GB", "ram", 32],
    ["内存，大概 32GB", "ram", 32],
    ["記憶體:大約 16GB", "ram", 16],
    ["記憶體：大約 16GB", "ram", 16],
    ["記憶體，大約 16GB", "ram", 16]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractMemoryCandidates(document);
    assert.equal(candidates.length, 1, input);
    assert.deepEqual(
      [candidates[0].field, candidates[0].value, candidates[0].confidence, candidates[0].inferred],
      [field, value, "low", true],
      input
    );
    assert.equal(candidates[0].raw, document.normalized, input);
    assertCapacityCandidateContract(document, candidates[0]);
  }

  for (const input of [
    "RAM:大概 32GB",
    "VRAM,大約 16GB",
    "SSD:about 1TB",
    "内存:大约 32GB",
    "記憶體:大概 16GB",
    "about 8 gigs: of VRAM"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }
});

test("replays 1,188 wrapped repeated-label range variants as conflict evidence", () => {
  const fields = [
    ["ram", "RAM", "16", "64", "GB", 1],
    ["vram", "VRAM", "8", "12", "GiB", 1],
    ["storage", "SSD", "1", "2", "TB", 1000],
    ["ram", "内存", "16", "64", "GB", 1],
    ["vram", "显存", "8", "12", "GiB", 1],
    ["storage", "固态硬盘", "1", "2", "TB", 1000],
    ["ram", "記憶體", "16", "64", "GB", 1],
    ["vram", "顯存", "8", "12", "GiB", 1],
    ["storage", "固態硬碟", "1", "2", "TB", 1000]
  ];
  const connectors = ["/", "to", "or", "或", "或者", "至", "-", "–", "—", "~", "～"];
  const wrappers = [
    ["(", ")"],
    ["[", "]"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["〔", "〕"]
  ];
  let variantCount = 0;
  let compactSlashLabelFirstCount = 0;

  for (const [field, label, left, right, unit, multiplier] of fields) {
    for (const connector of connectors) {
      const connectorText = connector === "/" ? connector : ` ${connector} `;
      for (const [open, close] of wrappers) {
        for (const amountFirst of [false, true]) {
          const leftClause = amountFirst
            ? `${left}${unit} ${label}`
            : `${label} ${left}${unit}`;
          const rightClause = amountFirst
            ? `${right}${unit} ${label}`
            : `${label} ${right}${unit}`;
          const input = `${leftClause}${connectorText}${open}${rightClause}${close}`;
          variantCount += 1;
          if (connector === "/" && !amountFirst) compactSlashLabelFirstCount += 1;

          const document = normalizeSetupText(input);
          const candidates = extractCapacityCandidates(document);
          assert.deepEqual(
            candidates.map((candidate) => [candidate.field, candidate.value]),
            [[field, Number(left) * multiplier], [field, Number(right) * multiplier]],
            input
          );
          candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
        }
      }
    }
  }
  assert.equal(variantCount, 1_188);
  assert.equal(compactSlashLabelFirstCount, 54);

  assert.deepEqual(extractCapacityCandidates(normalizeSetupText("RAM 16GB/(64GB)")), []);
  assert.deepEqual(extractCapacityCandidates(normalizeSetupText("SSD speed 7GB/s")), []);
  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("RAM 16GB / SSD 512GB")).map((candidate) => [
      candidate.field,
      candidate.value
    ]),
    [["ram", 16], ["storage", 512]]
  );
  assert.deepEqual(extractCapacityCandidates(normalizeSetupText("+64GB RAM")), []);
});

test("retains all 18 approved natural approximation wrapper variants", () => {
  const wrappers = [
    ["(", ")"],
    ["[", "]"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["〔", "〕"]
  ];
  const families = [
    [(open, close) => `about ${open}8 gigs${close} of memory`, 8, "gig"],
    [(open, close) => `内存:大概 ${open}32GB${close}`, 32, "GB"],
    [(open, close) => `記憶體:大約 ${open}16GB${close}`, 16, "GB"]
  ];
  let variantCount = 0;

  for (const [createInput, value, sourceUnit] of families) {
    for (const [open, close] of wrappers) {
      const input = createInput(open, close);
      const document = normalizeSetupText(input);
      const candidates = extractMemoryCandidates(document);
      variantCount += 1;
      assert.equal(candidates.length, 1, input);
      assert.deepEqual(
        [
          candidates[0].field,
          candidates[0].value,
          candidates[0].confidence,
          candidates[0].inferred,
          candidates[0].sourceUnit,
          candidates[0].raw
        ],
        ["ram", value, "low", true, sourceUnit, document.normalized],
        input
      );
      assertCapacityCandidateContract(document, candidates[0]);
    }
  }
  assert.equal(variantCount, 18);

  for (const input of [
    "RAM maybe (32GB)",
    "VRAM approximately [12GiB]",
    "SSD about（1TB）",
    "RAM 大概【32GB】"
  ]) {
    assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
  }

  for (const input of ["8 gigs of memory", "内存 32GB", "記憶體 16GB"]) {
    const [candidate] = extractMemoryCandidates(normalizeSetupText(input));
    assert.deepEqual([candidate.confidence, candidate.inferred], ["high", false], input);
  }
});

test("replays 5,940 wrapped shared-label ranges without endpoint leakage", () => {
  const fields = [
    ["RAM", "16", "64", "GB"],
    ["VRAM", "8", "12", "GiB"],
    ["SSD", "1", "2", "TB"],
    ["内存", "16", "64", "GB"],
    ["显存", "8", "12", "GiB"],
    ["固态硬盘", "1", "2", "TB"],
    ["記憶體", "16", "64", "GB"],
    ["顯存", "8", "12", "GiB"],
    ["固態硬碟", "1", "2", "TB"]
  ];
  const connectors = ["/", "to", "or", "或", "或者", "至", "-", "–", "—", "~", "～"];
  const wrappers = [
    ["(", ")"],
    ["[", "]"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["〔", "〕"]
  ];
  let variantCount = 0;

  for (const [label, left, right, unit] of fields) {
    for (const connector of connectors) {
      const joiner = connector === "/" ? connector : ` ${connector} `;
      for (const [open, close] of wrappers) {
        const ranges = [
          `${left}${unit}${joiner}${open}${right}${unit}${close}`,
          `${left}${joiner}${open}${right}${unit}${close}`,
          `${left}${unit}${joiner}${open}${right}${close}`,
          `${open}${left}${unit}${close}${joiner}${open}${right}${unit}${close}`,
          `${open}${left}${close}${joiner}${open}${right}${unit}${close}`
        ];
        for (const range of ranges) {
          for (const input of [`${label} ${range}`, `${range} ${label}`]) {
            variantCount += 1;
            assert.deepEqual(extractCapacityCandidates(normalizeSetupText(input)), [], input);
          }
        }
      }
    }
  }
  assert.equal(variantCount, 5_940);
});

test("replays 1,624 bounded qualifier ownership cases", () => {
  const cases = [
    ["ram", "RAM", "64GB", 64, "not equipped with"],
    ["vram", "VRAM", "12GiB", 12, "not equipped with"],
    ["storage", "SSD", "2TB", 2000, "not equipped with"],
    ["ram", "RAM", "64GB", 64, "lacks"],
    ["vram", "VRAM", "12GiB", 12, "lacks"],
    ["storage", "SSD", "2TB", 2000, "lacks"],
    ["ram", "RAM", "64GB", 64, "does not have"],
    ["vram", "VRAM", "12GiB", 12, "does not have"],
    ["storage", "SSD", "2TB", 2000, "does not have"],
    ["ram", "内存", "32GB", 32, "没有配备"],
    ["vram", "显存", "12GiB", 12, "没有配备"],
    ["storage", "固态硬盘", "1TB", 1000, "没有配备"],
    ["ram", "記憶體", "16GB", 16, "沒有配備"],
    ["vram", "顯存", "8GiB", 8, "沒有配備"],
    ["storage", "固態硬碟", "1TB", 1000, "沒有配備"],
    ["ram", "RAM", "64GB", 64, "unsupported"],
    ["vram", "VRAM", "12GiB", 12, "unsupported"],
    ["storage", "SSD", "2TB", 2000, "unsupported"],
    ["ram", "RAM", "64GB", 64, "not supported"],
    ["vram", "VRAM", "12GiB", 12, "not supported"],
    ["storage", "SSD", "2TB", 2000, "not supported"],
    ["ram", "内存", "32GB", 32, "不支持"],
    ["vram", "显存", "12GiB", 12, "不支持"],
    ["storage", "固态硬盘", "1TB", 1000, "不支持"],
    ["ram", "記憶體", "16GB", 16, "不支援"],
    ["vram", "顯存", "8GiB", 8, "不支援"],
    ["storage", "固態硬碟", "1TB", 1000, "不支援"],
    ["storage", "SSD", "900GB", 900, "in use"],
    ["storage", "固态硬盘", "900GB", 900, "已占用"]
  ];
  const wrappers = [
    ["", ""],
    ["(", ")"],
    ["[", "]"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["〔", "〕"]
  ];
  const layouts = [
    (qualifier, label, amount) => `${qualifier} ${label} ${amount}`,
    (qualifier, label, amount) => `${qualifier}: ${label} ${amount}`,
    (qualifier, label, amount) => `${qualifier} - ${label} ${amount}`,
    (qualifier, label, amount) => `${qualifier}: ${label}: ${amount}`,
    (qualifier, label, amount) => `${qualifier} ${amount} ${label}`,
    (qualifier, label, amount) => `${qualifier}: ${amount} ${label}`,
    (qualifier, label, amount) => `${qualifier} - ${amount} ${label}`,
    (qualifier, label, amount) => `${qualifier}: ${amount}: ${label}`
  ];
  let variantCount = 0;

  for (const [field, label, amount, value, qualifier] of cases) {
    const unrelated = field === "storage" ? "RAM 32GB" : "SSD 512GB";
    const unrelatedExpected = field === "storage" ? ["ram", 32] : ["storage", 512];
    for (const [open, close] of wrappers) {
      const wrappedQualifier = `${open}${qualifier}${close}`;
      for (const createInput of layouts) {
        const input = `${createInput(wrappedQualifier, label, amount)};${unrelated}`;
        const candidates = extractCapacityCandidates(normalizeSetupText(input));
        variantCount += 1;
        assert.equal(
          candidates.some((candidate) => candidate.field === field && candidate.value === value),
          false,
          input
        );
        assert.equal(
          candidates.some((candidate) => (
            candidate.field === unrelatedExpected[0]
            && candidate.value === unrelatedExpected[1]
          )),
          true,
          input
        );
      }
    }
  }
  assert.equal(variantCount, 1_624);
});

test("replays 210 wrapped storage-kind evidence variants", () => {
  const statuses = [
    ["SSD", "100GB", "free", "free"],
    ["SSD", "100GB", "capacity", "total"],
    ["固态硬盘", "100GB", "可用", "free"],
    ["固态硬盘", "100GB", "总容量", "total"],
    ["固態硬碟", "100GB", "剩餘", "free"]
  ];
  const wrappers = [
    ["(", ")"],
    ["[", "]"],
    ["（", "）"],
    ["［", "］"],
    ["【", "】"],
    ["〔", "〕"]
  ];
  const layouts = [
    (label, amount, status) => `${label} ${amount} ${status}`,
    (label, amount, status) => `${label} ${status} ${amount}`,
    (label, amount, status) => `${status} ${label} ${amount}`,
    (label, amount, status) => `${amount} ${label} ${status}`,
    (label, amount, status) => `${amount} ${status} ${label}`,
    (label, amount, status) => `${status} ${amount} ${label}`,
    (label, amount, status) => `${label}: ${amount}, ${status}`
  ];
  let variantCount = 0;

  for (const [label, amount, status, kind] of statuses) {
    for (const [open, close] of wrappers) {
      const wrappedStatus = `${open}${status}${close}`;
      for (const createInput of layouts) {
        const input = createInput(label, amount, wrappedStatus);
        const document = normalizeSetupText(input);
        const candidates = extractStorageCandidates(document);
        variantCount += 1;
        assert.equal(candidates.length, 1, input);
        assert.equal(candidates[0].storageKind, kind, input);
        assert.equal(candidates[0].raw, document.normalized, input);
        assertCapacityCandidateContract(document, candidates[0]);
      }
    }
  }
  assert.equal(variantCount, 210);
});

test("replays 288 wrapped plus ownership variants", () => {
  const fields = [
    { field: "ram", label: "RAM", amount: "16GB", value: 16 },
    { field: "vram", label: "VRAM", amount: "12GiB", value: 12 },
    { field: "storage", label: "SSD", amount: "512GB", value: 512 }
  ];
  const permutations = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ];
  const wrappers = [["(", ")"], ["【", "】"]];
  let variantCount = 0;

  for (const order of permutations) {
    for (let orientationMask = 0; orientationMask < 8; orientationMask += 1) {
      for (const plus of ["+", " + ", "+ "]) {
        for (const [open, close] of wrappers) {
          const input = order.map((fieldIndex, position) => {
            const field = fields[fieldIndex];
            const clause = orientationMask & (1 << position)
              ? `${field.amount} ${field.label}`
              : `${field.label} ${field.amount}`;
            return `${open}${clause}${close}`;
          }).join(plus);
          const document = normalizeSetupText(input);
          const candidates = extractCapacityCandidates(document);
          variantCount += 1;
          assert.deepEqual(
            candidates.map((candidate) => [candidate.field, candidate.value]),
            order.map((fieldIndex) => [fields[fieldIndex].field, fields[fieldIndex].value]),
            input
          );
          candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
        }
      }
    }
  }
  assert.equal(variantCount, 288);
});

test("suppresses integrated Vega 56 and 64 proximity independently of model source", () => {
  for (const [input, model] of [
    ["integrated AMD Vega 64 8GB", "AMD Vega 64"],
    ["integrated AMD Vega 56 8GB", "AMD Vega 56"],
    ["AMD Vega 64 (iGPU) 8GB", "AMD Vega 64"],
    ["AMD Vega 56（集成显卡）8GB", "AMD Vega 56"]
  ]) {
    const document = normalizeSetupText(input);
    const gpuModels = extractGpuCandidates(document).filter((candidate) => (
      candidate.field === "gpuModel"
    ));
    const vegaModel = gpuModels.find((candidate) => candidate.value === model);
    assert.ok(vegaModel, input);
    assert.equal(vegaModel.source, "gpu.amd-labeled-unknown", input);
    assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
  }

  for (const input of [
    "dedicated AMD Vega 64 8GB",
    "discrete AMD Vega 56 8GB",
    "AMD Vega 64 8GB",
    "integrated graphics;AMD Vega 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(extractCapacityCandidates(normalizeSetupText(input)), "vram"), [8], input);
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText("integrated AMD Vega 64 with 8GB VRAM"))
      .map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 8, "8GB VRAM"]]
  );
});

test("marks contradictory attached storage statuses unknown without losing evidence", () => {
  for (const input of [
    "SSD total free 100GB",
    "free SSD 100GB total",
    "固态硬盘总容量可用 100GB",
    "可用 固態硬碟 100GB 總容量"
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractStorageCandidates(document);
    assert.equal(candidates.length, 1, input);
    assert.deepEqual(
      [candidates[0].value, candidates[0].storageKind, candidates[0].raw],
      [100, "unknown", document.normalized],
      input
    );
    assertCapacityCandidateContract(document, candidates[0]);
  }

  for (const [input, kind] of [
    ["SSD free 100GB", "free"],
    ["SSD 100GB available", "free"],
    ["SSD remaining 100GB", "free"],
    ["SSD total 100GB", "total"],
    ["SSD 100GB capacity", "total"]
  ]) {
    const document = normalizeSetupText(input);
    const [candidate] = extractStorageCandidates(document);
    assert.deepEqual([candidate.storageKind, candidate.raw], [kind, document.normalized], input);
  }

  const mixed = extractCapacityCandidates(normalizeSetupText(
    "SSD total free 100GB;RAM 32GB;SSD 900GB used"
  ));
  assert.deepEqual(
    mixed.map((candidate) => [candidate.field, candidate.value, candidate.storageKind]),
    [["storage", 100, "unknown"], ["ram", 32, undefined]]
  );
});

test("keeps adjacent storage qualifiers with their owned fields", () => {
  for (const [input, expected] of [
    [
      "SSD total 100GB free HDD 200GB",
      [[100, "total", "SSD total 100GB"], [200, "free", "free HDD 200GB"]]
    ],
    [
      "free SSD 100GB total HDD 200GB",
      [[100, "free", "free SSD 100GB"], [200, "total", "total HDD 200GB"]]
    ],
    [
      "SSD total free 100GB remaining HDD 200GB",
      [[100, "unknown", "SSD total free 100GB"], [200, "free", "remaining HDD 200GB"]]
    ]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractStorageCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("replays adjacent storage qualifier ownership zones", () => {
  const vocabularies = [
    {
      labels: ["SSD", "HDD", "disk"],
      qualifiers: [["total", "total"], ["remaining", "free"], ["capacity", "total"]]
    },
    {
      labels: ["drive", "SSD", "HDD"],
      qualifiers: [["available", "free"], ["capacity", "total"], ["free", "free"]]
    },
    {
      labels: ["固态硬盘", "硬盘", "存储"],
      qualifiers: [["总容量", "total"], ["剩余", "free"], ["可用", "free"]]
    },
    {
      labels: ["固態硬碟", "硬碟", "存儲"],
      qualifiers: [["總容量", "total"], ["剩餘", "free"], ["可用", "free"]]
    }
  ];
  const wrappers = [["", ""], ["(", ")"], ["（", "）"]];
  const separators = [" ", " : ", " ： ", " , ", " ， "];
  let variantCount = 0;

  for (const vocabulary of vocabularies) {
    for (const fieldCount of [2, 3]) {
      for (let orientationMask = 0; orientationMask < 2 ** fieldCount; orientationMask += 1) {
        for (const [open, close] of wrappers) {
          for (const separator of separators) {
            const clauses = [];
            const expected = [];
            for (let index = 0; index < fieldCount; index += 1) {
              const label = vocabulary.labels[index];
              const [qualifier, kind] = vocabulary.qualifiers[index];
              const amount = `${100 * (index + 1)}GB`;
              const clause = orientationMask & (1 << index)
                ? `${open}${qualifier}${close} ${amount} ${label}`
                : `${open}${qualifier}${close} ${label} ${amount}`;
              clauses.push(clause);
              expected.push([
                100 * (index + 1),
                kind,
                normalizeSetupText(clause).normalized
              ]);
            }
            const input = clauses.join(separator);
            const document = normalizeSetupText(input);
            const candidates = extractStorageCandidates(document);
            variantCount += 1;
            assert.deepEqual(
              candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
              expected,
              input
            );
            candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
          }
        }
      }
    }
  }
  assert.equal(variantCount, 720);
});

test("keeps an adjacent valid storage field before an owned used field", () => {
  for (const [input, expected] of [
    [
      "SSD total 100GB occupied 200GB HDD",
      [[100, "total", "SSD total 100GB"]]
    ],
    [
      "100GB total SSD occupied HDD 200GB",
      [[100, "total", "100GB total SSD"]]
    ],
    [
      "固态硬盘 总容量 100GB 已占用 200GB 硬盘",
      [[100, "total", "固态硬盘 总容量 100GB"]]
    ],
    [
      "100GB 總容量 固態硬碟 已使用 硬碟 200GB",
      [[100, "total", "100GB 總容量 固態硬碟"]]
    ]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractStorageCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }

  assert.deepEqual(extractStorageCandidates(normalizeSetupText("SSD 900GB occupied")), []);
  assert.deepEqual(
    extractStorageCandidates(normalizeSetupText("SSD total free 100GB"))
      .map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
    [[100, "unknown", "SSD total free 100GB"]]
  );
});

test("replays adjacent storage disqualifier ownership zones", () => {
  const vocabularies = [
    {
      labels: ["SSD", "HDD", "disk"],
      qualifiers: [["total", "total"], ["free", "free"], ["available", "free"]],
      disqualifiers: ["occupied", "used"]
    },
    {
      labels: ["drive", "SSD", "HDD"],
      qualifiers: [["capacity", "total"], ["remaining", "free"], ["total", "total"]],
      disqualifiers: ["in use", "consumed"]
    },
    {
      labels: ["固态硬盘", "硬盘", "存储"],
      qualifiers: [["总容量", "total"], ["可用", "free"], ["剩余", "free"]],
      disqualifiers: ["已占用", "已使用"]
    },
    {
      labels: ["固態硬碟", "硬碟", "存儲"],
      qualifiers: [["總容量", "total"], ["可用", "free"], ["剩餘", "free"]],
      disqualifiers: ["已佔用", "已使用"]
    }
  ];
  const wrappers = [["", ""], ["(", ")"], ["（", "）"]];
  const separators = [" ", " : ", " ， "];
  let variantCount = 0;

  for (const vocabulary of vocabularies) {
    for (const fieldCount of [2, 3]) {
      for (let orientationMask = 0; orientationMask < 2 ** fieldCount; orientationMask += 1) {
        for (const [open, close] of wrappers) {
          for (const separator of separators) {
            for (const disqualifier of vocabulary.disqualifiers) {
              const clauses = [];
              const expected = [];
              for (let index = 0; index < fieldCount; index += 1) {
                const label = vocabulary.labels[index];
                const amount = `${100 * (index + 1)}GB`;
                const amountFirst = Boolean(orientationMask & (1 << index));
                if (index === 1) {
                  clauses.push(amountFirst
                    ? `${open}${disqualifier}${close} ${amount} ${label}`
                    : `${open}${disqualifier}${close} ${label} ${amount}`);
                  continue;
                }

                const [qualifier, kind] = vocabulary.qualifiers[index];
                const clause = amountFirst
                  ? `${qualifier} ${amount} ${label}`
                  : `${qualifier} ${label} ${amount}`;
                clauses.push(clause);
                expected.push([
                  100 * (index + 1),
                  kind,
                  normalizeSetupText(clause).normalized
                ]);
              }
              const input = clauses.join(separator);
              const document = normalizeSetupText(input);
              const candidates = extractStorageCandidates(document);
              variantCount += 1;
              assert.deepEqual(
                candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
                expected,
                input
              );
              candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
            }
          }
        }
      }
    }
  }
  assert.equal(variantCount, 864);
});

test("suppresses integrated generic AMD Vega proximity case-insensitively", () => {
  for (const [input, modelRaw, source] of [
    ["integrated AMD VEGA 64 8GB", "AMD VEGA 64", "gpu.amd-labeled-unknown"],
    ["integrated amd vega 56 8GB", "amd vega 56", "gpu.amd-labeled-unknown"],
    ["AMD vEgA 64 (iGPU) 8GB", "AMD vEgA 64", "gpu.amd-labeled-unknown"],
    ["集成显卡 AMD VeGa 56 8GB", "AMD VeGa 56", "gpu.amd-labeled-unknown"],
    [
      "integrated AMD RADEON VEGA 64 8GB",
      "AMD RADEON VEGA 64",
      "gpu.amd-radeon-vega-dedicated"
    ]
  ]) {
    const document = normalizeSetupText(input);
    const model = extractGpuCandidates(document).find((candidate) => (
      candidate.field === "gpuModel" && candidate.raw === modelRaw
    ));
    assert.ok(model, input);
    assert.equal(model.source, source, input);
    assert.equal(document.normalized.slice(model.start, model.end), modelRaw, input);
    assert.deepEqual(candidateValues(extractCapacityCandidates(document), "vram"), [], input);
  }

  for (const input of [
    "dedicated AMD VEGA 64 8GB",
    "discrete AMD vEgA 56 8GB",
    "AMD VEGA 64 8GB",
    "integrated graphics;AMD VEGA 64 8GB"
  ]) {
    assert.deepEqual(candidateValues(
      extractCapacityCandidates(normalizeSetupText(input)),
      "vram"
    ), [8], input);
  }

  assert.deepEqual(
    extractCapacityCandidates(normalizeSetupText(
      "integrated AMD VEGA 64 with 8GB VRAM"
    )).map((candidate) => [candidate.field, candidate.value, candidate.raw]),
    [["vram", 8, "8GB VRAM"]]
  );
});

test("assigns storage semantics across overlapping shared-label ownerships", () => {
  for (const [input, expected] of [
    [
      "1TB total SSD free 200GB",
      [[1000, "total", "1TB total SSD"], [200, "free", "SSD free 200GB"]]
    ],
    [
      "200GB free SSD total 1TB",
      [[200, "free", "200GB free SSD"], [1000, "total", "SSD total 1TB"]]
    ],
    [
      "1TB 总容量 固态硬盘 可用 200GB",
      [[1000, "total", "1TB 总容量 固态硬盘"], [200, "free", "固态硬盘 可用 200GB"]]
    ],
    [
      "200GB 剩餘 固態硬碟 總容量 1TB",
      [[200, "free", "200GB 剩餘 固態硬碟"], [1000, "total", "固態硬碟 總容量 1TB"]]
    ]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractStorageCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }

  assert.deepEqual(
    extractStorageCandidates(normalizeSetupText("1TB total free SSD"))
      .map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
    [[1000, "unknown", "1TB total free SSD"]]
  );
  assert.deepEqual(
    extractStorageCandidates(normalizeSetupText("1TB total SSD occupied 200GB"))
      .map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
    [[1000, "total", "1TB total SSD"]]
  );
  assert.deepEqual(
    extractStorageCandidates(normalizeSetupText("SSD total 100GB free HDD 200GB"))
      .map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
    [[100, "total", "SSD total 100GB"], [200, "free", "free HDD 200GB"]]
  );
});

test("replays overlapping shared storage-label semantic ownership", () => {
  const vocabularies = [
    { label: "SSD", total: "total", free: ["free", "remaining"] },
    { label: "固态硬盘", total: "总容量", free: ["可用", "剩余"] },
    { label: "固態硬碟", total: "總容量", free: ["可用", "剩餘"] }
  ];
  const wrappers = [["", ""], ["(", ")"], ["（", "）"]];
  const separators = [" ", " : ", " ： "];
  let variantCount = 0;

  for (const vocabulary of vocabularies) {
    for (const free of vocabulary.free) {
      for (const mirrored of [false, true]) {
        for (const [open, close] of wrappers) {
          for (const separator of separators) {
            const wrappedTotal = `${open}${vocabulary.total}${close}`;
            const wrappedFree = `${open}${free}${close}`;
            const input = mirrored
              ? `200GB${separator}${wrappedFree}${separator}${vocabulary.label}${separator}${wrappedTotal}${separator}1TB`
              : `1TB${separator}${wrappedTotal}${separator}${vocabulary.label}${separator}${wrappedFree}${separator}200GB`;
            const expected = mirrored
              ? [
                [200, "free", normalizeSetupText(`200GB${separator}${wrappedFree}${separator}${vocabulary.label}`).normalized],
                [1000, "total", normalizeSetupText(`${vocabulary.label}${separator}${wrappedTotal}${separator}1TB`).normalized]
              ]
              : [
                [1000, "total", normalizeSetupText(`1TB${separator}${wrappedTotal}${separator}${vocabulary.label}`).normalized],
                [200, "free", normalizeSetupText(`${vocabulary.label}${separator}${wrappedFree}${separator}200GB`).normalized]
              ];
            const document = normalizeSetupText(input);
            const candidates = extractStorageCandidates(document);
            variantCount += 1;
            assert.deepEqual(
              candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
              expected,
              input
            );
            candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
          }
        }
      }
    }
  }
  assert.equal(variantCount, 108);
});

test("does not let a suppressed storage amount reserve the following qualifier", () => {
  for (const [input, expected] of [
    [
      "1TB total SSD occupied 200GB free HDD 300GB",
      [[1000, "total", "1TB total SSD"], [300, "free", "free HDD 300GB"]]
    ],
    [
      "1TB 总容量 固态硬盘 已占用 200GB 可用 硬盘 300GB",
      [[1000, "total", "1TB 总容量 固态硬盘"], [300, "free", "可用 硬盘 300GB"]]
    ],
    [
      "300GB 剩餘 硬碟 已佔用 200GB 總容量 固態硬碟 1TB",
      [[300, "free", "300GB 剩餘 硬碟"], [1000, "total", "總容量 固態硬碟 1TB"]]
    ]
  ]) {
    const document = normalizeSetupText(input);
    const candidates = extractStorageCandidates(document);
    assert.deepEqual(
      candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
      expected,
      input
    );
    candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
  }
});

test("replays 36 suppressed-middle storage ownership variants", () => {
  const vocabularies = [
    { firstLabel: "SSD", total: "total", used: "occupied", free: "free", lastLabel: "HDD" },
    { firstLabel: "固态硬盘", total: "总容量", used: "已占用", free: "可用", lastLabel: "硬盘" },
    { firstLabel: "固態硬碟", total: "總容量", used: "已佔用", free: "剩餘", lastLabel: "硬碟" }
  ];
  const wrappers = [["", ""], ["(", ")"]];
  let variantCount = 0;

  for (const vocabulary of vocabularies) {
    for (const [open, close] of wrappers) {
      const total = `${open}${vocabulary.total}${close}`;
      const used = `${open}${vocabulary.used}${close}`;
      const free = `${open}${vocabulary.free}${close}`;
      const firstBefore = `1TB ${total} ${vocabulary.firstLabel}`;
      const firstAfter = `${total} ${vocabulary.firstLabel} 1TB`;
      const lastBefore = `300GB ${free} ${vocabulary.lastLabel}`;
      const lastAfter = `${free} ${vocabulary.lastLabel} 300GB`;
      const layouts = [
        [`${firstBefore} ${used} 200GB ${lastAfter}`, [[1000, "total", firstBefore], [300, "free", lastAfter]]],
        [`${firstAfter} ${used} 200GB ${lastAfter}`, [[1000, "total", firstAfter], [300, "free", lastAfter]]],
        [`${firstBefore} ${used} 200GB ${lastBefore}`, [[1000, "total", firstBefore], [300, "free", lastBefore]]],
        [`${lastBefore} ${used} 200GB ${firstAfter}`, [[300, "free", lastBefore], [1000, "total", firstAfter]]],
        [`${lastAfter} ${used} 200GB ${firstAfter}`, [[300, "free", lastAfter], [1000, "total", firstAfter]]],
        [`${lastBefore} ${used} 200GB ${firstBefore}`, [[300, "free", lastBefore], [1000, "total", firstBefore]]]
      ];

      for (const [input, expected] of layouts) {
        const document = normalizeSetupText(input);
        const candidates = extractStorageCandidates(document);
        variantCount += 1;
        assert.deepEqual(
          candidates.map((candidate) => [candidate.value, candidate.storageKind, candidate.raw]),
          expected.map(([value, kind, raw]) => [
            value,
            kind,
            normalizeSetupText(raw).normalized
          ]),
          input
        );
        candidates.forEach((candidate) => assertCapacityCandidateContract(document, candidate));
      }
    }
  }
  assert.equal(variantCount, 36);
});

test("keeps direct extractors equal to aggregate output across interleaved calls", () => {
  const inputs = [
    "1TB total SSD free 200GB",
    "1TB total SSD occupied 200GB free HDD 300GB",
    "200GB 剩餘 固態硬碟 總容量 1TB",
    "SSD total 100GB occupied 200GB HDD",
    "integrated AMD VEGA 64 8GB;RAM 32GB",
    "dedicated AMD vEgA 56 8GB;SSD 512GB",
    "Apple M2 Max unified memory 32GB",
    "Mac Studio M3 Ultra with 64GB unified memory",
    "no dedicated GPU 12GB RAM 32GB SSD 512GB",
    "NVIDIA RTX 4070 12GB;without a dedicated GPU",
    "RAM 16GB to 32GB;SSD 512GB",
    "RAM maybe 64GB;SSD 1TB",
    "内存大概 32GB;固态硬盘 1TB"
  ];
  const families = [
    [extractSystemCandidates, new Set(["os", "deviceType"])],
    [extractCpuCandidates, new Set(["cpuModel"])],
    [extractGpuCandidates, new Set(["gpuModel", "gpuVendor"])],
    [extractTaskCandidates, new Set(["task"])],
    [extractMemoryCandidates, new Set(["ram", "vram"])],
    [extractStorageCandidates, new Set(["storage"])],
    [extractCapacityCandidates, new Set(["ram", "vram", "storage"])]
  ];
  const documents = inputs.map((input) => normalizeSetupText(input));
  const snapshots = documents.map((document) => JSON.stringify(document));
  const expected = documents.map((document) => families.map(([extract]) => (
    JSON.stringify(extract(document))
  )));

  for (let round = 0; round < 4; round += 1) {
    const order = round % 2 === 0
      ? documents.map((_, index) => index)
      : documents.map((_, index) => documents.length - 1 - index);
    for (const documentIndex of order) {
      const document = documents[documentIndex];
      const aggregate = extractCandidates(document);
      for (let familyIndex = families.length - 1; familyIndex >= 0; familyIndex -= 1) {
        const [extract, fields] = families[familyIndex];
        const direct = extract(document);
        const aggregateFamily = aggregate.filter((candidate) => fields.has(candidate.field));
        assert.equal(JSON.stringify(direct), expected[documentIndex][familyIndex]);
        assert.deepEqual(direct, aggregateFamily, inputs[documentIndex]);
      }
      assert.equal(JSON.stringify(document), snapshots[documentIndex]);
    }
  }
});

test("keeps dense non-storage disqualifier ownership subquadratic", () => {
  function medianDenseTime(length) {
    const phrase = "RAM maybe 1GB ";
    const repeats = Math.floor((length + 1) / phrase.length);
    const document = normalizeSetupText(phrase.repeat(repeats).trim());
    extractCapacityCandidates(document);
    const durations = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const start = performance.now();
      const candidates = extractCapacityCandidates(document);
      durations.push(performance.now() - start);
      assert.deepEqual(candidates, []);
    }
    durations.sort((left, right) => left - right);
    return {
      durationMs: durations[Math.floor(durations.length / 2)],
      normalizedLength: document.normalized.length,
      repeats
    };
  }

  medianDenseTime(2_500);
  const quarter = medianDenseTime(5_000);
  const half = medianDenseTime(10_000);
  const full = medianDenseTime(20_000);
  assert.equal([quarter.repeats, half.repeats, full.repeats].join(","), "357,714,1428");
  assert.ok(full.durationMs < 500, `20k RAM uncertainty ${full.durationMs.toFixed(3)}ms`);
  assert.ok(
    full.durationMs / half.durationMs < 3,
    `RAM scaling half/full ${half.durationMs.toFixed(3)}ms -> ${full.durationMs.toFixed(3)}ms`
  );
  assert.ok(
    full.durationMs / quarter.durationMs < 7,
    `RAM scaling quarter/full ${quarter.durationMs.toFixed(3)}ms -> ${full.durationMs.toFixed(3)}ms`
  );
});

test("keeps dense shared-label ownership subquadratic", () => {
  function medianSharedLabelTime(length) {
    const phrase = "1GB SSD 2GB ";
    const repeats = Math.floor((length + 1) / phrase.length);
    const document = normalizeSetupText(phrase.repeat(repeats).trim());
    extractStorageCandidates(document);
    const durations = [];
    let candidates = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const start = performance.now();
      candidates = extractStorageCandidates(document);
      durations.push(performance.now() - start);
    }
    durations.sort((left, right) => left - right);
    assert.equal(candidates.length, repeats * 2);
    return durations[Math.floor(durations.length / 2)];
  }

  medianSharedLabelTime(2_500);
  const quarter = medianSharedLabelTime(5_000);
  const half = medianSharedLabelTime(10_000);
  const full = medianSharedLabelTime(20_000);
  assert.ok(full < 500, `20k shared-label extraction ${full.toFixed(3)}ms`);
  assert.ok(full / half < 3, `shared-label half/full ${half.toFixed(3)}ms -> ${full.toFixed(3)}ms`);
  assert.ok(full / quarter < 7, `shared-label quarter/full ${quarter.toFixed(3)}ms -> ${full.toFixed(3)}ms`);
});

test("keeps storage-dense semantic ownership bounded at the 20k cap", () => {
  function medianStorageDense(length) {
    const repeats = Math.floor((length + 1) / 13);
    const input = "free SSD 1GB ".repeat(repeats).trim();
    const document = normalizeSetupText(input);
    extractStorageCandidates(document);
    const durations = [];
    let candidates = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const start = performance.now();
      candidates = extractStorageCandidates(document);
      durations.push(performance.now() - start);
    }
    durations.sort((left, right) => left - right);
    return {
      candidates,
      durationMs: durations[Math.floor(durations.length / 2)],
      normalizedLength: document.normalized.length,
      repeats
    };
  }

  medianStorageDense(2_500);
  const quarter = medianStorageDense(5_000);
  const half = medianStorageDense(10_000);
  const full = medianStorageDense(20_000);

  for (const sample of [quarter, half, full]) {
    assert.equal(sample.candidates.length, sample.repeats);
    assert.equal(sample.candidates.every((candidate) => (
      candidate.storageKind === "free" && candidate.raw === "free SSD 1GB"
    )), true);
  }
  assert.ok(
    full.durationMs < 500,
    `20k storage-dense extraction ${full.durationMs.toFixed(3)}ms`
  );
  assert.ok(
    full.durationMs / half.durationMs < 3,
    `storage scaling 10k/20k ${half.durationMs.toFixed(3)}ms -> ${full.durationMs.toFixed(3)}ms`
  );
  assert.ok(
    full.durationMs / quarter.durationMs < 7,
    `storage scaling 5k/20k ${quarter.durationMs.toFixed(3)}ms -> ${full.durationMs.toFixed(3)}ms`
  );
});

test("keeps capped segment-dense aggregate extraction materially subquadratic", () => {
  function medianExtraction(input) {
    const document = normalizeSetupText(input);
    extractCandidates(document);
    const durations = [];
    let candidates = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const start = performance.now();
      candidates = extractCandidates(document);
      durations.push(performance.now() - start);
    }
    durations.sort((left, right) => left - right);
    return {
      candidates,
      durationMs: durations[Math.floor(durations.length / 2)],
      segments: document.segments.length
    };
  }

  const halfNoMatch = medianExtraction("x;".repeat(5_000));
  const noMatch = medianExtraction("x;".repeat(10_000));
  const halfDense = medianExtraction("M1;".repeat(3_333));
  const dense = medianExtraction("M1;".repeat(6_666));

  assert.equal(noMatch.segments, 10_000);
  assert.equal(noMatch.candidates.length, 0);
  assert.equal(dense.segments, 6_666);
  assert.equal(dense.candidates.length, 6_666);
  assert.ok(noMatch.durationMs < 500, `no-match extraction ${noMatch.durationMs.toFixed(3)}ms`);
  assert.ok(dense.durationMs < 500, `dense extraction ${dense.durationMs.toFixed(3)}ms`);
  assert.ok(
    noMatch.durationMs / halfNoMatch.durationMs < 3,
    `no-match scaling ${halfNoMatch.durationMs.toFixed(3)}ms -> ${noMatch.durationMs.toFixed(3)}ms`
  );
  assert.ok(
    dense.durationMs / halfDense.durationMs < 3,
    `dense scaling ${halfDense.durationMs.toFixed(3)}ms -> ${dense.durationMs.toFixed(3)}ms`
  );
});
