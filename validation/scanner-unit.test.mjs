import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSetupText } from "../src/scanner/normalize.js";

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
