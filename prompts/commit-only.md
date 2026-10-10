---
description: Commit relevant repo changes without pushing
argument-hint: [message/scope/instructions]
---

Operate in current working repo from current working directory. Do not use `~/.pi` unless it is current repo.

User args: `$ARGUMENTS`

Goal: commit relevant uncommitted changes only. Do not push.

Steps:
1. Confirm current directory is inside Git worktree; ask if not.
2. Inspect `git status --short --branch`, `git diff`, `git diff --cached`, and relevant untracked file contents.
3. Include relevant tracked and untracked files matching user args. Exclude secrets, `.env*`, credentials, build artifacts, dependency dirs, logs, caches, and unrelated noise.
4. Ask before committing if changes are ambiguous, no changes exist, branch/upstream state is risky, or secrets appear.
5. Run repo verification from conventions when applicable; always run `git diff --check` before commit.
6. Stage only relevant files. Commit with concise message from args or inferred scope.
7. Do not push, even if commit succeeds.
8. Summarize commit hash, verification, staged/skipped files, and push status as `not pushed`.
