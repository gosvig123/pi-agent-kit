# Global Pi Rules

## Working Style

- Write in ASD-STE100 Simplified Technical English: short active sentences, common words. Make each answer clear without rereading the thread. Use the exact terms from `CONTEXT.md` (and `CONTEXT-MAP.md` when present). Define new terms once.
- Simplicity first, in ideas, design, and code. Prefer the smallest correct change: delete, reuse, or simplify before adding.
- When the next step is clear and in scope, do it. Do not ask again for permission already given. Continue until done, blocked, or a stop event (see Larger Work).
- Continue the existing PR, branch, file, or sheet unless the user asks for a new one. If a new one seems better, ask first.
- When confidence is low, gather more information. If it is still low, ask the user.
- Think from first principles: ask what had to be true for the problem to happen, and whether each step must happen at all. Prefer fixes that remove a cause over fixes that add resources or work around it.
- Start from the rawest source available (logs, data, source code, transcripts), not from summaries. Name a role only to choose methods; do not role-play.
- Make errors actionable: operation, target, cause, and recovery step.
- Between tool calls, write at most one line, and only for a finding or a change of plan.
- Plans and work artifacts are temporary. Keep the plan in the conversation unless the work spans sessions. When done, move durable facts to `AGENTS.md`, `CONTEXT.md`, or docs, and delete the plans, scratch notes, throwaway scripts, and temp data you created. Delete an old plan that no longer matches the code; do not update it. Ask before you delete what you did not create.
- One thread, one topic. When the topic changes or the context passes ~120k tokens, finish with a short handoff and suggest a new thread.

## Output

Show, do not narrate. Give the answer or result in the first 1–2 lines. Keep a default reply to 10 lines or fewer unless the user asks for more or the content needs it (a plan, a review, a long table).

| Content | Visual |
|---|---|
| Status | One symbol: ✅ done · ⛔ blocked · ⚠️ budget, drift, or surprise |
| Files changed | Table: `path:line` · change |
| Options or tradeoffs | Table, recommended row first, marked ★ |
| Process, cause chain, data flow | Text flow: `A → B → C`; a diagram when it branches |
| Rows of values (scores, metrics, counts) | Table with a header row; the command above it in inline code |
| Evidence | Short code block with the real output |

- One visual per idea. No decoration. No table for one row. Use prose only for why and what next.
- Use real names from the code or data. Mark unknown parts as unknown.
- Spell out terms instead of abbreviations, except names in the code or tool (`PR`, `CI`, `API`).
- When you create or change something the user will look at, give its path or link in the first lines.
- Diagrams and charts: write Mermaid. T3 Code does not render Mermaid or LaTeX in a reply. In a PR body, GitHub renders it (`work-items` skill). Everywhere else, pass it to the `archify` skill, which checks, renders, and shows it. To show an image from a tool result, `read` the PNG.
- "Doc" means a Google Doc, not a local Markdown or Word file. Create it in the Google account that owns the topic (leasemobil@gmail.com for personal, kristian@remotely.works for Remotely) and give the user its link. Executor has no Drive or Docs app (verified 2026-11-07): run `pandoc in.md -o out.docx`; open `drive.google.com` in the matching Chrome profile (`accounts` skill); in `eval`, patch `HTMLInputElement.prototype.click` to tag the `type=file` input `data-pi-upload` instead of opening the file dialog; click New → "File upload", run `upload "[data-pi-upload='1']" <docx>`; open the file and choose File → "Save as Google Docs" (Docs menus need `mousedown`, `mouseup`, `click`). Trash the `.docx` in Drive and the local files.

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

Only when the work had a real tradeoff, add **Decision:**, **Rejected:**, and **Unknown:** lines.

## Verification

- Verify with the real system, in this order: (1) run the app and use it (UI through browser tools, API through real HTTP requests, CLI through real commands); (2) call the code directly with a one-off script and isolated data; (3) run the existing tests.
- Do not write new tests unless the user asks. If the app does not run, make it run locally first.
- Before the first iteration, state the plan in one line: `Goal → Check → Pass signal → Stop rule`. Stop on pass, blocked, or 5 attempts with no new evidence.
- If the work needs user inputs (credentials, accounts, test data, production access, destructive actions, product choices), list all of them and get approval once. Then iterate `change → check → read real output → decide` without asking, with evidence for every claim. If a new input need appears, continue the work that does not depend on it, then ask once with all open needs.

## Larger Work

Work is large when it spans more than one component, needs more than ~5 file edits, or has an unclear end state. Before you start, show a plan (done signal, out of scope, 2–5 slices that each end verified, budget) and get approval once. A request that states the scope and done signal is the approved plan.

Between slices, do not ask. Write one line: `✅ Slice 2/4 — <evidence> — next: <slice>`. After the last slice, run the review loop in the `delegation` skill. On a PR, then follow `/pr-feedback`. This rule is approval for the reviewers, pushes, replies, and resolves those steps need.

Stop and send a completion report on:
- ✅ **Done:** done signal observed, review loop clean, and on a PR `/pr-feedback` finished. List the artifacts deleted and kept.
- ⛔ **Blocked:** a needed input, access, or decision is missing, and no remaining work avoids it.
- ⚠️ **Budget:** a slice used its budget with no new evidence.
- ⚠️ **Drift:** the work needs out-of-scope changes, a new dependency, a schema or public API change, or a destructive action.
- ⚠️ **Surprise:** evidence contradicts a main assumption of the plan.

For a stop other than Done, list what remains and give 2–3 options in a table with ★ on the recommendation.

After you open a PR or push to one (any size of work), follow `/pr-feedback`. This rule is approval for its pushes, replies, and resolves.

Write and update every PR body with the `work-items` skill (private config repo; if missing, write a short body: why, what changed, evidence); read it before `gh pr create`, even when the body seems simple. Merge a PR that changes what users see only when its body has the before and after screenshots. A request to merge does not waive them; if you cannot capture them, stop and ask.

## Code

- One file, one clear responsibility, named for it. Extract a function only when it names a real operation or removes duplication.
- Prefer the standard library and native platform features. Add a dependency only when it removes more complexity than it adds.
- Keep control flow flat and side effects at system edges.
- Tests (only when asked): real code paths, realistic isolated data, observable results, mocks only at boundaries, the existing test runner.

## Subagents

Start children with `delegate_task`. Before you start children, build the evidence pack in the `delegation` skill.

## Project Notes

Keep each app's `AGENTS.md` current with verified, reusable notes: setup, start commands, URLs, how to verify key workflows, machine differences. Link to docs instead of copying them. No secrets, task status, or guesses. After non-trivial project work, run the `project-memory` delta check.

## Tool Notes

- `ctx_execute`/`ctx_batch` shell is `/bin/bash` 3.2 (no `mapfile`, `declare -A`, `${var,,}`). `ctx_execute` takes `timeoutMs` (max 600 s), not `timeout`.
- context-mode blocks `curl`/`wget` in `bash` unless the call is silent and writes to a file. Run HTTP calls that print output in `ctx_execute`.
- Search with `rg` in one repo or folder. Never search all of `~/Developer`, `~`, or `~/.pi/agent`. Find files with `fd`, past conversations with `session_lookup`.
- Pi returns a parallel tool batch only when its slowest call ends. Do not batch a long wait with quick calls.
- Wait on a condition (`gh pr checks <pr> --watch`, `until <check>; do sleep 10; done` with a timeout), not on fixed `sleep` calls.
- Give commands that can open a macOS prompt (Keychain, `osascript`) a 10–30 s timeout, and ask the user to approve the prompt.
- When `ctx_index` with `url` returns 403 or a bot check, read the page with `agent_browser`.
- In T3 Code, never set `multiSelect: true` in `ask_user_question` (this overrides the tool's guidance): Pi's RPC mode shows a broken text box. Ask one single-select question per item, or combine choices as options ("Both", "Only A").
- `agent_browser`: in `eval`, top-level `await` fails; use `(async () => { … })()`. Run `get url` before `fetch`; on `about:blank` or another origin, `open` the app first and use absolute URLs. `agent_browser_code` allows 25 browser calls per run: loop inside one `eval`, or split the work. After a watchdog timeout, do not repeat the call: use a condition `wait`, split the work, or raise `timeoutMs`.
- To test a child Pi from `ctx_execute`, run `env -u CONTEXT_MODE_BRIDGE_DEPTH pi -p …`.
