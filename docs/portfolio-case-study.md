# Model Digger: choosing local AI around a real workload

## Problem

Model catalogs describe models, but users need a practical starting point for their computer, memory budget, and intended task. A confident recommendation based on misread hardware can be worse than no recommendation.

## My contribution

I defined the product workflow and constraints, iterated the bilingual interface, directed AI-assisted implementation, and used synthetic hardware scenarios and regression tests to review parsing and recommendation behavior.

## Product choices

- Keep setup inputs in the browser and make the catalog local to the application.
- Let users review extracted fields before applying them.
- Preserve uncertainty and conflicts rather than inventing hardware facts.
- Explain practical fit and unsuitable choices with transparent rules.
- Separate recommendations from benchmark rankings.

## Evidence and limits

The repository includes runnable code, a curated model catalog, deterministic tests, and historical validation material. The current code passed 211 automated tests during the September 9, 2026 portfolio audit; the exact code commit is recorded in the companion validation note.

That test result does not establish real-world ranking superiority, automatic hardware detection, or accuracy for every future model and device. The older July validation report is preserved as historical evidence of failures that informed the scanner rebuild.

## Learning

The important product boundary is between extracted suggestions and confirmed user inputs. Transparent uncertainty, editable fields, and explicit review are core functionality rather than decorative UX.
