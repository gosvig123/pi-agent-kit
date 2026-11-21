---
description: Wait for PR reviews (Copilot, Greptile, people), evaluate each comment, fix, push, reply, and resolve
argument-hint: [pr-number]
---

Handle the review feedback on a GitHub PR until no comment is left open.

User args: `$ARGUMENTS`
PR: first argument (`$1`). If it is missing, use the PR for the current branch (`gh pr view --json number`). If there is none, ask and stop.

## Flow

```
request bot reviews → wait → collect open comments → evaluate each → fix + verify → push → reply + resolve → wait for re-review (max 3 rounds) → report
```

## Authority

This prompt is approval to push fix commits to the PR branch, reply on review threads, and resolve them. It is not approval to merge, approve, dismiss reviews, force-push, rebase, or change the PR base. Do not post to other channels.

## 1. Request and wait

- Get `owner/repo`, head branch, and head SHA: `gh pr view $1 --json headRefName,headRefOid,url,reviewRequests,reviews`.
- If the repo rules say Copilot reviews every PR (`AGENTS.md`, `docs/`), and the PR has no Copilot review or request, run `gh pr edit $1 --add-reviewer @copilot`. Check that it registered: `gh api repos/OWNER/REPO/issues/$1/timeline --jq '.[]|select(.event=="review_requested")|.requested_reviewer.login'` must list `Copilot`. If it does not (seen once: both `gh pr edit` and the REST `requested_reviewers` call returned success but did nothing), do not wait for Copilot. Report that the user must request it in the GitHub UI.
- In T3 Code: call `watch_pull_request` on the PR URL and end your turn to wait for new reviews or checks instead of polling.
- Outside T3 Code (Pi terminal): wait in one bounded loop (20 min) until no review-bot check or bot review request is pending:

```bash
end=$((SECONDS+1200))
until gh pr view $1 --json statusCheckRollup,reviewRequests --jq '
  ([.statusCheckRollup[] | select(((.name // .context) // "") | test("review|greptile|coderabbit|copilot";"i"))
    | select(((.status // .state) // "") | test("^(COMPLETED|SUCCESS|FAILURE|ERROR|NEUTRAL|SKIPPED)$") | not)] | length == 0)
  and ([.reviewRequests[] | select(.__typename == "Bot" or (((.login // .name) // "") | test("copilot|bot";"i")))] | length == 0)' | grep -q true
do [ $SECONDS -ge $end ] && { echo "review wait timed out"; break; }; sleep 30; done
```

- Do not wait for people. Handle the human comments that are already posted.
- On timeout, handle what is there and report which reviewer did not finish.

## 2. Collect

Run `pr-fb collect $1` (returns unresolved inline threads with `threadId`, `firstCommentId`, `isBot`, plus review bodies and PR comments, skipping non-review status bots).

- Read the whole comment, not only the title. Greptile and Copilot put the reason and the suggested fix in the body.

## 3. Evaluate

Judge each comment on evidence, not on the reviewer or the badge. Read the code at the PR head, check the claim, and choose one:

| Decision | When | Action |
|---|---|---|
| Fix | The claim is true, and the fix is in the scope of the PR | Smallest change that removes the problem |
| Decline | The claim is false, out of date, or against the repo or user rules | Reply with the reason and evidence (`path:line`, command output) |
| Follow-up | The claim is true, but the PR did not cause it: the problem is on the base branch and the PR does not make it worse or newly reachable | Do not change code. Draft an issue (title, `path:line`, proof, why it is separate). Create it (Linear by default, `work-items` skill) only after the user approves. |
| Ask | Product, scope, architecture, or public API decision; or the fix needs a new dependency, migration, or destructive action | Do not change code. Leave the thread open. List it for the user. |

- Bot suggestions are often generic. Do not apply a suggestion only because a bot made it.
- The user rules still apply. For example, if the rules say "no new tests unless the user asks", then a request for tests is **Ask**, not **Fix**.
- Several comments about one cause get one fix.

## 4. Fix and verify

- Work in the PR's worktree or branch. Keep to one writer. If the repo requires a worktree, use one.
- Apply the accepted fixes. Run the checks that cover them (the same checks the PR description lists, plus the narrow test for the changed code). Read the real output.
- If a fix fails its check twice with no new evidence, revert it, and change its decision to **Ask**.
- Make one commit per round: `fix: address review feedback` with one line for each comment it addresses. Push to the PR branch with `git push` (never `--force`).

## 5. Reply and resolve

Use `pr-fb reply` for every inline thread (it checks that `--sha` is pushed, prepends `🤖 *<agent>, replying on behalf of @<login>.*`, and enforces resolution rules: resolves fixes, approved follow-ups, and declined bot threads; leaves human declines and `Ask` threads open):

```bash
pr-fb reply $1 --thread <threadId> --decision fix      --sha <short-sha> --text "<what changed>"
pr-fb reply $1 --thread <threadId> --decision decline  --text "<reason>. <evidence>."
pr-fb reply $1 --thread <threadId> --decision followup --issue "<issue link>"   # only after user approves and issue exists
pr-fb reply $1 --thread <threadId> --decision ask      --text "<the question>"
```

For a top-level review body or PR comment (not an inline thread), reply with `gh pr comment $1 --body "🤖 *Agent, replying on behalf of @<login>.*\n\n..."` and quote the point.

## 6. Re-review

- After a push, bots may review again. Go back to step 1. Re-request Copilot only when the round changed code that it commented on.
- Stop when there are no new unresolved threads, when only **Ask** and **Follow-up** items are left, or after 3 rounds.

## Report

```
✅ PR #<n>: <k> comments handled in <r> rounds — <url>

| Reviewer | Comment | Decision | Commit / reply |
|---|---|---|---|
| greptile-apps | `path:line` short title | Fix / Decline / Follow-up / Ask | `<sha>` · link |

Checks: <command → result>
Open for you: <Ask items, each with the question>
Issue drafts: <Follow-up items, each with title and `path:line`; approve to create them>
```

Use ⚠️ instead of ✅ when a reviewer timed out or a check failed, and say which.
