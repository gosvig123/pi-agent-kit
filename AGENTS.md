# Global Pi Rules

## Working Style

- Write in ASD-STE100 Simplified Technical English: short active sentences, common words. Make each answer clear without rereading the thread. Use the exact domain terms from `CONTEXT.md` (and `CONTEXT-MAP.md` when present). Define new terms once.
- Simplicity first, in ideas, design, and code. Prefer the smallest correct change: delete, reuse, or simplify before adding.
- Plans and work artifacts are temporary. Keep the plan in the conversation; write a plan file only when the work spans sessions or the user asks. When the work is done, move durable facts to `AGENTS.md`, `CONTEXT.md`, or docs, then delete the plan files, scratch notes, throwaway scripts and checks, and temp data you created. Delete an old plan or artifact that no longer matches the code; do not update it. Ask first if you did not create it.
- When the next step is clear and in scope, do it. Do not stop at a plan or ask again for permission already given. Continue until done, blocked, or a stop event in Larger Work.
- When confidence is low, gather more information. If still low, ask the user.
- Make errors actionable: operation, target, cause, and recovery step.

## Completion Reports

For completed fixes or changes:
- Start with the result and confirmed cause. State when the cause is unknown.
- Show what changed. Include exact paths or commands when useful.
- Give the next action only when needed.
- For non-trivial work, end with three short bullets:
  - Hardest decision: the key judgment and its basis.
  - Alternatives rejected: credible options and why they were unnecessary.
  - Remaining uncertainty: unknown causes, limits, or untested behavior.
- Omit empty sections. Never invent decisions, alternatives, or evidence.
- Use this structure instead of code-first or three-line output limits.

## Code

- One file, one clear domain concept or responsibility, named for it. Keep related code together. Extract a function only when it names a real operation or removes duplication.
- Prefer the standard library and native platform features. Add a dependency only when it removes more complexity than it adds.
- Keep control flow flat and side effects at system edges.
- When the user asks for tests: use real code paths and realistic, isolated data; assert observable results; mock only boundaries needed for safety or repeatability; copy real response shapes exactly; use the existing test runner.

## Function docstrings

Add a docstring when callers need details the function's name and types do not show, such as input limits, side effects, or behavior on empty input. Fix unclear variable names or unnecessary branches instead of explaining them in comments.

## Verification Loop

- Verify with the real system. Use the first option that works:
  1. Run the app and use it: UI through browser tools, API through real HTTP requests (use a subagent), CLI through real commands.
  2. Call the code directly with a one-off script against real modules and isolated data.
  3. Run the existing tests.
  Do not write new tests unless the user asks.
- If the app does not run, make it run locally first (env from examples, seed data, local services).
- Before the first iteration, write one plan: goal, exact check, pass signal, stop rule (pass, blocked, or 5 attempts with no new evidence), and every input needed from the user (credentials, accounts, test data, production access, destructive actions, product or design choices). Get approval once, then iterate without asking.
- Each iteration: change, run the check, read the real output, decide the next step. Show evidence (output, response body, or screenshot) for every claim.
- If a new input need appears, continue the work that does not depend on it, then ask once with all open needs.

## Larger Work

Work is large when it spans more than one component, needs more than ~5 file edits, or has an unclear end state.

Before large work, add these fields to the plan and get approval once. A user request that already states the scope and done signal is the approved plan:
- Done signal: the observable result that ends the work.
- Out of scope: what will not change.
- Slices: 2–5 steps. Each ends in a verified, working state.
- Budget: attempts per slice (default 5 with no new evidence) and expected files.

Stop and send a stop report when one of these occurs:
- Done: the done signal is observed.
- Blocked: a needed input, access, or decision is missing, and no remaining work avoids it.
- Budget: a slice uses its budget with no new evidence.
- Drift: the work needs changes out of scope, a new dependency, a schema or public API change, or a destructive action.
- Surprise: evidence contradicts a main assumption of the plan.

Between slices, do not ask. Write one line: slice done, evidence, next slice.

Stop report: state reached, evidence, what remains, 2–3 options with a recommendation. On Done, also list the artifacts deleted and any kept, with the reason.

## Project Notes

- Keep each app's `AGENTS.md` current with verified, reusable notes: setup, start commands, working directories, URLs, how to reach the UI, how to verify key workflows, and machine-specific differences. Fix stale notes. Link to docs instead of copying them. No secrets, task status, or guesses.
- After non-trivial project work, run the `context-gardener` delta check.
- Use `visual-explanations` when asked or when a visual makes a non-trivial answer clearer.
