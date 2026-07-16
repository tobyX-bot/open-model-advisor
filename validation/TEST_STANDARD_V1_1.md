# Model Digger Synthetic User Validation Standard

Version: 1.1
Frozen before production scanner correction: 2026-07-16
Code under test: `codex/v2-liquid-excavation` at `5dd494c`
Oracle fixture: `fixtures/computer_setups_200_v1_1.json`
Oracle fixture SHA-256: `54fe97fdd3e8b742000bd9df4ec79c586e0e16eeaa07f3c61ac99aebefce02b7`

## Purpose

Test Model Digger as 200 synthetic users completing realistic hardware-entry and recommendation journeys. The run uses five stratified folds of 40 users to expose variance and coverage gaps.

Model Digger is deterministic and has no learned parameters. The folds are independent scenario batches, not training/test splits. Results measure robustness, safety, and consistency; they do not estimate real-world predictive accuracy.

## Golden Standard

Accuracy and reliability are the release criteria. Coverage, visual quality, and a high overall average cannot compensate for a wrong scan, unsafe recommendation, inconsistent result, exception, or weak fold.

- **Accuracy** means exact reconstruction of every non-ambiguous expected field plus correct task category, hardware-feasibility classification, and fallback policy.
- **Reliability** means identical results for repeated identical inputs, equivalent results for semantically equivalent supported inputs, no uncaught failures, and no fold below the release standard.
- Any hard-gate failure produces a `Needs revision` verdict.
- “Best model” accuracy is not claimed without an independent expert-labeled ranking or real outcome data. This test validates the deterministic policy and catalog constraints that the product actually implements.

## Oracle V1.1

V1.1 is an oracle-only derivative of `fixtures/computer_setups_200.json`, whose SHA-256 remains `e9e96bf82cde212d1f8d3ea71ac5b6184c138e355eb3a1cee07d921d1064b17b`. It preserves every setup, profile, fold, quota, journey, and policy label.

The erratum removes unsupported GPU identities from four records with no GPU evidence and preserves explicit NVIDIA vendor evidence in five records whose GPU model remains unknown. Every observable expected field has exact source evidence from NFKC-normalized setup text. Every ambiguous field has one `conflict`, `unknown`, or `missing` status and one field-matching issue code.

## Synthetic Audience Assumptions

Each fold must contain:

| Dimension | Per-fold distribution |
| --- | --- |
| Task | 12 chat, 10 coding, 6 image, 6 speech, 6 embeddings |
| OS | 18 Windows, 12 macOS, 10 Linux |
| Device | 18 laptop, 14 desktop, 5 workstation, 3 server |
| Hardware tier | 10 entry, 16 mainstream, 10 performance, 4 extreme |
| Language style | 22 English, 9 Simplified Chinese, 5 Traditional Chinese, 4 mixed |
| Text quality | 24 clean, 10 messy but unambiguous, 6 adversarial |
| Entry journey | 32 paste, 5 manual, 3 preset then edit |
| Deployment | 10 local only, 22 local first, 8 cloud acceptable |

These proportions are product assumptions, not observed traffic. They must be replaced with real usage evidence when ethical, privacy-preserving analytics or structured usability sessions exist.

## Five-fold Protocol

1. Freeze this standard, the code commit, seed, and dataset before calculating results.
2. Use seed `20260716` and exactly 40 records in each fold.
3. Evaluate each fold independently with identical rules.
4. Report per-fold counts, rates, macro mean, minimum, maximum, and standard deviation.
5. Do not tune thresholds or exclude failures after seeing results.
6. If production code changes, invalidate the run and rerun all five folds from the start.

## Hard Release Gates

### G1. Execution reliability: 100%

- All 200 journeys complete without an uncaught exception, blank application state, or catalog-load failure.
- Repeating the same parser and recommendation input must produce an identical normalized profile, ranking, score, labels, and fallback decision.
- Every fold must score 40/40.

### G2. Scanner exactness on non-ambiguous text: 100%

- Every explicitly detectable field must exactly match the independent expected value.
- No detected field may contradict the source profile.
- Legitimate declared inferences are allowed but cannot contradict the profile.
- Report field-level precision, recall, and exact-record accuracy.
- Every non-ambiguous record in every fold must pass; macro averaging cannot hide a failure.

### G3. Ambiguous and adversarial safety: 100%

- Every record marked `shouldWarn` must produce a warning.
- Contradictory RAM/VRAM text must never silently conflate system RAM and GPU memory.
- Unknown or omitted hardware must not crash or be presented as a confident exact identification.
- Ambiguous values are scored on safe handling, not on choosing an arbitrary ground truth.
- Ambiguous `conflict`, `unknown`, or `missing` fields may not appear in resolved fields.
- An issue code must correspond to the ambiguous field.

### G4. Journey integrity: 100%

- Scan results require explicit apply and hardware confirmation before recommendations unlock.
- Applying a partial scan must not silently confirm inherited example hardware.
- A detected task must not overwrite a task the user already selected.
- Invalid required numeric fields must block confirmation and scoring.
- Current confirmation, not historical confirmation, gates recommendations.
- New scans invalidate pending results immediately.

### G5. Recommendation category correctness: 100%

- Every returned recommendation must support the selected task category.
- All five supported categories must produce results for at least one feasible profile in every fold.

### G6. Hardware-safety labeling: 100%

- A model below minimum RAM, VRAM, or storage cannot be labeled `strong` or `usable`.
- A GPU-required model on an unsupported or absent GPU cannot be labeled `strong` or `usable`.
- When no practical local fit exists, the journey must show a limitation state rather than imply a good local fit.

### G7. Local-first and fallback policy: 100%

- Local-only users must never receive hosted fallback guidance.
- Hosted fallback may appear only when cloud use is allowed.
- Hosted fallback must remain secondary and clearly labeled as fallback.

### G8. Feasible-profile coverage: 100%

- Every profile with at least one catalog-compatible local model must receive at least one local recommendation.
- Every recommendation must include a concrete starter family, runtime, fit explanation, avoid note, license note, source link, and review date.

### G9. Equivalent-input consistency: 100%

- Paired setups representing the same machine and task in different ordering or supported language must resolve to the same normalized hardware profile and top starter family.
- Score each detected applied profile independently when comparing the top starter family.

### G10. Fold stability: no hidden weak fold

- Gates G1-G9 must pass in every individual fold.
- The required hard-gate standard deviation is therefore zero percentage points.

## Diagnostic Metrics

These do not replace the hard gates:

- Detection rate and confidence by field, language style, OS, device, GPU vendor, and text quality.
- Failure concentration by user journey and hardware tier.
- Top-family distribution by task and hardware tier.
- Percentage of weak/no-fit profiles and hosted-fallback activations.
- Recommendation changes within equivalent-input pairs.

## Verdict

- **Pass:** all hard gates pass in all five folds.
- **Needs revision:** any hard gate fails, even if the overall average is high.
- **Invalid run:** dataset quotas, independent labels, seed, or frozen-code requirement are violated.

Passing this synthetic test does not prove real-world accuracy. It establishes that the deterministic rules satisfy the frozen test population; real-user usability sessions remain necessary before making reliability claims.
