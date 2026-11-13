---
name: diagnose
description: Use for a diff you do not trust ("blast radius", "what could this break"), a bug with an unclear cause, a flaky failure or performance regression, watching CI or a deploy until healthy ("babysit this"), or a Pi failure (tool, extension, provider, child task, [auto-heal]).
---

# Diagnose

| Situation | Read |
|---|---|
| Bug, intermittent failure, regression | `references/bug.md` (human-in-the-loop template: `scripts/hitl-loop.template.sh`) |
| A change you do not trust: what could it break | `references/change-risk.md` |
| A running process to watch: CI, deploy, rollout | `references/monitor.md` |
| A Pi tool, extension, provider, or child-task failure, or an `[auto-heal]` message | `references/pi-failure.md` |

Shared rules: start from raw evidence (logs, output, code). Confirm a cause before you fix it. Obvious, directly evidenced fixes do not need the full loop. Never hide a failure.
