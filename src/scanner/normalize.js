const MAX_TEXT_LENGTH = 20_000;

/**
 * Defensive ceiling for direct API calls before NFKC normalization.
 * Normal UI input remains limited to 20,000 UTF-16 code units.
 */
const PRE_NORMALIZATION_SAFETY_LENGTH = 100_000;

/**
 * @typedef {object} NormalizedSegment
 * @property {string} text
 * @property {string} lower Comparison-only lowercase text. Its indices must
 * never be used for evidence spans because Unicode lowercasing may change length.
 * @property {number} index
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} NormalizedSetupDocument
 * @property {string} raw
 * @property {string} normalized
 * @property {string} lower Comparison-only lowercase text. Its indices must
 * never be used for evidence spans because Unicode lowercasing may change length.
 * @property {boolean} truncated
 * @property {NormalizedSegment[]} segments
 */

function capCodePointSafe(value, maxCodeUnits) {
  if (value.length <= maxCodeUnits) {
    return { text: value, truncated: false };
  }

  let end = maxCodeUnits;
  const codeUnitBeforeCut = value.charCodeAt(end - 1);
  const codeUnitAfterCut = value.charCodeAt(end);
  const cutsSurrogatePair = codeUnitBeforeCut >= 0xD800
    && codeUnitBeforeCut <= 0xDBFF
    && codeUnitAfterCut >= 0xDC00
    && codeUnitAfterCut <= 0xDFFF;

  if (cutsSurrogatePair) end -= 1;
  return { text: value.slice(0, end), truncated: true };
}

function appendSegment(segments, normalized, start, end) {
  const candidate = normalized.slice(start, end);
  const text = candidate.trim();
  if (!text) return;

  const leadingWhitespaceLength = candidate.length - candidate.trimStart().length;
  const segmentStart = start + leadingWhitespaceLength;

  segments.push({
    text,
    lower: text.toLowerCase(),
    index: segments.length,
    start: segmentStart,
    end: segmentStart + text.length
  });
}

/**
 * Normalizes setup text while retaining evidence offsets in `normalized`.
 * Evidence-producing matching must use `normalized` or `segment.text` with a
 * case-insensitive expression; `lower` fields are comparison-only.
 *
 * @param {unknown} input
 * @returns {NormalizedSetupDocument}
 */
export function normalizeSetupText(input) {
  const coerced = input === null || input === undefined ? "" : String(input);
  const rawResult = capCodePointSafe(coerced, MAX_TEXT_LENGTH);
  const sourceResult = capCodePointSafe(coerced, PRE_NORMALIZATION_SAFETY_LENGTH);
  const normalizedResult = capCodePointSafe(sourceResult.text.normalize("NFKC"), MAX_TEXT_LENGTH);
  const normalized = normalizedResult.text;
  const segments = [];
  let segmentStart = 0;

  const delimiters = /\r\n|[\n\r;；|｜]|->|=>|→|⇒|➜|➔|(?<=\s)\/(?=\s)/gu;
  for (const match of normalized.matchAll(delimiters)) {
    appendSegment(segments, normalized, segmentStart, match.index);
    segmentStart = match.index + match[0].length;
  }
  appendSegment(segments, normalized, segmentStart, normalized.length);

  return {
    raw: rawResult.text,
    normalized,
    lower: normalized.toLowerCase(),
    truncated: sourceResult.truncated || normalizedResult.truncated,
    segments
  };
}
