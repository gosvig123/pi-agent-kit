---
name: pr-description
description: Creates concise pull request descriptions. Use when opening, preparing, or drafting a PR, especially for a PR description, PR body, GitHub PR text, or merge request summary.
---

# PR Description

1. Inspect the diff, commit range, changed files, and issue context. Derive purpose from evidence; do not invent motivation.
2. Explain why the change exists, what changed, and how it was validated. Highlight removed code or simpler paths when real, not as forced framing.
3. When the change alters behavior, data, or performance, show before and after: what the system did, what it does now, and the measured difference. Also state what does not change, such as data freshness, coverage, or deploy state, when readers could assume it does.
4. When the change alters what a user sees (a page, component, layout, copy, or email), the body must have before and after screenshots of each changed screen. See Screenshots.
5. Every PR body has a diagram of the change, made when the PR is created. See Diagram. The Why still comes first: the diagram shows what changes, the Why says why.
6. Ask only when unresolved intent or release risk materially affects the description. Drafting does not authorize publishing or editing a PR.

## Suggested body

- **Why:** Problem, constraint, or user need. Always first, in words.
- **Diagram:** A `mermaid` block that shows the change (see Diagram).
- **What changed:** Specific changes and their effects; use a table only if it improves scanning.
- **Before and after:** Screenshots for user-visible changes (see Screenshots). For behavior, data, or performance changes, a short flow or table of old and new behavior, with real numbers from validation. Mark unmeasured values as unknown. Add known limits that the change leaves as they are.
- **Validation:** Checks actually run and their results; distinguish pending checks.

## Screenshots

Required for every user-visible change. A PR without them stays a draft.

1. Capture with `agent_browser` `screenshot` in the Pi terminal, or with `preview_snapshot` and `save: true` in T3 Code (it returns `screenshotPath`; `preview_*` is allowed here because this step asks for browser work). DOM measurements are checks, not screenshots. Before from the base branch (another checkout, or production when it runs the base), after from the PR branch. Use the same page, data, account type, and viewport. Add a phone width (390 px) when layout changes, and one shot per account type when who sees what changes.
2. Host them: GitHub has no API to attach images to a PR. Push the PNGs to the orphan branch `pr-screenshots`, in a folder named for the PR branch, without touching the working checkout:
   ```sh
   shots=$(mktemp -d); dir="$(git branch --show-current)"
   git fetch origin pr-screenshots 2>/dev/null && git worktree add "$shots" pr-screenshots || git worktree add --orphan -b pr-screenshots "$shots"
   mkdir -p "$shots/$dir" && cp before-*.png after-*.png "$shots/$dir/"
   git -C "$shots" add -A && git -C "$shots" commit -m "Screenshots for $dir" && git -C "$shots" push -u origin pr-screenshots
   sha=$(git -C "$shots" rev-parse HEAD); git worktree remove "$shots"
   ```
3. Link each image by commit, so a later push cannot change it: `https://github.com/<owner>/<repo>/blob/<sha>/<dir>/<file>.png?raw=true`. These render for everyone with repository access, private repositories too.
   Look at each image before you post it: `Read` refuses large images, so view a copy made with `sips -s format jpeg -s formatOptions 25 -Z 640 <file> --out /tmp/view.jpg`. Retake blank or wrong screens; do not post them.
4. Show them in a table under **Before and after**: one row per screen, columns Before and After, `<img src="…" width="420">`.
5. If a screen cannot be captured (sign-in needs the human, no test data), name it, give the reason, and ask the human for the missing input. Do not mark the PR ready until the screenshots are in.
6. Before you merge, or report a PR as ready, open its body and confirm that each changed screen has its screenshots. A request to merge does not waive this.

## Diagram

Required in every PR body, right after **Why**. GitHub renders `mermaid` code blocks in PR bodies, so the diagram needs no image hosting or tools.

1. Draw from the diff, not from memory. Use the real names from the code: routes, functions, tables, components, queues.
2. Pick the type by what changed:
   | Change | Diagram |
   |---|---|
   | Data flow, request path, or pipeline | `flowchart` (`LR` for up to 5 nodes, else `TD`; see step 3) with old and new paths, in `subgraph Before` and `subgraph After` when both exist |
   | Calls between services or components in order | `sequenceDiagram` |
   | Schema or data model | `erDiagram` with the changed tables |
   | State or lifecycle | `stateDiagram-v2` |
   | UI change | `flowchart` of what the user does and sees: screen → action → result |
3. Make it readable at GitHub's size. GitHub scales the whole diagram down to the body width (about 780 px on desktop, less on narrow screens), and pan and zoom buttons cover its right edge:
   - At most 5 nodes in a row. For a longer chain, use `flowchart TD` with `subgraph` rows that set `direction LR`.
   - Node labels of 1–3 words, such as the function or table name. Explain the steps in the line under the block, not in the nodes.
   - About 10 nodes in total.
4. Mark new or changed nodes with a border only: `classDef new stroke:#2da44e,stroke-width:3px`. Never set `fill` without `color`: GitHub shows the diagram in the reader's theme, and in dark mode a light fill gets light text and becomes unreadable. Do not set `%%{init}%%` themes; GitHub picks the theme.
5. One line under the block says what to read in it, such as "New steps have a green border." Put numbers from validation there or in the body, not in edge labels.
6. After the PR is created, check how the diagram looks in a real browser. The Markdown API (`gh api /markdown`) proves only that the block parses. For a private repository, use the `logged-in-chrome` skill (a signed-out browser gets "Page not found"). Take a screenshot of the diagram with `set media dark`, and again with `set media light`. Pass only when every label is readable in both and the zoom buttons cover no node. If it fails, shorten labels or split rows, run `gh pr edit <n> --body-file`, and check again. Quote labels that contain punctuation: `A["parseSearch()"]`.

The diagram does not replace the Why or the screenshots: a reader must understand why the change exists from the Why alone.

Add breaking changes, migration steps, and risks when real. Keep the body self-contained in Markdown. Mention changed-line posture when useful, such as deletion-heavy or a large addition with its reason.

Keep it short and concrete. Omit empty sections, marketing language, and implementation dumps.
