---
name: blast-radius
description: Find what a change could break beyond its diff and test the facts its safety depends on. Use for "blast radius of X", "what could this break", or reviewing a small diff you do not trust.
---

# Blast Radius

Look beyond callers to the assumptions that make a change safe.

## Investigate

1. Inspect the diff, history, and relevant code. State what changed, including effects not obvious in the diff.
2. Identify the safety facts that matter. Trace realistic failure paths through timing, teardown, serialization, database fields, flags, and downstream consumers. Check dependency source, pinned versions, and local patches where relevant.
3. Cite real `file:line` evidence. Never invent callers or APIs. Separate confirmed risks from cases checked and cleared; state likelihood, impact, and how to verify each remaining risk.
4. Test the decisive facts with real code when permitted and practical: use an existing check or a small script at the relevant boundary. Report commands and results. If execution is unavailable or costly, mark the fact unproven rather than treating a plausible explanation as proof.

Use independent review only when it materially improves coverage and the current role permits delegation.

## Report

- What changed and the affected boundaries.
- Safety facts and their evidence: assertion, source citation, failure-path reasoning, executed check, or running-app reproduction. Facts not tested with real code remain unproven.
- Confirmed risks, checked-and-cleared cases, and the cheapest remaining verification before merge.

Keep the report concise. Remove private data before sharing publicly. Never publish without explicit user approval.
