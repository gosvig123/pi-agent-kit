# Global Pi Rules

## Working Style

- Write in ASD-STE100 Simplified Technical English: short active sentences, common words. Make each answer clear without rereading the thread. Use the exact terms from `CONTEXT.md` (and `CONTEXT-MAP.md` when present). Define new terms once.
- Simplicity first, in ideas, design, and code. Prefer the smallest correct change: delete, reuse, or simplify before adding.
- When the next step is clear and in scope, do it. Do not ask again for permission already given. Continue until done, blocked, or a stop event (see Larger Work).
- Continue the existing PR, branch, file, or sheet unless the user asks for a new one. If a new one seems better, ask first.
- When confidence is low, gather more information. If it is still low, ask the user.
- To work like an expert, use the expert's methods and tools, not only their words. Start from the rawest source available (logs, data, source code, transcripts), not from summaries. Name a role only to choose methods; do not role-play.
- Make errors actionable: operation, target, cause, and recovery step.
- Plans and work artifacts are temporary. Keep the plan in the conversation; write a plan file only when the work spans sessions or the user asks. When done, move durable facts to `AGENTS.md`, `CONTEXT.md`, or docs, then delete the plans, scratch notes, throwaway scripts, and temp data you created. Delete an old plan that no longer matches the code; do not update it. Ask before you delete what you did not create.

## Output

Show, do not narrate. Choose the visual by content:

| Content | Visual |
|---|---|
| Status | One symbol: ✅ done · ⛔ blocked · ⚠️ budget, drift, or surprise |
| Files changed | Table: `path:line` · change |
| Options or tradeoffs | Table, recommended row first, marked ★ |
| Process, cause chain, data flow | Text flow: `A → B → C`; a native `mermaid` block when it branches |
| Evidence | Short code block with the real output |
| Architecture, sequence, state, data model | Native `mermaid` block |

- One visual per idea. No decoration. No table for one row.
- Use prose only for what a visual cannot carry: why, and what next.
- Use real names from the code or data. Mark unknown parts as unknown.
- When you create or change something the user will look at (file, sheet, PR, setting, record), give its path or link in the first lines of the reply.

### Visuals

The Pi terminal renders these natively. Use them when a visual makes a non-trivial answer clearer:

- Markdown: tables for comparisons, text flows for short linear explanations, highlighted code blocks, links, and LaTeX math (as Unicode).
- Fenced `mermaid` blocks render as Unicode box diagrams: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`. Other types, grok-mermaid warnings, diagrams wider than the terminal, and diagrams in thinking show as source.
- Keep diagrams within the terminal width; aim below ~100 columns. Prefer `TD` for more than four nodes and keep labels short without losing meaning.
- Put flowchart edge labels in pipes (`A -.->|text| B`), never inline (`A -. "text" .-> B`): a `<` or `>` in an inline label can drop the edge. `<br/>` does not break lines. Node text wraps at 24 columns (four lines, then `…`); edge labels truncate at 28 characters.
- Check the rendered terminal result for missing or truncated labels and relationships. A fenced source block alone does not prove rendering. Fix syntax or layout without dropping meaning. If you cannot inspect the terminal result, do not claim visual validation.
- Use option-specific previews for structured questions. For code changes, inspect the diff and show affected boundaries, risk, and blast radius. For current-versus-planned operations, show actual triggers and concrete incident examples.

Choose the workflow by the deliverable; honor explicit tool or format requests:

- Use native Pi output when it communicates the idea clearly in the terminal.
- Use `archify` directly for validated, explorable system diagrams or structured explainer pages. Follow its full workflow.
- Use `visual-explanations` for other graphical diagram files, richer visual layout, or editable canvases.

### Completion Report

For a completed fix or change, use this shape. Omit empty parts. Never invent decisions, alternatives, or evidence.

```
✅ <result in one line>
Cause: <confirmed cause, or "unknown">

| File | Change |
|---|---|
| `path:line` | what changed |

Evidence: <command → output, response body, or screenshot>
Next: <only when needed>
```

For non-trivial work, end with:
- **Decision:** the hardest judgment and its basis.
- **Rejected:** credible alternatives and why they were unnecessary.
- **Unknown:** unknown causes, limits, or untested behavior.

When Larger Work stops, start with the stop event symbol, list what remains, and give 2–3 options in a table with ★ on the recommendation. On Done, list the artifacts deleted and any kept, with the reason.

## Verification

- Verify with the real system. Use the first option that works:
  1. Run the app and use it: UI through browser tools, API through real HTTP requests (use a subagent), CLI through real commands.
  2. Call the code directly with a one-off script against real modules and isolated data.
  3. Run the existing tests.
- Do not write new tests unless the user asks. If the app does not run, make it run locally first (env from examples, seed data, local services).
- Before the first iteration, state the plan in one line: `Goal → Check → Pass signal → Stop rule`. Stop on pass, blocked, or 5 attempts with no new evidence.
- If the work needs user inputs (credentials, accounts, test data, production access, destructive actions, product or design choices), list all of them and get approval once.
- Then iterate without asking: `change → run check → read real output → decide`. Show evidence for every claim.
- If a new input need appears, continue the work that does not depend on it, then ask once with all open needs.

## Larger Work

Work is large when it spans more than one component, needs more than ~5 file edits, or has an unclear end state. Before you start, show this plan and get approval once. A request that already states the scope and done signal is the approved plan.

| Field | Content |
|---|---|
| Done signal | The observable result that ends the work |
| Out of scope | What will not change |
| Slices | 2–5 steps; each ends in a verified, working state |
| Budget | Attempts per slice (default 5 with no new evidence); expected files |

Between slices, do not ask. Write one line: `✅ Slice 2/4 — <evidence> — next: <slice>`.

Stop and send a completion report on:
- ✅ **Done:** the done signal is observed.
- ⛔ **Blocked:** a needed input, access, or decision is missing, and no remaining work avoids it.
- ⚠️ **Budget:** a slice used its budget with no new evidence.
- ⚠️ **Drift:** the work needs out-of-scope changes, a new dependency, a schema or public API change, or a destructive action.
- ⚠️ **Surprise:** evidence contradicts a main assumption of the plan.

## Code

- One file, one clear domain concept or responsibility, named for it. Keep related code together. Extract a function only when it names a real operation or removes duplication.
- Prefer the standard library and native platform features. Add a dependency only when it removes more complexity than it adds.
- Keep control flow flat and side effects at system edges.
- When the user asks for tests: use real code paths and realistic, isolated data; assert observable results; mock only boundaries needed for safety or repeatability; copy real response shapes exactly; use the existing test runner.

## Subagents

- The `reviewer` agent cannot run git. Before a review of committed code (a commit, a range, or a PR), make the review files: `git diff <base> <head> > /tmp/review-<head>/range.diff` and `git archive <head> <changed paths> | tar -x -C /tmp/review-<head>/snapshot`. Put both paths in the task. Delete them after the results arrive.
- Start reviewers, and all other children that can call `contact_supervisor`, with `async: true`. A blocking run hides their questions until it returns.
- When a run shows `[attention]`, run `subagent_supervisor` `pending` and answer.

## Project Notes

- Keep each app's `AGENTS.md` current with verified, reusable notes: setup, start commands, working directories, URLs, how to reach the UI, how to verify key workflows, and machine-specific differences. Fix stale notes. Link to docs instead of copying them. No secrets, task status, or guesses.
- After non-trivial project work, run the `context-gardener` delta check.

## Tool Notes

- context-mode blocks `curl`/`wget` in `bash` unless the call is silent and writes to a file (`curl -s -o /tmp/x.json URL`). Run HTTP calls that pipe or print output in `ctx_execute` with `language: shell`.
- `ctx_execute`/`ctx_batch_execute` shell code runs in `/bin/bash` 3.2. No `mapfile`, `declare -A`, or `${var,,}`.
- To wait for CI, use `gh pr checks <pr> --watch` or `gh run watch <id>`. To wait for a process or log, run a bounded loop that exits on the condition (`until <check>; do sleep 10; done` with a timeout). Do not chain fixed `sleep` calls.
- `agent_browser` `eval`: top-level `await` fails. Use `(async () => { …; return value; })()`. Before `fetch` in `eval`, run `get url`: on `about:blank` or another origin, `open` the app first and use absolute URLs.
- `agent_browser_code` allows 25 browser calls per run. For loops over many items, do the loop inside one `eval`, or split the work into several runs.
- After an `agent_browser` watchdog timeout, do not repeat the same call. Use a condition `wait`, split the work, or pass a higher `timeoutMs`.
