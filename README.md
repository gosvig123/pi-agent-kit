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

1. Runs `pi install` for this kit and each companion package (see [Packages](#packages)). Team-only packages install only when your git login can read them; otherwise the installer prints `skipped`. If a package is already loaded from a local clone with the same repository name (for example `~/.pi/agent/local/pi-agent-kit`), the installer keeps the clone and does not install a second copy.
2. Copies `AGENTS.md` and `config/mcp-adapter.json` into `~/.pi/agent`. It never overwrites a file that exists; it prints the path so you can merge by hand.
3. Adds the keys in `config/settings.defaults.json` to `~/.pi/agent/settings.json` only when they are not set.

Restart Pi after it finishes. Run `./install.sh` again at any time; it is safe to repeat. Run `pi update --extensions` to pull package updates.

To try only the kit for one session, without the installer: `pi -e git:github.com/gosvig123/pi-agent-kit`.

## What is in the kit

### Global rules

`AGENTS.md` holds the working style: plain short English, smallest correct change, verify with the real system, a plan and stop rules for larger work, and a fixed completion-report format. The installer copies it to `~/.pi/agent/AGENTS.md`. Edit your copy freely.

### Skills

| Skill | Use |
|---|---|
| archify | Validated architecture, workflow, sequence, data-flow, lifecycle, ERD, class, tree, timeline, and waterfall diagrams, and one-page explainers, as standalone HTML. Vendored from [tt-a1i/archify](https://github.com/tt-a1i/archify) v3.2.0 |
| council | Ask three advisor models the same question and compare their answers |
| delegation | Evidence pack for child agents, and the end-of-work review loop |
| diagnose | Debugging, change risk (blast radius), monitoring CI or deploys, and Pi failure recovery |
| frontend-design | Intentional visual direction for new UI |
| project-memory | `CONTEXT.md` check, domain modeling, lessons from sessions, and skill creation |

Each merged skill has a short `SKILL.md` that routes to one file in `references/`, so the always-loaded skill list stays small.

Optional skills. They load with the kit but need your own setup; without it they report the missing piece:

| Skill | Needs |
|---|---|
| review-calls | A [Gappd](https://github.com/gosvig123/gappd) MCP server, or a transcript you paste in |
| macos-app-drive | macOS, with Accessibility permission for the terminal |

To turn off skills you do not want, run `pi config`, or narrow the kit entry in `~/.pi/agent/settings.json`:

```json
{ "source": "git:github.com/gosvig123/pi-agent-kit", "skills": ["!skills/review-calls", "!skills/macos-app-drive"] }
```

### Prompt templates

| Command | Does |
|---|---|
| `/commit-only` | Commit relevant changes in themed commits, no push |
| `/commit-push` | Commit and push in themed commits |
| `/push-only` | Push the current branch |
| `/pr-review <number>` | Review a GitHub PR and report findings in chat |
| `/pr-feedback [number]` | Wait for PR reviews, evaluate each comment, push fixes, reply as an agent, and resolve |

### Extensions

| Extension | Does |
|---|---|
| better-web-search | `better_web_search` tool. Uses the Codex CLI login, or `BRAVE_SEARCH_API_KEY` / `TAVILY_API_KEY` |
| checkpoint-nudge | After long runs without user input, reminds the agent of the `AGENTS.md` larger-work check |
| self-heal | Groups failed tool results into one recovery message and allows one safe retry |
| toolsets | Keeps rarely used tool sets out of new sessions: browser (with its rules block), tasks, ctx-admin (`ctx_stats`, `ctx_doctor`, `ctx_upgrade`, `ctx_purge`), and sessions (`session_lookup`). It also gives the context-mode tools short descriptions through the `load_toolset` `prepareLoadout` hook. A set loads when the prompt names it (for example "browser" or "todo"), when the session already used it, with `/toolset <name>`, or when the model calls `load_toolset`. A `load_toolset` call ends the reply and a follow-up prompt continues with the tools |
| session-lookup | `session_lookup` tool: finds earlier Pi conversations (terminal and T3 Code threads) by topic, folder, and date. Summaries are cached in `~/.pi/agent/pisesh-search-index.json`; titles saved by the retired pi-desk still show |
| slow-search-guard | In `bash`, `ctx_execute` shell, and `ctx_batch`, rewrites `grep -r` to an equivalent `rg` call, and `find` over `/`, `~`, `~/Developer`, `~/Library`, `~/.pi`, or `~/.pi/agent` (without `-maxdepth` 2 or less) to `fd -HI`. The result starts with a note that names the command that ran. Calls it cannot translate safely (`find -prune`/`-o`/`-exec`, `grep -f`) are blocked with a reason. 0.1–0.3 s instead of 14–120+ s |

`config/settings.defaults.json` also keeps new sessions small: it excludes skills that are rarely used in Pi (Hyperframes engine skills, figma, media-use, claude-design, ctx-* commands), and compacts `anthropic/claude-opus-5-5` at about 200k instead of near its 1M window.

## Packages

| Package | Does |
|---|---|
| pi-mcp-adapter | MCP servers from `~/.pi/agent/mcp-adapter.json` (context7 and GitHub by default) |
| context-mode | Sandboxed command runs; large output is indexed instead of filling context |
| @samfp/pi-memory | Persistent facts and lessons across sessions |
| @juicesharp/rpiv-ask-user-question | `ask_user_question` tool with typed options |
| pi-agent-browser-native | Browser automation |

Remove any package with `pi remove <source>`.

## Optional setup

**Models.** Pick your provider and model in Pi (`/model`). `config/models.opencode-go.json` adds an OpenCode Go provider that reads its key from OpenCode's local login; merge it into `~/.pi/agent/models.json` only if you use OpenCode Go.

**Browser automation.** `brew install agent-browser` (0.35 or newer).

**Updates.** `bin/pi-up` updates Pi and every package, then starts Pi once in print mode to prove all extensions load. It handles both installs: Pi in a private npm prefix (it relinks `pi` when another package ships an old `pi` bin) and a global npm install. `pi-up --host <ssh-host>` does the same on another machine; the host needs only Pi. Put it on PATH (`ln -s "$PWD/bin/pi-up" ~/.local/bin/pi-up`), and schedule it weekly with T3 Code `schedule_task` if you want automatic updates. Exit code 1 means a machine failed; the output names the extension or login that broke.

**AI commit messages in lazygit.** `bin/pi-commit` writes a commit message for the staged diff through the `anthropic` provider, then opens it in `$EDITOR`. Add to lazygit's `config.yml`:

```yaml
customCommands:
  - key: "c"
    context: "files"
    command: "/path/to/pi-agent-kit/bin/pi-commit"
    output: terminal
    description: "Commit with a pi-written message"
```

## One setup for everyone

`install.sh` is the single package list. To add or remove a package, change the `PACKAGES` list, run `./install.sh` (or `pi remove <source>`), then commit and push. Everyone who runs `./install.sh` again gets the same setup.

Keep personal values out of this repository: provider and model choice, credentials, and private MCP servers belong in your own `~/.pi/agent/settings.json` and `~/.pi/agent/mcp-adapter.json`.

## Notes

- npm 11 prints `install-scripts ... not yet covered by allowScripts` for `better-sqlite3` and `context-mode`. The scripts still run; the native SQLite module builds and loads.
- Web pages come from context-mode's `ctx_index` with `url` (plain HTTP). Sites behind Cloudflare or bot checks (openai.com, npmjs.com, Zendesk help centers, LinkedIn, Medium) return 403 or a challenge page; open those with the browser tool set.
- `skills/archify` and `skills/frontend-design` keep their own licenses.
