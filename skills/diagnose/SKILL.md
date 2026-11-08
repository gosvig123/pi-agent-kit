---
name: diagnose
description: Find and fix causes of failure. Bugs with unclear causes, intermittent failures, performance regressions ("diagnose this", "debug this"); what a change could break ("blast radius", "what could this break"); monitoring CI, deploys, or rollouts until healthy ("babysit this"); and Pi tool, extension, provider, or child-task failures, including auto-heal recovery requests.
---

# Diagnose

| Situation | Read |
|---|---|
| Bug, intermittent failure, regression | `references/bug.md` (human-in-the-loop template: `scripts/hitl-loop.template.sh`) |
| A change you do not trust: what could it break | `references/change-risk.md` |
| A running process to watch: CI, deploy, rollout | `references/monitor.md` |
| A Pi tool, extension, provider, or child-task failure, or an `[auto-heal]` message | `references/pi-failure.md` |

Shared rules: start from raw evidence (logs, output, code). Confirm a cause before you fix it. Obvious, directly evidenced fixes do not need the full loop. Never hide a failure.
