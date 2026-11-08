---
name: diagnose
description: Use for (1) a diff or change you do not trust ("I don't trust this diff", "blast radius", "what could this break"); (2) bugs with unclear causes, intermittent failures, performance regressions ("diagnose this", "debug this"); (3) watching CI, deploys, or rollouts until healthy ("babysit this"); (4) Pi failures, such as a tool that errors or is missing, a failed workflow step, extension, provider, or child task, or an [auto-heal] message.
---

# Diagnose

| Situation | Read |
|---|---|
| Bug, intermittent failure, regression | `references/bug.md` (human-in-the-loop template: `scripts/hitl-loop.template.sh`) |
| A change you do not trust: what could it break | `references/change-risk.md` |
| A running process to watch: CI, deploy, rollout | `references/monitor.md` |
| A Pi tool, extension, provider, or child-task failure, or an `[auto-heal]` message | `references/pi-failure.md` |

Shared rules: start from raw evidence (logs, output, code). Confirm a cause before you fix it. Obvious, directly evidenced fixes do not need the full loop. Never hide a failure.
