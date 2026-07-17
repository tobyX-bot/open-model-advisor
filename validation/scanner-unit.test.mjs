import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
