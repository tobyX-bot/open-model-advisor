# Open Model Advisor

Static, local-first model recommendation tool.

The app runs in the browser, loads only the local `models.json` catalog, and does not send hardware inputs, pasted setup text, task selections, or priorities to a backend. Hugging Face links are curation references in the static catalog, not runtime API calls.

V2 supports exact CPU/GPU model fields, numeric RAM/VRAM/storage inputs, a deterministic local paste-and-scan setup parser, concrete "try first" starter recommendations, and an English/Mandarin Chinese language switch.

Recommendations are practical starting points, not benchmark rankings or legal/license advice. The setup scanner does not call an AI service and should be treated as a helper, not as hardware detection.

Run it from this folder with a local static server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

Opening `index.html` directly may block `fetch("models.json")` in some browsers because of `file://` restrictions.
