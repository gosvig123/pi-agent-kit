---
name: delegation
description: "Start child agents: brief them with an evidence pack, run the end-of-work review loop, or ask a council of three advisors for one verdict. Use before any delegate_task launch, after the last slice of Larger Work, or for \"council\", \"get other opinions\", or a hard decision, design choice, or diagnosis."
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

Build `/tmp/brief-<slug>/` with `brief-init <slug> --base <ref> --cmd "<check>" --review` (pass `--local` for a workspace-local `.briefs/<slug>/` pack when sandboxed subagents cannot read `/tmp`) and remove it with `brief-init clean <slug> [--local]` when results arrive. Never pass `/tmp/brief-*` to `ctx_index` (it rejects paths outside the project); read brief files directly with `read`. Child outputs go to `~/Documents/pi-output/<YYYY-MM-DD>-<slug>/` or the project, never the brief folder.

- `context.md` (scaffolded by `brief-init`; fill in the placeholders):
  - The goal and why.
  - Decisions already made, which the child must not reopen.
  - Pass rules, as testable statements.
  - `Not building (scope lock)`: explicit adjacent controls, endpoints, or refactors excluded from this change. Builders must not add unrequested extras; reviewers must not file findings asking for excluded items.
  - `Invariants checked before review` (for `--review`): prove in `checks.txt` or mark N/A with reason before launching reviewers — (1) concurrency & stale-state overwrites, (2) account & workspace boundaries, (3) 320–440 px UI fit, sticky-header overlap, and keyboard-focus preservation.
  - For a decision that can change the verdict, ask the user before launch. For any other open decision, write the assumption to use.
- `range.diff`: written by `brief-init` (`git diff <base> <head>`). Must not be empty.
- `checks.txt`: real output of the tests, build, and repro commands, so children do not rerun them.
- Any PR body, issue, or API response the child needs.

Each child's task gives only what is different for it:
- `Read /tmp/brief-<slug>/context.md first.`
- Its angle, its part of the code, `cwd`, and the output path.
- "If X is missing, assume Y and record it in `assumptions`."

A child on another machine cannot read `/tmp`, so put its brief in the task text. Child rules and reply shape come from `extensions/child-mode.ts`. Say in the brief when a child may break them.

## Review loop

1. **Focus.** Add `## Review focus` to `context.md`:
   - **Matters:** the 2–4 risks that would make this change unsafe to ship.
   - **Not a finding:** for example, internal tools, unlikely races, or style.
   - **P1 means:** the harm that blocks the merge. Everything else is P2.
   - **Origin:** each finding sets `origin`. `diff`: the change added it, or made an old problem worse or newly reachable; the proof cites a changed line. `existing`: it is on the base branch and the change does not affect it. When unsure: inside a changed hunk is `diff`, anything else is `existing`. Record `existing` problems in the code you read; do not search the repo for them.
2. **Review.** Start 2–3 fresh reviewers (`role: "review"`, `mode: "async"`), each with one angle: correctness, simplicity, verification, security, or docs. The verification reviewer checks that the `Goal → Check → Pass signal` proof in `checks.txt` shows the change works; missing tests are not a finding unless the user asked for tests. They record each finding with `report_finding` (or `review-finding add --brief <slug> ...` outside Pi), with `file:line`, proof, a P0/P1/P2 label, and `origin`.
3. **Triage.** When all reviewers have replied, call `review_findings` (or `review-finding merge <slug> [--since <iso>]` outside Pi). It splits findings into **Fix** (`diff`) and **Issue drafts** (`existing`). You own the verdict, with one line of reason for each:
   - `diff` → **block** or **cheap fix** by default, or **noise** when the claim is false. Change a P1 to P2 when it fails the brief's P1 rule.
   - `existing` → **issue draft** by default: title, `file:line`, proof, and why it is separate from this change. Move it to **block** only when the change cannot ship safely without it.
4. **Fix.** Fix small findings yourself. Give larger ones to one `role: "implementation"` child. Do not fix issue drafts in this change.

Clean means no block findings left. Stop after 3 rounds; `review-budget` limits each round to 3 reviewers. Report the rounds, the triage table, and the issue drafts. Create the issues (Linear by default, with the `work-items` skill) only after the user approves them. When the work is on a PR, push, then run `/pr-feedback`.
