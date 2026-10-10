---
name: context-gardener
description: End-of-task delta check that keeps CONTEXT.md accurate when finished work revealed durable project terms, relationships, or ambiguities. Use after non-trivial work, not during design; for naming and modeling decisions during design use domain-modeling.
---

# Context Gardener

Preserve project language, not implementation notes.

## Delta check

- Did this task reveal or correct a durable project term, relationship, or ambiguity?
- Is it supported by code, existing docs, or an explicit user statement?
- If not, stop. Do not create an empty scaffold or update context for read-only work.

## Update

1. Follow `CONTEXT-MAP.md` when present; otherwise use root `CONTEXT.md`. Ask if multiple contexts fit.
2. Read existing context. Tighten or merge entries before adding new ones; preserve its format and voice.
3. If no file exists, create one only when there are evidenced facts to record. Use [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md), filling only known facts.
4. Keep definitions to one sentence. Record unresolved names under `Flagged ambiguities`; ask before asserting weakly supported business rules or context boundaries.
5. Report the file and the terms or relationships changed.

## Include / exclude

- Include domain definitions, meaningful aliases, stable relationships, and resolved naming conflicts.
- Exclude function inventories, schema dumps, build commands, test strategy, temporary decisions, and generic programming concepts.
- Never invent facts, dialogue, or intended behavior. Skip implementation-only changes.
