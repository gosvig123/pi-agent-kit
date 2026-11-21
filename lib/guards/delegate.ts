import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type ModelFamily = "sol" | "opus" | "neon";

export type ChildTarget = {
	providerInstanceId: string;
	model: string;
	options: Record<string, unknown>;
};

export const DEFAULT_CHILD_TARGET: ChildTarget = {
	providerInstanceId: "pi",
	model: "openai-codex/gpt-6.2-sol",
	options: { thinking: "high" },
};

// Cross-model review pool: review rounds always pick from the models other than the orchestrator.
export const REVIEW_POOL: readonly { family: ModelFamily; label: string; target: ChildTarget }[] = [
	{
		family: "sol",
		label: "GPT-6.2 Sol (high via Pi)",
		target: { providerInstanceId: "pi", model: "openai-codex/gpt-6.2-sol", options: { thinking: "high" } },
	},
	{
		family: "opus",
		label: "Claude Opus 5.5 (high via Pi)",
		target: { providerInstanceId: "pi", model: "anthropic/claude-opus-5-5", options: { thinking: "high" } },
	},
	{
		family: "neon",
		label: "Gemini 4 Neon (high via Antigravity)",
		target: { providerInstanceId: "antigravity", model: "gemini-4-neon", options: { thought_level: "high" } },
	},
];

export const DELEGATE_TOOLS = new Set(["mcp__t3-code__delegate_task", "mcp__t3_code__delegate_task"]);

const BRIEF_PATH = /(?:(?:\/private)?\/tmp\/brief-|(?:\.?\/)?\.briefs\/)[^\s`'"()<>\]*]+/g;
const PASS_SIGNAL = /pass signal|done signal|done when|pass when|success criteria|→\s*pass|invariant/i;

export type DelegateInput = {
	task?: string;
	role?: string;
	isolation?: string;
	target?: Record<string, unknown> | null;
};

export function modelFamily(modelId: string | undefined | null): ModelFamily | null {
	if (!modelId) return null;
	if (/neon/i.test(modelId)) return "neon";
	if (/opus[-._ ]?5[-._ ]?5|claude-opus/i.test(modelId)) return "opus";
	if (/gpt-6\.2-sol|6\.2-sol|\bsol\b/i.test(modelId)) return "sol";
	return null;
}

export function reviewPoolForParent(parentModelId: string | undefined | null) {
	const parent = modelFamily(parentModelId);
	return parent ? REVIEW_POOL.filter((entry) => entry.family !== parent) : [...REVIEW_POOL];
}

export function pickReviewTarget(parentModelId: string | undefined | null, index: number): { family: ModelFamily; label: string; target: ChildTarget } {
	const eligible = reviewPoolForParent(parentModelId);
	const picked = eligible[((index % eligible.length) + eligible.length) % eligible.length];
	return { family: picked.family, label: picked.label, target: structuredClone(picked.target) };
}

/**
 * Returns a warning string if a `role: "review"` call explicitly targets the same model family
 * as the orchestrator (among neon, opus 5.5, sol 6.2).
 */
export function checkReviewModelDiversity(input: DelegateInput, parentModelId: string | undefined | null): string | null {
	if (input.role !== "review") return null;
	const targetModel = typeof input.target?.model === "string" ? input.target.model : undefined;
	if (!targetModel) return null;
	const parent = modelFamily(parentModelId);
	const child = modelFamily(targetModel);
	if (!parent || !child || parent !== child) return null;
	const alternatives = reviewPoolForParent(parentModelId)
		.map((e) => `${e.label}: ${JSON.stringify(e.target)}`)
		.join(" ; ");
	return `review-model: reviewer target "${targetModel}" matches the orchestrator's model (${parent}). Review rounds must use a different model from {neon, opus 5.5, sol 6.2}. Omit target to auto-rotate, or pick one of: ${alternatives}`;
}

export function needsDefaultChildTarget(input: DelegateInput): boolean {
	return !input.target || Object.keys(input.target).length === 0;
}

export function defaultChildTarget(): Record<string, unknown> {
	return structuredClone(DEFAULT_CHILD_TARGET) as unknown as Record<string, unknown>;
}

function git(cwd: string, args: string[]): string | null {
	try {
		return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return null;
	}
}

function briefPaths(task: string, cwd: string): string[] {
	return [...new Set((task.match(BRIEF_PATH) ?? []).map((p) => {
		const cleaned = p.replace(/[.,;:]+$/, "");
		return isAbsolute(cleaned) ? cleaned : resolve(cwd, cleaned);
	}))];
}

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

export type BriefCheckResult = { hard?: string; soft: string[] };

export function checkDelegateBrief(input: DelegateInput, cwd: string): BriefCheckResult {
	const task = input.task ?? "";
	const paths = briefPaths(task, cwd);
	const envId = typeof input.target?.environmentId === "string" ? input.target.environmentId : undefined;

	if (paths.length > 0 && envId) {
		return {
			hard: `brief-check: this child runs on another machine (environmentId ${envId}) and cannot read ${paths[0]}. Put the brief in the task text, then call delegate_task again.`,
			soft: [],
		};
	}
	const missing = paths.filter((path) => !existsSync(path));
	if (missing.length > 0) {
		return {
			hard: `brief-check: the task names brief files that do not exist: ${missing.join(", ")}. Write them (e.g. with brief-init), or fix the paths, then call delegate_task again.`,
			soft: [],
		};
	}
	if (input.isolation === "worktree" && git(cwd, ["rev-parse", "--verify", "HEAD"]) === null) {
		return {
			hard: `brief-check: isolation "worktree" needs a git commit in ${cwd}, and there is none. Commit first, or use isolation "shared".`,
			soft: [],
		};
	}

	const soft: string[] = [];
	if (input.isolation === "worktree") {
		const dirty = (git(cwd, ["status", "--porcelain"]) ?? "").trimEnd().split("\n").filter(Boolean);
		if (dirty.length > 0) {
			soft.push(
				`isolation "worktree" starts from the last commit, so the child will not see ${dirty.length} uncommitted change(s) in ${cwd} (${dirty.slice(0, 5).map((line) => line.slice(3)).join(", ")}). Commit them first if the child needs them.`,
			);
		}
	}
	if (input.role === "implementation" && !PASS_SIGNAL.test(task + "\n" + briefText(paths))) {
		soft.push(`the implementation brief has no pass signal. Add "Goal → Check → Pass signal" so the child knows when it is done.`);
	}
	return { soft };
}
