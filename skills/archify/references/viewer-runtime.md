# Viewer Runtime reference

Read this only when the user asks for a reader-facing capability. Ordinary generation does not require implementing or re-documenting these features; they are already in the generated HTML.

## Exploration

- Diagram Guide lists current actions and shortcuts. Open it with the guide button or `?`; it never opens automatically.
- Reading Depth starts at READ at the default 100% scale, reveals FULL detail at 175%, and falls back to MAP only below 100%. Focus, route, and semantic interactions reveal their exact facts at any scale.
- Semantic Lens summarizes selected node/relationship kinds without changing authored geometry.
- Intent Trace previews a fine-pointer or keyboard target before committed focus.
- Node Finder searches labels and stable IDs.
- Branch collapse: tree branches and `dataflow`/`architecture` nodes with [child nodes](authoring-contract.md#collapsible-child-nodes) show a ⊕/⊖ disc. Click, Enter, Space, or ArrowLeft/ArrowRight on the focused parent collapse or expand it; Finder, focus and shared links expand hidden ancestors. Nothing moves, and export writes the complete diagram.
- Semantic Passport opens on focus, shows authored upstream/downstream facts, supports a copyable deep link, has an explicit close action, closes on true outside activation and Escape, and never enters canonical export.
- Semantic Radar mirrors the visible viewport and authored graph without becoming a second source of truth.
- Direct Relationship Pin makes a unique compiled relationship operable while preserving the authored line and stable relationship identity. It must fail closed on conflicting source/target/label/ID metadata.
- Route Probe resolves exactly two endpoints over authored directed relationships. It never infers a route from geometry.

## Embedded reading addresses

A host displaying the native reader in an opaque `srcdoc` frame may set
`data-reading-link-template` on that reader's `html` element. Supply an absolute
HTTP, HTTPS or file URL containing exactly one `{state}` marker, for example
`https://example.test/architecture#page=mechanism&reader={state}`. Native Focus,
Relationship, Reach, Route and Lens copy actions replace the marker with their
percent-encoded opaque query state. The host keeps its page identity and restores
that value as the native frame's hash; it never parses or reconstructs queries.

Absent configuration preserves standalone links. Invalid, credential-bearing or
unsupported URL templates make copying fail without accessing the clipboard.
This seam changes copied addresses only, not query parsing, history, permissions,
embedding isolation or authored geometry. It adds no network or storage surface.

## Motion

Every rendered diagram is always Live. There is no Live/Still button and no saved preference. Every edge runs a small light show on one shared cycle: a comet (glow, halo, tail, head, plus a dimmer echo on every edge) cascades downstream, leaves a soft wake, and lands as a ripple on the target node, while nodes enter once and then glow on the same cycle with authored-step staggering. Phases follow the authored step order (source-node rank, chronological in sequence diagrams); the flow rides a separate Viewer overlay and the original line styles and arrowheads remain intact. Semantic exploration temporarily owns the motion budget, and continuous flow resumes when that action releases it. Diagrams without connections retain their bounded node entrance. Omit `meta.animation`; the renderer ignores it. The OS reduced-motion setting, page hiding, and print still pause motion.

## Fixed appearance

Every diagram is dark and uses the `blueprint` preset. The viewer has no toolbar: no theme, style, presentation, or export control. Keys T, S, F, and E do nothing.

## Truth boundary

Viewer exports are communication assets. They do not replace the checked HTML, the deterministic delivery receipt, or a real visual review. Do not add a hosted service, storage surface, dependency, schema branch, or mobile product surface for these viewer-only capabilities.
