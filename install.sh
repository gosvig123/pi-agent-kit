#!/usr/bin/env bash
# Install the Pi agent kit and its companion packages into the Pi agent directory.
# Safe to run again: packages Pi already has are reconciled, and existing config files are kept.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

PACKAGES=(
  "git:github.com/gosvig123/pi-agent-kit"          # this kit: skills, prompts, extensions
  "npm:pi-mcp-adapter"                             # MCP servers from mcp-adapter.json
  "npm:context-mode"                               # sandboxed commands and indexed large output
  "npm:@samfp/pi-memory"                           # persistent facts and lessons
  "npm:@juicesharp/rpiv-ask-user-question"         # ask_user_question tool
  "npm:pi-agent-browser-native"                    # browser automation (needs agent-browser)
)

fail() {
  echo "install: $1" >&2
  echo "recovery: $2" >&2
  exit 1
}

command -v pi >/dev/null || fail "pi is not on PATH" "install Pi first, then run ./install.sh again"
command -v node >/dev/null || fail "node is not on PATH" "install Node.js 24.21 or newer"
mkdir -p "$AGENT_DIR"

# Prints "local" when settings.json already loads a local clone of this git repository.
# Maintainers keep editable clones (for example ~/.pi/agent/local/pi-agent-kit); installing the git copy too would load it twice.
loaded_locally() {
  node - "$AGENT_DIR/settings.json" "$1" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const [settingsPath, source] = process.argv.slice(2);
if (!fs.existsSync(settingsPath)) process.exit(0);
const repo = source.replace(/@[^/]*$/, "").split("/").pop();
const packages = JSON.parse(fs.readFileSync(settingsPath, "utf8")).packages ?? [];
const local = packages.map((p) => (typeof p === "string" ? p : p.source)).filter((p) => /^(\/|\.|~)/.test(p));
if (local.some((p) => path.basename(p) === repo)) console.log("local");
EOF
}

for source in "${PACKAGES[@]}"; do
  if [[ "$source" != npm:* && "$(loaded_locally "$source")" == local ]]; then
    echo "==> kept local clone for $source"
    continue
  fi
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
echo "Done. Restart Pi. Optional steps are in README.md (models, agent-browser)."
