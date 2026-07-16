import {
  CPU_MODEL_PATTERNS,
  GPU_MODEL_PATTERNS,
  SYSTEM_PATTERNS,
  TASK_PATTERNS
} from "./patterns.js";

function globalRegex(regex) {
  const flags = `${regex.flags.replace(/[gy]/g, "")}g`;
  return new RegExp(regex.source, flags);
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function candidateFromMatch(document, segment, pattern, match) {
  const evidence = pattern.evidenceGroup ? match.groups?.[pattern.evidenceGroup] : match[0];
  if (!evidence) return null;

  const evidenceOffset = pattern.evidenceGroup ? match[0].indexOf(evidence) : 0;
  const start = segment.start + match.index + evidenceOffset;
  const end = start + evidence.length;
  const raw = document.normalized.slice(start, end);

  if (raw !== evidence) return null;
  return {
    field: pattern.field,
    value: typeof pattern.normalize === "function" ? pattern.normalize(match) : pattern.value,
    raw,
    segmentIndex: segment.index,
    start,
    end,
    source: pattern.id,
    specificity: pattern.specificity,
    confidence: pattern.confidence,
    inferred: false
  };
}

function collectPatternMatches(document, patterns) {
  const accepted = [];

  for (const segment of document.segments) {
    for (const [patternIndex, pattern] of patterns.entries()) {
      const matcher = globalRegex(pattern.regex);
      for (const match of segment.text.matchAll(matcher)) {
        const candidate = candidateFromMatch(document, segment, pattern, match);
        if (!candidate) continue;

        const shadowed = accepted.some((entry) => (
          entry.candidate.segmentIndex === candidate.segmentIndex
          && entry.candidate.field === candidate.field
          && entry.candidate.specificity >= candidate.specificity
          && overlaps(entry.candidate, candidate)
        ));
        if (shadowed) continue;

        for (let index = accepted.length - 1; index >= 0; index -= 1) {
          const entry = accepted[index];
          if (
            entry.candidate.segmentIndex === candidate.segmentIndex
            && entry.candidate.field === candidate.field
            && entry.candidate.specificity < candidate.specificity
            && overlaps(entry.candidate, candidate)
          ) {
            accepted.splice(index, 1);
          }
        }
        accepted.push({ candidate, pattern, patternIndex });
      }
    }
  }

  accepted.sort((left, right) => (
    left.candidate.segmentIndex - right.candidate.segmentIndex
    || left.candidate.start - right.candidate.start
    || left.candidate.end - right.candidate.end
    || left.patternIndex - right.patternIndex
  ));
  return accepted;
}

function collectSimpleCandidates(document, patterns) {
  return collectPatternMatches(document, patterns).map((entry) => entry.candidate);
}

export function extractSystemCandidates(document) {
  return collectSimpleCandidates(document, SYSTEM_PATTERNS);
}

export function extractCpuCandidates(document) {
  return collectSimpleCandidates(document, CPU_MODEL_PATTERNS);
}

export function extractGpuCandidates(document) {
  const candidates = [];

  for (const { candidate, pattern } of collectPatternMatches(document, GPU_MODEL_PATTERNS)) {
    candidates.push(candidate);
    if (!pattern.vendor) continue;

    candidates.push({
      field: "gpuVendor",
      value: pattern.vendor,
      raw: candidate.raw,
      segmentIndex: candidate.segmentIndex,
      start: candidate.start,
      end: candidate.end,
      source: `${pattern.id}.vendor`,
      specificity: pattern.vendorSpecificity ?? pattern.specificity,
      confidence: pattern.vendorConfidence ?? pattern.confidence,
      inferred: false
    });
  }
  return candidates;
}

export function extractTaskCandidates(document) {
  return collectSimpleCandidates(document, TASK_PATTERNS);
}

export function extractCandidates(document) {
  return [
    ...extractSystemCandidates(document),
    ...extractCpuCandidates(document),
    ...extractGpuCandidates(document),
    ...extractTaskCandidates(document)
  ];
}
