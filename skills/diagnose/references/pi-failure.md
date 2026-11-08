# Self Heal

Recover evidence-first. Preserve useful partial work. Never hide failure.

## Loop

1. Capture operation, target, exact error, structured details, and artifact/log/session paths.
2. Classify: cancellation, expected miss, transient transport/startup, deterministic setup, partial success, or unsafe/unknown.
3. Inspect status and artifacts before action. For a `delegate_task` child, read its result with `task_status` or `t3_thread_read`.
4. Salvage valid output first. A failed lifecycle can still contain a usable artifact.
5. Retry once only when operation is read-only/idempotent, no mutation evidence exists, cause is transient or repaired, and this failure signature has not retried.
6. Use fresh rerun for read-only work. To continue a failed `delegate_task` child, start a new one with its saved output and a brief that forbids repeating completed mutations.
7. Validate recovered result. Report cause, action, evidence, and residual risk.

## Stop Conditions

Do not auto-retry user cancellation, `stop`, destructive commands, writes, external publication, authentication, payment, legal acceptance, unknown side effects, or repeated signature. Do not edit installed `node_modules`; create user/project overrides.

When blocked, give exact recovery command or decision needed. After repeated evidenced failure, use `project-memory` (learn); request approval before durable memory or instruction changes.
