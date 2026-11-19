import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { childBrief } from "./child-mode.ts";

// Review children report each finding with report_finding instead of only in prose.
// The parent reads all reviewers of one brief with review_findings, merged by file and nearby line,
// so duplicate findings from different angles get one fix.
// Findings live in ~/.pi/agent/review-findings/<brief slug>/<child session id>.jsonl.
const ROOT = join(homedir(), ".pi", "agent", "review-findings");
const SLUG = /\/tmp\/brief-([\w.-]*[\w-])/;
const NEAR_LINES = 3;
const RANK = { P0: 0, P1: 1, P2: 2 } as const;

type Finding = { time: string; reviewer: string; angle: string; severity: keyof typeof RANK; file: string; line?: number; title: string; proof: string; fix?: string };

function readFindings(slug: string, since?: string): Finding[] {
	const dir = join(ROOT, slug);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".jsonl"))
		.flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n").filter(Boolean).map(parseLine))
		.filter((finding): finding is Finding => finding !== null && (!since || finding.time >= since));
}

/** One stored finding, or null for a damaged line, so one bad line does not hide the other reviewers. */
function parseLine(line: string): Finding | null {
	try {
		return JSON.parse(line) as Finding;
	} catch {
		return null;
	}
}

const top = (group: Finding[]) => group.map((f) => f.severity).sort((a, b) => RANK[a] - RANK[b])[0];

/**
 * Groups duplicate findings from different reviewers: same file, and a line within NEAR_LINES of the
 * group's first finding (or the same title when a line is missing). One reviewer's findings never merge.
 */
function merge(findings: Finding[]): Finding[][] {
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
	return groups.sort((a, b) => RANK[top(a)] - RANK[top(b)]);
}

function report(slug: string, findings: Finding[]): string {
	if (findings.length === 0) return `No findings for brief "${slug}" in ${join(ROOT, slug)}. A reviewer that reports none either found nothing or did not use report_finding; check its reply.`;
	const reviewers = new Set(findings.map((f) => f.reviewer));
	const groups = merge(findings);
	const rows = groups.map((group) => {
		const severity = top(group);
		const lines = [...new Set(group.map((f) => f.line).filter((l) => l !== undefined))].join(",");
		const angles = [...new Set(group.map((f) => f.angle || f.reviewer.slice(0, 8)))].join(", ");
		const detail = group.map((f) => `${f.title} — ${f.proof}${f.fix ? ` Fix: ${f.fix}` : ""}`).join(" / ").replace(/\|/g, "\\|").replace(/\n/g, " ");
		return `| ${severity} | \`${group[0].file}${lines ? `:${lines}` : ""}\` | ${group.length} (${angles}) | ${detail} |`;
	});
	const count = (s: string) => groups.filter((g) => top(g) === s).length;
	return [
		`${groups.length} merged findings from ${findings.length} reports by ${reviewers.size} reviewers (P0 ${count("P0")} / P1 ${count("P1")} / P2 ${count("P2")}).`,
		"",
		"| Severity | Where | Reports (angles) | Finding — proof |",
		"|---|---|---|---|",
		...rows,
	].join("\n");
}

export default function reviewFindings(pi: ExtensionAPI) {
	let reporter: { slug: string; angle: string } | null = null;

	pi.registerTool({
		name: "review_findings",
		label: "Review findings",
		description: "Read the findings that review children reported with report_finding for one brief, merged by file and nearby line, highest severity first.",
		promptSnippet: "Read merged findings from review children for one /tmp/brief-<slug>",
		promptGuidelines: ["Use review_findings after the reviewers of a round reply, with the slug of their /tmp/brief-<slug> folder, before you fix findings."],
		parameters: Type.Object({
			slug: Type.String({ description: "The <slug> of /tmp/brief-<slug> that the reviewers read." }),
			since: Type.Optional(Type.String({ description: "ISO time; only findings reported at or after it, for example the start of this round." })),
		}),
		async execute(_id, params) {
			return { content: [{ type: "text", text: report(params.slug, readFindings(params.slug, params.since)) }], details: {} };
		},
	});

	pi.registerTool({
		name: "report_finding",
		label: "Report finding",
		description: "Record one concrete review finding for the parent agent. Call it once per issue, before your final reply.",
		promptSnippet: "Record one review finding (severity, file, line, proof) for the parent agent",
		promptGuidelines: ["Use report_finding once for each concrete issue the diff causes, before your final reply. Your final reply still lists each finding."],
		defaultActive: false,
		parameters: Type.Object({
			severity: StringEnum(["P0", "P1", "P2"] as const),
			file: Type.String({ description: "Repository-relative path." }),
			line: Type.Optional(Type.Number()),
			title: Type.String({ description: "The problem in one line." }),
			proof: Type.String({ description: "The evidence: code, output, or a repro step." }),
			fix: Type.Optional(Type.String({ description: "The smallest fix." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const slug = reporter?.slug ?? "no-brief";
			const dir = join(ROOT, slug);
			mkdirSync(dir, { recursive: true });
			const finding: Finding = { time: new Date().toISOString(), reviewer: ctx.sessionManager.getSessionId(), angle: reporter?.angle ?? "", ...params };
			appendFileSync(join(dir, `${finding.reviewer}.jsonl`), JSON.stringify(finding) + "\n");
			return { content: [{ type: "text", text: `Recorded ${params.severity} ${params.file}${params.line ? `:${params.line}` : ""} for brief "${slug}".` }], details: {} };
		},
	});

	pi.on("before_agent_start", (event, ctx) => {
		const child = childBrief(ctx, event.prompt);
		if (child?.role !== "review" || reporter) return;
		const angle = /angle:\s*\**([^\n.*]+)/i.exec(child.brief)?.[1]?.trim().slice(0, 60) ?? "";
		reporter = { slug: SLUG.exec(child.brief)?.[1] ?? "no-brief", angle };
		pi.setActiveTools([...new Set([...pi.getActiveTools(), "report_finding"])]);
	});
}
