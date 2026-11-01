import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Pins the first prompt of the session above the editor, so a long or resumed
// session still shows what it is for. Collapsed: one line with the first prompt and
// the count of later prompts. Expanded (ctrl+shift+p or /trail): the first prompt in
// full and the most recent later prompts, which often change the goal.

type Prompt = { time: number; text: string };
type Content = string | { type: string; text?: string }[];

const WIDGET = "prompt-pin";
const SHORTCUT = "ctrl+shift+p";
// User messages that extensions send, not the person.
const NOT_TYPED = /^\[(toolset|Extension issues)\]/;
const FIRST_MAX_LINES = 4;
const LATER_MAX = 8;

// Show what the person typed: a skill or file expansion becomes its short name.
function promptText(content: Content): string | undefined {
	const parts = typeof content === "string" ? [{ type: "text", text: content }] : content;
	const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" ").trim();
	if (NOT_TYPED.test(text)) return undefined;
	const short = text
		.replace(/^<skill name="([^"]+)"[\s\S]*?<\/skill>/, "/skill:$1")
		.replace(/<file name="([^"]+)">[\s\S]*?<\/file>/g, (_match, path: string) => `@${basename(path)}`)
		.replace(/\s+/g, " ")
		.trim();
	if (short) return short;
	return parts.some((part) => part.type === "image") ? "[image]" : undefined;
}

function clock(time: number): string {
	const date = new Date(time);
	const pad = (n: number) => String(n).padStart(2, "0");
	const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
	return date.toDateString() === new Date().toDateString() ? hm : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
}

function collapsed(prompts: Prompt[], width: number, theme: Theme): string[] {
	const later = prompts.length - 1;
	const hint = theme.fg("dim", `${later ? ` · +${later} later` : ""} · ${SHORTCUT}`);
	const room = Math.max(10, width - 3 - visibleWidth(hint));
	return [`📌 ${theme.fg("muted", truncateToWidth(prompts[0].text, room))}${hint}`];
}

function expanded(prompts: Prompt[], width: number, theme: Theme): string[] {
	const [first, ...later] = prompts;
	const head = `📌 ${clock(first.time)}  `;
	const indent = " ".repeat(visibleWidth(head));
	const wrapped = wrapTextWithAnsi(first.text, Math.max(10, width - indent.length));
	const firstLines = wrapped.slice(0, FIRST_MAX_LINES);
	if (wrapped.length > FIRST_MAX_LINES) firstLines[FIRST_MAX_LINES - 1] = truncateToWidth(`${firstLines[FIRST_MAX_LINES - 1]} …`, width - indent.length);
	const lines = firstLines.map((line, i) => `${i ? indent : head}${theme.fg("muted", line)}`);

	const shown = later.slice(-LATER_MAX);
	if (later.length > shown.length) lines.push(theme.fg("dim", `   … ${later.length - shown.length} earlier`));
	for (const prompt of shown) {
		const prefix = `   ↳ ${clock(prompt.time)}  `;
		lines.push(theme.fg("dim", prefix) + truncateToWidth(prompt.text, Math.max(10, width - visibleWidth(prefix))));
	}
	return lines;
}

export default function promptPin(pi: ExtensionAPI) {
	let prompts: Prompt[] = [];
	let open = false;

	const show = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!prompts.length) return ctx.ui.setWidget(WIDGET, undefined);
		ctx.ui.setWidget(WIDGET, (_tui, theme) => ({
			// Cut again so a very narrow terminal never gets a line wider than itself.
			render: (width: number) => (open ? expanded : collapsed)(prompts, width, theme).map((line) => truncateToWidth(line, width)),
			invalidate() {},
		}));
	};

	// The branch holds every prompt, also the ones before a compaction.
	const reload = (ctx: ExtensionContext) => {
		prompts = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "user") continue;
			const text = promptText(entry.message.content as Content);
			if (text) prompts.push({ time: entry.message.timestamp, text });
		}
		show(ctx);
	};

	// Subagent children and print runs have no person reading the screen.
	const active = (ctx: ExtensionContext) => ctx.mode === "tui" && process.env.PI_SUBAGENT_CHILD !== "1";

	pi.on("session_start", (_event, ctx) => {
		if (active(ctx)) reload(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		if (active(ctx)) reload(ctx);
	});
	// Pi saves the message after this event, so add it here instead of reading the branch.
	pi.on("message_end", (event, ctx) => {
		if (!active(ctx) || event.message.role !== "user") return;
		const text = promptText(event.message.content as Content);
		if (!text) return;
		prompts.push({ time: event.message.timestamp, text });
		show(ctx);
	});

	const toggle = (ctx: ExtensionContext) => {
		if (!prompts.length) return ctx.ui.notify("No prompt to pin yet", "info");
		open = !open;
		show(ctx);
	};
	pi.registerShortcut(SHORTCUT, { description: "Expand or collapse the pinned prompts", handler: toggle });
	pi.registerCommand("trail", {
		description: "Expand or collapse the pinned prompts above the editor",
		handler: async (_args, ctx) => toggle(ctx),
	});
}
