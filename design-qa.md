# Model Digger V2 Design QA

## Comparison Sources

| View | Approved source | Implementation | Comparison size |
| --- | --- | --- | --- |
| Desktop | `/Users/bssm/Documents/model digger/mocks/model-digger-v3/desktop.png` | `/tmp/model-digger-v2-populated-desktop-zh-1440.png` | 1440 x 1589 |
| Mobile | `/Users/bssm/Documents/model digger/mocks/model-digger-v3/mobile.png` | `/tmp/model-digger-v2-populated-mobile.png` | 390 px wide; implementation viewport 390 x 844 |

## Full And Focused Checks

- Layered three-panel suspension hierarchy matches the approved direction.
- Porcelain and frosted-white surfaces retain clear depth and contrast.
- The shovel brand remains visible and coherent across desktop and mobile.
- English and Mandarin switching works without mixed-language catalog freshness text.
- No overlap or horizontal overflow is present at the tested desktop and mobile sizes.
- Ranked recommendation cards preserve hierarchy and scanability.
- Official model-source and runtime-guide actions remain visible and usable.
- The hardware confirmation gate remains explicit before recommendations are generated.

## Findings

- P0: none open.
- P1: none open.
- P2: none open.

## Accepted Intentional Deltas

- The deterministic ranking selects SDXL Base first for the tested RTX 4070 profile; this reflects the verified catalog and scoring rules rather than the static mock order.
- After a scan is applied, the active-profile summary replaces the pending scan rows while exact hardware details remain accessible in the profile controls.

## Final Result

PASSED
