# pi-agent-kit

A shared [Pi](https://pi.dev) agent setup: global working rules, skills, prompt templates, extensions, and an installer for the companion packages.

## Install

Requirements: Pi, Node.js 24.21 or newer, `git`, and the GitHub CLI (`gh auth login`).

```sh
git clone https://github.com/gosvig123/pi-agent-kit.git
cd pi-agent-kit
./install.sh
```

The installer:

1. Runs `pi install` for this kit and each companion package (see [Packages](#packages)).
2. Copies `AGENTS.md`, the subagent timeout config, and `config/mcp-adapter.json` into `~/.pi/agent`. It never overwrites a file that exists; it prints the path so you can merge by hand.
3. Adds the keys in `config/settings.defaults.json` to `~/.pi/agent/settings.json` only when they are not set.

Restart Pi after it finishes. Run `./install.sh` again at any time; it is safe to repeat. Run `pi update --extensions` to pull package updates.

To try only the kit for one session, without the installer: `pi -e git:github.com/gosvig123/pi-agent-kit`.

## What is in the kit

### Global rules

`AGENTS.md` holds the working style: plain short English, smallest correct change, verify with the real system, a plan and stop rules for larger work, and a fixed completion-report format. The installer copies it to `~/.pi/agent/AGENTS.md`. Edit your copy freely.

### Skills

| Skill | Use |
|---|---|
| archify | Validated architecture, workflow, sequence, data-flow, and lifecycle diagrams as standalone HTML |
| babysit | Watch CI, deploys, or rollouts, fix safe minor failures, re-check |
| blast-radius | What a change could break beyond its diff |
| context-gardener | Keep a project's `CONTEXT.md` glossary accurate |
| diagnose | Structured debugging for unclear, flaky, or performance bugs |
| domain-modeling | Domain terms, relationships, and rules during design work |
| frontend-design | Intentional visual direction for new UI |
| github-issues | Draft, create, search, and update GitHub issues |
| learn-from-session | Propose reusable lessons from corrections and failures |
| pr-description | Short pull request descriptions |
| self-heal | Recover from tool, extension, provider, and subagent failures |
| skill-creator | Create and improve skills |
| visual-explanations | Pick Markdown or Excalidraw visuals for explanations |

Optional skills. They load with the kit but need your own setup; without it they report the missing piece:

| Skill | Needs |
|---|---|
| gmail, google-calendar, slack | The `codex-exec` subagent (pi-subagents) and Codex/ChatGPT hosted connectors for those accounts |
| review-calls | A [Gappd](https://github.com/gosvig123/gappd) MCP server, or a transcript you paste in |
| macos-app-drive | macOS, with Accessibility permission for the terminal |

To turn off skills you do not want, run `pi config`, or narrow the kit entry in `~/.pi/agent/settings.json`:

```json
{ "source": "git:github.com/gosvig123/pi-agent-kit", "skills": ["!skills/gmail", "!skills/google-calendar", "!skills/slack"] }
```

### Prompt templates

| Command | Does |
|---|---|
| `/commit-only` | Commit relevant changes in themed commits, no push |
| `/commit-push` | Commit and push in themed commits |
| `/push-only` | Push the current branch |
| `/pr-review <number>` | Review a GitHub PR and report findings in chat |

### Extensions

| Extension | Does |
|---|---|
| better-web-search | `better_web_search` tool. Uses the Codex CLI login, or `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` |
| checkpoint-nudge | After long runs without user input, reminds the agent of the `AGENTS.md` larger-work check |
| self-heal | Groups failed tool results into one recovery message and allows one safe retry |
| fetch-error-normalizer | Marks failed `web_fetch` and fully failed `batch_web_fetch` results as errors so self-heal sees them |
| hunk-inline | Shows `edit` and `write` results as compact diffs |
| file-preview | Click file links in the transcript to open them in nvim; Alt+O quick open |
| right-column | Shared right-side column that the pi-desk task panel uses |
| cmux-needs-input | Sends a cmux notification when `ask_user_question` waits for you |
| subright | `/subright` opens the current Pi branch in a new cmux pane on the right |

The cmux and nvim extensions do nothing outside cmux or without nvim.

### Subagent

`agents/researcher.md` is a web research subagent. pi-subagents loads it from the kit (declared in `package.json`), replacing its built-in `researcher`, which needs search tools the kit does not install. It returns a sourced brief with a source ledger.

## Packages

| Package | Does |
|---|---|
| pi-subagents | Subagents, parallel review, scripted workflows |
| pi-mcp-adapter | MCP servers from `~/.pi/agent/mcp-adapter.json` (context7 and GitHub by default) |
| context-mode | Sandboxed command runs; large output is indexed instead of filling context |
| @samfp/pi-memory | Persistent facts and lessons across sessions |
| pi-smart-fetch | `web_fetch` and `batch_web_fetch` with browser-grade TLS |
| @juicesharp/rpiv-ask-user-question | `ask_user_question` tool with typed options |
| pi-agent-browser-native | Browser automation |
| pi-excalidraw | Excalidraw canvas tools |
| pi-claude-bridge | Use a Claude subscription as a Pi provider |
| pi-lazygit, pi-nvim | lazygit and nvim inside Pi |
| pi-tutor | `/tutor`: hint-first coding tutor that remembers topics |
| [pi-desk](https://github.com/gosvig123/pi-desk) | `/desk`: conversations, tasks, Tick results |
| [pi-tick](https://github.com/gosvig123/pi-tick/tree/pi-agent-kit) | Scheduled agent jobs (fork branch `pi-agent-kit`) |

Remove any package with `pi remove <source>`.

## Optional setup

**Models.** Pick your provider and model in Pi (`/model`). `config/subagent-models.example.json` shows per-subagent model overrides; copy the `subagents` block into `settings.json` if you use the same providers. `config/models.opencode-go.json` adds an OpenCode Go provider that reads its key from OpenCode's local login; merge it into `~/.pi/agent/models.json` only if you use OpenCode Go.

**Browser automation.** `brew install agent-browser` (0.35 or newer).

**Desk tasks.** The pi-desk task panel reads task lists from [tasks-go](https://github.com/gosvig123/tasks-go).

**cmux.** In cmux, run `cmux hooks pi install` to add cmux's own Pi session bridge.

**AI commit messages in lazygit.** `bin/pi-commit` writes a commit message for the staged diff through pi-claude-bridge, then opens it in `$EDITOR`. Add to lazygit's `config.yml`:

```yaml
customCommands:
  - key: "c"
    context: "files"
    command: "/path/to/pi-agent-kit/bin/pi-commit"
    output: terminal
    description: "Commit with a pi-written message"
```

## Notes

- npm 11 prints `install-scripts ... not yet covered by allowScripts` for `better-sqlite3` and `context-mode`. The scripts still run; the native SQLite module builds and loads.
- Pi warns at startup that `pi-smart-fetch` lists host packages as dependencies. This is an upstream packaging issue; the extension still loads.
- `skills/archify` and `skills/frontend-design` keep their own licenses.
