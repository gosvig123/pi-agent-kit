---
name: delegation
description: "Start child agents: brief them with an evidence pack, score the review gate (skip, light, or full review) and run the review loop, or ask a council of three advisors for one verdict. Use before any delegate_task launch, after the last slice of Larger Work, before you report a change to auth, privacy, money, data, or concurrency as done, for \"should this be reviewed\", \"review this\", \"council\", \"get other opinions\", or a hard decision, design choice, or diagnosis."
---

# Delegation

Council (three advisors, one verdict): follow `references/council.md`.

## Child model

Never use the `codex` provider.

- **Non-review children:** omit `target`; the guard/extension sets the default (GPT-6.2 Sol, high, through Pi). Set `target` only for the council roster or a model the user names.
- **Review rounds (`role: "review"`):** always use different models than the orchestrator from `{sol 6.2, opus 5.5, neon}`:

| Family | `delegate_task` target |
|---|---|
| `sol` | `{"providerInstanceId": "pi", "model": "openai-codex/gpt-6.2-sol", "options": {"thinking": "high"}}` |
| `opus` | `{"providerInstanceId": "pi", "model": "anthropic/claude-opus-5-5", "options": {"thinking": "high"}}` |
| `neon` | `{"providerInstanceId": "antigravity", "model": "gemini-4-neon", "options": {"thought_level": "high"}}` |

In Pi and Claude Code, omit `target` on `role: "review"` and the guard rotates automatically across the 2 models other than the orchestrator (and blocks same-model review targets once). In Antigravity or Codex, pass the other 2 targets explicitly (or run `brief-init review-targets --parent-model <your-model>`).

## Evidence pack

Name a later review round of the same change `<slug>-r<N>` (`beta-main-pr-r4`), so all rounds share one pre-existing ledger. Build `/tmp/brief-<slug>/` with `brief-init <slug> --base <ref> --cmd "<check>" --review` (pass `--local` for a workspace-local `.briefs/<slug>/` pack when sandboxed subagents cannot read `/tmp`) and remove it with `brief-init clean <slug> [--local]` when results arrive. Never pass `/tmp/brief-*` to `ctx_index` (it rejects paths outside the project); read brief files directly with `read`. Child outputs go to `~/Documents/pi-output/<YYYY-MM-DD>-<slug>/` or the project, never the brief folder.

- `context.md` (scaffolded by `brief-init`; fill in the placeholders):
  - The goal and why.
  - Decisions already made, which the child must not reopen.
  - Pass rules, as testable statements.
  - `Not building (scope lock)`: explicit adjacent controls, endpoints, or refactors excluded from this change. Builders must not add unrequested extras; reviewers must not file findings asking for excluded items.
  - `Invariants checked before review` (for `--review`): `brief-init` auto-selects triggered invariants from `range.diff` (concurrency/stale-state, account/workspace boundaries, 320–440 px UI/focus, schema/data safety, plus optional `.agent/invariants.json` repo rules) and marks unmatched built-ins N/A. Prove every triggered item in `checks.txt` or explain N/A before launching reviewers.
  - For a decision that can change the verdict, ask the user before launch. For any other open decision, write the assumption to use.
- `range.diff`: written by `brief-init` (`git diff <base> <head>`). Must not be empty.
- `checks.txt`: real output of the tests, build, and repro commands, so children do not rerun them.
- Any PR body, issue, or API response the child needs.

Each child's task gives only what is different for it:
- `Read /tmp/brief-<slug>/context.md first.`
- Its angle, its part of the code, `cwd`, and the output path.
- "If X is missing, assume Y and record it in `assumptions`."

A child on another machine cannot read `/tmp`, so put its brief in the task text. Child rules and reply shape come from `extensions/child-mode.ts`. Say in the brief when a child may break them.

## Review gate

Score the change before any review round. Run `brief-init gate <slug> --base <ref>` with the scores it asks for; each needs `--reason "<axis>: <why>"`. It suggests risk and size from the diff, and proof from `checks.txt` when the brief exists. A score below a suggestion needs a reason.

| Axis (0–3) | 0 | 3 |
|---|---|---|
| risk | docs, copy, config | auth, privacy, account boundary, money, data or schema, concurrency |
| reversibility | local, instant revert | cannot undo: migration, data loss, messages to customers, public API |
| size | ≤50 lines in 1 file | many components |
| novelty | mechanical | new design or unclear end |
| proof (gap) | the goal ran end to end | nothing ran, or a check failed |

Impact = max(risk, reversibility). Likelihood = round(0.25·size + 0.35·novelty + 0.4·proof). Score = impact × likelihood:
- **0–2 skip:** no reviewers. Report the proof.
- **3–4 light:** 1 reviewer, the angle the gate prints.
- **6–9 full:** 2–3 reviewers, the angles the gate prints.

To lower the score, improve the proof (run the goal end to end), not the reasons. Put the gate line (`<level>, score <n>`) in the final report. Calibrate with `review-finding stats`: it shows yield per level and per angle.

## Review loop

1. **Focus.** Add `## Review focus` to `context.md`:
   - **Matters:** the 2–4 risks that would make this change unsafe to ship.
   - **Not a finding:** for example, internal tools, unlikely races, or style.
   - **P1 means:** the harm that blocks the merge. Everything else is P2.
   - **Origin:** each finding sets `origin`. `diff`: the change added it, or made an old problem worse or newly reachable; the proof cites a changed line. `existing`: it is on the base branch and the change does not affect it. When unsure: inside a changed hunk is `diff`, anything else is `existing`. Record `existing` problems in the code you read; do not search the repo for them.
2. **Review.** Start the number of fresh reviewers the gate says (`role: "review"`, `mode: "async"`), each with one angle from the gate: correctness, security and privacy, concurrency, data safety, UI, or verification. Simplicity, tests, and docs are not angles of their own (past reviews: 4 P0/P1 in 41 reports); the correctness reviewer notes them as P2. The verification reviewer checks that the `Goal → Check → Pass signal` proof in `checks.txt` shows the change works; missing tests are not a finding unless the user asked for tests. They record each finding with `report_finding` (or `review-finding add --brief <slug> ...` outside Pi), with `file:line`, proof, a P0/P1/P2 label, and `origin`.
3. **Triage.** When all reviewers have replied, call `review_findings` (or `review-finding merge <slug> [--since <iso>]` outside Pi). It returns **Fix** (`diff` findings of this round) and the **pre-existing ledger** (`existing` findings of all rounds of the group, each with an ID and a status). You own the verdict, with one line of reason for each:
   - `diff` → **block** or **cheap fix** by default, or **noise** when the claim is false. Change a P1 to P2 when it fails the brief's P1 rule. Record each verdict with the ID from the Fix table: `review-finding verdict <slug> <id> block|cheap-fix|noise [--note <why>]` (noise needs a note). These verdicts calibrate the gate.
   - `existing` → verify the claim against the code, then recommend one decision: `fix-here` (the change cannot ship safely without it, or it is a P0/P1 in code this change touches), `split-pr` (real and urgent, but its own change), `file` (real, not urgent), or `drop` (false or not worth tracking).
4. **Fix.** Fix small findings yourself. Give larger ones to one `role: "implementation"` child. Fix an `existing` finding only after its decision is `fix-here`.

### Pre-existing triage gate

Pre-existing findings are not blockers of this change, but they are decisions the user owns. Do not let them fade into a count or a footnote.

- **Every round:** when `untriaged` > 0, the reply has a separate **Pre-existing findings (outside this diff)** table after the blockers: ID, severity, `file:line`, a one-line proof, and your recommended decision. Show every row, from every round, in full. A P0 or P1 goes in the reply of the round that found it, not only at the end.
- **Decide:** ask with one question for the table (options: accept all recommendations ★, or decide row by row). Record each answer: `review-finding triage <group> <id> <decision> [--note <text>]`.
  - `fix-here` → add it to this change's fix list; the next review round covers it.
  - `split-pr` → record the follow-up branch or thread as the note.
  - `file` → create the issue in the repo's tracker (the `Issue tracker:` line in the repo's `AGENTS.md`; else Linear for `remotely-works` repos, else GitHub Issues), with the `work-items` skill, then record the issue URL as the note. The decision to file is the user's approval; create no issue before it.
  - `drop` → record the reason as the note.
- **Gate:** before the final report, `review-finding existing <group> --check` must exit 0 (no `untriaged` rows). If the user has not decided yet, the final report shows the table and says the gate is open; do not call the work done.

Clean means no block findings left and the pre-existing gate closed. When `review_findings` says **Not converging** (a round found as many P0/P1 as the round before), start no new round: check the design or the scope with the user. Stop after 3 rounds; `review-budget` limits each round to 3 reviewers. Report the rounds, the triage table, and the pre-existing ledger with each decision and link. When the work is on a PR, push, then run `/pr-feedback`.
