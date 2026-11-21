import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DELEGATE_TOOLS, checkDelegateBrief, type DelegateInput } from "../lib/guards/delegate.ts";

// Stops a delegate_task call whose child would start without what it needs.
// Check logic lives in ../lib/guards/delegate.ts so Claude Code hooks enforce the same rules.
export default function briefCheck(pi: ExtensionAPI) {
	const warned = new Set<string>();

	pi.on("tool_call", (event, ctx) => {
		if (!DELEGATE_TOOLS.has(event.toolName)) return;
		const input = event.input as DelegateInput;
		const res = checkDelegateBrief(input, ctx.cwd);
		if (res.hard) return { block: true, reason: res.hard };
		if (res.soft.length === 0) return;

		const key = JSON.stringify(input);
		if (warned.has(key)) return;
		warned.add(key);
		return {
			block: true,
			reason: `brief-check (blocked once): ${res.soft.join(" ")} To start the child anyway, call delegate_task again with the same input.`,
		};
	});
}
