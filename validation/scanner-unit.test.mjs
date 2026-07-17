import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  extractCandidates,
  extractCpuCandidates,
  extractGpuCandidates,
  extractSystemCandidates,
  extractTaskCandidates
} from "../src/scanner/extractors.js";
import { normalizeSetupText } from "../src/scanner/normalize.js";
import {
  CPU_MODEL_PATTERNS,
  GPU_MODEL_PATTERNS,
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

test("exports all pure Task 2 extractor entry points", () => {
  for (const extractor of [
    extractSystemCandidates,
    extractCpuCandidates,
    extractGpuCandidates,
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
