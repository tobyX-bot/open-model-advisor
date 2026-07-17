import {
  CAPACITY_AMOUNT_PATTERNS,
  CAPACITY_CLAUSE_PATTERNS,
  CAPACITY_DISQUALIFIER_PATTERNS,
  CAPACITY_LABEL_PATTERNS,
  CPU_MODEL_PATTERNS,
  DEDICATED_GPU_EVIDENCE_PATTERNS,
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
const COPULAR_APPLE_M_SERIES = /^(?:is|was)[ \t]+M[1-4](?:[ \t]*(?:Pro|Max|Ultra))?$/iu;
const TRAILING_PLAIN_NUMBER = new RegExp(
  String.raw`(?:^|[ \t])${CAPACITY_INTEGER_SOURCE}$`,
  "u"
);
const DECIMAL_CONTINUATION = new RegExp(String.raw`^${DECIMAL_CONTINUATION_SOURCE}`, "u");
const ADJACENT_CAPACITY_CONTEXT = new RegExp(
  String.raw`^${CAPACITY_SEPARATOR_SOURCE}(?:${CAPACITY_UNIT_SOURCE}\b|${CAPACITY_FIELD_SOURCE})`,
  "iu"
);
const TRAILING_CAPACITY_AMOUNT = new RegExp(
  String.raw`(?<![A-Z0-9.])${CAPACITY_INTEGER_SOURCE}[ \t-]*${CAPACITY_UNIT_SOURCE}[ \t]*$`,
  "iu"
);
const MAX_CAPACITY_LABEL_GAP = 32;
const MAX_GPU_PROXIMITY_GAP = 24;
const APPLE_PLATFORM_CONTEXT = /\b(?:macOS|MacBook|Mac[ \t]+mini|Mac[ \t]+Studio|iMac|Apple[ \t]+(?:silicon|GPU))\b|苹果电脑|蘋果電腦|苹果系统|蘋果系統/iu;
const NON_APPLE_M_SERIES_PREFIX = /\b(?:Intel(?:[ \t]+Core)?|Core)[ \t]*$/iu;
const STRONG_APPLE_M_SERIES_PREFIX = /(?:(?:\bMacBook(?:[ \t]+(?:Air|Pro))?|\bMac[ \t]+(?:mini|Studio|Pro)|\biMac)(?:[ \t]+(?:is[ \t]+)?powered[ \t]+by)?|\b(?:CPU|processor|chip|SoC)(?:[ \t]+(?:is|was))?|(?:处理器|處理器|芯片|晶片)(?:[ \t]+(?:是|为|為))?)[ \t:,-]*$/iu;
const STORAGE_M_SERIES_PREFIX = /\b(?:NVMe|SSD|storage|disk|drive)[ \t:-]*$/iu;
const STORAGE_M_SERIES_SUFFIX = /^[ \t:-]*(?:NVMe|SSD|storage|disk|drive)\b/iu;
const TRANSFER_RATE_SUFFIX = /^(?:[ \t]+(?:(?:\/[ \t]*|per[ \t]+)(?:(?:s|secs?|seconds?)\b|秒)|(?:each|a)[ \t]+seconds?\b)|[ \t]*每[ \t]*秒)/iu;
const TRANSFER_RATE_INVENTORY = /^[ \t]+(?:drive|SSD|HDD|disk|storage)\b/iu;
const TRANSFER_RATE_PREFIX = /(?:\b(?:speed|throughput|bandwidth|rate)\b|带宽|帶寬|速度|吞吐量)[ \t:,-]*$/iu;

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
  if (pattern.field === "cpuModel" && COPULAR_APPLE_M_SERIES.test(evidence)) return false;
  if (
    TRAILING_PLAIN_NUMBER.test(evidence)
    && (DECIMAL_CONTINUATION.test(followingText) || ADJACENT_CAPACITY_CONTEXT.test(followingText))
  ) return false;
  return !TASK_PATTERNS.some((taskPattern) => taskPattern.regex.test(evidence));
}

function candidateFromMatch(document, segment, pattern, match) {
  if (pattern.requiresAppleContext) {
    const precedingText = segment.text.slice(Math.max(0, match.index - 32), match.index);
    const followingText = segment.text.slice(match.index + match[0].length, match.index + match[0].length + 32);
    const hasStrongAppleEvidence = (
      Boolean(match.groups?.suffix)
      || STRONG_APPLE_M_SERIES_PREFIX.test(precedingText)
    );
    const hasStorageContext = (
      STORAGE_M_SERIES_PREFIX.test(precedingText)
      || STORAGE_M_SERIES_SUFFIX.test(followingText)
    );
    if (
      !APPLE_PLATFORM_CONTEXT.test(document.normalized)
      || NON_APPLE_M_SERIES_PREFIX.test(precedingText)
      || (
        pattern.rejectsStorageContext
        && hasStorageContext
        && !hasStrongAppleEvidence
      )
    ) return null;
  }

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

function collectLocalPatternMatches(segment, patterns) {
  const matches = [];

  for (const [patternIndex, pattern] of patterns.entries()) {
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
    left.start - right.start
    || left.end - right.end
    || left.patternIndex - right.patternIndex
  ));
  return matches;
}

function capacityNumberStart(match) {
  return match.index + match[0].indexOf(match.groups.amount);
}

function hasUnsafeSignPrefix(segment, match, labels) {
  const numberStart = capacityNumberStart(match);
  let signIndex = numberStart - 1;
  while (signIndex >= 0 && /[ \t]/u.test(segment.text[signIndex])) signIndex -= 1;

  const sign = segment.text[signIndex];
  if (!/[+\-−±]/u.test(sign ?? "")) return false;
  if (sign === "+") {
    return !TRAILING_CAPACITY_AMOUNT.test(segment.text.slice(0, signIndex));
  }
  if (sign !== "-") return true;

  return !labels.some((label) => (
    label.end <= signIndex
    && /^[ \t]*-[ \t]*$/u.test(segment.text.slice(label.end, numberStart))
  ));
}

function hasTransferRateSuffix(document, segment, match) {
  const globalEnd = segment.start + match.index + match[0].length;
  const followingText = document.normalized.slice(globalEnd, globalEnd + 32);
  const rateMatch = TRANSFER_RATE_SUFFIX.exec(followingText);
  if (!rateMatch) return false;
  if (!TRANSFER_RATE_INVENTORY.test(followingText.slice(rateMatch[0].length))) return true;

  const precedingText = segment.text.slice(Math.max(0, match.index - 32), match.index);
  return TRANSFER_RATE_PREFIX.test(precedingText);
}

function hasUnsafeDigitCommaPrefix(segment, match, modelCandidates) {
  const numberStart = capacityNumberStart(match);
  let separatorStart = numberStart;
  let sawComma = false;

  while (separatorStart > 0) {
    const character = segment.text[separatorStart - 1];
    if (/[ \t]/u.test(character)) {
      separatorStart -= 1;
      continue;
    }
    if (/[,，]/u.test(character)) {
      sawComma = true;
      separatorStart -= 1;
      continue;
    }
    break;
  }

  if (
    !sawComma
    || separatorStart < 1
    || !/\d/u.test(segment.text[separatorStart - 1])
  ) {
    return false;
  }

  const separatorText = segment.text.slice(separatorStart, numberStart);
  const commaCount = separatorText.match(/[,，]/gu)?.length ?? 0;
  if (commaCount !== 1) return true;

  const globalCommaIndex = segment.start + separatorStart;
  const followsHardwareModel = modelCandidates.some((candidate) => (
    candidate.segmentIndex === segment.index && candidate.end === globalCommaIndex
  ));
  if (followsHardwareModel) return false;

  const precedingClause = segment.text.slice(0, separatorStart).split(/[,，.。!?！？]/u).at(-1);
  const endsWithKnownUnparsedModel = /(?:\bIntel[ \t]+Core[ \t]+i[3579][ \t]*-[ \t]*\d{3,5}[A-Z]\d|\bXeon[ \t]+W-\d{4})$/iu.test(precedingClause);
  return !endsWithKnownUnparsedModel;
}

function collectCapacityAmounts(document, segment, modelCandidates, labels) {
  const amounts = [];

  for (const [patternIndex, pattern] of CAPACITY_AMOUNT_PATTERNS.entries()) {
    for (const match of segment.text.matchAll(globalRegex(pattern.regex))) {
      if (
        hasUnsafeSignPrefix(segment, match, labels)
        || hasTransferRateSuffix(document, segment, match)
        || hasUnsafeDigitCommaPrefix(segment, match, modelCandidates)
      ) continue;

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

function hasAttachedDisqualifier(segment, clause, disqualifiers, amount, ownership) {
  const localStart = ownership
    ? Math.min(ownership.label.start, amount.start)
    : amount.start;
  const localEnd = ownership
    ? Math.max(ownership.label.end, amount.end)
    : amount.end;

  return disqualifiers.some((match) => {
    if (match.pattern.requireAmountAdjacency) {
      if (!localSpanIsInClause(match.start, match.end, clause)) return false;
      if (match.end > amount.start) return false;
      return /^[ \t:()（）-]*$/u.test(segment.text.slice(match.end, amount.start));
    }

    if (
      match.start < localEnd
      && match.end > localStart
      && localSpanIsInClause(match.start, match.end, clause)
    ) {
      return true;
    }

    if (match.end <= localStart) {
      if (!localSpanIsInClause(match.start, match.end, clause)) return false;
      return /^[ \t:()（）-]*$/u.test(segment.text.slice(match.end, localStart));
    }

    if (match.start >= localEnd && match.pattern.allowAfterCapacity) {
      const gap = segment.text.slice(localEnd, match.start);
      if (match.pattern.requireAdjacentAfterCapacity && gap.length > 0) return false;
      return /^[ \t:()（）-]*$/u.test(gap);
    }
    return false;
  });
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

function labelHasAmountInPosition(segment, amounts, label, amountPosition) {
  return amounts.some((amount) => (
    ownershipOption(segment, amount, label)?.amountPosition === amountPosition
  ));
}

function findCapacityOwnership(segment, labels, amounts, amount) {
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

  const precedingOption = precedingLabel
    ? ownershipOption(segment, amount, precedingLabel)
    : null;
  const followingOption = followingLabel
    ? ownershipOption(segment, amount, followingLabel)
    : null;

  if (precedingOption && followingOption) {
    const amountBeforeList = labelHasAmountInPosition(
      segment,
      amounts,
      precedingLabel,
      "before-label"
    );
    const labelBeforeList = labelHasAmountInPosition(
      segment,
      amounts,
      followingLabel,
      "after-label"
    );

    if (amountBeforeList !== labelBeforeList) {
      return {
        status: "owned",
        ownership: amountBeforeList ? followingOption : precedingOption
      };
    }
  }

  const options = [precedingOption, followingOption]
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
    return { status: "ambiguous", ownership: null };
  }
  return options[0]
    ? { status: "owned", ownership: options[0] }
    : { status: "unowned", ownership: null };
}

function collectStorageQualifiers(segment) {
  return collectLocalPatternMatches(segment, STORAGE_KIND_PATTERNS);
}

function storageEvidence(segment, clause, qualifiers, localStart, localEnd) {
  const options = qualifiers
    .filter((qualifier) => localSpanIsInClause(qualifier.start, qualifier.end, clause))
    .map((qualifier) => {
      let gap = "";
      if (qualifier.end <= localStart) gap = segment.text.slice(qualifier.end, localStart);
      else if (qualifier.start >= localEnd) gap = segment.text.slice(localEnd, qualifier.start);
      if (!/^[ \t:]*$/u.test(gap)) return null;

      return { qualifier, distance: gap.length };
    })
    .filter(Boolean)
    .sort((left, right) => (
      left.distance - right.distance
      || left.qualifier.patternIndex - right.qualifier.patternIndex
      || left.qualifier.start - right.qualifier.start
    ));
  const qualifier = options[0]?.qualifier;

  return {
    localStart: qualifier ? Math.min(localStart, qualifier.start) : localStart,
    localEnd: qualifier ? Math.max(localEnd, qualifier.end) : localEnd,
    kind: qualifier?.pattern.kind ?? "unknown"
  };
}

function explicitCapacityEntry(document, segment, clause, qualifiers, amount, ownership) {
  const { label, amountPosition } = ownership;
  let localStart = Math.min(label.start, amount.start);
  let localEnd = Math.max(label.end, amount.end);
  let kind = "unknown";
  if (label.pattern.field === "storage") {
    const evidence = storageEvidence(segment, clause, qualifiers, localStart, localEnd);
    localStart = evidence.localStart;
    localEnd = evidence.localEnd;
    kind = evidence.kind;
  }
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
  if (label.pattern.field === "storage") candidate.storageKind = kind;

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

function proximityVramEntry(document, segment, clause, amount, gpuModels, hasNoGpu) {
  if (
    hasNoGpu
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

function isDedicatedGpuModel(candidate) {
  return GPU_MODEL_PATTERNS.some((pattern) => (
    pattern.id === candidate.source && pattern.dedicated === true
  ));
}

export function extractCapacityCandidates(document) {
  const cpuCandidates = extractCpuCandidates(document);
  const gpuCandidates = extractGpuCandidates(document);
  const gpuModels = gpuCandidates.filter((candidate) => (
    candidate.field === "gpuModel" && candidate.value !== "No dedicated GPU"
  ));
  const dedicatedGpuModels = gpuModels.filter(isDedicatedGpuModel);
  const hasNoGpu = gpuCandidates.some((candidate) => (
    candidate.field === "gpuModel" && candidate.value === "No dedicated GPU"
  ));
  const modelCandidates = [
    ...cpuCandidates.filter((candidate) => candidate.field === "cpuModel"),
    ...gpuCandidates.filter((candidate) => candidate.field === "gpuModel")
  ];
  const entries = [];
  let hasExplicitVramEvidence = false;

  for (const segment of document.segments) {
    const segmentLabels = collectCapacityLabels(segment);
    const disqualifiers = collectLocalPatternMatches(segment, CAPACITY_DISQUALIFIER_PATTERNS);
    const storageQualifiers = collectStorageQualifiers(segment);
    const clauseBoundaries = collectCapacityClauseBoundaries(segment);
    if (segmentLabels.some((label) => label.pattern.field === "vram")) {
      hasExplicitVramEvidence = true;
    }

    const segmentAmounts = collectCapacityAmounts(
      document,
      segment,
      modelCandidates,
      segmentLabels
    );
    for (const amount of segmentAmounts) {
      const clause = capacityClause(segment, amount, clauseBoundaries);
      const labels = segmentLabels.filter((label) => (
        localSpanIsInClause(label.start, label.end, clause)
      ));
      const amounts = segmentAmounts.filter((candidate) => (
        localSpanIsInClause(candidate.start, candidate.end, clause)
      ));
      const ownership = findCapacityOwnership(segment, labels, amounts, amount);
      if (ownership.status === "ambiguous") continue;
      if (hasAttachedDisqualifier(
        segment,
        clause,
        disqualifiers,
        amount,
        ownership.ownership
      )) continue;

      let entry = null;
      if (ownership.status === "owned") {
        entry = explicitCapacityEntry(
          document,
          segment,
          clause,
          storageQualifiers,
          amount,
          ownership.ownership
        );
      } else if (ownership.status === "unowned") {
        entry = proximityVramEntry(
          document,
          segment,
          clause,
          amount,
          dedicatedGpuModels,
          hasNoGpu
        );
      }
      if (entry) entries.push(entry);
    }
  }

  entries.sort((left, right) => (
    left.candidate.segmentIndex - right.candidate.segmentIndex
    || left.candidate.start - right.candidate.start
    || left.candidate.end - right.candidate.end
  ));

  const hasAppleMSeries = cpuCandidates.some((candidate) => (
    candidate.source.startsWith("cpu.apple-m")
  ));
  const hasExplicitVram = hasExplicitVramEvidence || entries.some((entry) => (
    entry.candidate.field === "vram"
  ));
  const hasDedicatedGpuModel = dedicatedGpuModels.length > 0;
  const hasDedicatedGpu = hasDedicatedGpuModel || document.segments.some((segment) => (
    DEDICATED_GPU_EVIDENCE_PATTERNS.some((pattern) => pattern.regex.test(segment.text))
  ));
  const allowAppleInference = (
    hasAppleMSeries
    && !hasNoGpu
    && !hasDedicatedGpu
    && !hasExplicitVram
  );
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
