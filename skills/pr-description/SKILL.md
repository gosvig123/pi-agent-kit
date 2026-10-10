---
name: pr-description
description: Creates concise pull request descriptions. Use when opening, preparing, or drafting a PR, especially for a PR description, PR body, GitHub PR text, or merge request summary.
---

# PR Description

1. Inspect the diff, commit range, changed files, and issue context. Derive purpose from evidence; do not invent motivation.
2. Explain why the change exists, what changed, and how it was validated. Highlight removed code or simpler paths when real, not as forced framing.
3. Ask only when unresolved intent or release risk materially affects the description. Drafting does not authorize publishing or editing a PR.

## Suggested body

- **Why:** Problem, constraint, or user need.
- **What changed:** Specific changes and their effects; use a table only if it improves scanning.
- **Validation:** Checks actually run and their results; distinguish pending checks.

Add breaking changes, migration steps, and risks when real. Use a before/after flow or `visual-explanations` only when it clarifies the change; keep the body self-contained in Markdown. Mention changed-line posture when useful, such as deletion-heavy or a large addition with its reason.

Keep it short and concrete. Omit empty sections, marketing language, and implementation dumps.
