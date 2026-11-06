---
name: pr-description
description: Creates concise pull request descriptions. Use when opening, preparing, or drafting a PR, especially for a PR description, PR body, GitHub PR text, or merge request summary.
---

# PR Description

1. Inspect the diff, commit range, changed files, and issue context. Derive purpose from evidence; do not invent motivation.
2. Explain why the change exists, what changed, and how it was validated. Highlight removed code or simpler paths when real, not as forced framing.
3. When the change alters behavior, data, or performance, show before and after: what the system did, what it does now, and the measured difference. Also state what does not change, such as data freshness, coverage, or deploy state, when readers could assume it does.
4. When the change alters what a user sees (a page, component, layout, copy, or email), the body must have before and after screenshots of each changed screen. See Screenshots.
5. Ask only when unresolved intent or release risk materially affects the description. Drafting does not authorize publishing or editing a PR.

## Suggested body

- **Why:** Problem, constraint, or user need.
- **What changed:** Specific changes and their effects; use a table only if it improves scanning.
- **Before and after:** Screenshots for user-visible changes (see Screenshots). For behavior, data, or performance changes, a short flow or table of old and new behavior, with real numbers from validation. Mark unmeasured values as unknown. Add known limits that the change leaves as they are.
- **Validation:** Checks actually run and their results; distinguish pending checks.

## Screenshots

Required for every user-visible change. A PR without them stays a draft.

1. Capture with `agent_browser` `screenshot`: before from the base branch (another checkout, or production when it runs the base), after from the PR branch. Use the same page, data, account type, and viewport. Add a phone width (390 px) when layout changes, and one shot per account type when who sees what changes.
2. Host them: GitHub has no API to attach images to a PR. Push the PNGs to the orphan branch `pr-screenshots`, in a folder named for the PR branch, without touching the working checkout:
   ```sh
   shots=$(mktemp -d); dir="$(git branch --show-current)"
   git fetch origin pr-screenshots 2>/dev/null && git worktree add "$shots" pr-screenshots || git worktree add --orphan -b pr-screenshots "$shots"
   mkdir -p "$shots/$dir" && cp before-*.png after-*.png "$shots/$dir/"
   git -C "$shots" add -A && git -C "$shots" commit -m "Screenshots for $dir" && git -C "$shots" push -u origin pr-screenshots
   sha=$(git -C "$shots" rev-parse HEAD); git worktree remove "$shots"
   ```
3. Link each image by commit, so a later push cannot change it: `https://github.com/<owner>/<repo>/blob/<sha>/<dir>/<file>.png?raw=true`. These render for everyone with repository access, private repositories too.
4. Show them in a table under **Before and after**: one row per screen, columns Before and After, `<img src="…" width="420">`.
5. If a screen cannot be captured (sign-in needs the human, no test data), name it, give the reason, and ask the human for the missing input. Do not mark the PR ready until the screenshots are in.

Add breaking changes, migration steps, and risks when real. Use a before/after flow or a `mermaid` block only when it clarifies the change; keep the body self-contained in Markdown. Mention changed-line posture when useful, such as deletion-heavy or a large addition with its reason.

Keep it short and concrete. Omit empty sections, marketing language, and implementation dumps.
