// Review gate: decides skip, light, or full review for a change from five 0–3 scores.
// Impact = max(risk, reversibility). Likelihood = round(0.25·size + 0.35·novelty + 0.4·proof gap).
// Score = Impact × Likelihood (0–9): 0–2 skip, 3–4 light (1 reviewer), 6–9 full (2–3 reviewers).
// Floor: code with impact ≥1 and size ≥1 (over 50 changed lines, or more than 1 file) gets at least light.
// `brief-init gate` suggests risk, size, and proof from the diff and checks.txt; the agent sets
// novelty and reversibility, and must give a reason to score below a suggestion.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InvariantAnalysis } from "./brief-invariants.ts";
import { parseDiffEntries } from "./brief-invariants.ts";
import { findingsRoot } from "./review-findings-store.ts";

export const AXES = ["risk", "reversibility", "size", "novelty", "proof"] as const;
export type Axis = (typeof AXES)[number];
export type Scores = Record<Axis, number>;
export type Level = "skip" | "light" | "full";

export const WEIGHTS = { size: 0.25, novelty: 0.35, proof: 0.4 } as const;

export const SCALE: Record<Axis, string[]> = {
	risk: [
		"docs, copy, or config only",
		"internal logic",
		"user-facing behavior, UI state, or external API calls",
		"auth, privacy, account boundary, money, data or schema, or concurrency",
	],
	reversibility: [
		"local or instant revert",
		"revert by deploy",
		"revert needs cleanup (external records, sent notifications)",
		"cannot undo (migration, data loss, messages to customers, public API)",
	],
	size: ["≤50 changed lines in 1 file", "≤200 lines in 1 component", "≤600 lines or 2–3 components", "larger"],
	novelty: ["mechanical (rename, bump, repeated pattern)", "known pattern in new place", "new flow", "new design or unclear end"],
	proof: ["the goal ran end to end and passed", "tests on the changed paths pass", "build or typecheck only", "nothing ran, or a check failed"],
};

const DOCS_ONLY = /(\.(md|mdx|txt|rst|png|jpe?g|gif|svg|webp)$|(^|\/)docs?\/)/i;
const TEST_PATH = /(\.(test|spec)\.[^/]+$|(^|\/)(__tests__|tests?|fixtures)\/)/i;
const MONEY = /(^|\/|\b)(billing|payments?|stripe|invoices?|payouts?|checkout|subscriptions?|pricing)(\b|\/|\.|_|-|$)/i;

export type Suggestion = { score: number; reason: string };

export function suggestRisk(diff: string, invariants: InvariantAnalysis): Suggestion {
	const entries = parseDiffEntries(diff);
	if (entries.length === 0) return { score: 0, reason: "empty diff" };
	if (entries.every((e) => DOCS_ONLY.test(e.path))) return { score: 0, reason: "docs or assets only" };
	const hit = (id: string) => invariants.triggered.find((t) => t.id === id);
	const money = entries.find((e) => MONEY.test(e.path) || e.addedLines.some((l) => MONEY.test(l)));
	const high = [
		hit("account-workspace-boundary") && "account or workspace boundary",
		hit("schema-destructive-data") && "schema or destructive data",
		hit("concurrency-stale-state")?.matchedBy.includes("content") && "concurrency code",
		money && "money",
		...invariants.triggered.filter((t) => t.source === "repo").map((t) => `repo rule ${t.id}`),
	].filter(Boolean);
	if (high.length) return { score: 3, reason: high.join(", ") };
	const medium = [hit("concurrency-stale-state") && "server or sync paths", hit("narrow-ui-focus") && "UI"].filter(Boolean);
	if (medium.length) return { score: 2, reason: medium.join(", ") };
	return { score: 1, reason: "code with no risk class matched" };
}

function component(path: string): string {
	const parts = path.split("/");
	if (parts.length === 1) return "(root)";
	return /^(apps|packages|services|libs|src)$/.test(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

export function suggestSize(diff: string): Suggestion & { lines: number; files: number; components: string[] } {
	let lines = 0;
	const files = new Set<string>();
	let current = "";
	for (const line of diff.split("\n")) {
		const header = /^diff --git a\/.* b\/(.*)$/.exec(line);
		if (header) {
			current = header[1];
			if (!TEST_PATH.test(current)) files.add(current);
			continue;
		}
		if (TEST_PATH.test(current) || line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+") || line.startsWith("-")) lines += 1;
	}
	const components = [...new Set([...files].map(component))];
	const score = lines <= 50 && files.size <= 1 ? 0 : lines <= 200 && components.length <= 1 ? 1 : lines <= 600 && components.length <= 3 ? 2 : 3;
	return { score, reason: `${lines} changed lines, ${files.size} files, ${components.length} components (tests excluded)`, lines, files: files.size, components };
}

/** Proof gap from a brief's checks.txt: no real output or a failed check is 3; all checks passed is 1 (raise to 0 only for an end-to-end run). */
export function suggestProof(checksText: string | null): Suggestion | null {
	if (checksText === null) return null;
	const exits = [...checksText.matchAll(/^exit: (\S+)$/gm)].map((m) => m[1]);
	if (exits.length === 0) return { score: 3, reason: "checks.txt has no command output" };
	if (exits.some((e) => e !== "0")) return { score: 3, reason: `a check failed (exits: ${exits.join(", ")})` };
	return { score: 1, reason: `${exits.length} checks passed; set 0 only if one ran the goal end to end` };
}

export type Gate = {
	scores: Scores;
	impact: number;
	likelihood: number;
	score: number;
	level: Level;
	reviewers: string;
	angles: string[];
};

export function decide(scores: Scores, riskReasons: string[] = []): Gate {
	const impact = Math.max(scores.risk, scores.reversibility);
	const likelihood = Math.round(WEIGHTS.size * scores.size + WEIGHTS.novelty * scores.novelty + WEIGHTS.proof * scores.proof);
	const score = impact * likelihood;
	const floor = impact >= 1 && scores.size >= 1;
	const level: Level = score <= 2 ? (floor ? "light" : "skip") : score <= 4 ? "light" : "full";
	return { scores, impact, likelihood, score, level, reviewers: { skip: "0", light: "1", full: "2–3" }[level], angles: anglesFor(level, scores, riskReasons) };
}

/** Risk angles only. Simplicity, tests, and docs found 0 of 133 P1s in past reviews, so they ride along as P2 notes. */
function anglesFor(level: Level, scores: Scores, riskReasons: string[]): string[] {
	if (level === "skip") return [];
	const text = riskReasons.join(" ");
	const risks = [
		/account|money|repo rule/.test(text) && "security and privacy",
		/concurrency|server or sync/.test(text) && "concurrency and stale state",
		(/schema|destructive/.test(text) || scores.reversibility >= 2) && "data safety and rollback",
		/UI/.test(text) && "UI layout and focus at 320–440 px",
		scores.proof >= 2 && "verification: does checks.txt prove the goal",
	].filter((a): a is string => Boolean(a));
	const correctness = "correctness (note simplicity and test gaps only as P2)";
	if (level === "light") return [risks.length ? `correctness, focused on ${risks[0]}` : correctness];
	return [correctness, ...risks].slice(0, 3);
}

export function renderGateMarkdown(gate: Gate, reasons: Partial<Record<Axis, string>>): string {
	const rows = AXES.map((axis) => `| ${axis} | ${gate.scores[axis]} | ${SCALE[axis][gate.scores[axis]]} | ${reasons[axis] ?? ""} |`);
	return [
		`## Review gate: ${gate.level} (score ${gate.score} = impact ${gate.impact} × likelihood ${gate.likelihood})`,
		"",
		"| Axis | Score | Meaning | Reason |",
		"|---|---|---|---|",
		...rows,
		"",
		gate.level === "skip"
			? "- Skip the review loop. Report the proof from checks.txt."
			: `- Reviewers: ${gate.reviewers}. Angles: ${gate.angles.join("; ")}.`,
	].join("\n");
}

export function refreshGateSection(context: string, section: string): string {
	const match = /^## Review gate[^\n]*$/m.exec(context);
	if (!match) {
		const focus = context.search(/^## (Invariants checked before review|Review focus)\b/m);
		return focus === -1 ? `${context.trimEnd()}\n\n${section}\n` : `${context.slice(0, focus)}${section}\n\n${context.slice(focus)}`;
	}
	const rest = context.slice(match.index + match[0].length);
	const next = rest.search(/\n## /);
	return context.slice(0, match.index) + section + (next === -1 ? "\n" : rest.slice(next));
}

export type GateRecord = Gate & {
	time: string;
	slug: string;
	repo: string;
	base: string;
	head: string | null;
	suggested: Partial<Record<Axis, number>>;
	reasons: Partial<Record<Axis, string>>;
};

export function gatesPath(): string {
	return join(findingsRoot(), ".gates.jsonl");
}

export function recordGate(record: GateRecord): string {
	mkdirSync(findingsRoot(), { recursive: true });
	appendFileSync(gatesPath(), JSON.stringify(record) + "\n");
	return gatesPath();
}

export function readGates(): GateRecord[] {
	try {
		return readFileSync(gatesPath(), "utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					return [JSON.parse(line) as GateRecord];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}
