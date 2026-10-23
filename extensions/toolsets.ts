import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Rarely used tool sets cost schema and prompt tokens on every turn of every session.
// This extension keeps them inactive until a prompt needs them, the session already
// used them, the user runs /toolset, or the model calls load_toolset.
//
// The claude-bridge provider fixes the tool list for one Claude Code query, which lasts
// until the model stops. load_toolset therefore asks the model to stop and queues a
// follow-up prompt; that prompt starts a fresh query with the loaded tools. Do not use
// `terminate`: it leaves the query waiting, and the bridge then reuses it.
interface Toolset {
	summary: string;
	tools: RegExp; // tool names in the set
	sections: string[]; // system prompt sections owned by the set
	skills?: RegExp; // skill names owned by the set, for skills an extension adds at runtime
	keywords: RegExp; // prompt words that load the set before the run starts
}

const TOOLSETS: Record<string, Toolset> = {
	browser: {
		summary: "agent_browser web automation: open pages, signed-in sites, clicks, forms, screenshots",
		tools: /^agent_browser/,
		sections: ["agent_browser"],
		keywords: /\b(browser|website|web ?page|screenshots?|click|log(ged)?[- ]?in|sign(ed)?[- ]in|gmail|inbox|hubspot|clay|n8n|whatsapp|linkedin|chrome|scrape|playwright)\b|agent_browser/i,
	},
	excalidraw: {
		summary: "Excalidraw canvas: diagrams, nodes, panels, screenshots of the canvas",
		tools: /^excalidraw_/,
		sections: [],
		keywords: /\b(excalidraw|diagrams?|whiteboard|canvas)\b/i,
	},
	tick: {
		summary: "tick scheduled agent jobs: create, list, delete recurring launchd jobs",
		tools: /^tick_/,
		sections: [],
		keywords: /\b(tick|cron|launchd|recurring|scheduled? (a )?(job|agent|run))\b/i,
	},
	aidlc: {
		summary: "AI-DLC lifecycle: approvals, handoffs, and questions for a ticket",
		tools: /^aidlc_/,
		sections: [],
		skills: /^aidlc(-|$)/,
		keywords: /\b(aidlc|ai-dlc)\b/i,
	},
	tasks: {
		summary: "tasks-go task lists: view, create, update, complete, and delete tasks and subtasks",
		tools: /^tasks_/,
		sections: [],
		keywords: /\b(task ?lists?|to-?dos?|subtasks?|my tasks|today'?s? (list|tasks)|tasks-go)\b/i,
	},
	cmux: {
		summary: "cmux panes: open a browser or terminal split, start another Pi session, annotate a browser",
		tools: /^cmux_/,
		sections: [],
		keywords: /\b(cmux|split pane|new pane|right pane|new (cmux )?(tab|workspace)|open (a )?terminal|hand ?off)\b/i,
	},
	"ctx-admin": {
		summary: "context-mode maintenance: ctx_stats, ctx_doctor, ctx_upgrade, ctx_purge, ctx_insight",
		tools: /^ctx_(stats|doctor|upgrade|purge|insight)$/,
		sections: [],
		keywords: /\b(ctx[_-](stats|doctor|upgrade|purge|insight)|context-mode (stats|doctor|upgrade|purge|insight|dashboard))\b/i,
	},
};
const ENTRY_TYPE = "toolset-load";

export default function toolsets(pi: ExtensionAPI) {
	const loaded = new Set<string>();
	const parked = new Map<string, string[]>(); // set name -> tools removed from the active set

	const toolsOf = (name: string, names: string[]) => names.filter((tool) => TOOLSETS[name].tools.test(tool));

	function park() {
		const active = pi.getActiveTools();
		for (const name of Object.keys(TOOLSETS)) {
			if (loaded.has(name)) continue;
			const tools = toolsOf(name, active);
			if (tools.length) parked.set(name, [...new Set([...(parked.get(name) ?? []), ...tools])]);
		}
		const hidden = new Set([...parked].filter(([name]) => !loaded.has(name)).flatMap(([, tools]) => tools));
		pi.setActiveTools(active.filter((tool) => !hidden.has(tool)));
	}

	function load(name: string, reason: string): boolean {
		if (loaded.has(name)) return false;
		loaded.add(name);
		const restore = parked.get(name) ?? toolsOf(name, pi.getAllTools().map((tool) => tool.name));
		pi.setActiveTools([...new Set([...pi.getActiveTools(), ...restore])]);
		pi.appendEntry(ENTRY_TYPE, { name, reason });
		return true;
	}

	pi.on("session_start", (_event, ctx) => {
		loaded.clear();
		parked.clear();
		// A set the session already used stays loaded, so the cached prompt prefix stays stable.
		for (const entry of ctx.sessionManager.getBranch() as any[]) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE && TOOLSETS[entry.data?.name]) loaded.add(entry.data.name);
			const toolName = entry.type === "message" && entry.message?.role === "toolResult" ? String(entry.message.toolName) : "";
			for (const name of Object.keys(TOOLSETS)) if (toolName && TOOLSETS[name].tools.test(toolName)) loaded.add(name);
		}
		park();
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType === "user") {
			for (const [name, set] of Object.entries(TOOLSETS)) if (set.keywords.test(event.prompt)) load(name, "prompt keywords");
		}
		park(); // other extensions may have re-activated parked tools
		for (const [name, set] of Object.entries(TOOLSETS)) {
			if (loaded.has(name)) continue;
			const options = event.systemPromptOptions;
			for (const section of set.sections) delete (options.sections as Record<string, unknown>)[section];
			if (set.skills && options.skills) options.skills = options.skills.filter((skill) => !set.skills!.test(skill.name));
		}
	});

	pi.registerTool({
		name: "load_toolset",
		label: "Load Toolset",
		description:
			"Load a hidden tool set before you use its tools. After the call, stop and the task continues automatically in a new turn with the tools available. Hidden sets: " +
			Object.entries(TOOLSETS).map(([name, set]) => `${name} (${set.summary})`).join("; ") + ".",
		parameters: Type.Object({
			name: Type.Union(Object.keys(TOOLSETS).map((name) => Type.Literal(name)), { description: "Tool set to load" }),
		}),
		async execute(_toolCallId, params) {
			if (!load(params.name, "load_toolset")) {
				return { content: [{ type: "text", text: `The ${params.name} tool set is already loaded.` }] };
			}
			pi.sendUserMessage(`[toolset] The ${params.name} tool set is now loaded. Continue the task.`, { deliverAs: "followUp" });
			return {
				content: [{
					type: "text",
					text: `Loaded the ${params.name} tool set. Its tools become available in the next turn. Stop now: reply with one short line and make no more tool calls. The task continues automatically.`,
				}],
			};
		},
	});

	pi.registerCommand("toolset", {
		description: "Show hidden tool sets, or load one: /toolset <name>",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (!name) {
				const lines = Object.entries(TOOLSETS).map(([key, set]) => `${loaded.has(key) ? "on " : "off"}  ${key} — ${set.summary}`);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}
			if (!TOOLSETS[name]) {
				ctx.ui.notify(`Unknown tool set "${name}". Known sets: ${Object.keys(TOOLSETS).join(", ")}.`, "error");
				return;
			}
			ctx.ui.notify(load(name, "/toolset") ? `Loaded the ${name} tool set for this session.` : `The ${name} tool set is already loaded.`, "info");
		},
	});
}
