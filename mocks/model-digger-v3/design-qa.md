# Porcelain Suspension Design QA

## Comparison Target

- Source visual truth: `/Users/bssm/Downloads/IMG_9871.jpg`
- Desktop implementation: `/Users/bssm/Documents/model digger/mocks/model-digger-v3/desktop.png`
- Mobile implementation: `/Users/bssm/Documents/model digger/mocks/model-digger-v3/mobile.png`
- Desktop viewport and state: 1440px wide, zh-CN, reviewed VRAM conflict, applied image-generation recommendation, local-first deployment.
- Mobile viewport and state: 390px wide, zh-CN, same reviewed and applied state.
- Adaptation boundary: the source is authoritative only for warm-white palette, milky translucency, dark anchors, restrained tangerine, and material depth. Its cannabis content, photography, composition, plants, stones, and orange circle are intentionally excluded.

## Review Evidence

The source and desktop implementation were placed in one equal-width comparison board at the same review scale. The full-view board checked palette, overall material hierarchy, whitespace, and composition. A second combined board used matched-size focused frames to compare the source's translucent panel region with the implementation's three workflow planes. Temporary comparison captures were `/tmp/porcelain-qa-final-full.png` and `/tmp/porcelain-qa-final-focus.png`.

Focused comparison was required because the full page made hairlines, white edge highlights, icon weight, Chinese wrapping, and shadow falloff too small to judge. The focused pass confirmed distinct low, medium, and high elevations without perspective, decorative shapes, or content-covering overlap.

## Comparison History

### Pass 1

- [P2] Lower elevations lacked enough separation.
  - Location: desktop raw-input and detected-setup planes.
  - Evidence: the initial combined comparison showed appropriate warm whites, but the first two planes shared similar short shadows and visually compressed against the stone underlay.
  - Impact: Input -> Resolve -> Match read primarily through position rather than material elevation.
  - Fix: introduced calibrated `--elevation-1`, `--elevation-2`, and `--elevation-3` two-stage shadow falloffs, plus stronger white top and leading-edge highlights.

- [P2] Mobile lost the suspension rhythm.
  - Location: 390px major workflow surfaces.
  - Evidence: the initial mobile capture placed the three planes on nearly identical side edges, weakening the layered effect even though the vertical order remained usable.
  - Impact: the mobile adaptation felt flatter than the desktop material system.
  - Fix: added distinct 6-18px side offsets, reduced the final negative overlap, retained protected padding, and preserved ordered shadow strength.

No P0 or P1 findings were present.

### Pass 2

Post-fix desktop and mobile captures show three visibly different elevations and opacity levels. Automated geometry checks, including a 3px focus allowance, found no intersection between later planes and earlier buttons, inputs, evidence, status labels, or focus rings. The two P2 findings are resolved; no actionable P0, P1, or P2 findings remain.

## Required Fidelity Surfaces

| Surface | Final assessment |
| --- | --- |
| Typography | SF/system hierarchy remains precise. Hardware uses monospace only. The Chinese headline remains two deliberate lines, `从电脑配置，找到` / `适合你的模型。`, with fixed 40px desktop and 32px mobile sizes and explicit zero letter spacing. |
| Spacing and layout | Desktop keeps 52px and 108px vertical advances with 16px protected horizontal overlaps. Mobile uses distinct side offsets and protected vertical margins. Alignment, control dimensions, and section rhythm are stable. |
| Warm-white tokens | Mineral page `#eeeae6`, stone underlay `#d9d1ca`, and warm hairlines match the selected material direction without gradients or photographic imitation. |
| Translucency and elevation | Major planes use 52%, 78%, and 93% white glass with 24px, 28px, and 32px blur. Shadows and white edge highlights increase by elevation. Nested rows and controls remain crisp. |
| Icons | Existing shovel asset and interface stroke icons remain optically consistent, aligned, and legible. No source imagery or decorative shape was imitated with CSS or placeholder assets. |
| Chinese copy | Native Mainland Chinese copy, exact hardware strings, status distinctions, and accessible names are preserved. EN/ZH switching restores the correct heading structure repeatedly. |
| Interactions | Shovel scan, staged progress, blocking conflict review, source selection, apply, manual invalidation, five tasks, deployment choices, and hosted fallback all pass. |
| Contrast | On the lowest-opacity composite, primary text is 14.37:1, body text 9.16:1, secondary text 5.86:1, review orange 5.71:1, and verified green 5.31:1. White on near-black primary controls is 17.17:1. |
| Responsiveness | EN and ZH pass at 1440px and 390px with no horizontal overflow, clipped controls, off-screen status labels, or content-covering overlaps. |

## Verification

- Browser console and page errors: none at 1440px or 390px.
- Keyboard: visible 3px tangerine focus outline; skip link, language controls, textarea, scan control, evidence, and actions remain reachable.
- Reduced motion: shovel, sweep line, and evidence transitions resolve to `0.01ms` while state changes remain functional.
- Screenshot dimensions: desktop 1440x1192; mobile 390x3167.
- Opaque fallback: three explicit warm-white fallback surfaces are present for browsers without backdrop-filter.

## Follow-up Polish

- [P3] The mobile page remains long because exact source review, conflict history, and manual correction stay inline. This is an intentional workflow trade-off rather than a material-fidelity defect.

final result: passed
