import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Every turn re-reads the whole context, so one large tool result is paid for again on
// every later turn. Session analysis showed bash results over 8 KB are 5% of calls but 39%
// of bash output. This extension saves such results to a file and gives the model the
// head, the tail, and the file path instead. ctx_batch_execute output is also indexed by
// context-mode, so ctx_search can return any omitted section.
const SPILL_TOOLS = new Set(["bash", "gappd_query", "ctx_batch_execute"]);
const LIMIT = 8_000;
const HEAD = 2_500;
const TAIL = 1_500;
const KEEP_DAYS = 7;
const ROOT = join(homedir(), ".pi", "agent", "tmp", "tool-output");

function removeOldSpills() {
	const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
	try {
		for (const dir of readdirSync(ROOT)) {
			const path = join(ROOT, dir);
			if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
		}
	} catch {
		// No spill directory yet.
	}
}

export default function outputSpill(pi: ExtensionAPI) {
	pi.on("session_start", () => removeOldSpills());

	pi.on("tool_result", (event, ctx) => {
		// Nested calls feed a calling script, not the model, so they keep their full output.
		if (!SPILL_TOOLS.has(event.toolName) || event.parentToolCallId) return;
		const text = event.content.map((block) => (block.type === "text" ? block.text : "")).join("");
		if (text.length <= LIMIT) return;

		const dir = join(ROOT, ctx.sessionManager.getSessionId());
		const path = join(dir, `${event.toolName}-${event.toolCallId.replace(/[^\w.-]/g, "_")}.txt`);
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(path, text);
		} catch (error) {
			// Keep the full result when the file cannot be written; losing output is worse.
			console.error(`output-spill: could not write ${path}: ${(error as Error).message}. The full result stays in context.`);
			return;
		}
		const lines = text.split("\n").length;
		const note =
			`\n\n[… ${(text.length - HEAD - TAIL).toLocaleString("en-US")} chars omitted. Full output (${text.length.toLocaleString("en-US")} chars, ${lines.toLocaleString("en-US")} lines) saved to ${path}. ` +
			`Inspect it with read (offset/limit), grep, or ctx_execute_file. Do not print it again in full.]\n\n`;
		const images = event.content.filter((block) => block.type === "image");
		return {
			content: [{ type: "text", text: text.slice(0, HEAD) + note + text.slice(-TAIL) }, ...images],
			structuredContent: event.structuredContent,
		};
	});
}
