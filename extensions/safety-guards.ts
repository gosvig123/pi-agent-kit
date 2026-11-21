import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkAskQuestion, checkForcePush } from "../lib/guards/safety.ts";

// Enforces deterministic safety rules from AGENTS.md in Pi:
// - Blocks `git push --force` / `-f` / `+refspec` in bash, ctx_execute (shell), and ctx_batch.
// - Blocks `multiSelect: true` in ask_user_question (T3 Code rule).
function shellScripts(toolName: string, input: Record<string, unknown>): string[] {
	if (toolName === "bash") return [String(input.command ?? "")];
	if (toolName === "ctx_execute" && input.language === "shell") return [String(input.code ?? "")];
	if (toolName === "ctx_batch" && Array.isArray(input.commands)) {
		return input.commands
			.map((c) => (typeof c === "string" ? c : c && typeof c === "object" && typeof (c as { command?: unknown }).command === "string" ? (c as { command: string }).command : null))
			.filter((c): c is string => c !== null);
	}
	return [];
}

export default function safetyGuards(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		const input = (event.input ?? {}) as Record<string, unknown>;
		const askBlock = checkAskQuestion(event.toolName, input);
		if (askBlock) return { block: true, reason: askBlock };

		for (const script of shellScripts(event.toolName, input)) {
			const pushBlock = checkForcePush(script);
			if (pushBlock) return { block: true, reason: pushBlock };
		}
	});
}
