// Pure safety checks shared by Pi extensions and Claude Code PreToolUse hooks.

// Split on shell control operators after neutralizing quoted strings & heredocs.
const CMD_SPLIT = /(?:&&|\|\||\$\(|[;&|\n`()])+/;
const GIT_GLOBAL_VAL_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env"]);

/**
 * Normalizes a shell snippet for static command inspection:
 * - Strips heredoc bodies (`<<EOF ... EOF`).
 * - Single-token quoted strings (like `"--force"` or `'-f'`) unwrap to their inner token so quoted flags are caught.
 * - Multi-word or operator-containing quoted strings (like commit messages `"a; git push -f"`) collapse to `""`.
 */
function normalizeShell(script: string): string {
	// Strip simple heredoc bodies so literal text inside heredocs never triggers command checks.
	let out = script.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2(?=\n|$)/g, "<<HEREDOC");
	out = out.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"/g, (_m, single: string | undefined, dbl: string | undefined) => {
		const inner = single !== undefined ? single : (dbl ?? "").replace(/\\(.)/g, "$1");
		return /^[^\s;&|`$()<>]+$/.test(inner) ? inner : '""';
	});
	return out;
}

/**
 * Detects `git push` with `--force`, `--force-with-lease[=...]`, `--force-if-includes`,
 * `-f` (including combined short flags like `-uf`), or forced `+refspec` (`+HEAD:main`).
 */
export function checkForcePush(script: string): string | null {
	const normalized = normalizeShell(script);
	for (const rawSeg of normalized.split(CMD_SPLIT)) {
		const tokens = rawSeg.trim().split(/\s+/).filter(Boolean);
		if (tokens.length === 0) continue;

		// Skip leading env assignments (`FOO=1 BAR=2`) and `env` / `command` wrappers.
		let i = 0;
		while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || tokens[i] === "env" || tokens[i] === "command")) {
			i++;
		}
		if (i >= tokens.length || !/^(?:.*\/)?git$/.test(tokens[i])) continue;
		i++;

		// Skip global git flags before the subcommand (`-C dir`, `-c k=v`, `--no-pager`, `--git-dir=...`).
		while (i < tokens.length && tokens[i].startsWith("-")) {
			const tok = tokens[i];
			i++;
			if (GIT_GLOBAL_VAL_FLAGS.has(tok) && i < tokens.length) i++;
		}
		if (tokens[i] !== "push") continue;

		// Inspect arguments to `git push`.
		let afterDoubleDash = false;
		for (let j = i + 1; j < tokens.length; j++) {
			const arg = tokens[j];
			if (!afterDoubleDash && arg === "--") {
				afterDoubleDash = true;
				continue;
			}
			if (!afterDoubleDash) {
				if (/^--force(?:-[a-z-]+)?(?:=.*)?$/i.test(arg)) {
					return "Blocked git force-push (`--force` / `--force-with-lease`). Ask the user for explicit approval before rewriting remote history.";
				}
				if (/^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg)) {
					return "Blocked git force-push (`-f`). Ask the user for explicit approval before rewriting remote history.";
				}
			}
			// Forced refspec (`+main`, `+HEAD:refs/heads/main`), excluding standalone `+`.
			if (/^\+[^\s]+/.test(arg)) {
				return "Blocked git force-push (`+refspec`). Ask the user for explicit approval before rewriting remote history.";
			}
		}
	}
	return null;
}

const ASK_TOOLS = new Set([
	"ask_user_question",
	"AskUserQuestion",
	"mcp__t3-code__ask_user_question",
	"mcp__t3_code__ask_user_question",
]);

function hasMultiSelectFlag(obj: Record<string, unknown>): boolean {
	return obj.multiSelect === true || obj.is_multi_select === true || obj.multi_select === true;
}

/**
 * Blocks `multiSelect: true` in ask_user_question (AGENTS.md: never set multiSelect: true in T3 Code).
 */
export function checkAskQuestion(toolName: string, input: Record<string, unknown>): string | null {
	if (!ASK_TOOLS.has(toolName)) return null;
	if (hasMultiSelectFlag(input)) {
		return "Blocked multiSelect: true in ask_user_question (AGENTS.md rule for T3 Code). Ask with single-select options instead.";
	}
	if (Array.isArray(input.questions)) {
		for (const q of input.questions) {
			if (q && typeof q === "object" && hasMultiSelectFlag(q as Record<string, unknown>)) {
				return "Blocked multiSelect: true in ask_user_question (AGENTS.md rule for T3 Code). Ask with single-select options instead.";
			}
		}
	}
	return null;
}
