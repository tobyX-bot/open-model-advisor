# Open Model Advisor

Static, local-first model recommendation tool.

The app runs in the browser, loads only the local `models.json` catalog, and does not send hardware inputs, task selections, or priorities to a backend. Hugging Face links are curation references in the static catalog, not runtime API calls.

Recommendations are practical starting points, not benchmark rankings or legal/license advice.

Run it from this folder with a local static server:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

Opening `index.html` directly may block `fetch("models.json")` in some browsers because of `file://` restrictions.
