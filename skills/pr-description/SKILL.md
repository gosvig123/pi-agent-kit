---
name: pr-description
description: Creates concise pull request descriptions. Use when opening, preparing, or drafting a PR, especially for a PR description, PR body, GitHub PR text, or merge request summary.
---

# PR Description

1. Inspect the diff, commit range, changed files, and issue context. Derive purpose from evidence; do not invent motivation.
2. Explain why the change exists, what changed, and how it was validated. Highlight removed code or simpler paths when real, not as forced framing.
3. When the change alters behavior, data, or performance, show before and after: what the system did, what it does now, and the measured difference. Also state what does not change, such as data freshness, coverage, or deploy state, when readers could assume it does.
4. Ask only when unresolved intent or release risk materially affects the description. Drafting does not authorize publishing or editing a PR.

## Suggested body

- **Why:** Problem, constraint, or user need.
- **What changed:** Specific changes and their effects; use a table only if it improves scanning.
- **Before and after:** For behavior, data, or performance changes. A short flow or table of old and new behavior, with real numbers from validation. Mark unmeasured values as unknown. Add known limits that the change leaves as they are.
- **Validation:** Checks actually run and their results; distinguish pending checks.

Add breaking changes, migration steps, and risks when real. Use a before/after flow or a `mermaid` block only when it clarifies the change; keep the body self-contained in Markdown. Mention changed-line posture when useful, such as deletion-heavy or a large addition with its reason.

Keep it short and concrete. Omit empty sections, marketing language, and implementation dumps.
