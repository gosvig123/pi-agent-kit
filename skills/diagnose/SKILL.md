---
name: diagnose
description: Diagnoses bugs with uncertain causes, intermittent failures, and performance regressions. Use for "diagnose this", "debug this", or an unresolved failure. Obvious, directly evidenced fixes do not require the full loop.
---

# Diagnose

For a directly evidenced cause, apply the smallest fix and targeted verification. Use the loop below while the cause remains uncertain. Read relevant project context and ADRs.

## Feedback loop

1. Build the smallest runnable check that exposes the user's symptom: a failing test, HTTP/CLI request, browser assertion, or captured-input replay.
2. If needed, use a temporary harness, differential comparison, or bisection. For human-only steps, use [the HITL template](./scripts/hitl-loop.template.sh).
3. Confirm the original failure and capture its exact output or timing. Narrow the input and control time, randomness, files, and network where practical.
4. For intermittent bugs, measure reproduction frequency and use bounded repetition or stress in an isolated environment. For performance, establish a measured baseline before changing code.
5. If no useful check is possible, report attempts and ask for the missing access or a sanitized artifact. Label untested explanations as hypotheses; do not claim a verified cause or fix.

## Test the cause

- Form only the hypotheses needed to distinguish plausible causes. Each must predict an observable result. Add alternatives when evidence contradicts the leading explanation.
- Test one variable at a time. Prefer debugger inspection or targeted probes over broad logging; tag temporary logs with a unique `[DEBUG-...]` prefix.
- Share hypotheses when user knowledge could change the next test, not as a mandatory checkpoint.
- Obtain explicit approval before production instrumentation or disruptive experiments. Do not capture secrets in logs or fixtures.

## Fix and verify

1. Apply the smallest fix.
2. Re-run the original reproduction (request, command, or UI path) and confirm the symptom is gone. Do not write a regression test unless the user asks for one.
3. Remove temporary instrumentation and harnesses, or retain useful diagnostics in a clearly marked location. Do not delete pre-existing user work.
4. Report cause, change, verification, and remaining gaps. Suggest architectural follow-up only when the evidence warrants it; do not expand the fix automatically.
