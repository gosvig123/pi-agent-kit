import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// T3 Code gives a delegate_task call without `target` the parent's model
// (Claude Opus 5.5). In one week, 77 children inherited Opus that way although
// the rules asked for GPT-6.1 Sol. This sets the default child model in code,
// so no prompt has to repeat it. An explicit `target` (council, user request) wins.
const DEFAULT_TARGET = {
	providerInstanceId: "pi",
	model: "openai-codex/gpt-6.1-sol",
	options: { thinking: "high" },
};
const DELEGATE_TOOLS = new Set(["mcp__t3-code__delegate_task", "mcp__t3_code__delegate_task"]);

export default function childTarget(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (!DELEGATE_TOOLS.has(event.toolName)) return;
		const input = event.input as { target?: Record<string, unknown> | null };
		if (!input.target || Object.keys(input.target).length === 0) input.target = structuredClone(DEFAULT_TARGET);
	});
}
