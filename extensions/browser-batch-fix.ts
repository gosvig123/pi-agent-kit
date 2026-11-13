import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// pi-agent-browser-native (0.9.16 to 0.9.25) marks the page "unverified" after eval, back,
// forward, reload, connect, state load, or tab selection. The next content step then fails
// with "Run get url ... before page-content inspection" until the agent sends `get url`.
// In one week, 43 batch calls failed that way, and 17 more failed because a step started
// with `--session` ("Unknown command: --session"). This rewrites agent_browser batch input
// before it runs: it moves a step-level --session to the call, starts the batch with
// `get url` (cheap and read-only), and adds `get url` after each page-changing step.
const TRANSITIONS = new Set(["back", "connect", "eval", "forward", "reload"]);

function changesPage([command, subcommand]: string[]): boolean {
	if (TRANSITIONS.has(command)) return true;
	if (command === "state") return subcommand === "load";
	if (command === "tab") return subcommand !== undefined && subcommand !== "list" && subcommand !== "new";
	return false;
}

const isGetUrl = (step: string[] | undefined) => step?.[0] === "get" && step?.[1] === "url";
const navigates = (step: string[]) => step[0] === "open" || step[0] === "goto" || step[0] === "navigate";

export default function browserBatchFix(pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "agent_browser") return;
		const input = event.input as { args?: string[]; stdin?: string };
		if (!Array.isArray(input.args) || !input.args.includes("batch") || typeof input.stdin !== "string") return;

		let steps: unknown;
		try {
			steps = JSON.parse(input.stdin);
		} catch {
			return; // Let the wrapper report the stdin error.
		}
		if (!Array.isArray(steps) || !steps.every((step) => Array.isArray(step) && step.every((token) => typeof token === "string"))) return;

		let session: string | undefined;
		const fixed: string[][] = [];
		for (const raw of steps as string[][]) {
			let step = raw;
			if (step[0] === "--session" && step.length > 2) {
				session ??= step[1];
				step = step.slice(2);
			}
			if (fixed.length === 0 && step.length > 0 && !isGetUrl(step) && !navigates(step)) fixed.push(["get", "url"]);
			fixed.push(step);
			if (changesPage(step)) fixed.push(["get", "url"]);
		}
		// Drop a get url that is now doubled, such as one the agent already added.
		const result = fixed.filter((step, index) => !(isGetUrl(step) && isGetUrl(fixed[index + 1])));
		if (session && !input.args.includes("--session")) input.args = ["--session", session, ...input.args];
		input.stdin = JSON.stringify(result);
	});
}
