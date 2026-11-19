import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// T3 Code starts every delegate_task child with "Act as the <role> sub-agent for this task."
// (444 of 444 child sessions, Nov 2026). Children also load the parent rules in AGENTS.md, so
// 54% called ctx_resume on an empty session, 41 ran the project-memory check, and implementation
// children started their own review loops. This adds child rules that take precedence.
// If T3 changes that first line, children silently get only the parent rules.
const CHILD_START = /^Act as the [\w-]+ sub-agent for this task\./;
// context-mode adds this hint to every new session; a child session is always new.
const RESUME_HINT = /^This session may have run before\..*(\n|$)/m;
const SECTION = "child_agent";
const RULES = `You are a child agent. A parent agent started you with delegate_task and reads only your final reply. Where these rules differ from AGENTS.md, these rules win.
- Do not call ctx_resume. Your session is new; the brief holds the context.
- Your brief is the approved plan. Do not ask for plan approval. Stay in its scope; report out-of-scope needs instead of doing them.
- Start no child agents and run no review loop unless your brief asks for it. The parent owns the review loop.
- Do not run the project-memory check or edit CONTEXT.md or AGENTS.md files unless your brief asks. Put lessons worth keeping under "Memory candidates" in your reply.
- Do not call record_decision or ask_user_question unless your brief allows it. When a charter decision or a missing input blocks you, stop and reply ⛔ with the decision or input the parent must get.
- Final reply, unless your brief gives another format: line 1 is "✅ done", "✅ clean", "⚠️ <n> findings (P0 a / P1 b / P2 c)", or "⛔ blocked: <cause>". Then the results or findings, each with path:line and proof. Then these sections, left out when empty: "Assumptions", "Files written" (absolute paths), "Memory candidates". Keep it under 40 lines; put longer detail in a file at the output path from your brief.`;

function firstUserText(entries: unknown[]): string {
	for (const entry of entries as { type?: string; message?: { role?: string; content?: unknown } }[]) {
		if (entry.type !== "message" || entry.message?.role !== "user") continue;
		const content = entry.message.content;
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content.map((part) => (part?.type === "text" ? part.text : "")).join("");
	}
	return "";
}

export default function childMode(pi: ExtensionAPI) {
	pi.on("before_agent_start", (event, ctx) => {
		const start = firstUserText(ctx.sessionManager.getEntries()) || (event.prompt ?? "");
		if (!CHILD_START.test(start.trimStart())) return;

		const options = event.systemPromptOptions;
		if (options.forceSystemPrompt !== undefined) {
			return { systemPrompt: event.systemPrompt.replace(RESUME_HINT, "") + `\n\n<${SECTION}>\n${RULES}\n</${SECTION}>` };
		}
		const contextMode = options.sections.context_mode;
		if (typeof contextMode === "string") options.sections.context_mode = contextMode.replace(RESUME_HINT, "");
		options.sections[SECTION] = RULES;
	});
}
