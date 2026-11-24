import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ORIGINS = ["diff", "existing"] as const;
export const SEVERITIES = ["P0", "P1", "P2"] as const;
export const DECISIONS = ["fix-here", "split-pr", "file", "drop"] as const;
/** The parent's verdict on a `diff` finding; `stats` uses it to measure how often reviews pay off. */
export const VERDICTS = ["block", "cheap-fix", "noise"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Origin = (typeof ORIGINS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Decision = (typeof DECISIONS)[number];

const RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };
const NEAR_LINES = 3;
const VALID_SLUG = /^[A-Za-z0-9._-]+$/;
const ROUND_SUFFIX = /-r\d+$/;

export type Finding = {
	time: string;
	reviewer: string;
	angle: string;
	severity: Severity;
	origin?: Origin;
	file: string;
	line?: number;
	title: string;
	proof: string;
	fix?: string;
};

export type Triage = {
	time: string;
	id: string;
	decision: Decision;
	note?: string;
	by: string;
};

export type LedgerRow = {
	id: string;
	group: Finding[];
	slugs: string[];
	status: Decision | "untriaged";
	note?: string;
};

export function findingsRoot(): string {
	return process.env.PI_REVIEW_FINDINGS_DIR || join(homedir(), ".pi", "agent", "review-findings");
}

export function assertValidSlug(slug: string): string {
	if (!VALID_SLUG.test(slug) || slug === "." || slug === "..") {
		throw new Error(`validate brief slug "${slug}": invalid characters. Use letters, digits, ".", "_", or "-".`);
	}
	return slug;
}

export function briefDir(slug: string): string {
	return join(findingsRoot(), assertValidSlug(slug));
}

export function appendFinding(slug: string, finding: Finding): string {
	const dir = briefDir(slug);
	mkdirSync(dir, { recursive: true });
	const safeReviewer = finding.reviewer.replace(/[^A-Za-z0-9._-]/g, "_") || "reviewer";
	const filePath = join(dir, `${safeReviewer}.jsonl`);
	appendFileSync(filePath, JSON.stringify(finding) + "\n");
	return filePath;
}

function parseLine(line: string): Finding | null {
	try {
		return JSON.parse(line) as Finding;
	} catch {
		return null;
	}
}

export function readFindings(slug: string, since?: string): Finding[] {
	const dir = briefDir(slug);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map(parseLine))
		.filter((finding): finding is Finding => finding !== null && (!since || finding.time >= since));
}

const topSeverity = (group: Finding[]): Severity =>
	group.map((f) => f.severity).sort((a, b) => RANK[a] - RANK[b])[0];

/**
 * Groups duplicate findings from different reviewers: same file, and a line within NEAR_LINES of the
 * group's first finding (or the same title when a line is missing). One reviewer's findings never merge.
 */
export function mergeFindings(findings: Finding[]): Finding[][] {
	const groups: Finding[][] = [];
	const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
	for (const finding of sorted) {
		const group = groups.find(([first, ...rest]) => {
			if (first.file !== finding.file || [first, ...rest].some((f) => f.reviewer === finding.reviewer)) return false;
			if (first.line !== undefined && finding.line !== undefined) return Math.abs(first.line - finding.line) <= NEAR_LINES;
			return first.title.toLowerCase() === finding.title.toLowerCase();
		});
		if (group) group.push(finding);
		else groups.push([finding]);
	}
	return groups.sort((a, b) => RANK[topSeverity(a)] - RANK[topSeverity(b)]);
}

function formatTable(groups: Finding[][], verdicts: Map<string, VerdictRecord> = new Map()): string[] {
	const rows = groups.map((group) => {
		const id = groupId(group);
		const verdict = verdicts.get(id)?.verdict ?? "open";
		const severity = topSeverity(group);
		const lines = [...new Set(group.map((f) => f.line).filter((l) => l !== undefined))].join(",");
		const angles = [...new Set(group.map((f) => f.angle || f.reviewer.slice(0, 8)))].join(", ");
		const detail = group
			.map((f) => `${f.title} — ${f.proof}${f.fix ? ` Fix: ${f.fix}` : ""}`)
			.join(" / ")
			.replace(/\|/g, "\\|")
			.replace(/\n/g, " ");
		return `| ${id} | ${verdict} | ${severity} | \`${group[0].file}${lines ? `:${lines}` : ""}\` | ${group.length} (${angles}) | ${detail} |`;
	});
	return ["| ID | Verdict | Severity | Where | Reports (angles) | Finding — proof |", "|---|---|---|---|---|---|", ...rows];
}

export type VerdictRecord = { time: string; slug: string; id: string; verdict: Verdict; note?: string; by: string };

function verdictPath(group: string): string {
	return join(findingsRoot(), ".verdicts", `${assertValidSlug(group)}.jsonl`);
}

/** Merged `diff` findings of one round, each with its stable ID. */
export function diffGroups(slug: string): { id: string; group: Finding[] }[] {
	return mergeFindings(readFindings(slug).filter((f) => (f.origin ?? "diff") === "diff")).map((group) => ({ id: groupId(group), group }));
}

/** Latest verdict per finding ID for one round. */
export function readVerdicts(slug: string): Map<string, VerdictRecord> {
	const path = verdictPath(groupOf(slug));
	const out = new Map<string, VerdictRecord>();
	if (!existsSync(path)) return out;
	for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
		const v = parseLine(line) as unknown as VerdictRecord | null;
		if (v?.id && v.slug === slug) out.set(v.id, v);
	}
	return out;
}

export function recordVerdict(slug: string, verdict: Omit<VerdictRecord, "slug">): string {
	if (!diffGroups(slug).some((g) => g.id === verdict.id)) {
		throw new Error(`find diff finding ${verdict.id} in round "${slug}": no such ID`);
	}
	const path = verdictPath(groupOf(slug));
	mkdirSync(join(findingsRoot(), ".verdicts"), { recursive: true });
	appendFileSync(path, JSON.stringify({ ...verdict, slug }) + "\n");
	return path;
}

export function roundOf(slug: string): number {
	return Number(/-r(\d+)$/.exec(slug)?.[1] ?? 1);
}

/** P0+P1 merged diff findings per round of a group, oldest round first. */
export function blockingByRound(groupOrSlug: string): { slug: string; round: number; blocking: number }[] {
	return groupSlugs(groupOf(groupOrSlug))
		.map((slug) => ({ slug, round: roundOf(slug), blocking: diffGroups(slug).filter((g) => topSeverity(g.group) !== "P2").length }))
		.sort((a, b) => a.round - b.round);
}

/** A warning when this round found as many P0/P1 findings as the round before it. */
function convergenceNote(slug: string): string[] {
	const rounds = blockingByRound(slug);
	const at = rounds.findIndex((r) => r.slug === slug);
	if (at < 1) return [];
	const [prev, cur] = [rounds[at - 1], rounds[at]];
	const trail = rounds.slice(0, at + 1).map((r) => `r${r.round}: ${r.blocking}`).join(" → ");
	if (prev.blocking === 0 || cur.blocking < prev.blocking) return [`Convergence: P0/P1 per round ${trail}.`, ""];
	return [
		`⚠️ Not converging: P0/P1 per round ${trail}. Stop review rounds. Check the design or the scope with the user before the next round.`,
		"",
	];
}

/** The review group of a brief slug: later rounds are named `<group>-r<N>` and share one pre-existing ledger. */
export function groupOf(slug: string): string {
	return assertValidSlug(slug).replace(ROUND_SUFFIX, "");
}

function groupSlugs(group: string): string[] {
	const root = findingsRoot();
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && (d.name === group || (d.name.startsWith(group) && /^-r\d+$/.test(d.name.slice(group.length)))))
		.map((d) => d.name);
}

function triagePath(group: string): string {
	return join(findingsRoot(), ".triage", `${assertValidSlug(group)}.jsonl`);
}

/** Stable ID of a merged group: a hash of its earliest finding, so later rounds do not change it. */
function groupId(group: Finding[]): string {
	const first = [...group].sort((a, b) => a.time.localeCompare(b.time))[0];
	return createHash("sha1").update(`${first.file}\n${first.title.toLowerCase()}`).digest("hex").slice(0, 6);
}

/** All `existing` findings of every round in a review group, merged, with the latest triage decision for each. */
export function existingLedger(groupOrSlug: string): LedgerRow[] {
	const group = groupOf(groupOrSlug);
	const slugOf = new Map<Finding, string>();
	const findings = groupSlugs(group).flatMap((slug) =>
		readFindings(slug)
			.filter((f) => f.origin === "existing")
			.map((f) => (slugOf.set(f, slug), f)),
	);
	const path = triagePath(group);
	const decisions = new Map<string, Triage>();
	if (existsSync(path)) {
		for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
			const t = parseLine(line) as unknown as Triage | null;
			if (t?.id) decisions.set(t.id, t);
		}
	}
	return mergeFindings(findings)
		.map((g) => {
			const id = groupId(g);
			const t = decisions.get(id);
			return { id, group: g, slugs: [...new Set(g.map((f) => slugOf.get(f) ?? group))].sort(), status: t?.decision ?? ("untriaged" as const), ...(t?.note ? { note: t.note } : {}) };
		})
		.sort((a, b) => Number(b.status === "untriaged") - Number(a.status === "untriaged") || RANK[topSeverity(a.group)] - RANK[topSeverity(b.group)]);
}

export function recordTriage(groupOrSlug: string, triage: Triage): string {
	const group = groupOf(groupOrSlug);
	if (!existingLedger(group).some((row) => row.id === triage.id)) {
		throw new Error(`find pre-existing finding ${triage.id} in group "${group}": no such ID`);
	}
	const path = triagePath(group);
	mkdirSync(join(findingsRoot(), ".triage"), { recursive: true });
	appendFileSync(path, JSON.stringify(triage) + "\n");
	return path;
}

function cell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderLedger(groupOrSlug: string, rows: LedgerRow[] = existingLedger(groupOrSlug)): string[] {
	const group = groupOf(groupOrSlug);
	const open = rows.filter((r) => r.status === "untriaged").length;
	const head = `## Pre-existing findings (outside this diff): ${open} untriaged of ${rows.length}, all rounds of "${group}"`;
	if (rows.length === 0) return [head, "", "None."];
	const table = rows.map((r) => {
		const lines = [...new Set(r.group.map((f) => f.line).filter((l) => l !== undefined))].join(",");
		const detail = r.group.map((f) => `${f.title} — ${f.proof}`).join(" / ");
		const status = r.note ? `${r.status}: ${r.note}` : r.status;
		return `| ${r.id} | ${cell(status)} | ${topSeverity(r.group)} | \`${r.group[0].file}${lines ? `:${lines}` : ""}\` | ${r.slugs.join(", ")} | ${cell(detail)} |`;
	});
	return [
		head,
		"Not blockers of this change. Show every untriaged row to the user with a recommended decision; never reduce them to a count.",
		`Decisions: fix-here, split-pr, file (note = issue URL), drop (note = reason). Record: \`review-finding triage ${group} <id> <decision> [--note <text>]\`.`,
		"",
		"| ID | Status | Sev | Where | Rounds | Finding — proof |",
		"|---|---|---|---|---|---|",
		...table,
	];
}

export function renderFindingsReport(slug: string, findings: Finding[]): string {
	const dir = briefDir(slug);
	const ledger = renderLedger(slug);
	if (findings.length === 0) {
		return [
			`No findings for brief "${slug}" in ${dir}. A reviewer that reports none either found nothing or did not record findings; check its reply.`,
			"",
			...ledger,
		].join("\n");
	}
	const reviewers = new Set(findings.map((f) => f.reviewer));
	const caused = mergeFindings(findings.filter((f) => (f.origin ?? "diff") === "diff"));
	const count = (s: Severity) => caused.filter((g) => topSeverity(g) === s).length;
	return [
		`${caused.length} merged diff findings from ${findings.length} reports by ${reviewers.size} reviewers.`,
		"",
		...convergenceNote(slug),
		`## Fix: caused by this change (${caused.length}; P0 ${count("P0")} / P1 ${count("P1")} / P2 ${count("P2")})`,
		`Default: block or cheap fix, unless noise. Record each verdict: \`review-finding verdict ${slug} <id> block|cheap-fix|noise [--note <why>]\`.`,
		"",
		...(caused.length ? formatTable(caused, readVerdicts(slug)) : ["None."]),
		"",
		...ledger,
	].join("\n");
}
