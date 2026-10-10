---
name: babysit
description: Monitor active engineering processes, fix safe minor failures, and revalidate until healthy or escalation is needed. Use for "babysit this", monitoring deployments or CI, following rollouts, or minor workflow/process issues.
---

# Babysit

Keep the process moving without expanding scope or hiding risk.

## Boundaries

A minor fix has a clear cause and is low-risk, reversible, and local to the process: for example, a formatting error, stale generated output, or incorrect workflow path.

Stop for secrets, permissions, authentication, migrations, production data, billing, destructive infrastructure changes, broad dependency upgrades, architecture changes, security controls, unclear provider state, force-push, or user-impacting rollback. Never enter credentials, approve legal terms, change production environment variables, suppress checks, weaken validation, or retry a mutation with uncertain outcome.

## Monitor and recover

1. Establish the process, expected stages, revision, environment, and healthy signal. Capture available repository status, run IDs, logs, deployment state, and health endpoint before action.
2. Monitor structured status until success, failure, timeout, cancellation, or required approval. On failure, capture stage, command, exact error, revision, relevant artifacts, and known side effects.
3. Fix only understood minor issues. For transient failure, retry once only if read-only/idempotent or the mutation clearly never started. Stop on unknown effects or a repeated failure after one repaired retry.
4. Preserve useful work and ensure one writer owns the worktree. Apply the smallest fix, run the narrow failing check and required broader checks, then resume from the new revision.
5. Commit and push only when publication was requested and remote/branch are verified. Never infer deployment success from a push.

## Deployment verification

- Verify remote, branch, intended SHA, workflow, environment, and deployment destination. Inspect CI before deployment status; read failed job logs and annotations rather than rerunning blindly.
- After deployment, check platform status, application health endpoint, and a non-destructive smoke path. Compare deployed and intended SHAs; CI, deployment, and health must agree before declaring success.
- If production is unhealthy, stop further changes. Recommend rollback only with known target and effects; obtain confirmation before executing it.
- Stop when credentials, permissions, secrets, or environment changes are needed; logs are unavailable; provider outcome is uncertain; checks disagree; or health cannot be verified.

Report process/revision, observed stages, issue classification and evidence, fix/files/commit, validation and health status, and residual risk or exact recovery step.
