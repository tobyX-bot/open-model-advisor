# Porcelain Suspension Design QA

## Comparison Target

- Source visual truth: `/Users/bssm/Downloads/IMG_9871.jpg`
- Desktop implementation: `/Users/bssm/Documents/model digger/mocks/model-digger-v3/desktop.png`
- Mobile implementation: `/Users/bssm/Documents/model digger/mocks/model-digger-v3/mobile.png`
- Desktop viewport and state: 1440px wide, zh-CN, reviewed 12GB VRAM conflict, applied image-generation guidance, local-first deployment.
- Mobile viewport and state: 390px wide, zh-CN, the same reviewed and applied state.
- Functional target: exactly three viable practical-fit options for every task, with Rank 1 expanded, Ranks 2 and 3 compact, unsuitable guidance separated, and static curated sources exposed.
- Adaptation boundary: the source is authoritative only for warm-white palette, milky translucency, dark anchors, restrained tangerine, and material depth. Its cannabis content, photography, composition, plants, stones, and orange circle are intentionally excluded.

## Review Evidence

The source and final desktop implementation were placed in one comparison board at the same 680px review width. This kept palette, white contrast, translucency, elevation, typography, and overall information density visible together without treating the reference composition as an implementation target. The final combined board is `/tmp/porcelain-ranked-qa-final.png`.

The board confirms that the added ranking content remains inside one near-white foreground plane. Rank rows use internal hairlines and whitespace rather than new glass cards, while the raw and detected planes retain their lower elevations. The source's warm porcelain environment, milky panel contrast, near-black anchors, and small warm signal informed the material; no photographic scenery or decorative source motif was copied.

## Comparison History

### Material Pass

- [P2] Lower elevations initially lacked enough separation.
  - Fix: calibrated `--elevation-1`, `--elevation-2`, and `--elevation-3` falloffs plus white top and leading-edge highlights.
- [P2] Mobile initially lost the suspension rhythm.
  - Fix: introduced distinct 6-18px side offsets, reduced protected overlaps, and retained ordered shadow strength.

Both findings remained resolved in the ranked-guidance render.

### Ranked Guidance Pass

- [P2] Compact alternatives and source actions were too quiet in the first ranked render.
  - Location: Rank 2 and Rank 3 headings, fit labels, ranking rationale, and source links at 1440px and 390px.
  - Evidence: at the shared review scale, the hierarchy from expanded Rank 1 to compact alternatives was correct, but the smaller fit and source typography required unnecessary effort to scan.
  - Impact: viable alternatives were technically visible yet insufficiently prominent for comparison and source verification.
  - Fix: increased fixed label, score, model-name, and source-link sizes; strengthened the alternatives heading; added 28px minimum source targets; and constrained mobile fit labels without changing the plane geometry.

No P0 or P1 findings were present. The final desktop and mobile captures resolve the P2 finding; no actionable P0, P1, or P2 findings remain.

## Required Fidelity Surfaces

| Surface | Final assessment |
| --- | --- |
| Typography | SF/system hierarchy remains precise, with monospace limited to exact hardware and artifact targets. The Mandarin headline remains two deliberate lines, `从电脑配置，找到` / `适合你的模型。`, with fixed desktop/mobile sizes and `letter-spacing: 0`. |
| Spacing and suspension | Three major planes retain distinct elevations and protected offsets. Automated geometry checks, including a 3px focus allowance, found no intersection between later planes and earlier buttons, inputs, evidence, status labels, or source actions. |
| Warm-white tokens | Mineral page `#eeeae6`, stone underlay `#d9d1ca`, and warm hairlines preserve the selected material direction without gradients, orbs, photographic imitation, or decorative bubbles. |
| Translucency and elevation | Major planes use 52%, 78%, and 93% white glass with 24px, 28px, and 32px blur. Shadows and white edge highlights increase by elevation; nested rows and controls remain crisp. |
| Ranking hierarchy | Every task renders exactly three viable options. Rank is explicitly described as practical fit for the reviewed profile, not a universal or benchmark ranking, and every score is labeled illustrative in EN/ZH. |
| Recommendation density | Rank 1 is fully expanded. Ranks 2 and 3 keep rank, model, fit, target, runtime, why-lower copy, provenance note, and source actions visible as compact rows. No additional elevated cards or disclosure dependency was introduced. |
| Unsuitable guidance | `Not recommended on this hardware / 不建议在此配置上使用` is separated from the ranked options and contains workload guidance rather than an unsuitable candidate presented as a recommendation. |
| Sources and provenance | All 15 catalog entries expose an official or creator Hugging Face page labeled `Download and model details / 下载与模型详情` and their existing official creator/setup/runtime/reference link. Community quantization guidance is explicitly separated from creator weights. |
| Icons | The existing shovel and stroke icon system remains consistent. External actions use the text-safe `↗` treatment; no handcrafted SVG or copied source ornament was added. |
| Chinese copy | Native Mainland Chinese, exact hardware/model strings, status distinctions, ranking rationale, source labels, artifact notes, and accessible names fit at 1440px and 390px. |
| Contrast | On the lowest-opacity composite, primary text is 14.37:1, body text 9.16:1, secondary text 5.86:1, review orange 5.71:1, and verified green 5.31:1. White on near-black controls is 17.17:1. |
| Responsiveness | EN and ZH pass at 1440px and 390px with no horizontal overflow, heading/score collision, clipped control, obscured source link, or content-covering overlap. |

## Verification

- Five-task data audit: chat, coding, image, speech-to-text, and embeddings each render exactly three unique ranked candidates; all 15 catalog entries are represented.
- Image order: FLUX.1 schnell, Stable Diffusion 3.5 Medium, and SDXL Base 1.0 at illustrative scores 88, 84, and 82 for the reviewed 32GB RAM / 12GB VRAM profile.
- Source audit: six visible actions per task, 30 total across the five sets; every `href` is HTTPS with `target="_blank"` and `rel="noopener noreferrer"`. No fetch, API, or automatic download behavior exists.
- Browser console and page errors: none in EN or ZH at 1440px or 390px.
- Workflow: staged scan, blocking VRAM review, source selection, apply, three-option result, inline manual editor, and edit invalidation all pass.
- Deployment: local-only suppresses the hosted fallback; local-first and cloud-acceptable states keep it clearly secondary. Ranking and scanning remain browser-local; internet is used only when a source link is opened.
- Keyboard: the source action is reached through the tab order and receives a solid 3px tangerine focus outline. Language, task, deployment, review, apply, and manual controls retain visible focus behavior.
- Reduced motion: shovel, sweep, and evidence motion resolve to `0.01ms`; state changes remain functional.
- Screenshot dimensions: desktop 1440x2031; mobile 390x4076.
- Opaque fallback: all three major material levels retain explicit warm-white backgrounds when `backdrop-filter` is unavailable.

## Remaining Trade-off

- [P3] Mobile is necessarily long because exact review context, Rank 1 detail, and both viable alternatives remain visible without hidden disclosures or navigation. This is a deliberate comparison-first workflow choice rather than an unresolved defect.

final result: passed
