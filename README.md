# Model Digger

Model Digger is a static, local-first tool for finding practical open-model starting points that fit a specific computer and workload.

The app runs entirely in the browser, loads only the local `models.json` catalog, and does not send hardware inputs, pasted setup text, task selections, or priorities to a backend. Model-card links are static curation references, not runtime API calls.

V2 includes:

- an English and Mandarin setup scanner with explicit review before apply;
- exact CPU, GPU, RAM, VRAM/unified-memory, storage, OS, and device fields;
- editable hardware examples with clear provenance rather than automatic-detection claims;
- deterministic category filtering and transparent rule scoring;
- concrete "Try first" family, size/quantization, runtime, fit, and avoid guidance;
- local-first results with hosted fallback labeled only when appropriate;
- a bilingual English/Mandarin interface;
- the Liquid Excavation interface, with a functional raw → scan → extract → match → recommendation progress line.

Recommendations are practical starting points, not benchmark rankings or legal/license advice. The setup scanner does not call an AI service and should be treated as a helper, not as hardware detection.

## Architecture

There is no build step and no backend. The page uses native browser modules:

- `index.html` — semantic application shell;
- `styles.css` — responsive visual system;
- `src/app.js` — state, events, and boot sequence;
- `src/scanner.js` and `src/hardware.js` — local setup parsing and hardware classification;
- `src/scoring.js` — deterministic recommendation rules;
- `src/catalog.js` — catalog loading and validation;
- `src/i18n.js` — English/Mandarin interface copy;
- `src/model-copy.js` and `src/render.js` — recommendation copy and safe rendering;
- `models.json` — curated static catalog.

No runtime Hugging Face/OpenAI calls, API keys, analytics, accounts, or server storage are used.

## Run locally

From this folder, start any static HTTP server. For example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

Opening `index.html` directly can block ES modules and `fetch("models.json")` because of `file://` restrictions. The page displays a local-server notice in that case.
