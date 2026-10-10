---
name: learn-from-session
description: Propose human-approved lessons from user corrections, recurring tool/test failures, or meaningful session outcomes. Use when a session reveals a reusable lesson or the user asks to learn; do not require an update after every task.
---

# Learn From Session

Improve future behavior through small, approved changes. No self-modifying automation.

1. Review the goal, outcome, failures, and user corrections. Keep only reusable, actionable lessons; exclude one-off accidents, guesses, and secrets. If none remain, stop.
2. Propose the smallest useful change. Show the exact target and text before writing:
   - Memory: stable user preference or project fact.
   - `AGENTS.md`: durable global operating rule.
   - Skill: reusable workflow instruction.
   - `~/.pi/agent/error-ledger.md`: recurring failure pattern and checkable prevention.
3. Require explicit user approval before editing any of these targets. Error ledger entries are append-only.
4. Write only the approved change. Do not claim the lesson is learned until the write succeeds.

Report the lesson, target, exact change, approval status, and file changed when applicable.
