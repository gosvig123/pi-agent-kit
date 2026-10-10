#!/usr/bin/env bash
# Install the Pi agent kit and its companion packages into the Pi agent directory.
# Safe to run again: packages Pi already has are reconciled, and existing config files are kept.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

PACKAGES=(
  "git:github.com/gosvig123/pi-agent-kit"          # this kit: skills, prompts, extensions
  "npm:pi-subagents"                               # subagents, workflows, parallel review
  "npm:pi-mcp-adapter"                             # MCP servers from mcp-adapter.json
  "npm:context-mode"                               # sandboxed commands and indexed large output
  "npm:@samfp/pi-memory"                           # persistent facts and lessons
  "npm:pi-smart-fetch"                             # web_fetch / batch_web_fetch
  "npm:@juicesharp/rpiv-ask-user-question"         # ask_user_question tool
  "npm:pi-agent-browser-native"                    # browser automation (needs agent-browser)
  "npm:pi-excalidraw"                              # Excalidraw canvas for visual-explanations
  "npm:pi-claude-bridge"                           # Claude subscription provider
  "npm:pi-lazygit"                                 # lazygit inside Pi
  "npm:pi-tutor"                                   # tutor mode
  "https://github.com/carderne/pi-nvim"            # nvim integration
  "git:github.com/gosvig123/pi-desk"               # /desk: conversations, tasks, Tick results
  "git:github.com/gosvig123/pi-tick@pi-agent-kit"  # scheduled agent jobs
)

fail() {
  echo "install: $1" >&2
  echo "recovery: $2" >&2
  exit 1
}

command -v pi >/dev/null || fail "pi is not on PATH" "install Pi first, then run ./install.sh again"
command -v node >/dev/null || fail "node is not on PATH" "install Node.js 24.21 or newer"
mkdir -p "$AGENT_DIR"

for source in "${PACKAGES[@]}"; do
  echo "==> pi install $source"
  pi install "$source" || fail "pi install $source failed" "fix the error above, then run ./install.sh again"
done

copy_if_absent() {
  local from="$KIT_DIR/$1" to="$AGENT_DIR/$2"
  if [ -e "$to" ]; then
    echo "==> kept existing $to (compare with $from)"
  else
    mkdir -p "$(dirname "$to")"
    cp "$from" "$to"
    echo "==> added $to"
  fi
}

copy_if_absent AGENTS.md AGENTS.md
copy_if_absent config/subagent.json extensions/subagent/config.json
copy_if_absent config/mcp-adapter.json mcp-adapter.json

# Add kit defaults to settings.json only where the key is not set yet.
node - "$AGENT_DIR/settings.json" "$KIT_DIR/config/settings.defaults.json" <<'EOF'
const fs = require("node:fs");
const [settingsPath, defaultsPath] = process.argv.slice(2);
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
const defaults = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
const added = Object.keys(defaults).filter((key) => !(key in settings));
for (const key of added) settings[key] = defaults[key];
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`==> settings.json: ${added.length ? "added " + added.join(", ") : "no new keys"}`);
EOF

echo
echo "Done. Restart Pi. Optional steps are in README.md (models, agent-browser, tasks-go, cmux)."
