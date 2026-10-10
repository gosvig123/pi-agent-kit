---
description: Push current branch without committing
argument-hint: [remote/branch/instructions]
---

Operate in current working repo from current working directory. Do not use `~/.pi` unless it is current repo.

User args: `$ARGUMENTS`

Goal: push existing commits only. Do not stage or commit.

Steps:
1. Confirm current directory is inside Git worktree; ask if not.
2. Inspect `git status --short --branch`, `git remote -v`, and upstream with `git rev-parse --abbrev-ref --symbolic-full-name @{u}` when available.
3. Ask before pushing if remote/branch/upstream is missing or ambiguous, working tree has uncommitted changes relevant to requested push, or remote looks personal for a project repo.
4. Prefer current upstream. If absent, use user args. If still unclear, ask. Never force push.
5. Push current branch to chosen project remote. Do not create commits.
6. Summarize pushed remote/branch, commit range when available, and any uncommitted files left untouched.
