import {
  CAPACITY_AMOUNT_PATTERNS,
  CAPACITY_CLAUSE_PATTERNS,
  CAPACITY_LABEL_PATTERNS,
  CPU_MODEL_PATTERNS,
  GPU_MODEL_PATTERNS,
  STORAGE_KIND_PATTERNS,
  SYSTEM_PATTERNS,
  TASK_PATTERNS
} from "./patterns.js";

const CAPACITY_INTEGER_SOURCE = String.raw`\d{1,5}`;
const DECIMAL_CONTINUATION_SOURCE = String.raw`\.\d{1,5}`;
const CAPACITY_NUMBER_SOURCE = String.raw`${CAPACITY_INTEGER_SOURCE}(?:${DECIMAL_CONTINUATION_SOURCE})?`;
const CAPACITY_SEPARATOR_SOURCE = String.raw`[ \t,，:\-–—]{0,8}`;
const CAPACITY_UNIT_SOURCE = String.raw`(?:G(?:i)?B|T(?:i)?B|G|T|gigabytes?|gigs?)`;
const CAPACITY_FIELD_SOURCE = String.raw`(?:\b(?:RAM|VRAM|memory|storage|SSD|HDD|disk|drive)\b|内存|記憶體|显存|顯存|存储|存儲|硬盘|硬碟|固态硬盘|固態硬碟)`;

const CAPACITY_TOKEN = new RegExp(
  String.raw`\b${CAPACITY_NUMBER_SOURCE}${CAPACITY_SEPARATOR_SOURCE}${CAPACITY_UNIT_SOURCE}\b`,
  "iu"
);
const FORBIDDEN_GENERIC_LABEL = new RegExp(
  String.raw`(?:${CAPACITY_FIELD_SOURCE}|\b(?:task|workload|with)\b|任务|任務|用途)`,
  "iu"
);
const TRAILING_PLAIN_NUMBER = new RegExp(
  String.raw`(?:^|[ \t])${CAPACITY_INTEGER_SOURCE}$`,
  "u"
);
const DECIMAL_CONTINUATION = new RegExp(String.raw`^${DECIMAL_CONTINUATION_SOURCE}`, "u");
const ADJACENT_CAPACITY_CONTEXT = new RegExp(
  String.raw`^${CAPACITY_SEPARATOR_SOURCE}(?:${CAPACITY_UNIT_SOURCE}\b|${CAPACITY_FIELD_SOURCE})`,
  "iu"
);
const MAX_CAPACITY_LABEL_GAP = 32;
const MAX_GPU_PROXIMITY_GAP = 24;

function globalRegex(regex) {
  const flags = `${regex.flags.replace(/[gy]/g, "")}g`;
  return new RegExp(regex.source, flags);
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end;
}

function isValidEvidence(pattern, evidence, followingText) {
  if (!pattern.generic) return true;
  if (CAPACITY_TOKEN.test(evidence) || FORBIDDEN_GENERIC_LABEL.test(evidence)) return false;
  if (
    TRAILING_PLAIN_NUMBER.test(evidence)
    && (DECIMAL_CONTINUATION.test(followingText) || ADJACENT_CAPACITY_CONTEXT.test(followingText))
  ) return false;
  return !TASK_PATTERNS.some((taskPattern) => taskPattern.regex.test(evidence));
}

function candidateFromMatch(document, segment, pattern, match) {
  const evidence = pattern.evidenceGroup ? match.groups?.[pattern.evidenceGroup] : match[0];
  if (!evidence) return null;

  const evidenceOffset = pattern.evidenceGroup ? match[0].indexOf(evidence) : 0;
  const localEnd = match.index + evidenceOffset + evidence.length;
  const followingText = segment.text.slice(localEnd, localEnd + 48);
  if (!isValidEvidence(pattern, evidence, followingText)) return null;

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

function collectCapacityLabels(segment) {
  const matches = [];

  for (const [patternIndex, pattern] of CAPACITY_LABEL_PATTERNS.entries()) {
    for (const match of segment.text.matchAll(globalRegex(pattern.regex))) {
      matches.push({
        pattern,
        patternIndex,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  matches.sort((left, right) => (
    right.pattern.specificity - left.pattern.specificity
    || (right.end - right.start) - (left.end - left.start)
    || left.patternIndex - right.patternIndex
    || left.start - right.start
  ));

  const accepted = [];
  for (const match of matches) {
    if (accepted.some((entry) => overlaps(entry, match))) continue;
    accepted.push(match);
  }

  accepted.sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || left.patternIndex - right.patternIndex
  ));
  return accepted;
}

function hasUnsafeDigitCommaPrefix(segment, match, modelCandidates) {
  const amountText = match.groups.amount;
  const numberStart = match.index + match[0].indexOf(amountText);
  const commaIndex = numberStart - 1;
  if (
    commaIndex < 1
    || !/[,，]/u.test(segment.text[commaIndex])
    || !/\d/u.test(segment.text[commaIndex - 1])
  ) {
    return false;
  }

  const globalCommaIndex = segment.start + commaIndex;
  const followsHardwareModel = modelCandidates.some((candidate) => (
    candidate.segmentIndex === segment.index && candidate.end === globalCommaIndex
  ));
  if (followsHardwareModel) return false;

  const precedingClause = segment.text.slice(0, commaIndex).split(/[,，.。!?！？]/u).at(-1);
  const endsWithKnownUnparsedModel = /(?:\bIntel[ \t]+Core[ \t]+i[3579][ \t]*-[ \t]*\d{3,5}[A-Z]\d|\bXeon[ \t]+W-\d{4})$/iu.test(precedingClause);
  return !endsWithKnownUnparsedModel;
}

function collectCapacityAmounts(segment, modelCandidates) {
  const amounts = [];

  for (const [patternIndex, pattern] of CAPACITY_AMOUNT_PATTERNS.entries()) {
    for (const match of segment.text.matchAll(globalRegex(pattern.regex))) {
      if (hasUnsafeDigitCommaPrefix(segment, match, modelCandidates)) continue;

      amounts.push({
        pattern,
        patternIndex,
        value: Number(match.groups.amount) * pattern.multiplier,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  amounts.sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || left.patternIndex - right.patternIndex
  ));
  return amounts.filter((amount, index) => (
    !amounts.slice(0, index).some((earlier) => overlaps(earlier, amount))
  ));
}

function supportsCapacityField(amount, field) {
  return field === "storage" ? amount.pattern.storage : amount.pattern.memory;
}

function collectCapacityClauseBoundaries(segment) {
  const boundaries = [];

  for (const [patternIndex, pattern] of CAPACITY_CLAUSE_PATTERNS.entries()) {
    for (const match of segment.text.matchAll(globalRegex(pattern.regex))) {
      boundaries.push({
        patternIndex,
        start: match.index,
        end: match.index + match[0].length
      });
    }
  }

  boundaries.sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || left.patternIndex - right.patternIndex
  ));
  return boundaries;
}

function capacityClause(segment, amount, boundaries) {
  let start = 0;
  let end = segment.text.length;

  for (const boundary of boundaries) {
    if (boundary.end <= amount.start) {
      start = Math.max(start, boundary.end);
      continue;
    }
    if (boundary.start >= amount.end) {
      end = boundary.start;
      break;
    }
  }

  return { start, end };
}

function localSpanIsInClause(start, end, clause) {
  return start >= clause.start && end <= clause.end;
}

function ownershipOption(segment, amount, label) {
  if (!supportsCapacityField(amount, label.pattern.field)) return null;

  const labelBeforeAmount = label.end <= amount.start;
  const amountBeforeLabel = amount.end <= label.start;
  if (!labelBeforeAmount && !amountBeforeLabel) return null;

  const gapStart = labelBeforeAmount ? label.end : amount.end;
  const gapEnd = labelBeforeAmount ? amount.start : label.start;
  const gap = segment.text.slice(gapStart, gapEnd);
  if (gap.length > MAX_CAPACITY_LABEL_GAP || /\d/u.test(gap)) return null;

  return {
    label,
    gapLength: gap.length,
    amountPosition: labelBeforeAmount ? "after-label" : "before-label"
  };
}

function findOwningLabel(segment, labels, amount) {
  let precedingLabel = null;
  let followingLabel = null;

  for (const label of labels) {
    if (label.end <= amount.start) {
      precedingLabel = label;
      continue;
    }
    if (label.start >= amount.end) {
      followingLabel = label;
      break;
    }
  }

  const options = [precedingLabel, followingLabel]
    .filter(Boolean)
    .map((label) => ownershipOption(segment, amount, label))
    .filter(Boolean)
    .sort((left, right) => (
      left.gapLength - right.gapLength
      || right.label.pattern.specificity - left.label.pattern.specificity
      || left.label.patternIndex - right.label.patternIndex
    ));

  if (
    options.length > 1
    && options[0].gapLength === options[1].gapLength
    && options[0].label.pattern.field !== options[1].label.pattern.field
  ) {
    return null;
  }
  return options[0] ?? null;
}

function storageKind(raw) {
  const match = STORAGE_KIND_PATTERNS.find((pattern) => pattern.regex.test(raw));
  return match?.kind ?? "unknown";
}

function explicitCapacityEntry(document, segment, amount, ownership) {
  const { label, amountPosition } = ownership;
  const localStart = Math.min(label.start, amount.start);
  const localEnd = Math.max(label.end, amount.end);
  const start = segment.start + localStart;
  const end = segment.start + localEnd;
  const raw = document.normalized.slice(start, end);
  if (raw !== segment.text.slice(localStart, localEnd)) return null;

  const candidate = {
    field: label.pattern.field,
    value: amount.value,
    raw,
    segmentIndex: segment.index,
    start,
    end,
    source: `capacity.${label.pattern.field}.${amountPosition}`,
    specificity: label.pattern.specificity,
    confidence: label.pattern.confidence,
    inferred: false,
    amountPosition,
    sourceUnit: amount.pattern.sourceUnit
  };
  if (label.pattern.field === "storage") candidate.storageKind = storageKind(raw);

  return {
    candidate,
    unified: label.pattern.memoryKind === "unified"
  };
}

function proximityOption(segment, amount, gpuModel) {
  const modelStart = gpuModel.start - segment.start;
  const modelEnd = gpuModel.end - segment.start;
  const modelBeforeAmount = modelEnd <= amount.start;
  const amountBeforeModel = amount.end <= modelStart;
  if (!modelBeforeAmount && !amountBeforeModel) return null;

  const gapStart = modelBeforeAmount ? modelEnd : amount.end;
  const gapEnd = modelBeforeAmount ? amount.start : modelStart;
  const gap = segment.text.slice(gapStart, gapEnd);
  if (gap.length > MAX_GPU_PROXIMITY_GAP || /\d/u.test(gap)) return null;

  return {
    gpuModel,
    gapLength: gap.length,
    amountPosition: modelBeforeAmount ? "after-label" : "before-label"
  };
}

function proximityVramEntry(document, segment, clause, labels, amount, gpuModels, hasNoGpu) {
  if (
    hasNoGpu
    || labels.length > 0
    || !["GB", "GiB"].includes(amount.pattern.sourceUnit)
  ) {
    return null;
  }

  const option = gpuModels
    .filter((candidate) => (
      candidate.segmentIndex === segment.index
      && localSpanIsInClause(
        candidate.start - segment.start,
        candidate.end - segment.start,
        clause
      )
    ))
    .map((candidate) => proximityOption(segment, amount, candidate))
    .filter(Boolean)
    .sort((left, right) => (
      left.gapLength - right.gapLength
      || left.gpuModel.start - right.gpuModel.start
    ))[0];
  if (!option) return null;

  const start = Math.min(option.gpuModel.start, segment.start + amount.start);
  const end = Math.max(option.gpuModel.end, segment.start + amount.end);
  const raw = document.normalized.slice(start, end);
  if (!segment.text.includes(raw)) return null;

  return {
    candidate: {
      field: "vram",
      value: amount.value,
      raw,
      segmentIndex: segment.index,
      start,
      end,
      source: "capacity.vram.gpu-proximity",
      specificity: 60,
      confidence: "medium",
      inferred: false,
      amountPosition: option.amountPosition,
      sourceUnit: amount.pattern.sourceUnit
    },
    unified: false
  };
}

function appleUnifiedInference(candidate) {
  return {
    field: "vram",
    value: Math.max(4, Math.floor(candidate.value * 0.75)),
    raw: candidate.raw,
    segmentIndex: candidate.segmentIndex,
    start: candidate.start,
    end: candidate.end,
    source: "capacity.vram.apple-unified-inference",
    specificity: 50,
    confidence: "medium",
    inferred: true,
    amountPosition: candidate.amountPosition,
    sourceUnit: candidate.sourceUnit
  };
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

export function extractCapacityCandidates(document) {
  const cpuCandidates = extractCpuCandidates(document);
  const gpuCandidates = extractGpuCandidates(document);
  const gpuModels = gpuCandidates.filter((candidate) => (
    candidate.field === "gpuModel" && candidate.value !== "No dedicated GPU"
  ));
  const hasNoGpu = gpuCandidates.some((candidate) => (
    candidate.field === "gpuModel" && candidate.value === "No dedicated GPU"
  ));
  const modelCandidates = [
    ...cpuCandidates.filter((candidate) => candidate.field === "cpuModel"),
    ...gpuCandidates.filter((candidate) => candidate.field === "gpuModel")
  ];
  const entries = [];

  for (const segment of document.segments) {
    const segmentLabels = collectCapacityLabels(segment);
    const clauseBoundaries = collectCapacityClauseBoundaries(segment);
    for (const amount of collectCapacityAmounts(segment, modelCandidates)) {
      const clause = capacityClause(segment, amount, clauseBoundaries);
      const labels = segmentLabels.filter((label) => (
        localSpanIsInClause(label.start, label.end, clause)
      ));
      const ownership = findOwningLabel(segment, labels, amount);
      const entry = ownership
        ? explicitCapacityEntry(document, segment, amount, ownership)
        : proximityVramEntry(document, segment, clause, labels, amount, gpuModels, hasNoGpu);
      if (entry) entries.push(entry);
    }
  }

  entries.sort((left, right) => (
    left.candidate.segmentIndex - right.candidate.segmentIndex
    || left.candidate.start - right.candidate.start
    || left.candidate.end - right.candidate.end
  ));

  const hasAppleMSeries = cpuCandidates.some((candidate) => (
    candidate.source === "cpu.apple-m"
  ));
  const hasExplicitVram = entries.some((entry) => entry.candidate.field === "vram");
  const allowAppleInference = hasAppleMSeries && gpuCandidates.length === 0 && !hasExplicitVram;
  const candidates = [];

  for (const entry of entries) {
    candidates.push(entry.candidate);
    if (entry.unified && allowAppleInference) {
      candidates.push(appleUnifiedInference(entry.candidate));
    }
  }
  return candidates;
}

export function extractMemoryCandidates(document) {
  return extractCapacityCandidates(document).filter((candidate) => candidate.field !== "storage");
}

export function extractStorageCandidates(document) {
  return extractCapacityCandidates(document).filter((candidate) => candidate.field === "storage");
}

export function extractCandidates(document) {
  return [
    ...extractSystemCandidates(document),
    ...extractCpuCandidates(document),
    ...extractGpuCandidates(document),
    ...extractCapacityCandidates(document),
    ...extractTaskCandidates(document)
  ];
}
