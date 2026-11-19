import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DELEGATE_TOOLS } from "./child-target.ts";

// Reviewers were 71% of all delegate_task children in Nov 2026. The delegation skill allows
// 2–3 reviewers per round and at most 3 rounds. This blocks a reviewer past those limits once
// (the same call again goes through), and tells the parent when it edits files while
// reviewers of the current round are still running.
// A round starts with a review launch when no reviewer of the last round is still running.
// Rounds count from the last human message, because one session can review several changes.
// State comes from the session branch, so it survives a reload.
const MAX_REVIEWERS = 3;
const MAX_ROUNDS = 3;
const EDIT_TOOLS = new Set(["edit", "write"]);

type Round = { id: string; launched: number; finished: number };
// User messages that Pi extensions send; every other user message, except a wake-up, is human.
const AUTOMATIC = /^\[(toolset|auto-heal)\]/;
type Block = { type?: string; id?: string; name?: string; arguments?: { role?: string; mode?: string; title?: string }; text?: string };
type Message = { role?: string; content?: string | Block[]; toolCallId?: string; isError?: boolean };

function text(content: Message["content"]): string {
	if (typeof content === "string") return content;
	return (content ?? []).map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

/**
 * Review rounds since the last human message, up to (not including) the tool call `stopAt`.
 * A round where every launch failed does not count.
 */
function reviewRounds(entries: unknown[], stopAt?: string): Round[] {
	let rounds: Round[] = [];
	const counted = () => rounds.filter((round) => round.launched > 0);
	const byCall = new Map<string, { round: Round; title: string; wait: boolean }>();
	const running = new Map<string, Round>(); // by taskId, and by "title:<title>" when the result text was replaced
	const finish = (key: string) => {
		const round = running.get(key);
		if (!round) return false;
		round.finished += 1;
		running.delete(key);
		return true;
	};
	for (const entry of entries as { type?: string; message?: Message }[]) {
		const message = entry.type === "message" ? entry.message : undefined;
		if (!message) continue;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type !== "toolCall" || !block.id) continue;
				if (block.id === stopAt) return counted();
				if (!DELEGATE_TOOLS.has(block.name ?? "") || block.arguments?.role !== "review") continue;
				let round = rounds.at(-1);
				if (!round || round.launched <= round.finished) rounds.push((round = { id: block.id, launched: 0, finished: 0 }));
				round.launched += 1;
				byCall.set(block.id, { round, title: block.arguments.title ?? "", wait: block.arguments.mode === "wait" });
			}
		} else if (message.role === "toolResult" && message.toolCallId && byCall.has(message.toolCallId)) {
			const { round, title, wait } = byCall.get(message.toolCallId)!;
			const result = text(message.content);
			if (message.isError) round.launched -= 1;
			else if (wait && !/"waitTimedOut"\s*:\s*true/.test(result)) round.finished += 1;
			else running.set(/"taskId":"([^"]+)"/.exec(result)?.[1] ?? `title:${title}`, round);
		} else if (message.role === "user") {
			const body = text(message.content);
			const wake = /^Delegated task (\S+) \((.*)\) \[\w+\]/.exec(body);
			if (wake) finish(wake[1]) || finish(`title:${wake[2]}`);
			else if (!AUTOMATIC.test(body)) rounds = []; // reviewers still running from before stay in `running` and finish there
		}
	}
	return counted();
}

export default function reviewBudget(pi: ExtensionAPI) {
	const warned = new Set<string>();
	const nudgedRounds = new Set<string>();

	pi.on("tool_call", (event, ctx) => {
		if (!DELEGATE_TOOLS.has(event.toolName) || (event.input as { role?: string }).role !== "review") return;
		const rounds = reviewRounds(ctx.sessionManager.getBranch(), event.toolCallId);
		const last = rounds.at(-1);
		const joins = last !== undefined && last.launched > last.finished;
		const round = rounds.length + (joins ? 0 : 1);
		const reviewer = joins ? last.launched + 1 : 1;
		const problem =
			round > MAX_ROUNDS
				? `this starts review round ${round}; the delegation skill stops after ${MAX_ROUNDS}. Report the open findings as deferred instead.`
				: reviewer > MAX_REVIEWERS
					? `this is reviewer ${reviewer} in round ${round}; the limit is ${MAX_REVIEWERS}. Save the extra angle for a fresh reviewer in the next round.`
					: null;
		if (!problem) return;
		const key = JSON.stringify(event.input);
		if (warned.has(key)) return;
		warned.add(key);
		return { block: true, reason: `review-budget (blocked once): ${problem} If the user asked for it, or the change needs it, call delegate_task again with the same input.` };
	});

	pi.on("tool_result", (event, ctx) => {
		if (!EDIT_TOOLS.has(event.toolName) || event.isError) return;
		const rounds = reviewRounds(ctx.sessionManager.getBranch());
		const last = rounds.at(-1);
		if (!last || last.finished === 0 || last.finished >= last.launched || nudgedRounds.has(last.id)) return;
		nudgedRounds.add(last.id);
		const note = `review-budget: ${last.launched - last.finished} of ${last.launched} reviewers in round ${rounds.length} are still running. Fix after all findings arrive, so duplicate findings get one fix.`;
		return { content: [...event.content, { type: "text" as const, text: note }] };
	});
}
