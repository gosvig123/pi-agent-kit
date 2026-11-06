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
//
// load_toolset also shortens the long context-mode tool descriptions through its
// prepareLoadout hook. The originals cost about 4k more tokens on every call; these keep
// each rule and drop the examples. Parameter descriptions stay unchanged.
const SHORT_DESCRIPTIONS: Record<string, string> = {
	ctx_execute:
		"Run code in a sandboxed subprocess (javascript, typescript, shell, python, ruby, go, rust, php, perl). Only what the code prints enters the conversation, so filter, count, parse, and aggregate inside the code and print only the answer. " +
		"Use it when output size is unknown (repo-wide greps, list endpoints, logs, query results). Pass `intent` to index output over ~5 KB and get section titles back; then use ctx_search. Pass `background: true` to keep a server or watcher alive. " +
		"Use bash instead for short known output, file changes, and cd/ls. Wrap risky calls in try/catch: uncaught errors go to stderr.",
	ctx_search:
		"Search the knowledge base: content stored by ctx_index and ctx_batch, plus auto-captured session memory (sources such as decision, error, error-resolution, blocker, plan, user-prompt, rejected-approach, compaction). " +
		"Matching uses stemming, substrings, typo correction, and proximity ranking. Put all related questions in one call, 2-4 specific terms per query. Use `source` to scope (partial match), `sort: \"timeline\"` for prior sessions and auto-memory (relevance covers only the current session), and `scope` (session, worktree, or project). " +
		"For one question about data that is not stored, run code with ctx_execute instead. Calls are throttled in a rolling window.",
	ctx_batch:
		"Run several shell commands in one call. Each output is indexed, and `queries` return the matching sections in the same call (this is the only search for that call, so include every question). Raw output is not returned. " +
		"Use it for 3 or more related commands, such as gh lookups, git log plus diff, or multi-file reads. Commands run one at a time. " +
		"To derive an answer, add a command that processes the output and prints only the result. For one command with no query, use ctx_execute.",
};

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
		summary: "context-mode maintenance: ctx_stats, ctx_doctor, ctx_upgrade, ctx_purge",
		tools: /^ctx_(stats|doctor|upgrade|purge)$/,
		sections: [],
		keywords: /\b(ctx[_-](stats|doctor|upgrade|purge)|context-mode (stats|doctor|upgrade|purge|dashboard))\b/i,
	},
	// The sets below hold tools that a week of sessions used less than once per 10 sessions.
	sessions: {
		summary: "session_lookup: find earlier Pi conversations by topic",
		tools: /^session_lookup$/,
		sections: [],
		keywords: /\b((earlier|previous|past|old|other) (pi )?(conversations?|sessions?|threads?|chats?)|session_lookup)\b/i,
	},
	background: {
		summary: "bg_wait: wait for detached or provider background work without native notification",
		tools: /^bg_wait$/,
		sections: [],
		keywords: /\bbg_wait\b/i,
	},
};
// In T3 Code, delegate_task replaces pi-subagents for a top-level session, so its tools stay
// parked there. Children of pi-subagents (PI_SUBAGENT_CHILD=1) inherit T3_MCP_URL
// but still need contact_supervisor, so they keep the tools.
if (process.env.T3_MCP_URL && process.env.PI_SUBAGENT_CHILD !== "1") {
	TOOLSETS.subagents = {
		summary: "pi-subagents: subagent, subagent_supervisor, contact_supervisor (in T3 Code use delegate_task instead)",
		tools: /^(subagent|subagents_enable|subagent_supervisor|contact_supervisor)$/,
		sections: [],
		keywords: /\b(pi-subagents|review-fanout|subagent_supervisor)\b/i,
	};
}
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
		prepareLoadout: () => ({ descriptions: SHORT_DESCRIPTIONS }),
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
