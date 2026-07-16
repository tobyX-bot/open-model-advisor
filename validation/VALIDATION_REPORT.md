# Model Digger V2: 200-User Validation Report

Date: 2026-07-16
Overall assessment: **NEEDS REVISION - DO NOT PUBLISH V2**

## Release Decision

V2 does not meet the frozen accuracy and reliability standard. The recommendation engine and corrected browser journeys were stable, but the automatic setup scanner failed three hard gates:

- Exact scan reconstruction: 98/175 unambiguous setup descriptions (56.00%). Required: 100% in every fold.
- Adversarial/ambiguous safety: 3/30 setups (10.00%). Required: 100% in every fold.
- Equivalent-input consistency: 15/20 pairs (75.00%). Required: 100% in every fold.

Across G2 and G3, 99 of the 200 synthetic records produced at least one scanner accuracy or warning failure. The module suite deliberately scanner-tested every description even when that record's assigned browser journey was manual or preset-edit. Among the 160 actual paste journeys, 74 encountered a G2 or G3 failure: 83/139 unambiguous paste cases were exact (59.71%), and 3/25 adversarial paste cases were handled safely (12.00%).

The raw result contains 109 gate-failure events: 77 G2 failures, 27 G3 failures, and 5 G9 pair failures. These events are not 109 distinct users.

The V2 branch should not be merged into the public GitHub Pages release until the scanner is repaired and the unchanged five-fold suite passes all hard gates.

## Problems Found

### 1. Blocker: scanner exact-record accuracy is 56%, not 100%

One incorrect hardware field can change feasibility scoring, so field-level precision alone is not an adequate release measure. Only 98 of 175 non-ambiguous setup descriptions were reconstructed exactly. This module test covers all fixture descriptions; the actual paste-journey subset was 83/139 exact.

Field mismatches across the 77 failed records:

| Field | Mismatches |
| --- | ---: |
| GPU model | 40 |
| Storage | 28 |
| VRAM | 14 |
| CPU model | 9 |
| RAM | 8 |

Scanner field totals were 1,305 true positives, 78 false positives, and 99 false negatives: 94.36% precision and 92.95% recall. Those percentages hide the user-level problem: exact-record accuracy was only 56.00%.

### 2. Blocker: unsafe inputs usually do not produce the required warning

Only 3 of 30 adversarial records were handled safely. Results by case type:

| Adversarial case | Failed | Total |
| --- | ---: | ---: |
| Unknown GPU | 5 | 5 |
| Unknown CPU | 5 | 5 |
| Intel Core Ultra | 5 | 5 |
| Omitted memory/storage | 5 | 5 |
| Contradictory memory, variant A | 4 | 5 |
| Contradictory memory, variant B | 3 | 5 |

Examples:

- `NVIDIA MysteryGPU Z-10 with 8GB VRAM` preserved the memory number but omitted the GPU identity without warning.
- `NovaCore NX-17H` was omitted without a low-confidence warning.
- A setup containing both `RAM 32GB` and an old conflicting note saying `4GB RAM` silently selected 4GB.
- A setup saying RAM, VRAM, and storage were not listed produced partial fields without the required incompleteness warning.

This is a safety and trust problem, not merely a formatting mismatch. The scanner can appear confident while material information is missing or contradictory.

### 3. Blocker: CPU-only text can invent VRAM from storage

In repeated English CPU-only cases, `no dedicated GPU` correctly set VRAM to 0 and a later nearby-number match overwrote it. For a machine ending in `128GB SSD`, the scanner returned 28GB VRAM. Nine records showed the `0 -> 28` failure and five showed `0 -> 8`.

This creates impossible hardware and can overstate local model feasibility. A confirmed no-GPU result must be terminal for dedicated VRAM unless the source explicitly declares shared/unified memory.

### 4. High: storage parsing crosses field and line boundaries

In multiline specification dumps such as:

```text
RAM: 64GB
SSD free: 1024GB
```

the scanner frequently returned 64GB storage instead of 1024GB. The recurring wrong storage values were 64GB, 32GB, and 16GB, showing that the parser is taking the preceding RAM value when it sees a later storage label.

The parser needs label-local or line-local extraction and candidate conflict resolution rather than a first broad regular-expression match.

### 5. High: exact GPU names are truncated or contaminated

The scanner dropped `Laptop GPU` from NVIDIA models, for example returning `NVIDIA RTX 4060` for `NVIDIA RTX 4060 Laptop GPU`. Intel matching was too greedy in the other direction, returning values such as `Intel Arc A750 with 8GB VRAM` instead of `Intel Arc A750`.

The affected names may represent different power envelopes or product classes. Exact model preservation is therefore part of recommendation correctness, not cosmetic normalization.

### 6. High: common and emerging CPU formats are unsupported

All five `Intel Core Ultra 7 155H` cases missed the CPU model. Xeon names lost their numeric SKU, and AMD EPYC names sometimes lost the `AMD` prefix. These misses reduce CPU confidence and can push scoring onto broad memory-only fallback rules.

### 7. High: natural-language memory wording is not robust

Phrases such as `about 8 gigs of memory` were not parsed as RAM. In the same records, wording such as `128GB free on the SSD` could also be missed. Messy but unambiguous text failed 35/50 times (70%), while even clean text failed 37/120 times (30.83%).

### 8. High: semantically equivalent English and Chinese inputs normalize differently

Only 15 of 20 equivalent-input pairs produced the same normalized scan. Three folds differed because English CPU-only text invented VRAM while the Chinese equivalent retained 0GB. Two folds differed because the English Intel GPU name included `with 2GB VRAM` while the Chinese version returned the clean model name.

The harness's recorded top-family comparison used each pair's identical ground-truth profile rather than the two detected scans. It therefore does not validate end-to-end recommendation consistency after scanning. The normalized hardware failure is proven; the top-starter subcriterion remains unverified and must be corrected in the next harness revision.

### 9. Medium: error rates vary sharply by scenario and hardware segment

G2 failure rates among unambiguous records were:

| Segment | Failed / Total | Failure rate |
| --- | ---: | ---: |
| Clean text | 37 / 120 | 30.83% |
| Messy text | 35 / 50 | 70.00% |
| Non-ambiguous adversarial text | 5 / 5 | 100.00% |
| Entry hardware | 28 / 43 | 65.12% |
| Mainstream hardware | 24 / 71 | 33.80% |
| Performance hardware | 13 / 43 | 30.23% |
| Extreme hardware | 12 / 18 | 66.67% |

English records failed 53/99 (53.54%), Simplified Chinese 11/36 (30.56%), Traditional Chinese 7/22 (31.82%), and mixed-language records 6/18 (33.33%). These are diagnostic rates for this fixed synthetic mix, not evidence that one language is intrinsically better supported.

### 10. Test limitation: browser completion demonstrates recovery, not scan accuracy

All 200 real-browser journeys completed, but the harness corrected the detected setup to the known profile before testing confirmation and recommendations. This models a careful user who notices and repairs mistakes. It does not prove that an ordinary user will detect a wrong scan.

The result supports downstream UI stability and manual recoverability only. It must not be presented as 100% end-to-end automatic accuracy. A separate task-preservation interaction was added once per fold and passed 5/5: scanning and applying text suggesting a different task did not replace a task the user had already selected.

## Five-Fold Results

| Gate | Fold 1 | Fold 2 | Fold 3 | Fold 4 | Fold 5 | Macro mean | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| G1 deterministic execution | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 100% | Pass |
| G2 exact scanner reconstruction | 18/35 | 20/35 | 21/35 | 19/35 | 20/35 | 56% | **Fail** |
| G3 adversarial safety | 1/6 | 1/6 | 0/6 | 1/6 | 0/6 | 10% | **Fail** |
| G4 browser journey integrity | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 100% | Pass |
| G5 recommendation category | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 100% | Pass |
| G6 hardware-safety labeling | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 100% | Pass |
| G7 local/cloud fallback policy | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 100% | Pass |
| G8 feasible coverage/content | 40/40 | 40/40 | 40/40 | 40/40 | 40/40 | 100% | Pass |
| G9 equivalent-input consistency | 3/4 | 3/4 | 3/4 | 3/4 | 3/4 | 75% | **Fail; top subcheck incomplete** |

G2 fold accuracy ranged from 51.43% to 60.00%, with a standard deviation of 2.91 percentage points. G3 ranged from 0% to 16.67%, with a standard deviation of 8.16 points. G10 therefore fails because hard gates did not pass in every fold.

## What Passed

- The deterministic module run completed all 200 records without an uncaught failure.
- The real Google Chrome run completed all 200 corrected journeys with no browser failure.
- Invalid required numeric input blocked progress in each fold.
- A previously selected task survived scanning and applying a conflicting detected task in one explicit interaction per fold (5/5).
- Recommendation category correctness was 200/200 across all five V1 categories.
- Hardware feasibility labels, local-first behavior, cloud fallback policy, and recommendation content were 200/200 under the catalog-based test oracle.
- Local-only profiles never received hosted fallback; cloud fallback remained secondary when permitted.
- The frozen fixture passed its independent population and realism audit.

These passes validate deterministic product rules, not a claim that the recommended starter is the objectively best model. No independent expert ranking or real outcome dataset was available for that claim.

## Methodology And Reproducibility

The application has no trained component, so ordinary machine-learning cross-validation is not applicable. The test used five independent, stratified scenario folds of 40 synthetic users each. No training or threshold tuning occurred between folds. The module suite evaluated the scanner on all descriptions for broad coverage; the browser suite followed each record's assigned paste, manual, or preset-edit journey.

- Production code under test: `5dd494c`
- Frozen fixture commit: `736f9cf8412c6300161056eea7650f04305f12cd`
- Seed: `20260716`
- Fixture SHA-256: `e9e96bf82cde212d1f8d3ea71ac5b6184c138e355eb3a1cee07d921d1064b17b`
- Module results SHA-256: `a134c2913d760ae389c9c5e92d9269ba6815d5589a28c40b1cccaeac375bba8a`
- Browser results SHA-256: `2463d3b8a57f15d40db094c4f886deed8b767db3e6c505e2e2138a4530f5d238`

Evidence:

- Test standard: [`TEST_STANDARD.md`](TEST_STANDARD.md)
- Frozen users: [`fixtures/computer_setups_200.json`](fixtures/computer_setups_200.json)
- Every module failure and observed value: [`results/module-results.json`](results/module-results.json)
- Every browser journey result: [`results/browser-results.json`](results/browser-results.json)

## Required Repair Order

1. Prevent later weak matches from overwriting hard facts such as `no dedicated GPU -> 0GB VRAM`.
2. Replace cross-line memory matching with label-local candidates that retain source spans, units, and confidence.
3. Add explicit conflict handling for repeated RAM/VRAM/storage values; warn and require review instead of silently choosing one.
4. Preserve exact GPU product suffixes and stop GPU names before memory descriptors.
5. Add Intel Core Ultra, complete Xeon/EPYC, and natural-language memory patterns in both languages.
6. Emit visible warnings for unknown CPU/GPU, omitted required capacity, and unresolved conflicts.
7. Add direct regression fixtures for every failure signature in the raw report.
8. Make the G9 top-starter comparison score each detected normalized profile rather than the shared ground-truth profile.
9. Rerun the unchanged 200-user, five-fold suite after production changes. Do not alter expected labels to accommodate parser behavior.
10. Require 100% in every fold before merging V2, then run human usability sessions to test whether users notice and understand scanner uncertainty.

## Final Conclusion

The downstream recommendation policy is internally consistent against its current catalog rules, and the interface is recoverable when a user manually corrects the scan. The central V2 promise, however, is automatic setup recognition. At 56% exact reconstruction and 10% adversarial safety, that promise is not reliable enough for a public release.
