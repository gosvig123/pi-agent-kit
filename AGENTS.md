# Global Pi Rules

## Working Style

- Write in ASD-STE100 Simplified Technical English: short active sentences, common words. Make each answer clear without rereading the thread. Use the exact terms from `CONTEXT.md` (and `CONTEXT-MAP.md` when present). Define new terms once.
- Simplicity first, in ideas, design, and code. Prefer the smallest correct change: delete, reuse, or simplify before adding.
- When the next step is clear and in scope, do it. Do not ask again for permission already given. Continue until done, blocked, or a stop event (see Larger Work).
- Continue the existing PR, branch, file, or sheet unless the user asks for a new one. If a new one seems better, ask first.
- When confidence is low, gather more information. If it is still low, ask the user.
- To work like an expert, use the expert's methods and tools, not only their words. Start from the rawest source available (logs, data, source code, transcripts), not from summaries. Name a role only to choose methods; do not role-play.
- Make errors actionable: operation, target, cause, and recovery step.
- Between tool calls, write at most one line, and only for a finding or a change of plan.
- Plans and work artifacts are temporary. Keep the plan in the conversation; write a plan file only when the work spans sessions or the user asks. When done, move durable facts to `AGENTS.md`, `CONTEXT.md`, or docs, then delete the plans, scratch notes, throwaway scripts, and temp data you created. Delete an old plan that no longer matches the code; do not update it. Ask before you delete what you did not create.

## Output

Show, do not narrate. Give the answer or result in the first 1–2 lines. Keep a default reply to 10 lines or fewer; give more detail only when the user asks or the content needs it (a plan, a review, a long table).

Choose the visual by content:

| Content | Visual |
|---|---|
| Status | One symbol: ✅ done · ⛔ blocked · ⚠️ budget, drift, or surprise |
| Files changed | Table: `path:line` · change |
| Options or tradeoffs | Table, recommended row first, marked ★ |
| Process, cause chain, data flow | Text flow: `A → B → C`; a `mermaid` block when it branches |
| Evidence | Short code block with the real output |
| Architecture, sequence, state, data model | `mermaid` block |

- One visual per idea. No decoration. No table for one row.
- Use prose only for what a visual cannot carry: why, and what next.
- Use real names from the code or data. Mark unknown parts as unknown.
- Spell out terms instead of abbreviations or acronyms. Keep only names that appear in the code or the tool (`PR`, `CI`, `API`).
- When you create or change something the user will look at (file, sheet, PR, setting, record), give its path or link in the first lines of the reply.

### Visuals

The Pi terminal renders these natively. Use them when a visual makes a non-trivial answer clearer:

- Markdown: tables, highlighted code blocks, links, and LaTeX math (as Unicode).
- Fenced `mermaid` blocks render as Unicode box diagrams: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`. Other types, diagrams wider than the terminal, and diagrams in thinking show as source. Keep diagrams under ~100 columns: use `TD` for more than 4 nodes and short labels.
- Pi shows the source for any grok-mermaid warning, not only for width. Put flowchart edge labels in pipes (`A -.->|text| B`), never inline (`A -. "text" .-> B`): a `<` or `>` in an inline label drops the edge. An unquoted `;` ends the statement, so put node text that has `;` in double quotes: `D["a; b"]`. `<br/>` does not break lines; node text wraps at 24 columns (4 lines, then `…`), and edge labels are cut at 28 characters.
- Inline images from tool results: `read` a PNG or call `excalidraw_capture_screenshot`.
- For an editable canvas, run `load_toolset` `excalidraw`, use sans-serif text (`fontFamily: 2`), and check a screenshot before you show it.
- For a standalone diagram file to share, use the `archify` skill.

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

Only when the work had a real tradeoff, end with these (omit each one that is empty):
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

After the last slice, run a review loop before you report Done. Follow `/review-loop` (`pi-subagents/prompts/review-loop.md`): fresh-context `reviewer` agents in parallel, then one fix `worker` for the accepted P0/P1 findings, at most 3 rounds. This rule is approval to start these subagents. Done needs a clean review: no P0, and no P1 fix worth doing now. Put the rounds, fixes, and deferred findings in the completion report. When the work is on a PR, push the clean result, then run `/pr-feedback` before you report Done.

After you open a PR or push to one, follow `/pr-feedback` (`pi-agent-kit/prompts/pr-feedback.md`): wait for the bot reviews (Copilot, Greptile), evaluate each comment on evidence, push fixes, then reply and resolve. Each reply says that an agent wrote it on behalf of the user. This rule is approval for those pushes, replies, and resolves.

Stop and send a completion report on:
- ✅ **Done:** the done signal is observed, the review loop is clean, and on a PR `/pr-feedback` has finished.
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
- `ctx_execute`/`ctx_batch_execute` shell code runs in `/bin/bash` 3.2. No `mapfile`, `declare -A`, or `${var,,}`. A `ctx_batch_execute` command that starts with `for`, `while`, or `if` fails (context-mode puts `NODE_OPTIONS=…` before it); start it with `cd . &&`.
- `ctx_*` calls with no `timeout` stop after 120 s (`pi-agent-kit/extensions/ctx-timeout.ts`). Pass a larger `timeout` for long builds.
- Search file contents with `rg`, not `grep -r`, in one repo or folder. Never search all of `~/Developer` (43 GB), `~`, or `~/.pi/agent` (5.4 GB). `rg` skips `.gitignore` paths (`node_modules`, `dist`, `sessions`); add `-uu` only to search them, and treat "no match" without `-uu` as "not in tracked source". Find files by name with `fd`. Find past conversations with `session_lookup` or `hindsight`, not by searching `~/.pi/agent/sessions`. The `slow-search-guard` extension rewrites `grep -r` to `rg`, and `find` over `/`, `~`, `~/Developer`, `~/Library`, `~/.pi`, or `~/.pi/agent` to `fd -HI`; a result that starts with `[slow-search-guard]` came from the rewritten command.
- Pi returns a parallel tool batch only when its slowest call ends. Do not put a long wait (CI watch, poll loop) in the same batch as quick calls: a `git push` result waited 15 min for a Railway poll.
- To wait for CI, use `gh pr checks <pr> --watch` or `gh run watch <id>`. To wait for a process or log, run a bounded loop that exits on the condition (`until <check>; do sleep 10; done` with a timeout). Do not chain fixed `sleep` calls.
- `ctx_fetch_and_index` uses plain HTTP. When a page returns 403 or a bot-check page (Cloudflare, Zendesk help centers, openai.com, npmjs.com, LinkedIn), load the `browser` tool set and read the page with `agent_browser`.
- To test a child Pi from `ctx_execute`, run `env -u CONTEXT_MODE_BRIDGE_DEPTH pi -p …`. The context-mode server sets that variable, and a child that inherits it skips its `ctx_*` tools (recursion guard).
- `agent_browser` `eval`: top-level `await` fails. Use `(async () => { …; return value; })()`. Before `fetch` in `eval`, run `get url`: on `about:blank` or another origin, `open` the app first and use absolute URLs.
- `agent_browser_code` allows 25 browser calls per run. For loops over many items, do the loop inside one `eval`, or split the work into several runs.
- After an `agent_browser` watchdog timeout, do not repeat the same call. Use a condition `wait`, split the work, or pass a higher `timeoutMs`.
