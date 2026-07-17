# Porcelain Suspension

Porcelain Suspension treats information as a sequence of pale working planes held in still air. Form is quiet, exact, and visibly ordered: each surface advances by a measured offset, while protected negative space lets the eye understand which plane is raw, active, and resolved. The composition must feel meticulously crafted, as if every edge and interval survived countless refinements by a designer at the top of the field.

Space communicates before decoration. Planes never tilt or perform; they suspend. Their stagger, overlap, and shadow falloff create depth without perspective tricks, while empty margins absorb every overlap so content remains untouched. Alignment is master-level and unforgiving: text, controls, focus rings, and status labels occupy stable functional zones, never the theatrical edges where materials cross.

Light reveals material through contrast between solid warm stone and increasingly opaque white glass. Lower glass admits more of the underlay, middle glass clarifies evidence, and the foreground approaches porcelain white. Fine white edge highlights catch the implied light source; disciplined warm shadows release each plane from the one beneath it. This must look painstakingly calibrated, not filtered, with no gradients, bubbles, scenery, or atmospheric effects.

Color is sparse enough to behave like a signal system. Graphite anchors action and selection. Tangerine appears only when scanning, focusing, or resolving uncertainty. Verified green remains separate and restrained. The limited palette requires expert chromatic control: every neutral, hairline, and semantic state is tuned against the lightest surfaces rather than relying on spectacle.

Typography is integrated into the material architecture. SF/system sans keeps the product calm and precise; monospace marks only exact machine facts. Copy stays literal and essential, with the fixed two-line Mandarin headline functioning as a visual cadence rather than a marketing gesture. The hierarchy should feel labored over with the care of a master instrument maker, even when the interface is dense.

Motion is rare and consequential. The shovel sweeps once through the source, extracted facts rise, and the recommendation settles; nothing parallax-scrolls or rotates in space. Reduced motion preserves every state without travel. The finished screenshots are the visual canvases for this movement, but the functional HTML remains its most complete expression.

## Material Levels

1. **Raw input / lower-opacity glass:** `rgba(255,255,255,0.52)` over `#d9d1ca`. It keeps the source visible while feeling closest to unprocessed material.
2. **Detected setup / medium-opacity glass:** `rgba(255,255,255,0.78)`. The evidence becomes clearer, while the active inspector retains a smaller permitted glass treatment.
3. **Recommendation / high-opacity glass:** `rgba(255,255,255,0.93)` with the strongest soft elevation. It reads as the resolved foreground without becoming an opaque card.

The page is solid mineral white (`#eeeae6`); the stage underlay is solid warm stone (`#d9d1ca`). Nested evidence rows, textarea, source choices, segmented controls, editor fields, and buttons stay crisp and do not receive backdrop blur. Browsers without backdrop-filter use opaque `#ede8e4`, `#f7f4f1`, and `#fdfcfb` fallbacks for the three major levels.

## Suspension System

- **Elevation 1 / raw input:** the baseline plane uses `--elevation-1`, the shortest and lightest falloff, plus white top and leading-edge highlights.
- **Elevation 2 / detected setup:** desktop position advances 52px vertically and overlaps the prior plane by 16px only inside protected edge padding. `--elevation-2` extends farther and slightly darker.
- **Elevation 3 / recommendation:** desktop position advances 96px from the baseline and another protected 16px horizontally. `--elevation-3` has the clearest two-stage falloff.
- **Mobile suspension:** the three planes use distinct 6-18px side offsets, reduced negative vertical margins, and the same ordered shadow strengths.
- No plane uses rotation, perspective, parallax, or content-covering overlap. Interactive content and its 3px focus allowance remain outside every overlap zone.

## Contrast Tokens

Contrast values use sRGB calculations against the lowest-opacity composite (`#ede9e6`), which is the most demanding major surface.

| Token | Value | Role | Minimum contrast |
| --- | --- | --- | ---: |
| `--ink` | `#1c1a19` | Headlines and primary text | 14.37:1 |
| `--ink-2` | `#403b37` | Body and guidance text | 9.16:1 |
| `--ink-3` | `#5f5751` | Secondary labels and metadata | 5.86:1 |
| `--review` | `#9a3d0c` | Unresolved conflict and warning | 5.71:1 |
| `--verified` | `#2f6956` | Verified and applied state | 5.31:1 |
| White on `--morandi-900` | `#ffffff` on `#1d1b19` | Primary and selected controls | 17.17:1 |

Hairlines are structural and are not used as the only carrier of text or state. Focus uses a 3px tangerine outline plus shape and position; status always includes explicit copy and icons.

## Depth And Interaction Model

- The three planes keep their staggered desktop offsets and controlled mobile overlap.
- Overlap occupies protected edge space only; no evidence, source choice, or action can sit underneath another plane.
- The shovel remains the actual scan button and sweeps through the pasted source.
- Scan stages remain Input, Extract, Verify, and Match, with active tangerine progress and graphite completed progress.
- Conflict resolution remains blocking; reviewed source history remains visible.
- Manual hardware correction stays inline and invalidates the applied setup until re-applied.
- Task and deployment choices recalculate the visible guidance locally; opening a source is the only part of the recommendation flow that requires internet access.

## Ranked Guidance Hierarchy

- Each task resolves to exactly three viable options for the reviewed hardware. Rank describes practical fit for this profile, not general quality, benchmark position, or market leadership; the displayed scores are explicitly illustrative.
- Rank 1 remains the expanded working recommendation with runtime, target artifact, fit rationale, avoid guidance, source actions, and a clearly secondary hosted fallback.
- Ranks 2 and 3 are compact, unframed ledger rows rather than additional cards. Their rank, model, fit label and score, two-column target/runtime facts, one why-lower sentence, and sources remain visible without disclosure interaction.
- Unsuitable workload classes live in a separate `Not recommended on this hardware / 不建议在此配置上使用` area and never occupy a ranked slot.
- Every model exposes a curated creator or official Hugging Face model page labeled `Download and model details / 下载与模型详情`, plus the existing official creator, setup, runtime, or reference link. These are static HTTPS links, not automatic downloads or live model lookups.
- A single shared note below all rankings distinguishes creator weights from community-maintained quantized or optimized files. It tells users to confirm compatibility on the model or runtime page without repeating the same caveat in every row.
- The foreground stays one suspended recommendation plane: internal hairlines and whitespace establish rank without stacking three elevated cards.

## Mandarin Language Principles

- Keep concise Mainland Chinese product language and preserve exact hardware/model strings.
- Keep the headline as two deliberate lines: `从电脑配置，找到` and `适合你的模型。`.
- Do not translate the excavation metaphor into interface jargon.
- Preserve explicit distinctions among `已识别`, `待确认`, `已人工确认`, and `已应用此配置`.
- Validate all visible copy and accessible names at 1440px and 390px.

## Intentional Departures From V2 And The Morandi Pass

1. Replaces the dark blue raw-input slab with translucent warm-white glass over a solid stone underlay.
2. Gives all three major workflow sections distinct glass opacity instead of reserving translucency for the middle plane.
3. Replaces cool blue focus and progress with a restrained tangerine signal.
4. Moves primary and selected controls to near-black while keeping warnings orange and success green.
5. Warms borders, shadows, and opaque controls without adding beige monochrome decoration or photographic scenery.
6. Keeps dense rows and controls crisp, using blur only for the major planes, utility bar, scanner tray, and active inspector.
7. Replaces the single-output result with a practical-fit top three: one expanded recommendation, two compact viable alternatives, explicit source provenance, and a separate unsuitable-guidance boundary.

## User Tests Before Production

1. Do users still read Input -> Resolve -> Match from opacity and elevation without explanatory copy?
2. Does the raw input remain clearly interactive despite its lower-opacity material?
3. Are unresolved orange and verified green immediately distinguishable in both languages?
4. Does the porcelain palette remain legible in bright displays and reduced-transparency environments?
5. At 390px, does the overlap retain depth without hiding controls or creating scroll fatigue?
6. Is the hosted option still visibly secondary to the local recommendation?
7. Can keyboard and assistive-technology users follow the same sequence and names in EN and ZH?
8. Do users understand that the order is specific to their reviewed hardware rather than a universal model ranking?
9. Do the model-page labels and artifact notes prevent users from mistaking community quantizations for creator-provided weights or automatic downloads?
