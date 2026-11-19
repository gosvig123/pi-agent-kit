---
name: delegation
description: "Start child agents: brief them with an evidence pack, run the end-of-work review loop, or ask a council of three advisors for one verdict. Use before any delegate_task launch, after the last slice of Larger Work, or for \"council\", \"get other opinions\", or a hard decision, design choice, or diagnosis."
---

# Delegation

Council (three advisors, one verdict, advice only): read and follow `references/council.md`.

## Child model

Omit `target` for the default child (GPT-6.1 Sol at high through Pi): the `child-target` extension fills it in. Set `target` only when the council roster or the user names another model. Never use the `codex` provider.

## Evidence pack (before you start children)

Make it in `/tmp/brief-<slug>/`. It holds inputs only. Delete it after the results arrive.

When a child writes a file, give it an output path in `~/Documents/pi-output/<YYYY-MM-DD>-<slug>/` (or the project), never in the brief folder. Then the paths in the child's report stay valid after you delete the brief.

- `context.md`: the goal and why; decisions already made (do not reopen them); invariants that define a pass, as testable statements ("if the label step fails, return the text without labels"); out of scope.
- Open decisions: if a decision can change the verdict, get it from the user before launch. For each other open decision, write the assumption to use.
- `range.diff`: for committed code, `git diff <base> <head> > range.diff`. Make sure it is not empty: a symlinked file belongs to the repo of its target.
- `checks.txt`: the real output of the tests, build, lint, and repro commands the children need, so each child does not run them again.
- Any PR body, issue text, or API response the child must read.

Children follow the child rules in `~/.pi/agent/local/pi-agent-kit/extensions/child-mode.ts`: no child agents, review loop, memory check, or questions to the human unless the brief asks, and a fixed reply shape (line 1 `✅ done`, `✅ clean`, `⚠️ <n> findings (P0 a / P1 b / P2 c)`, or `⛔ blocked: <cause>`). Say in the brief when a child may do one of those things, or when it must use another reply format.

In each brief, send only what is different for that child: `Read /tmp/brief-<slug>/context.md first.`, then its angle, its part of the code, what the other children cover, `cwd`, and the output path. Answer the likely questions: "If X is missing, assume Y and record it in `assumptions`. Ask the parent only for Z." Z is a decision that changes the verdict or the scope.

A child on another machine cannot read this machine's `/tmp`. Put the brief in the task text instead.

## Review loop (after the last slice)

Each round, start 2–3 fresh reviewers in parallel with `delegate_task` (`role: "review"`, `mode: "async"`). Give each one angle chosen from the change: correctness, simplicity, tests, security, or docs. Reviewers report only concrete issues that the diff causes, each with `file:line`, proof, and a P0/P1/P2 label.

- Reviewers record each finding with `report_finding` (the `review-findings` extension turns it on in review children). When a round's reviewers have replied, call `review_findings` with the brief slug and `since` set to the round's start time (ISO), so fixed findings from earlier rounds stay out, for one merged list, then fix each merged finding once.
- The `review-budget` extension blocks a 4th reviewer in a round or a 4th round once. Call again with the same input only when the user asked for it or the change needs it. The `brief-check` extension blocks a child whose brief files are missing, and once for a worktree child with uncommitted changes or an implementation brief with no pass signal.
- Fix small accepted findings yourself. Give larger ones to one `delegate_task` with `role: "implementation"`.
- At most 3 rounds. Clean means no P0 and no P1 worth fixing now.
- Put the rounds, fixes, and deferred findings in the completion report.
- When the work is on a PR, push the clean result, then run `/pr-feedback` (read `~/.pi/agent/local/pi-agent-kit/prompts/pr-feedback.md`).
