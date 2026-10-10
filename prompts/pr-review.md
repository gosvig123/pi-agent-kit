---
description: Review a GitHub PR by number and output findings in chat
argument-hint: <pr-number>
---

Review GitHub PR number from user args and output findings in chat. Do not post GitHub review/comments unless user explicitly asks.

User args: `$ARGUMENTS`
PR number: first argument (`$1`). Required.

## Flow

```
PR number -> collect metadata/diff -> inspect risky paths -> run focused checks -> output findings
```

## Rules

- If PR number missing, ask for it and stop.
- Use `gh`; do not use browser.
- Do not edit files.
- Do not publish comments/reviews to GitHub.
- If diff is large, summarize with scripts/tools and inspect relevant hunks before judging.
- Prefer exact file:line locations from PR head when possible.

## Evidence to collect

Run:

```bash
gh pr view $1 --json number,title,author,headRefName,baseRefName,state,mergeable,additions,deletions,changedFiles,body,url,commits,reviews,statusCheckRollup
gh pr diff $1 --name-only
gh pr diff $1 --patch
```

For deeper review, fetch or check out PR into a temporary worktree, then inspect changed files and run focused tests/checks when cheap.

## Angles

| Angle | Focus |
| --- | --- |
| Correctness | broken behavior, edge cases, data loss, races |
| Security | auth, secrets, injection, PII, tenant isolation |
| Simplicity | unnecessary code, over-abstraction, duplicated logic |
| Maintainability | naming, boundaries, error handling, observability |
| Tests | missing high-value coverage or brittle tests |
| Product risk | UX regressions, deploy risk, compatibility |

Use subagents in parallel when available. If unavailable, run angles yourself as separate passes.

## Output

Output only review findings in chat:

### PR Review

| Verdict | Reason |
| --- | --- |
| `Ready` / `Needs fixes` / `Block` | one sentence |

### Findings

Group by severity.

For each finding:
- `Severity:` Critical / Important / Minor
- `Angle:` one angle above
- `Location:` file:line when possible
- `Issue:` concrete problem
- `Fix:` smallest safe fix

If no findings, say: `No findings.` Then list strongest confidence checks performed.
