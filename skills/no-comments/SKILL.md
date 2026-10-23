---
name: no-comments
description: Review and remove unnecessary source-code comments. Use when asked to clean up comments or enforce the no-comments policy.
disable-model-invocation: true
---

# No comments

Review the supplied files or diff. Otherwise, use the current diff against the base branch (default `main`), including working-tree changes. Stay inside that scope.

Keep function documentation allowed by AGENTS.md or the [create-docstring skill](../create-docstring/SKILL.md).

1. Enable the subagent tools with `subagents_enable` if needed, then run `subagent` with agent `comment-sicko` and `agentScope: "user"`. Pass the repository path, scope, AGENTS.md docstring rules, and the create-docstring skill's path. Allow comment edits only. Report a blocker if the reviewer is unavailable.
2. Check its diff. Reject application-code edits, scope changes, and deletion of comments or docstrings protected by the rules. Restore protected text; stop if the reviewer cannot follow the scope.
3. Fix accepted code issues with the smallest in-scope change, not explanatory comments. Leave out-of-scope fixes open. Ask before adding enforcement for a claimed constraint.
4. Report changed files, deletion count, fixes, and unresolved issues. Do not publish changes or expand the task without the caller's approval.
