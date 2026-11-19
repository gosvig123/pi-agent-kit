import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DELEGATE_TOOLS } from "./child-target.ts";

// Stops a delegate_task call whose child would start without what it needs.
// Each check comes from a failure in Nov 2026 sessions: briefs that named a missing
// /tmp/brief-* file, worktree children that lost uncommitted edits or had no commit,
// a brief in /tmp sent to another machine, and implementation briefs with no pass signal (11 of 437 had one).
// A soft check blocks once; the same call again goes through.
const BRIEF_PATH = /(?:\/private)?\/tmp\/brief-[^\s`'"()<>\]*]+/g;
const PASS_SIGNAL = /pass signal|done signal|done when|pass when|success criteria|→\s*pass|invariant/i;

type DelegateInput = { task?: string; role?: string; isolation?: string; target?: { environmentId?: string } };

function git(cwd: string, args: string[]): string | null {
	try {
		return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return null;
	}
}

function briefPaths(task: string): string[] {
	return [...new Set((task.match(BRIEF_PATH) ?? []).map((path) => path.replace(/[.,;:]+$/, "")))];
}

/** The text of the brief files; a file it cannot read adds nothing, so the check never breaks delegate_task. */
function briefText(paths: string[]): string {
	return paths
		.map((path) => {
			try {
				return statSync(path).isFile() ? readFileSync(path, "utf8") : "";
			} catch {
				return "";
			}
		})
		.join("\n");
}

export default function briefCheck(pi: ExtensionAPI) {
	const warned = new Set<string>();

	pi.on("tool_call", (event, ctx) => {
		if (!DELEGATE_TOOLS.has(event.toolName)) return;
		const input = event.input as DelegateInput;
		const task = input.task ?? "";
		const paths = briefPaths(task);

		if (paths.length > 0 && input.target?.environmentId) {
			return { block: true, reason: `brief-check: this child runs on another machine (environmentId ${input.target.environmentId}) and cannot read ${paths[0]}. Put the brief in the task text, then call delegate_task again.` };
		}
		const missing = paths.filter((path) => !existsSync(path));
		if (missing.length > 0) {
			return { block: true, reason: `brief-check: the task names brief files that do not exist: ${missing.join(", ")}. Write them, or fix the paths, then call delegate_task again.` };
		}
		if (input.isolation === "worktree" && git(ctx.cwd, ["rev-parse", "--verify", "HEAD"]) === null) {
			return { block: true, reason: `brief-check: isolation "worktree" needs a git commit in ${ctx.cwd}, and there is none. Commit first, or use isolation "shared".` };
		}

		const soft: string[] = [];
		if (input.isolation === "worktree") {
			const dirty = (git(ctx.cwd, ["status", "--porcelain"]) ?? "").trim().split("\n").filter(Boolean);
			if (dirty.length > 0) soft.push(`isolation "worktree" starts from the last commit, so the child will not see ${dirty.length} uncommitted change(s) in ${ctx.cwd} (${dirty.slice(0, 5).map((line) => line.slice(3)).join(", ")}). Commit them first if the child needs them.`);
		}
		if (input.role === "implementation" && !PASS_SIGNAL.test(task + "\n" + briefText(paths))) {
			soft.push(`the implementation brief has no pass signal. Add "Goal → Check → Pass signal" so the child knows when it is done.`);
		}
		if (soft.length === 0) return;
		const key = JSON.stringify(input);
		if (warned.has(key)) return;
		warned.add(key);
		return { block: true, reason: `brief-check (blocked once): ${soft.join(" ")} To start the child anyway, call delegate_task again with the same input.` };
	});
}
