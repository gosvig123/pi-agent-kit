// Review-loop calibration: joins review gates, findings, and the parent's verdicts so the gate
// thresholds and angles can follow real yield (confirmed P0/P1 per reviewer, noise rate).
import { existsSync, readdirSync } from "node:fs";
import { blockingByRound, diffGroups, findingsRoot, groupOf, readFindings, readVerdicts } from "./review-findings-store.ts";
import { type GateRecord, readGates } from "./review-gate.ts";

const ANGLE_CLASSES: [string, RegExp][] = [
	["security/privacy", /secur|privacy|access|auth/i],
	["concurrency", /concurren|race|stale/i],
	["data/rollback", /durab|rollback|data|schema|migrat|lifetime/i],
	["ui", /\bui\b|layout|accessib|render|desktop app/i],
	["verification", /verif|proof|\btests?\b/i],
	["simplicity/docs", /simplic|convention|leftover|docs?\b|design|repo rules/i],
	["correctness", /correct|runtime|regress|full review|end to end/i],
];

/** The class whose keyword appears first in a free-text angle. */
export function angleClass(angle: string): string {
	let best = ["other", Infinity] as [string, number];
	for (const [name, re] of ANGLE_CLASSES) {
		const at = angle.search(re);
		if (at !== -1 && at < best[1]) best = [name, at];
	}
	return best[0];
}

export type GroupStats = {
	group: string;
	level: GateRecord["level"] | "no gate";
	score: number | null;
	rounds: number;
	reviewers: number;
	findings: number;
	blocking: number;
	confirmedBlocking: number;
	noise: number;
	open: number;
	blockingByRound: number[];
};

export function collectStats(): { groups: GroupStats[]; angles: Record<string, { reports: number; blocking: number }> } {
	const root = findingsRoot();
	const slugs = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name) : [];
	const gates = readGates();
	const angles: Record<string, { reports: number; blocking: number }> = {};
	const groups = new Map<string, GroupStats>();
	for (const slug of slugs) {
		const name = groupOf(slug);
		const gate = gates.filter((g) => groupOf(g.slug) === name).at(-1);
		const stats = groups.get(name) ?? {
			group: name,
			level: gate?.level ?? "no gate",
			score: gate?.score ?? null,
			rounds: 0,
			reviewers: 0,
			findings: 0,
			blocking: 0,
			confirmedBlocking: 0,
			noise: 0,
			open: 0,
			blockingByRound: blockingByRound(name).map((r) => r.blocking),
		};
		const reports = readFindings(slug);
		stats.rounds += 1;
		stats.reviewers += new Set(reports.map((f) => f.reviewer)).size;
		for (const f of reports) {
			const a = (angles[angleClass(f.angle || "")] ??= { reports: 0, blocking: 0 });
			a.reports += 1;
			if (f.severity !== "P2") a.blocking += 1;
		}
		const verdicts = readVerdicts(slug);
		for (const { id, group } of diffGroups(slug)) {
			const blocking = group.some((f) => f.severity !== "P2");
			const verdict = verdicts.get(id)?.verdict;
			stats.findings += 1;
			if (blocking) stats.blocking += 1;
			if (blocking && (verdict === "block" || verdict === "cheap-fix")) stats.confirmedBlocking += 1;
			if (verdict === "noise") stats.noise += 1;
			if (!verdict) stats.open += 1;
		}
		groups.set(name, stats);
	}
	return { groups: [...groups.values()], angles };
}

const ratio = (a: number, b: number) => (b ? (a / b).toFixed(2) : "–");

export function renderStats(): string {
	const { groups, angles } = collectStats();
	const bands = ["skip", "light", "full", "no gate"].map((level) => {
		const rows = groups.filter((g) => g.level === level);
		const sum = (k: keyof GroupStats) => rows.reduce((n, r) => n + (r[k] as number), 0);
		const judged = sum("findings") - sum("open");
		return `| ${level} | ${rows.length} | ${sum("reviewers")} | ${ratio(sum("blocking"), sum("reviewers"))} | ${ratio(sum("confirmedBlocking"), sum("reviewers"))} | ${ratio(sum("noise"), judged)} | ${ratio(sum("open"), sum("findings"))} |`;
	});
	const angleRows = Object.entries(angles)
		.sort((a, b) => b[1].blocking / b[1].reports - a[1].blocking / a[1].reports)
		.map(([name, a]) => `| ${name} | ${a.reports} | ${a.blocking} | ${ratio(a.blocking, a.reports)} |`);
	const stalled = groups.filter((g) => g.blockingByRound.slice(2).some((n) => n > 0));
	return [
		"## Review yield by gate level",
		"Confirmed = P0/P1 with verdict block or cheap-fix. Open = no verdict yet; findings before verdicts existed are all open.",
		"",
		"| Level | Reviews | Reviewers | P0/P1 per reviewer | Confirmed per reviewer | Noise rate | Open share |",
		"|---|---|---|---|---|---|---|",
		...bands,
		"",
		"## Yield by angle (all reports)",
		"",
		"| Angle | Reports | P0/P1 | P0/P1 share |",
		"|---|---|---|---|",
		...angleRows,
		"",
		"## Reviews with 3+ rounds that still found P0/P1",
		"",
		...(stalled.length ? stalled.map((g) => `- ${g.group}: P0/P1 per round ${g.blockingByRound.join(" → ")}`) : ["None."]),
	].join("\n");
}
