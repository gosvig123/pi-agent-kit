import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ORIGINS = ["diff", "existing"] as const;
export const SEVERITIES = ["P0", "P1", "P2"] as const;
export type Origin = (typeof ORIGINS)[number];
export type Severity = (typeof SEVERITIES)[number];

const RANK: Record<Severity, number> = { P0: 0, P1: 1, P2: 2 };
const NEAR_LINES = 3;
const VALID_SLUG = /^[A-Za-z0-9._-]+$/;

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

function formatTable(groups: Finding[][]): string[] {
	const rows = groups.map((group) => {
		const severity = topSeverity(group);
		const lines = [...new Set(group.map((f) => f.line).filter((l) => l !== undefined))].join(",");
		const angles = [...new Set(group.map((f) => f.angle || f.reviewer.slice(0, 8)))].join(", ");
		const detail = group
			.map((f) => `${f.title} — ${f.proof}${f.fix ? ` Fix: ${f.fix}` : ""}`)
			.join(" / ")
			.replace(/\|/g, "\\|")
			.replace(/\n/g, " ");
		return `| ${severity} | \`${group[0].file}${lines ? `:${lines}` : ""}\` | ${group.length} (${angles}) | ${detail} |`;
	});
	return ["| Severity | Where | Reports (angles) | Finding — proof |", "|---|---|---|---|", ...rows];
}

export function renderFindingsReport(slug: string, findings: Finding[]): string {
	const dir = briefDir(slug);
	if (findings.length === 0) {
		return `No findings for brief "${slug}" in ${dir}. A reviewer that reports none either found nothing or did not record findings; check its reply.`;
	}
	const reviewers = new Set(findings.map((f) => f.reviewer));
	const caused = mergeFindings(findings.filter((f) => (f.origin ?? "diff") === "diff"));
	const existing = mergeFindings(findings.filter((f) => f.origin === "existing"));
	const count = (s: Severity) => caused.filter((g) => topSeverity(g) === s).length;
	return [
		`${caused.length + existing.length} merged findings from ${findings.length} reports by ${reviewers.size} reviewers.`,
		"",
		`## Fix: caused by this change (${caused.length}; P0 ${count("P0")} / P1 ${count("P1")} / P2 ${count("P2")})`,
		"Default: block or cheap fix, unless noise.",
		"",
		...(caused.length ? formatTable(caused) : ["None."]),
		"",
		`## Issue drafts: not caused by this change (${existing.length})`,
		"Default: propose an issue in the final report; create it only after the user approves.",
		"",
		...(existing.length ? formatTable(existing) : ["None."]),
	].join("\n");
}
