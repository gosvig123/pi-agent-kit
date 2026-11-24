import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	ORIGINS,
	SEVERITIES,
	appendFinding,
	readFindings,
	renderFindingsReport,
	type Finding,
} from "../lib/review-findings-store.ts";
import { childBrief } from "./child-mode.ts";

// Review children report each finding with report_finding instead of only in prose.
// The parent reads all reviewers of one brief with review_findings, merged by file and nearby line,
// so duplicate findings from different angles get one fix.
// Storage and merge logic live in ../lib/review-findings-store.ts so non-Pi agents can share the
// exact same store via `review-finding`.
const SLUG = /\/tmp\/brief-([\w.-]*[\w-])/;

export default function reviewFindings(pi: ExtensionAPI) {
	let reporter: { slug: string; angle: string } | null = null;

	pi.registerTool({
		name: "review_findings",
		label: "Review findings",
		description: "Read the findings that review children reported with report_finding for one brief, merged by file and nearby line, highest severity first, split into findings the change caused (fix, each with an ID for `review-finding verdict` and a convergence check against the previous round) and the pre-existing ledger: every `existing` finding of all rounds of the review group (<slug> and <slug>-r<N>), each with a stable ID and triage status.",
		promptSnippet: "Read merged findings from review children for one /tmp/brief-<slug>",
		promptGuidelines: ["Use review_findings after the reviewers of a round reply, with the slug of their /tmp/brief-<slug> folder, before you fix findings."],
		parameters: Type.Object({
			slug: Type.String({ description: "The <slug> of /tmp/brief-<slug> that the reviewers read." }),
			since: Type.Optional(Type.String({ description: "ISO time; only findings reported at or after it, for example the start of this round." })),
		}),
		async execute(_id, params) {
			return { content: [{ type: "text", text: renderFindingsReport(params.slug, readFindings(params.slug, params.since)) }], details: {} };
		},
	});

	pi.registerTool({
		name: "report_finding",
		label: "Report finding",
		description: "Record one concrete review finding for the parent agent. Call it once per issue, before your final reply.",
		promptSnippet: "Record one review finding (severity, origin, file, line, proof) for the parent agent",
		promptGuidelines: [
			"Use report_finding once for each concrete issue you find, before your final reply. Your final reply still lists each finding.",
			"Set report_finding origin to diff when the change added the problem or made an old one worse or newly reachable; the proof cites a changed line. Set it to existing when the problem is on the base branch and the change does not affect it. When unsure: inside a changed hunk is diff, anything else is existing.",
		],
		defaultActive: false,
		parameters: Type.Object({
			severity: StringEnum(SEVERITIES),
			origin: StringEnum(ORIGINS, { description: "diff: the change caused it, made it worse, or made it reachable (default: fix). existing: on the base branch and not affected by the change (default: triage gate)." }),
			file: Type.String({ description: "Repository-relative path." }),
			line: Type.Optional(Type.Number()),
			title: Type.String({ description: "The problem in one line." }),
			proof: Type.String({ description: "The evidence: code, output, or a repro step." }),
			fix: Type.Optional(Type.String({ description: "The smallest fix." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const slug = reporter?.slug ?? "no-brief";
			const finding: Finding = {
				time: new Date().toISOString(),
				reviewer: ctx.sessionManager.getSessionId(),
				angle: reporter?.angle ?? "",
				...params,
			};
			appendFinding(slug, finding);
			return { content: [{ type: "text", text: `Recorded ${params.severity} (${params.origin}) ${params.file}${params.line ? `:${params.line}` : ""} for brief "${slug}".` }], details: {} };
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
