---
name: visual-explanations
description: Creates compact visuals for architecture, process, tradeoffs, plans, bugs, and reviews. Use when asked for a diagram, visual explanation, or Excalidraw, or when a non-trivial explanation is clearer with one.
---

# Visual Explanations

Clarify the main question with the smallest readable visual. Skip factual one-liners and requests for no visual; default to one visual per response.

## Choose and build

- For a standalone, validated diagram file (architecture, workflow, sequence, data flow, lifecycle) built from repository evidence, use the `archify` skill instead.
- Use a Markdown table or text flow for small, answer-local visuals. Use Excalidraw for architecture, multi-part flows, persistent artifacts, or explicit requests.
- Match shape to purpose: table for tradeoffs or severity, flow for process, module map for structure, causal chain for bugs. Use option-specific previews for structured questions; add a canvas only when the whole-system view helps.
- Inspect evidence and use real domain names. For changes, inspect the diff and show affected boundaries, risk, and blast radius; visuals supplement diff notes.
- For current-versus-planned operations, show actual triggers and trace concrete incident examples. Mark unknown behavior rather than hiding it behind generic failure labels.

## Layout

- Set Excalidraw text to sans-serif (`fontFamily: 2`) unless handwriting is explicitly requested. If font family changes, resize or recreate affected text; old bounds are stale.
- Keep every label inside its node or panel with clear space at the edges. Shorten labels, add semantic line breaks, or enlarge nodes before reducing font size.
- Use one reading direction, clear primary flow, whitespace, and consistent alignment. Reserve nodes for entities, systems, decisions, or flow-changing steps; use badges or callouts for attributes and status. Merge repeated infrastructure.
- Keep labels to a noun and short qualifier where possible. Keep fitted text legible: roughly 24+ for titles, 16+ for nodes, 13+ for annotations. Split dense diagrams rather than shrinking them.
- Use restrained color only for meaning; pair it with words, symbols, or line styles. Omit unused mechanisms unless their absence is itself a decision. Avoid decoration and duplicated prose.

## Verify and share

1. For Excalidraw, open its URL once per task in a right-side cmux browser pane and reuse it:
   ```sh
   cmux new-pane --type browser --direction right --url "$EXCALIDRAW_URL" --focus false
   ```
   If cmux is unavailable, use the normal browser and report the fallback.
2. Fit the canvas and inspect a screenshot at normal size. Purpose, direction, start/end, and uncertainty must be clear. Check every label, including diamonds and callouts, for crowding or overflow. Fix and recapture until no text touches or crosses borders.
3. Give a short explanation and saved path when applicable. Do not claim visual validation without inspecting the result.
