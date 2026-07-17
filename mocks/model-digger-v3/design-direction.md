# Resolved Depth

Resolved Depth makes workflow order physical. Input is a solid back plane, review is an active translucent plane, and the recommendation is a crisp foreground sheet. Their overlap expresses causality: pasted text becomes editable hardware, then becomes a bounded recommendation. The composition remains a working tool, meticulously aligned and information-dense, with depth doing explanatory work rather than acting as decoration.

The visual field is true white, cool Morandi blue, and restrained blue-gray. The input slab carries the deepest color; the review surface borrows light from both neighboring layers; the resolved sheet returns to opaque white. Hairlines, shallow shadows, and one cool-blue focus color establish material precision. There are no gradients, decorative textures, or atmospheric effects. Every separation should look painstakingly calibrated by an expert product team.

Type follows a precision-configurator hierarchy. SF/system sans carries product language at calm, readable sizes; monospace is reserved for exact hardware strings and source excerpts. Large type is earned only by the primary action and the recommended model. Status is always written, never carried by color alone. The craft lies in repeated baselines, stable control dimensions, and careful wrapping across English and Simplified Chinese.

Motion is limited to three meaningful events. The real shovel button sweeps through the pasted text in 700ms, the extracted profile rises into the active work surface in 400ms, and the recommendation sheet settles in 400ms after application. Hover and selection changes use 240ms transitions. Reduced motion preserves the same state sequence without travel, so animation clarifies the system without becoming a prerequisite.

The excavation identity stays in spatial behavior and the shovel control, not in product vocabulary. Visible language remains immediate: configuration, recognition, source, conflict, correction, and recommendation. The final result should feel materially refined and original while remaining obvious on first use, with the same master-level attention applied to Mandarin, mobile overlap, keyboard focus, and unresolved evidence.

## Depth And Interaction Model

- **Input / back plane:** a solid Morandi-blue slab keeps the pasted source visible throughout the workflow.
- **Resolve / active plane:** a translucent overlapping work surface holds detected fields, exact source excerpts, confidence, conflicts, and manual correction.
- **Match / foreground plane:** an elevated opaque sheet shows task and deployment controls plus one concrete recommendation.
- Overlap never covers a control or required label. It only occupies protected edge space between functional regions.
- The shovel is the actual scan button. Its sweep tracks the staged **Input -> Extract -> Verify -> Match** progress.
- Conflict resolution remains blocking; resolved conflicts stay visible as review history.
- On mobile, the same planes form one vertical sequence with small negative margins and reserved bottom space, preserving depth without horizontal scrolling.

## Mandarin Language Principles

- Use concise Mainland Chinese product language, written for comprehension rather than mirroring English structure.
- Translate user intent, not the excavation metaphor. Terms such as “core sample,” “strata,” “lens,” and “evidence inspector” never appear as Chinese UI jargon.
- Prefer direct verbs and familiar nouns: `解析配置`, `识别结果`, `查看原文位置`, `人工确认`, `应用识别结果`, `修改硬件信息`, `开源模型推荐`.
- Keep CPU, GPU, model, runtime, quantization, and operating-system names exact; localize surrounding labels and explanations.
- Make status distinctions explicit: `已识别` for parser output, `待确认` for unresolved conflict, `已人工确认` for a user decision, and `已应用此配置` for the scoring input.
- Write recommendations as decision guidance, using `适合本地运行`, `配置匹配说明`, `不建议用于`, and `云端备选方案` instead of translated noun piles.
- Validate every Chinese state at 1440px and 390px, including source choices, form options, ARIA labels, and long recommendation explanations.

## Material, Color, And Type

- **Back plane:** solid Morandi blue (`#314954`) with high-contrast white text.
- **Active plane:** translucent true-white with cool blue-gray inspection areas and an opaque fallback.
- **Foreground sheet:** true white with no border and a shallow soft shadow.
- **Focus:** cool blue (`#2f7391`); review amber is reserved for blocking issue semantics.
- **Type:** SF/system sans for hierarchy; SF Mono/system monospace only for hardware and source excerpts.
- **Geometry:** 6-12px radii, hairline separators, no nested cards, and no decorative glass.
- **Timing:** 240ms selection, 400ms resolve/match transitions, 700ms source sweep, all using Apple-style easing curves.

## Intentional Departures From The First V3 Pass

1. Replaces three equal dashboard columns with overlapping back, active, and foreground planes.
2. Moves the shovel from a scanner tray into the pasted source, making it a visible spatial scan control.
3. Uses the review surface itself as the extraction lens rather than placing glass inside a flat column.
4. Elevates the recommendation as a resolved output sheet while keeping its cause visible behind it.
5. Rewrites all Mandarin copy and accessibility labels as native product Chinese.
6. Removes metaphorical interface wording while preserving the excavation identity in motion and composition.
7. Gives mobile the same depth logic through controlled vertical overlap rather than flattening every section.

## User Tests Before Production

1. Do users understand the Input -> Resolve -> Match order from the overlap without needing explanatory copy?
2. Does the shovel sweep make local parsing visible without suggesting live AI or automatic hardware detection?
3. Can Mandarin users distinguish `已识别`, `待确认`, `已人工确认`, and `已应用此配置` immediately?
4. Do users notice the blocking VRAM conflict and understand that choosing a source is an explicit decision?
5. At 390px, does the vertical overlap preserve context without hiding controls or causing scroll fatigue?
6. Is the hosted option clearly secondary to the concrete local recommendation?
7. Can keyboard and assistive-technology users follow the same state sequence and accessible names in both languages?
