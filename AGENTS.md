# Global Pi Rules

## Working Style

- Write in ASD-STE100 Simplified Technical English: short active sentences, common words. Use the exact terms from `CONTEXT.md` (and `CONTEXT-MAP.md`). Define new terms once.
- Simplicity first. Prefer the smallest correct change: delete, reuse, or simplify before adding. Fix causes, not symptoms. Start from raw sources (logs, data, code), not summaries.
- When confidence is low, gather more information; if it stays low, ask.
- When the next step is clear and in scope, do it. Continue the existing PR, branch, file, or sheet unless the user asks for a new one.
- Ask only about outcomes, consent, and charter items. Decide execution details yourself (review mechanics, temporary files, reversible presentation) and say what you chose. When you ask for approval, say in one line what it allows. While a question waits, continue the work that does not depend on it.
- Make errors actionable: operation, target, cause, and recovery step.
- Between tool calls, write at most one line, and only for a finding or a change of plan.
- Delete the plans, scratch files, and temp data you created when done; move durable facts to `AGENTS.md`, `CONTEXT.md`, or docs. Ask before you delete what you did not create.
- One thread, one topic. When the topic changes or the context passes ~120k tokens, finish with a short handoff and suggest a new thread.

## Output

Give the answer in the first 1–2 lines. Keep a reply to 10 lines or fewer unless the content needs more. Status symbols: ✅ done · ⛔ blocked · ⚠️ budget, drift, or surprise. Use tables for files changed (`path:line` · change), options (recommended row first, ★), and rows of values; text flows (`A → B → C`) for processes; short code blocks for evidence. No table for one row. Use real names; mark unknowns as unknown. Spell out abbreviations except names in code (`PR`, `CI`, `API`). Give the path or link of anything the user will look at.

Diagrams: write Mermaid. In a PR body GitHub renders it (`work-items`); elsewhere use the `archify` skill. "Doc" means a Google Doc (`accounts` skill).

Completion report: `✅ <result>` · `Cause:` · files table · `Evidence:` (real output) · `Next:` when needed. Add `Decision:`/`Rejected:`/`Unknown:` only for a real tradeoff.

## Verification

Verify with the real system: run the app and use it, then a one-off script, then the existing tests. Do not write new tests unless asked. State `Goal → Check → Pass signal → Stop rule` before the first iteration; stop on pass, blocked, or 5 attempts with no new evidence. List all needed user inputs (credentials, test data, destructive actions) once, then iterate without asking.

## Larger Work

Large = more than one component, more than ~5 file edits, or an unclear end state. First show a plan (done signal, out of scope, 2–5 verified slices, budget) and get approval once; a request that states scope and done signal is the plan. Between slices write `✅ Slice n/N — <evidence> — next: <slice>`. After the last slice, run the review loop in the `delegation` skill; on a PR, then follow `/pr-feedback`. These rules approve the reviewers, pushes, replies, and resolves they need. Stop with a report on done, blocked, budget, drift (out-of-scope change, new dependency, schema or public API change, destructive action), or surprise; for a non-done stop, give 2–3 options with ★.

After you open or push to a PR (any size of work), follow `/pr-feedback`. Write every PR body with the `work-items` skill, and merge a PR that changes what users see only with before and after screenshots in its body.

## Code

One file, one responsibility. Extract a function only for a real operation or to remove duplication. Prefer the standard library; add a dependency only when it removes more complexity than it adds. Flat control flow; side effects at the edges. Tests (only when asked): real code paths, the existing runner, mocks only at boundaries.

## Tools: one route per job

| Job | Route |
|---|---|
| Child agents | `delegate_task` only (not Pi `subagent` tools or a native `Agent`). The `child-target` extension sets the default model; brief children with the `delegation` skill. |
| Browser automation, signed-in sites | `agent_browser` (`agent_browser_code` for loops); profiles in the `accounts` skill |
| T3 `preview_*` | Only when the user asks for the T3 browser or names a T3 page |
| Show a visual in T3 | `html_preview` then `html_render` |
| External apps (Gmail, Slack, Linear, HubSpot) | `executor_*`; the `mcp` tool only to install or authenticate |
| Web search / read a page | `better_web_search` / `ctx_index` with `url` (403 or bot check: `agent_browser`) |

- Prompts such as `/pr-feedback` mean: read `~/.pi/agent/local/pi-agent-kit/prompts/<name>.md` and follow it. `fd`/`rg` skip that git-ignored kit; use `fd -u`/`rg -u`.
- context-mode blocks printing `curl`/`wget` in `bash`; run HTTP calls in `ctx_execute`.
- `agent_browser`: in `eval`, wrap `await` in `(async () => { … })()`; `open` the app before `fetch` and use absolute URLs; `agent_browser_code` allows 25 browser calls per run; after a watchdog timeout, use a condition `wait` or split the work.
- Wait on conditions (`gh pr checks --watch`, `until …; do sleep 10; done`), not fixed sleeps. Do not batch a long wait with quick calls.
- Give commands that can open a macOS prompt a 10–30 s timeout and ask the user to approve it.
- In T3 Code, never set `multiSelect: true` in `ask_user_question`.
- Test a child Pi from `ctx_execute` with `env -u CONTEXT_MODE_BRIDGE_DEPTH pi -p …`.

## Project Notes

Keep each app's `AGENTS.md` current with verified, reusable notes (setup, start commands, URLs, how to verify key workflows). No secrets, task status, or guesses. After non-trivial project work, run the `project-memory` delta check.
