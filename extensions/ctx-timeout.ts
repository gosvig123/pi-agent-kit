import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// context-mode runs a command with no time limit when the call has no `timeout`; it
// leaves the limit to the host. pi-claude-bridge sets one only for bash. On 2026-10-28
// two sessions froze on a `grep -r` over ~/Developer (43 GB) and ~/.pi/agent (5.4 GB).
// This sets the same 120 s default as bash bridge calls. A call can still pass a larger value.
const CTX_TOOLS = new Set(["ctx_execute", "ctx_execute_file", "ctx_batch_execute"]);
const DEFAULT_TIMEOUT_MS = 120_000;

export default function ctxTimeout(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (!CTX_TOOLS.has(event.toolName)) return;
		const input = event.input as { timeout?: unknown };
		if (input.timeout === undefined) input.timeout = DEFAULT_TIMEOUT_MS;
	});
}
