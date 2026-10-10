---
description: Commit and push pending changes in themed commits
argument-hint: [scope/instructions]
---

Operate in the current Git worktree. Do not use `~/.pi` unless it is the current worktree.

User args: `$ARGUMENTS`

Goal: group relevant pending changes by purpose, commit each group, and push the current branch.

Steps:
1. Inspect `git status --short --branch`, `git diff`, `git diff --cached`, recent commit messages, and relevant untracked files.
2. Exclude secrets, `.env*`, credentials, build artifacts, dependency directories, logs, caches, and unrelated noise.
3. Group the remaining changes into the fewest coherent themed commits. Keep dependent changes together; use hunk staging only when one file contains separate themes.
4. Ask before committing only if the changes are ambiguous, no changes exist, the branch or remote is unsafe, or secrets appear.
5. Run repository verification when applicable and always run `git diff --check`.
6. Stage exact files or hunks for each theme and commit them with concise messages that match the repository style.
7. Confirm the worktree is clean, then push the current branch to its configured upstream. Never force push.
8. Summarize commit hashes and themes, verification, pushed remote and branch, and any skipped files.
