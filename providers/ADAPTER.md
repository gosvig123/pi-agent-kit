## Other Agents (Claude Code, Codex, Antigravity)

The rules above and the shared skills were written for Pi. When you are not Pi, map each Pi-only tool to the nearest tool you have. When no tool matches, use the fallback.

| Pi tool | Use instead |
|---|---|
| `read`, `edit`, `write`, `bash` | Your own file and shell tools. |
| `ctx_execute`, `ctx_batch`, `ctx_search`, `ctx_index` | The context-mode tools when you have them. Otherwise run the command and filter the output in the shell (`rg`, `jq`, `head`). |
| `delegate_task`, `task_status`, `orchestrator_capabilities` | The T3 Code tools with the same names. Outside T3 Code, do the work yourself. |
| `ask_user_question` | Your own question tool (Claude `AskUserQuestion`). Otherwise ask in chat with 2–4 options. |
| `executor_search`, `executor_describe`, `executor_call`, `executor_execute` | The `executor` MCP server tools (`search`, `describe`, `call`, `execute`). |
| `better_web_search` | Your own web search and fetch tools. |
| `load_toolset browser`, `agent_browser` | The `agent-browser` CLI, or your own browser tools. |
| `review_findings`, `report_finding` | Use the `review-finding` CLI on PATH (`review-finding add --brief <slug> ...` and `review-finding merge <slug>`); it shares `~/.pi/agent/review-findings` with Pi. |
| `ctx_resume`, `session_lookup` | Not available. Skip them. |

- Pi skill paths such as `~/.agents/skills/pi/<name>/SKILL.md` work for you too. Load a skill by its name or read that file.
- Rules about Pi extensions (`extensions/child-mode.ts`, `[auto-heal]`, Pi `subagent`) do not apply to you.
