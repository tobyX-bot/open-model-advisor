const MAX_TEXT_LENGTH = 20_000;

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

export function normalizeSetupText(input) {
  const coerced = input === null || input === undefined ? "" : String(input);
  const raw = coerced.length > MAX_TEXT_LENGTH
    ? coerced.slice(0, MAX_TEXT_LENGTH)
    : coerced;
  const nfkc = coerced.normalize("NFKC");
  const normalizedWasCut = nfkc.length > MAX_TEXT_LENGTH;
  const normalized = normalizedWasCut ? nfkc.slice(0, MAX_TEXT_LENGTH) : nfkc;
  const segments = [];
  let segmentStart = 0;

  const delimiters = /\r\n|[\n\r;；|｜]|->|=>|→|⇒|➜|➔|(?<=\s)\/(?=\s)/gu;
  for (const match of normalized.matchAll(delimiters)) {
    appendSegment(segments, normalized, segmentStart, match.index);
    segmentStart = match.index + match[0].length;
  }
  appendSegment(segments, normalized, segmentStart, normalized.length);

  return {
    raw,
    normalized,
    lower: normalized.toLowerCase(),
    truncated: normalizedWasCut,
    segments
  };
}
