---
name: visual-explanations
description: Create compact visuals for architecture, processes, tradeoffs, plans, bugs, and reviews. Use when asked for a diagram, visual explanation, or editable canvas.
---

# Visual Explanations

Explain the main question with the smallest readable visual. Use real names and evidence, and mark unknowns clearly.

## Choose and build

- Match shape to purpose: table for tradeoffs, flow for process, sequence for interactions, module map for structure, causal chain for bugs.
- Use Mermaid rendered with Pele for diagrams by default. Use Excalidraw when requested or when an editable canvas is needed. Honor explicit tool or format requests.
- For diagrams of real code, inspect the repository. For changes, show affected boundaries and relevant risks.

Create local artifacts; do not publish or send private source to a hosted service without explicit authorization.

## Pele

Pele renders Mermaid diagrams to SVG or embeds them in HTML.

- Use `render(source).svg` from `pele` for SVG files. For browser output, use `mount(element, source)` for font measurement, container fitting, resizing, supported automatic direction changes, and zoom. See [API and theming](https://pele.run).
- Keep the Mermaid source with the output. Preserve meaning; do not remove relationships or meaningful labels to make the diagram fit.
- Include `--pele-*` theme variables in the saved artifact. HTML must carry its required assets, not depend on a machine-specific installation path; use pre-rendered SVG or bundle the renderer when browser interaction is needed.
- Reuse an installed copy or an isolated workspace; do not add project dependencies just to create a diagram.

## Graphical layout

- Set Excalidraw text to sans-serif (`fontFamily: 2`) unless handwriting is explicitly requested. If the font changes, resize or recreate affected text; old bounds are stale.
- Keep every label inside its node or panel with clear space at the edges. Shorten wording without losing meaning, add semantic line breaks, or enlarge nodes before reducing font size.
- Use one reading direction, a clear primary flow, whitespace, and consistent alignment. Reserve nodes for entities, systems, decisions, or flow-changing steps; use badges or callouts for attributes and status. Merge repeated infrastructure.
- Keep text legible: roughly 24+ px for titles, 16+ px for nodes, and 13+ px for annotations. Split dense diagrams rather than shrinking them.
- Use restrained color only for meaning; pair it with words, symbols, or line styles. Omit unused mechanisms unless their absence is itself a decision.

## Verify and deliver

1. For Excalidraw, open its URL once per task in a right-side cmux browser pane and reuse it:
   ```sh
   cmux new-pane --type browser --direction right --url "$EXCALIDRAW_URL" --focus false
   ```
   If cmux is unavailable, use the normal browser and report the fallback.
2. For Pele or Excalidraw, fit the diagram and inspect a screenshot at normal size: `read` a PNG or call `excalidraw_capture_screenshot`. Purpose, direction, start/end, and uncertainty must be clear. Check labels, diamonds, callouts, arrows, contrast, and clipping. For responsive Pele HTML, check narrow and wide containers and resize behavior. Fix and recapture until no text touches or crosses borders.
3. Give a short explanation and the saved path when applicable. Keep the source with saved diagrams and state any missing evidence or checks. Parsing alone is not visual validation; claim visual inspection only when performed.
