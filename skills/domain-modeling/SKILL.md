---
name: domain-modeling
description: Build and sharpen a project's domain model during planning, design, and implementation. Use automatically when defining or changing domain concepts, entity relationships, lifecycle states, business rules, or responsibility boundaries; choosing names for domain concepts in code or APIs; resolving vague or conflicting terminology; or writing an ADR. For the end-of-task CONTEXT.md check, use context-gardener. Trigger when these questions arise during feature work, refactoring, or Wayfinder planning, even if the user does not ask for domain modeling. Skip mechanical edits and reading already-settled vocabulary.
---

# Domain Modeling

Challenge unclear terms and test domain boundaries. Record resolved language, not guesses.

## Model the domain

1. Read `CONTEXT-MAP.md` when present and select the relevant context; otherwise use root `CONTEXT.md`. Ask when the boundary is unclear.
2. Compare terms with the glossary and code. Surface contradictions and propose precise canonical names for vague or overloaded terms.
3. Use concrete hypothetical scenarios to test relationships and edge cases. Do not record these scenarios as established behavior.
4. Capture resolved terms and relationships in `CONTEXT.md` as they emerge. Follow [CONTEXT-FORMAT.md](../context-gardener/CONTEXT-FORMAT.md); mark unresolved conflicts rather than invent a resolution.

If the selected `CONTEXT.md` does not exist, create it as soon as there are evidenced domain terms or relationships to record, using the linked format. Without `CONTEXT-MAP.md`, create it at the repository root. Do not create an empty placeholder. Keep implementation details, specifications, and scratch notes out. Do not create or edit files during read-only work.

## Architecture Decision Records (ADRs)

Offer an ADR only when the decision is all three:

- Costly to reverse.
- Surprising without its context.
- A real choice between alternatives with different costs or benefits.

Follow the repository's ADR format. If none exists, record context, alternatives, decision, and consequences. Use `docs/adr/` for system-wide decisions and the relevant context's `docs/adr/` for local ones. Create directories only when a record is needed; never present a proposed decision as approved.
