---
name: council
description: Ask three advisors (GPT-6.1 Sol xhigh, Claude Opus 5.5 xhigh and high) the same question, then compare and give one verdict. Use for "council", "get other opinions", or a hard decision, design choice, or diagnosis. Not for routine edits.
---

# Council

Three advisors answer one question on their own. The parent compares the answers, checks the disputed facts, and gives one verdict. The council gives advice only. It does not change files.

## Roster

| Advisor | `delegate_task` target |
|---|---|
| sol | `{"providerInstanceId": "pi", "model": "openai-codex/gpt-6.1-sol", "options": {"thinking": "xhigh"}}` |
| opus | `{"providerInstanceId": "pi", "model": "anthropic/claude-opus-5-5", "options": {"thinking": "xhigh"}}` |
| opus-high | `{"providerInstanceId": "pi", "model": "anthropic/claude-opus-5-5", "options": {"thinking": "high"}}` |

Each advisor starts with fresh context: it does not see this conversation.

## Steps

1. **Write the brief.** Put in it everything an advisor needs, because it has no conversation history:
   - the question, in one or two sentences
   - the facts and constraints you already know
   - the absolute paths of the files or data to read
   - what a good answer looks like, and what is out of scope
   - this advisor block, unchanged:

   ```
   You are one advisor on a council. Answer on your own; you do not see the other advisors.
   - Read the evidence named above directly. Cite `path:line` or the source for each factual claim. Mark guesses as guesses.
   - Do not edit files, run commands that change state, commit, push, or start other agents.
   - Disagree when the evidence supports it. Do not hedge to sound balanced.
   Return, in at most 300 words: 1. Answer (1-2 lines). 2. Reasons (up to 5, each with evidence). 3. Risks. 4. Confidence (low, medium, high) and what would change your mind.
   ```

   If the question is not clear, ask the user before you start.
2. **Start the council.** Start three `delegate_task` calls in one batch, one per roster row, each with `role: "research"`, `mode: "async"`, and the same brief. Tell the user in one line that the council started. Then stop and wait for the completion wake-ups. Do not poll.
3. **Check the answers.** For each claim that the advisors dispute and that changes the verdict, read the source yourself. Accept the claim that the evidence supports, not the claim that most advisors make.
4. **Cross-examine (optional).** Do this only when the user asks, or when a dispute that changes the verdict remains after step 3. Do one round only: start a new `delegate_task` per advisor with the brief, its first answer, and the opposite claims with their evidence, and ask it to keep or change its answer.
5. **Report** in this shape:

   ```
   Verdict: <one-line answer>

   | Advisor | Answer | Confidence |
   |---|---|---|
   | sol | ... | ... |
   | opus | ... | ... |
   | opus-high | ... | ... |

   Agree: <points that all advisors share>
   Disputed: <claim → what the evidence shows>
   Owner decisions: <choices only the user can make>
   ```

## Failures

- If an advisor fails, report its error and continue with the other advisors. Do not put a different model in its place without the user's approval.
- If only one advisor answers, say that the council did not run, and show the one answer as a single opinion.
- To change a model or a thinking level, edit the roster table above.
