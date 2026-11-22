// Diff-triggered invariant selector for `brief-init`.
// Reads changed file paths (including renames & quoted paths), hunk-scoped added diff lines,
// and optional repo-local `.agent/invariants.json` so review briefs ask only for relevant invariants.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

export type InvariantRule = {
	id: string;
	title: string;
	check: string;
	pathPattern?: RegExp;
	contentPattern?: RegExp;
	contentRegexSource?: string;
	excludePathPattern?: RegExp;
	source: "builtin" | "repo";
};

export type TriggeredInvariant = {
	id: string;
	title: string;
	check: string;
	source: "builtin" | "repo";
	matchedFiles: string[];
	matchedBy: ("path" | "content")[];
};

export type SkippedInvariant = {
	id: string;
	title: string;
	reason: string;
};

export type InvariantAnalysis = {
	changedFiles: string[];
	triggered: TriggeredInvariant[];
	skipped: SkippedInvariant[];
	customRuleCount: number;
	warnings: string[];
};

const TEST_PATH = /(\.(test|spec)\.[^/]+$|(^|\/)__tests__\/|(^|\/)fixtures\/)/i;
const NESTED_QUANTIFIER = /\([^)]*(?:[+*]|\{\d+,\d*\})[^)]*\)\s*(?:[+*]|\{\d+,\d*\})/;

const BUILTIN_RULES: InvariantRule[] = [
	{
		id: "concurrency-stale-state",
		title: "Concurrency & stale state",
		check: "Prove overlapping refreshes, retries, or out-of-order events cannot overwrite newer state.",
		pathPattern: /(^|\/)(webhooks?|queues?|sync|workers?|jobs?|poll|optimistic|retry|debounce|throttle|locks?|mutex|cache|api|routes|server|handlers?)(\/|\.|_|-|$)/i,
		contentPattern: /\b(setInterval|setTimeout|AbortController|Promise\.(all|race|allSettled)|optimistic|webhook|retry|queue|upsert|ON CONFLICT|FOR UPDATE|request_withdrawn|updated_at)\b/i,
		excludePathPattern: TEST_PATH,
		source: "builtin",
	},
	{
		id: "account-workspace-boundary",
		title: "Account & workspace boundary",
		check: "Prove sign-out, workspace switch, or member removal cannot leak cached data or send queued writes under another user.",
		pathPattern: /(^|\/)(auth|session|clerk|login|logout|sign-?in|sign-?out|account|workspace|tenant|org|member|permission|access|role|token|store|stores|upload|storage|cookie)(\/|\.|_|-|$)/i,
		contentPattern: /\b(localStorage|sessionStorage|indexedDB|workspaceId|organizationId|orgId|tenantId|userId|signOut|clearCache|ownerId|actorId)\b/,
		excludePathPattern: TEST_PATH,
		source: "builtin",
	},
	{
		id: "narrow-ui-focus",
		title: "Narrow UI & focus",
		check: "Prove 320–440 px layout fits without overflow, sticky headers do not cover actions/matches, and polling preserves keyboard focus.",
		pathPattern: /(\.(svelte|tsx|jsx|vue|css|scss|sass|less|html|htm|astro)$|(^|\/)(components|pages|views|layouts|styles)\/)/i,
		contentPattern: /(?:\b(?:position:\s*sticky|sticky\s+top-|scrollIntoView|autoFocus|Dialog|Modal|Drawer)\b|\.focus\s*\()/,
		excludePathPattern: TEST_PATH,
		source: "builtin",
	},
	{
		id: "schema-destructive-data",
		title: "Schema & destructive data safety",
		check: "Prove migration/data changes are reversible or safe under live traffic and cannot drop or corrupt existing rows.",
		pathPattern: /(^|\/)(migrations?|schema|prisma|drizzle)(\/|\.|_|-|$)|\.sql$/i,
		contentPattern: /\b(DROP\s+TABLE|ALTER\s+TABLE|DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i,
		excludePathPattern: TEST_PATH,
		source: "builtin",
	},
];

type RawCustomRule = {
	id?: string;
	title?: string;
	check?: string;
	paths?: string[];
	contentRegex?: string;
};

function globToRegex(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*\//g, "<<<GLOBSTAR_DIR>>>")
		.replace(/\*\*/g, "<<<DOUBLESTAR>>>")
		.replace(/\*/g, "[^/]*")
		.replace(/\?/g, "[^/]")
		.replace(/<<<GLOBSTAR_DIR>>>/g, "(?:.*/)?")
		.replace(/<<<DOUBLESTAR>>>/g, ".*");
	return new RegExp(`(^|/)${escaped}$`, "i");
}

function unquoteGitPath(raw: string): string {
	if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
	const inner = raw.slice(1, -1);
	const bytes: number[] = [];
	for (let i = 0; i < inner.length; i++) {
		if (inner[i] === "\\" && i + 1 < inner.length) {
			const next = inner[i + 1];
			if (next >= "0" && next <= "7") {
				const oct = inner.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
				bytes.push(parseInt(oct, 8));
				i += oct.length;
				continue;
			}
			const escapes: Record<string, number> = {
				a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92,
			};
			bytes.push(escapes[next] ?? next.charCodeAt(0));
			i++;
		} else {
			for (const b of Buffer.from(inner[i], "utf8")) bytes.push(b);
		}
	}
	return Buffer.from(bytes).toString("utf8");
}

function parseDiffGitHeader(line: string): { oldPath: string; newPath: string } | null {
	const rest = line.slice("diff --git ".length);
	const readToken = (start: number): { token: string; next: number } | null => {
		if (start >= rest.length) return null;
		if (rest[start] === '"') {
			let i = start + 1;
			while (i < rest.length) {
				if (rest[i] === "\\") {
					i += 2;
					continue;
				}
				if (rest[i] === '"') {
					return { token: unquoteGitPath(rest.slice(start, i + 1)), next: i + 1 };
				}
				i++;
			}
			return null;
		}
		const sp = rest.indexOf(" b/", start);
		if (sp === -1) return null;
		return { token: rest.slice(start, sp), next: sp };
	};

	const first = readToken(0);
	if (!first) return null;
	if (rest[first.next] !== " ") return null;
	const secondRaw = rest.slice(first.next + 1);
	const secondToken = secondRaw.startsWith('"') ? unquoteGitPath(secondRaw) : secondRaw;
	const stripPrefix = (p: string, prefix: string) => (p.startsWith(prefix) ? p.slice(prefix.length) : p);
	return {
		oldPath: stripPrefix(first.token, "a/"),
		newPath: stripPrefix(secondToken, "b/"),
	};
}

function loadRepoRules(repoRoot: string, warnings: string[]): InvariantRule[] {
	const configPath = join(repoRoot, ".agent", "invariants.json");
	if (!existsSync(configPath)) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(configPath, "utf8"));
	} catch {
		warnings.push("Failed to parse .agent/invariants.json; skipped custom repo rules.");
		return [];
	}
	const rawList: RawCustomRule[] = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object" && Array.isArray((parsed as { invariants?: unknown }).invariants)
			? ((parsed as { invariants: RawCustomRule[] }).invariants)
			: [];

	const rules: InvariantRule[] = [];
	for (const [idx, item] of rawList.entries()) {
		if (!item || typeof item.title !== "string" || typeof item.check !== "string") continue;
		const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : `repo-rule-${idx + 1}`;
		const pathParts = Array.isArray(item.paths) ? item.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0) : [];
		let pathPattern: RegExp | undefined;
		if (pathParts.length > 0) {
			pathPattern = new RegExp(pathParts.map((p) => globToRegex(p).source).join("|"), "i");
		}
		let contentRegexSource: string | undefined;
		if (typeof item.contentRegex === "string" && item.contentRegex.trim()) {
			const src = item.contentRegex.trim();
			if (src.length > 256 || NESTED_QUANTIFIER.test(src)) {
				warnings.push(`Skipped unsafe custom contentRegex on rule \`${id}\` (too long or nested quantifiers).`);
			} else {
				try {
					new RegExp(src, "i");
					contentRegexSource = src;
				} catch {
					warnings.push(`Skipped invalid custom contentRegex on rule \`${id}\`.`);
				}
			}
		}
		rules.push({
			id,
			title: item.title.trim(),
			check: item.check.trim(),
			pathPattern,
			contentRegexSource,
			source: "repo",
		});
	}
	return rules;
}

function testCustomRegexBounded(source: string, lines: string[], ruleId: string, warnings: string[]): boolean {
	if (lines.length === 0) return false;
	try {
		return Boolean(
			runInNewContext(
				`(() => { const re = new RegExp(src, "i"); for (const l of lines) { if (re.test(l)) return true; } return false; })()`,
				{ src: source, lines },
				{ timeout: 100 },
			),
		);
	} catch {
		warnings.push(`Custom contentRegex on rule \`${ruleId}\` timed out (>100ms) and was skipped.`);
		return false;
	}
}

export type ParsedDiffEntry = {
	path: string;
	oldPath: string | null;
	addedLines: string[];
};

export function parseDiffEntries(diffText: string): ParsedDiffEntry[] {
	const entries: ParsedDiffEntry[] = [];
	let current: ParsedDiffEntry | null = null;
	let inHunk = false;

	for (const line of diffText.split("\n")) {
		if (line.startsWith("diff --git ")) {
			inHunk = false;
			const parsed = parseDiffGitHeader(line);
			if (parsed) {
				current = {
					path: parsed.newPath,
					oldPath: parsed.oldPath !== parsed.newPath ? parsed.oldPath : null,
					addedLines: [],
				};
				entries.push(current);
			} else {
				current = null;
			}
			continue;
		}
		if (!current) continue;

		if (!inHunk) {
			if (line.startsWith("rename from ")) {
				current.oldPath = unquoteGitPath(line.slice("rename from ".length));
				continue;
			}
			if (line.startsWith("rename to ")) {
				current.path = unquoteGitPath(line.slice("rename to ".length));
				continue;
			}
			if (line.startsWith("@@ ")) {
				inHunk = true;
			}
			continue;
		}

		// Inside a unified diff hunk:
		if (line.startsWith("@@ ")) {
			continue;
		}
		if (line.startsWith("+")) {
			current.addedLines.push(line.slice(1));
		} else if (!line.startsWith("-") && !line.startsWith(" ") && !line.startsWith("\\")) {
			// Unexpected non-hunk line ends the current hunk cleanly.
			inHunk = false;
		}
	}
	return entries;
}

export function analyzeDiffInvariants(diffText: string, repoRoot?: string): InvariantAnalysis {
	const entries = parseDiffEntries(diffText);
	const changedFiles = [...new Set(entries.map((e) => e.path))];
	const warnings: string[] = [];
	const repoRules = repoRoot ? loadRepoRules(repoRoot, warnings) : [];
	const allRules = [...BUILTIN_RULES, ...repoRules];

	const triggered: TriggeredInvariant[] = [];
	const skipped: SkippedInvariant[] = [];

	for (const rule of allRules) {
		const matchedFiles = new Set<string>();
		const matchedBy = new Set<"path" | "content">();

		for (const entry of entries) {
			const candidatePaths = entry.oldPath ? [entry.path, entry.oldPath] : [entry.path];
			const allExcluded = rule.excludePathPattern ? candidatePaths.every((p) => rule.excludePathPattern!.test(p)) : false;
			if (allExcluded) continue;

			if (rule.pathPattern && candidatePaths.some((p) => !rule.excludePathPattern?.test(p) && rule.pathPattern!.test(p))) {
				matchedFiles.add(entry.oldPath ? `${entry.oldPath} -> ${entry.path}` : entry.path);
				matchedBy.add("path");
			}
			if (entry.addedLines.length > 0 && !rule.excludePathPattern?.test(entry.path)) {
				if (rule.contentPattern && entry.addedLines.some((l) => rule.contentPattern!.test(l))) {
					matchedFiles.add(entry.path);
					matchedBy.add("content");
				} else if (rule.contentRegexSource && testCustomRegexBounded(rule.contentRegexSource, entry.addedLines, rule.id, warnings)) {
					matchedFiles.add(entry.path);
					matchedBy.add("content");
				}
			}
		}

		if (matchedFiles.size > 0) {
			triggered.push({
				id: rule.id,
				title: rule.title,
				check: rule.check,
				source: rule.source,
				matchedFiles: [...matchedFiles],
				matchedBy: [...matchedBy],
			});
		} else if (rule.source === "builtin") {
			skipped.push({
				id: rule.id,
				title: rule.title,
				reason: "no matching files or risk patterns in diff",
			});
		}
	}

	return {
		changedFiles,
		triggered,
		skipped,
		customRuleCount: repoRules.length,
		warnings,
	};
}

export const INVARIANTS_HEADING = "## Invariants checked before review (prove triggered items in checks.txt, or explain N/A)";

export function renderInvariantsMarkdown(analysis: InvariantAnalysis): string {
	const lines: string[] = [INVARIANTS_HEADING];
	if (analysis.triggered.length === 0) {
		lines.push("- [x] No built-in high-risk paths or patterns detected in diff; verify core goal and regression risk in `checks.txt`.");
	}
	for (const item of analysis.triggered) {
		const sample = item.matchedFiles.slice(0, 4).map((f) => `\`${f}\``).join(", ");
		const extra = item.matchedFiles.length > 4 ? ` (+${item.matchedFiles.length - 4} more)` : "";
		const tag = item.source === "repo" ? " [repo rule]" : "";
		lines.push(`- [ ] **${item.title}${tag}** *(triggered by ${sample}${extra})*: ${item.check}`);
	}
	for (const item of analysis.skipped) {
		lines.push(`- [x] **${item.title}:** N/A (${item.reason}).`);
	}
	for (const warn of analysis.warnings) {
		lines.push(`- ⚠️ ${warn}`);
	}
	return lines.join("\n");
}

export function refreshInvariantsSection(existingContext: string, newSection: string): string {
	const headingRe = /^## Invariants checked before review[^\n]*$/m;
	const match = headingRe.exec(existingContext);
	if (!match) {
		const reviewFocusIdx = existingContext.search(/^## Review focus\b/m);
		if (reviewFocusIdx !== -1) {
			return existingContext.slice(0, reviewFocusIdx) + newSection + "\n\n" + existingContext.slice(reviewFocusIdx);
		}
		return existingContext.trimEnd() + "\n\n" + newSection + "\n";
	}
	const start = match.index;
	const afterHeading = start + match[0].length;
	const nextHeadingRel = existingContext.slice(afterHeading).search(/\n## /);
	const end = nextHeadingRel === -1 ? existingContext.length : afterHeading + nextHeadingRel;
	return existingContext.slice(0, start) + newSection + existingContext.slice(end);
}
