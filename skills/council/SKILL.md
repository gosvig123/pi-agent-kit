---
name: council
description: Ask a council of three advisors (GPT-6.1 Sol at xhigh, Claude Opus 5.5 at xhigh, Claude Opus 5.5 at high) the same question, then compare their answers and give one verdict. Use for "council", "ask the council", "convene the council", "get other opinions", "what do the other models think", or a hard decision, design choice, or diagnosis where independent views help. Not for routine edits or questions with one clear answer.
---

# Council

Three advisors answer one question on their own. The parent compares the answers, checks the disputed facts, and gives one verdict. The council gives advice only. It does not change files.

## Roster

| Agent | Model | Thinking |
|---|---|---|
| `council-sol` | `openai-codex/gpt-6.1-sol` | `xhigh` |
| `council-opus` | `anthropic/claude-opus-5-5` | `xhigh` |
| `council-opus-high` | `anthropic/claude-opus-5-5` | `high` |

The profiles are in `../../agents/council-*.md`. Each advisor is read-only (`read`, `grep`, `find`, `ls`) and starts with fresh context: it does not see this conversation.

## Steps

1. **Write the brief.** Put in it everything an advisor needs, because it has no conversation history:
   - the question, in one or two sentences
   - the facts and constraints you already know
   - the absolute paths of the files or data to read
   - what a good answer looks like, and what is out of scope

   If the question is not clear, ask the user before you start.
2. **Start the council.** Send the same brief to all three advisors in one async run:

   ```js
   subagent({
     workflow: "parallel",
     async: true,
     args: { tasks: [
       { agent: "council-sol", task: brief },
       { agent: "council-opus", task: brief },
       { agent: "council-opus-high", task: brief },
     ] },
   })
   ```

   Always use `async: true`.

   Tell the user in one line that the council started. Then stop and wait for the completion message. Do not poll.
3. **Check the answers.** For each claim that the advisors dispute and that changes the verdict, read the source yourself. Accept the claim that the evidence supports, not the claim that most advisors make.
4. **Cross-examine (optional).** Do this only when the user asks, or when a dispute that changes the verdict remains after step 3. Do one round only: `resume` each advisor with the opposite claims and their evidence, and ask it to keep or change its answer.
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

- If an advisor fails, the run reports `failed`, but the completion message still lists the other outputs. Report the error, and continue with the other advisors. Do not put a different model in its place without the user's approval.
- If only one advisor answers, say that the council did not run, and show the one answer as a single opinion.
- To change a model or a thinking level, edit the matching `council-*.md` profile. Do not override models in the run.
