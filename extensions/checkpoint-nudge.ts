import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Prose stop rules fade in long runs. This extension counts work done since the
// last user message and steers the agent to the AGENTS.md "Larger Work" check.
const FILE_STEP = 5; // Matches the "~5 file edits" large-work threshold.
const CALL_STEP = 40;
const EDIT_TOOLS = new Set(["edit", "write"]);

function checkpointPrompt(files: number, calls: number): string {
	return `CHECKPOINT: This run edited ${files} files with ${calls} tool calls since the last user message.
Apply AGENTS.md "Larger Work" now:
- If this is large work and neither the user request nor an approved plan states the scope and done signal, stop and propose a plan.
- If a stop event holds (done, blocked, budget, drift, surprise), stop and send a stop report.
- Otherwise write one line (slice done, evidence, next slice) and continue without asking.`;
}

export default function checkpointNudge(pi: ExtensionAPI) {
	const files = new Set<string>();
	let calls = 0;
	let nextFiles = FILE_STEP + 1;
	let nextCalls = CALL_STEP;

	pi.on("agent_start", () => {
		files.clear();
		calls = 0;
		nextFiles = FILE_STEP + 1;
		nextCalls = CALL_STEP;
	});

	pi.on("tool_result", (event) => {
		calls += 1;
		if (!event.isError && EDIT_TOOLS.has(event.toolName) && typeof event.input.path === "string") {
			files.add(event.input.path);
		}
		if (files.size < nextFiles && calls < nextCalls) return;

		while (nextFiles <= files.size) nextFiles += FILE_STEP;
		while (nextCalls <= calls) nextCalls += CALL_STEP;
		pi.sendMessage(
			{ customType: "checkpoint-nudge", content: checkpointPrompt(files.size, calls), display: true },
			{ deliverAs: "steer" },
		);
	});
}
