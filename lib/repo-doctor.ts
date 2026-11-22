// Audits any git repository for dynamic agent readiness:
// - Concise AGENTS.md + CLAUDE.md link + cited script/path/markdown-link verification
// - .briefs/ gitignore hygiene
// - 3-tier verify contract (verify:fast, verify:all, verify:live) + CI wiring
// - Worktree bootstrap script + fresh verify stamp
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { checkVerifyStamp, discoverVerifyCommands, resolveRepoRoot } from "./verify-stamp.ts";
import { detectRepoStack, generateWorktreeSetupScript } from "./worktree-template.ts";

export type CheckStatus = "pass" | "warn" | "fail";

export type DoctorCheck = {
	id: string;
	status: CheckStatus;
	summary: string;
	details?: string[];
	fixHint?: string;
};

export type DoctorReport = {
	repo: string;
	path: string;
	score: number;
	maxScore: number;
	ok: boolean;
	checks: DoctorCheck[];
	verifyCommands: Record<string, string>;
};

export type FixResult = {
	applied: string[];
	skipped: string[];
};

const MAX_AGENTS_WARN = 100;
const MAX_AGENTS_FAIL = 200;

function runGit(repoRoot: string, args: string[]): { ok: boolean; stdout: string } {
	const res = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
	return { ok: res.status === 0, stdout: (res.stdout ?? "").trim() };
}

function isIgnoredByGit(repoRoot: string, relPath: string): boolean {
	return runGit(repoRoot, ["check-ignore", "-q", "--", relPath]).ok;
}

function hasGithubRemote(repoRoot: string): boolean {
	const res = runGit(repoRoot, ["remote", "-v"]);
	return res.ok && /github\.com/i.test(res.stdout);
}

function readAllPackageMeta(repoRoot: string): { ok: boolean; scripts: Set<string>; knownDepsAndBins: Set<string> } {
	const scripts = new Set<string>();
	const knownDepsAndBins = new Set<string>();
	let ok = false;
	const candidates: string[] = [join(repoRoot, "package.json")];
	try {
		for (const entry of readdirSync(repoRoot)) {
			if (entry === "node_modules" || entry.startsWith(".")) continue;
			const subPkg = join(repoRoot, entry, "package.json");
			if (existsSync(subPkg)) candidates.push(subPkg);
			if (entry === "apps" || entry === "packages" || entry === "services") {
				try {
					for (const nested of readdirSync(join(repoRoot, entry))) {
						const nestedPkg = join(repoRoot, entry, nested, "package.json");
						if (existsSync(nestedPkg)) candidates.push(nestedPkg);
					}
				} catch {
					// Ignore unreadable nested dirs.
				}
			}
		}
	} catch {
		// Ignore directory read errors.
	}
	for (const pkgPath of candidates) {
		if (!existsSync(pkgPath)) continue;
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
				scripts?: Record<string, string>;
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			ok = true;
			for (const key of Object.keys(pkg.scripts ?? {})) scripts.add(key);
			for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]) {
				const shortName = dep.includes("/") ? dep.split("/").pop()! : dep;
				knownDepsAndBins.add(dep);
				knownDepsAndBins.add(shortName);
			}
			const binDir = join(resolve(pkgPath, ".."), "node_modules", ".bin");
			if (existsSync(binDir)) {
				for (const bin of readdirSync(binDir)) knownDepsAndBins.add(bin);
			}
		} catch {
			// Ignore malformed package.json here.
		}
	}
	return { ok, scripts, knownDepsAndBins };
}

function listRepoFiles(repoRoot: string): string[] {
	const res = runGit(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard"]);
	if (!res.ok || !res.stdout) return [];
	return res.stdout.split("\n").filter(Boolean);
}

const KNOWN_FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|svelte|vue|py|go|rs|swift|sh|yml|yaml|json|md|sql|toml|css|scss|html)$/i;
const BUILTIN_PM_SUBCOMMANDS = new Set([
	"install", "ci", "i", "add", "remove", "rm", "update", "up", "test", "start", "build", "run",
	"exec", "dlx", "create", "init", "audit", "outdated", "ls", "list", "publish", "pack", "link",
	"unlink", "version", "config", "cache", "why", "prune", "dedupe", "login", "whoami", "help",
	"x", "patch", "store", "env", "setup", "upgrade", "completions", "workspace", "workspaces",
	"tsc", "tsx", "prisma", "drizzle-kit", "vitest", "jest", "eslint", "prettier", "biome",
	"svelte-check", "vite", "next", "astro", "playwright", "wrangler", "turbo", "changesets",
]);
const IGNORED_PATH_SEGMENTS = /(^|\/)(dist|out|build|node_modules|\.data|Contents\/Resources|Library\/|electron-user-data\/)\b/;
const EXAMPLE_LINE_CUE = /\b(e\.g\.|for example|instead of|such as|prefer\s+`[^`]+`)\b/i;
const PM_FLAG_WITH_VALUE = new Set(["-w", "--workspace", "--filter", "-F", "-C", "--dir", "--prefix", "--cwd"]);

function extractRunScriptName(token: string): string | null {
	const m = token.match(/^(?:npm|pnpm|bun|yarn)\s+run\s+(.+)$/);
	if (!m) return null;
	const parts = m[1].trim().split(/\s+/);
	for (let i = 0; i < parts.length; i++) {
		const p = parts[i];
		if (p === "--") return null;
		if (p.startsWith("-")) {
			if (PM_FLAG_WITH_VALUE.has(p)) i++;
			continue;
		}
		return /^[A-Za-z0-9:._-]+$/.test(p) ? p : null;
	}
	return null;
}

function repoPathExists(repoRoot: string, repoFiles: string[], cleanPath: string): boolean {
	if (existsSync(join(repoRoot, cleanPath))) return true;
	const suffix = `/${cleanPath}`;
	return repoFiles.some((f) => f === cleanPath || f.endsWith(suffix));
}

function lintDocFile(
	repoRoot: string,
	relDocPath: string,
	pkgScripts: Set<string>,
	knownDepsAndBins: Set<string>,
	hasPkg: boolean,
	repoFiles: string[],
): string[] {
	const absPath = join(repoRoot, relDocPath);
	if (!existsSync(absPath)) return [];
	const lines = readFileSync(absPath, "utf8").split("\n");
	const broken: string[] = [];
	let fenceChar: "`" | "~" | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = i + 1;
		const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
		if (fenceMatch) {
			const ch = fenceMatch[1][0] as "`" | "~";
			if (fenceChar === null) fenceChar = ch;
			else if (fenceChar === ch) fenceChar = null;
			continue;
		}
		if (fenceChar !== null) continue;
		const lineMentionsSkill = /\bskill\b/i.test(line);
		const isExampleLine = EXAMPLE_LINE_CUE.test(line);

		// 1. Check relative Markdown links `[label](relative/path.md#anchor)`.
		for (const mdLink of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
			const rawTarget = mdLink[1].replace(/^<|>$/g, "").split("#")[0].split("?")[0];
			if (
				!rawTarget ||
				rawTarget.startsWith("/") ||
				rawTarget.startsWith("~") ||
				rawTarget.startsWith("../") ||
				/^[a-z]+:/i.test(rawTarget) ||
				rawTarget.includes("<") ||
				rawTarget.includes("*")
			) {
				continue;
			}
			const cleanLink = rawTarget.replace(/^\.\//, "");
			if (IGNORED_PATH_SEGMENTS.test(cleanLink) || isIgnoredByGit(repoRoot, cleanLink)) continue;
			if (!existsSync(join(repoRoot, cleanLink))) {
				broken.push(`${relDocPath}:${lineNo} links to missing file \`${cleanLink}\``);
			}
		}

		// 2. Check backticked spans on non-fenced lines.
		for (const match of line.matchAll(/`([^`\n]+)`/g)) {
			const token = match[1].trim();
			if (
				!token ||
				token.includes("<") ||
				token.includes(">") ||
				token.includes("*") ||
				token.includes("$") ||
				token.includes("{") ||
				token.includes("…") ||
				token.includes("...")
			) {
				continue;
			}

			// 2a. Check `npm|pnpm|bun|yarn run <script>` and short-form `pnpm|yarn|bun <script>`.
			if (hasPkg) {
				const explicitScript = extractRunScriptName(token);
				if (explicitScript && !pkgScripts.has(explicitScript)) {
					broken.push(`${relDocPath}:${lineNo} cites missing script \`${explicitScript}\``);
					continue;
				}
				const shortMatch = token.match(/^(?:pnpm|yarn|bun)\s+([A-Za-z0-9:._-]+)(?:\s|$)/);
				if (shortMatch) {
					const name = shortMatch[1];
					const isFileLike = KNOWN_FILE_EXT.test(name) || existsSync(join(repoRoot, name));
					if (
						!BUILTIN_PM_SUBCOMMANDS.has(name) &&
						!knownDepsAndBins.has(name) &&
						!name.startsWith("-") &&
						!name.includes("/") &&
						!isFileLike &&
						!pkgScripts.has(name)
					) {
						broken.push(`${relDocPath}:${lineNo} cites missing script \`${name}\``);
						continue;
					}
				}
			}

			// 2b. Check explicit repo-relative file paths.
			const afterSpan = line.slice((match.index ?? 0) + match[0].length);
			const refersToOtherRepo = /^\s+in\s+`[^`]+`/.test(afterSpan);
			if (
				!isExampleLine &&
				!refersToOtherRepo &&
				!token.includes(" ") &&
				!token.startsWith("-") &&
				!token.startsWith("/") &&
				!token.startsWith("~") &&
				!token.startsWith("http://") &&
				!token.startsWith("https://") &&
				!token.startsWith("../") &&
				token.includes("/") &&
				KNOWN_FILE_EXT.test(token.replace(/:[0-9]+(-[0-9]+)?$/, ""))
			) {
				const cleanPath = token.replace(/^\.\//, "").replace(/:[0-9]+(-[0-9]+)?$/, "");
				if (/^(path\/to|foo|bar|example|your-|some_)/i.test(cleanPath) || /\/some_/.test(cleanPath)) continue;
				if (lineMentionsSkill && cleanPath.startsWith("references/")) continue;
				if (IGNORED_PATH_SEGMENTS.test(cleanPath) || isIgnoredByGit(repoRoot, cleanPath)) continue;
				if (!repoPathExists(repoRoot, repoFiles, cleanPath)) {
					broken.push(`${relDocPath}:${lineNo} cites missing path \`${cleanPath}\``);
				}
			}
		}
	}
	return broken;
}

function checkWorkflows(repoRoot: string, verifyCmd: string | null, verifyScriptName?: string): DoctorCheck {
	const wfDir = join(repoRoot, ".github", "workflows");
	const ghRemote = hasGithubRemote(repoRoot);
	if (!existsSync(wfDir)) {
		return {
			id: "ci-verify",
			status: ghRemote ? "fail" : "warn",
			summary: "No .github/workflows directory found.",
			fixHint: "Run `repo-doctor --fix --scaffold-ci` to add a starter PR check workflow.",
		};
	}
	const files = readdirSync(wfDir).filter((f) => /\.ya?ml$/i.test(f));
	if (files.length === 0) {
		return {
			id: "ci-verify",
			status: ghRemote ? "fail" : "warn",
			summary: ".github/workflows has no YAML files.",
			fixHint: "Run `repo-doctor --fix --scaffold-ci` to add a starter PR check workflow.",
		};
	}

	let hasPrTrigger = false;
	let runsVerify = false;
	const verifyNeedles = [
		...(verifyCmd ? [verifyCmd] : []),
		...(verifyScriptName ? [verifyScriptName] : []),
		"verify:all",
		"verify-all",
		"verify-repo",
	];

	for (const file of files) {
		const text = readFileSync(join(wfDir, file), "utf8");
		if (/\bpull_request\b|\bpush\b/.test(text)) hasPrTrigger = true;
		if (verifyNeedles.some((needle) => needle && text.includes(needle))) runsVerify = true;
	}

	if (!hasPrTrigger) {
		return {
			id: "ci-verify",
			status: "warn",
			summary: `Workflows exist (${files.join(", ")}) but none trigger on pull_request or push.`,
			fixHint: "Add a `pull_request` trigger to your verification workflow.",
		};
	}
	if (verifyCmd && !runsVerify) {
		return {
			id: "ci-verify",
			status: "warn",
			summary: `CI workflows (${files.join(", ")}) do not call \`${verifyCmd}\`.`,
			fixHint: `Call \`${verifyCmd}\` inside a pull_request CI job so local and CI checks match.`,
		};
	}
	return {
		id: "ci-verify",
		status: "pass",
		summary: verifyCmd
			? `CI runs \`${verifyCmd}\` (${files.length} workflow file(s)).`
			: `CI workflows present (${files.join(", ")}).`,
	};
}

function findWorktreeScript(repoRoot: string): string | null {
	for (const rel of ["scripts/worktree-setup.sh", "scripts/worktree-setup.mjs", "scripts/worktree-setup"]) {
		if (existsSync(join(repoRoot, rel))) return rel;
	}
	return null;
}

function pathLstat(p: string) {
	try {
		return lstatSync(p);
	} catch {
		return null;
	}
}

export function auditRepo(targetDir: string = process.cwd()): DoctorReport {
	const repoRoot = resolveRepoRoot(targetDir) ?? resolve(targetDir);
	const repoName = basename(repoRoot);
	const checks: DoctorCheck[] = [];

	// 1. AGENTS.md presence and conciseness.
	const agentsPath = join(repoRoot, "AGENTS.md");
	if (!existsSync(agentsPath)) {
		checks.push({
			id: "agents-md",
			status: "fail",
			summary: "Missing AGENTS.md.",
			fixHint: "Run `repo-doctor --fix --scaffold-agents` to create a short starter AGENTS.md.",
		});
	} else {
		const lineCount = readFileSync(agentsPath, "utf8").split("\n").length;
		if (lineCount > MAX_AGENTS_FAIL) {
			checks.push({
				id: "agents-md",
				status: "fail",
				summary: `AGENTS.md is ${lineCount} lines (over ${MAX_AGENTS_FAIL}-line cap).`,
				fixHint: "Keep root AGENTS.md under 100 lines and move subsystem details into folder-level AGENTS.md or CONTEXT.md.",
			});
		} else if (lineCount > MAX_AGENTS_WARN) {
			checks.push({
				id: "agents-md",
				status: "warn",
				summary: `AGENTS.md is ${lineCount} lines (target <= ${MAX_AGENTS_WARN}).`,
				fixHint: "Trim step-by-step prose or move subsystem notes into subfolder AGENTS.md files.",
			});
		} else {
			checks.push({ id: "agents-md", status: "pass", summary: `AGENTS.md present (${lineCount} lines).` });
		}
	}

	// 2. CLAUDE.md linked to AGENTS.md.
	const claudePath = join(repoRoot, "CLAUDE.md");
	const claudeStat = pathLstat(claudePath);
	if (!existsSync(agentsPath)) {
		checks.push({
			id: "claude-md",
			status: "warn",
			summary: "Skipped CLAUDE.md link check because AGENTS.md is missing.",
		});
	} else if (!claudeStat) {
		checks.push({
			id: "claude-md",
			status: "warn",
			summary: "Missing CLAUDE.md link to AGENTS.md.",
			fixHint: "Run `repo-doctor --fix` to create `CLAUDE.md -> AGENTS.md`.",
		});
	} else if (claudeStat.isSymbolicLink() && !existsSync(claudePath)) {
		checks.push({
			id: "claude-md",
			status: "warn",
			summary: `CLAUDE.md is a broken symlink (-> ${readlinkSync(claudePath)}).`,
			fixHint: "Remove the broken CLAUDE.md symlink and re-run `repo-doctor --fix`.",
		});
	} else if (claudeStat.isSymbolicLink() && basename(readlinkSync(claudePath)) === "AGENTS.md") {
		checks.push({ id: "claude-md", status: "pass", summary: "CLAUDE.md symlinks to AGENTS.md." });
	} else {
		const content = readFileSync(claudePath, "utf8");
		if (/@AGENTS\.md\b/.test(content)) {
			checks.push({ id: "claude-md", status: "pass", summary: "CLAUDE.md imports @AGENTS.md." });
		} else {
			checks.push({
				id: "claude-md",
				status: "warn",
				summary: "CLAUDE.md is a separate file that does not import @AGENTS.md.",
				fixHint: "Replace CLAUDE.md with a symlink to AGENTS.md (or `@AGENTS.md`) to prevent drift.",
			});
		}
	}

	// 3. Executable doc linter on AGENTS.md and CONTEXT.md.
	const { ok: hasPkg, scripts: pkgScripts, knownDepsAndBins } = readAllPackageMeta(repoRoot);
	const repoFiles = listRepoFiles(repoRoot);
	const brokenRefs = [
		...lintDocFile(repoRoot, "AGENTS.md", pkgScripts, knownDepsAndBins, hasPkg, repoFiles),
		...lintDocFile(repoRoot, "CONTEXT.md", pkgScripts, knownDepsAndBins, hasPkg, repoFiles),
	];
	if (brokenRefs.length > 0) {
		checks.push({
			id: "doc-links",
			status: "fail",
			summary: `${brokenRefs.length} stale script or file reference(s) in AGENTS.md / CONTEXT.md.`,
			details: brokenRefs.slice(0, 12),
			fixHint: "Update or remove the dead script/path references listed above.",
		});
	} else {
		checks.push({ id: "doc-links", status: "pass", summary: "Cited scripts, paths, and links in AGENTS.md / CONTEXT.md exist." });
	}

	// 4. .briefs/ gitignore hygiene.
	const briefsIgnored = isIgnoredByGit(repoRoot, ".briefs/test");
	if (!briefsIgnored) {
		checks.push({
			id: "gitignore-briefs",
			status: "fail",
			summary: ".briefs/ is not ignored by git.",
			fixHint: "Run `repo-doctor --fix` to add `.briefs/` to `.gitignore`.",
		});
	} else {
		checks.push({ id: "gitignore-briefs", status: "pass", summary: ".briefs/ is git-ignored." });
	}

	// 5. 3-tier verify contract.
	const discovery = discoverVerifyCommands(repoRoot);
	const verifyCommands: Record<string, string> = {};
	for (const [tier, info] of Object.entries(discovery.commands)) {
		if (info) verifyCommands[tier] = info.command;
	}
	if (!discovery.commands.all) {
		checks.push({
			id: "verify-all",
			status: discovery.isCodeRepo ? "fail" : "warn",
			summary: "No `verify:all` (or `verify`) command defined.",
			fixHint: "Add a single `verify:all` script (package.json, Makefile, or scripts/verify-all.sh) that runs typecheck, lint, tests, and build.",
		});
	} else {
		const tiers = Object.keys(verifyCommands).join(", ");
		checks.push({
			id: "verify-all",
			status: discovery.commands.fast ? "pass" : "warn",
			summary: discovery.commands.fast
				? `Verify contract present (${tiers}): \`${discovery.commands.all.command}\`.`
				: `\`${discovery.commands.all.command}\` present, but no \`verify:fast\` (<15s) script yet.`,
			fixHint: discovery.commands.fast ? undefined : "Add `verify:fast` for quick per-slice checks.",
		});
	}

	// 6. CI invokes verify command on PRs.
	checks.push(checkWorkflows(repoRoot, discovery.commands.all?.command ?? null, discovery.commands.all?.scriptName));

	// 7. Worktree bootstrap script.
	const wtScript = findWorktreeScript(repoRoot);
	const needsWorktreeSetup = existsSync(join(repoRoot, "package.json")) || existsSync(join(repoRoot, ".env.example")) || existsSync(join(repoRoot, ".env"));
	if (wtScript) {
		const envWtIgnored = isIgnoredByGit(repoRoot, ".env.worktree");
		checks.push({
			id: "worktree-setup",
			status: envWtIgnored ? "pass" : "warn",
			summary: envWtIgnored ? `Worktree bootstrap present (${wtScript}).` : `${wtScript} exists, but .env.worktree is not git-ignored.`,
			fixHint: envWtIgnored ? undefined : "Run `repo-doctor --fix` to ignore `.env.worktree`.",
		});
	} else if (needsWorktreeSetup) {
		checks.push({
			id: "worktree-setup",
			status: "warn",
			summary: "No worktree bootstrap script (`scripts/worktree-setup.sh`).",
			fixHint: "Run `repo-doctor --fix --scaffold-worktree` to generate one for T3 worktree setup.",
		});
	} else {
		checks.push({ id: "worktree-setup", status: "pass", summary: "Worktree setup script not required for this repo." });
	}

	// 8. Verify stamp status (informational when verify:all exists).
	if (discovery.commands.all) {
		const stamp = checkVerifyStamp(repoRoot, "all", { allowWorkingTree: true });
		checks.push({
			id: "verify-stamp",
			status: stamp.valid ? "pass" : "warn",
			summary: stamp.reason,
			fixHint: stamp.valid ? undefined : "Run `verify-repo` to stamp current HEAD.",
		});
	}

	const maxScore = checks.length * 2;
	const score = checks.reduce((acc, c) => acc + (c.status === "pass" ? 2 : c.status === "warn" ? 1 : 0), 0);
	const ok = checks.every((c) => c.status !== "fail");

	return {
		repo: repoName,
		path: repoRoot,
		score,
		maxScore,
		ok,
		checks,
		verifyCommands,
	};
}

function appendGitignoreEntries(repoRoot: string, entries: string[]): string[] {
	const gitignorePath = join(repoRoot, ".gitignore");
	const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
	const toAdd = entries.filter((entry) => !isIgnoredByGit(repoRoot, entry.endsWith("/") ? `${entry}test` : entry));
	if (toAdd.length === 0) return [];
	const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
	const block = `${prefix}${existing.length > 0 ? "\n" : ""}# Agent scratch and worktree runtime files\n${toAdd.join("\n")}\n`;
	writeFileSync(gitignorePath, existing + block);
	return toAdd;
}

function generateStarterAgents(repoRoot: string): string {
	const name = basename(repoRoot);
	const stack = detectRepoStack(repoRoot);
	const discovery = discoverVerifyCommands(repoRoot);
	const verifyLine = discovery.commands.all
		? `- Full verification: \`${discovery.commands.all.command}\``
		: "- Full verification: add `verify:all` to `package.json` or `Makefile`";
	return `# ${name}

Short project rules for coding agents. Keep this file under 100 lines.

## Stack & Setup
- Stack: ${stack}
- Worktree setup: \`bash scripts/worktree-setup.sh\` (when present; load worktree port with \`set -a; . ./.env.worktree; set +a\`)

## Verify
${verifyLine}

## Key Paths
- Add the 3–5 main entry points and URLs here.
`;
}

function detectPnpmMajorVersion(repoRoot: string): string {
	const lockPath = join(repoRoot, "pnpm-lock.yaml");
	if (existsSync(lockPath)) {
		try {
			const head = readFileSync(lockPath, "utf8").slice(0, 512);
			const m = head.match(/lockfileVersion:\s*['"]?(\d+)/);
			if (m) {
				const v = Number(m[1]);
				if (v >= 9) return "9";
				if (v === 6) return "8";
			}
		} catch {
			// Fall back to default.
		}
	}
	return "9";
}

function generateStarterCi(repoRoot: string, verifyCmd: string): string {
	const stack = detectRepoStack(repoRoot);
	if (stack === "pnpm") {
		let hasPackageManager = false;
		try {
			const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { packageManager?: string };
			hasPackageManager = typeof pkg.packageManager === "string" && pkg.packageManager.startsWith("pnpm@");
		} catch {
			hasPackageManager = false;
		}
		const pnpmVersionBlock = hasPackageManager
			? ""
			: `\n        with:\n          version: ${detectPnpmMajorVersion(repoRoot)}`;
		return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4${pnpmVersionBlock}
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: ${verifyCmd}
`;
	}
	if (stack === "bun") {
		return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: ${verifyCmd}
`;
	}
	if (stack === "go") {
		return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - run: ${verifyCmd}
`;
	}
	if (stack === "python") {
		const usesUv = existsSync(join(repoRoot, "uv.lock"));
		const setupSteps = usesUv
			? "      - uses: astral-sh/setup-uv@v5\n      - run: uv sync\n"
			: "      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n";
		return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setupSteps}      - run: ${verifyCmd}
`;
	}
	if (stack === "yarn") {
		return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: yarn
      - run: yarn install --frozen-lockfile
      - run: ${verifyCmd}
`;
	}
	if (stack === "npm") {
		const hasLock = existsSync(join(repoRoot, "package-lock.json"));
		let hasDeps = false;
		const pkgPath = join(repoRoot, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
					dependencies?: Record<string, string>;
					devDependencies?: Record<string, string>;
				};
				hasDeps = Object.keys(pkg.dependencies ?? {}).length > 0 || Object.keys(pkg.devDependencies ?? {}).length > 0;
			} catch {
				hasDeps = false;
			}
		}
		const cacheLine = hasLock ? "\n          cache: npm" : "";
		const installStep = hasLock ? "      - run: npm ci\n" : hasDeps ? "      - run: npm install\n" : "";
		return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24${cacheLine}
${installStep}      - run: ${verifyCmd}
`;
	}
	// Generic / Makefile repository with no detected language runtime.
	return `name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ${verifyCmd}
`;
}

export function applyRepoFixes(
	targetDir: string,
	opts: { scaffoldAgents?: boolean; scaffoldWorktree?: boolean; scaffoldCi?: boolean } = {},
): FixResult {
	const repoRoot = resolveRepoRoot(targetDir);
	if (!repoRoot) {
		throw new Error(`not inside a git repository (${resolve(targetDir)}). Run inside a git repo.`);
	}
	const applied: string[] = [];
	const skipped: string[] = [];

	// 1. Starter AGENTS.md (only if requested and absent).
	const agentsPath = join(repoRoot, "AGENTS.md");
	if (opts.scaffoldAgents) {
		if (!existsSync(agentsPath)) {
			writeFileSync(agentsPath, generateStarterAgents(repoRoot));
			applied.push("created starter AGENTS.md");
		} else {
			skipped.push("AGENTS.md already exists");
		}
	}

	// 2. Symlink CLAUDE.md -> AGENTS.md when AGENTS.md exists and CLAUDE.md does not exist at all (including broken symlinks).
	const claudePath = join(repoRoot, "CLAUDE.md");
	const claudeStat = pathLstat(claudePath);
	if (existsSync(agentsPath)) {
		if (!claudeStat) {
			symlinkSync("AGENTS.md", claudePath);
			applied.push("linked CLAUDE.md -> AGENTS.md");
		} else if (claudeStat.isSymbolicLink() && !existsSync(claudePath)) {
			skipped.push(`CLAUDE.md is a broken symlink (-> ${readlinkSync(claudePath)}); remove it first to re-link`);
		}
	}

	// 3. Worktree bootstrap script (only if requested and absent).
	if (opts.scaffoldWorktree) {
		const wtPath = join(repoRoot, "scripts", "worktree-setup.sh");
		if (!findWorktreeScript(repoRoot)) {
			mkdirSync(join(repoRoot, "scripts"), { recursive: true });
			writeFileSync(wtPath, generateWorktreeSetupScript(repoRoot));
			chmodSync(wtPath, 0o755);
			applied.push("created scripts/worktree-setup.sh");
		} else {
			skipped.push("worktree setup script already exists");
		}
	}

	// 4. .gitignore hygiene (.briefs/ and .env.worktree when worktree script exists).
	const ignoreEntries = [".briefs/"];
	if (opts.scaffoldWorktree || findWorktreeScript(repoRoot)) {
		ignoreEntries.push(".env.worktree");
	}
	const addedIgnores = appendGitignoreEntries(repoRoot, ignoreEntries);
	if (addedIgnores.length > 0) {
		applied.push(`added ${addedIgnores.join(", ")} to .gitignore`);
	}

	// 5. Starter CI workflow (only if requested, workflows missing, and verify:all exists).
	if (opts.scaffoldCi) {
		const wfDir = join(repoRoot, ".github", "workflows");
		const existingYml = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/i.test(f)) : [];
		const discovery = discoverVerifyCommands(repoRoot);
		if (existingYml.length > 0) {
			skipped.push("CI workflow already exists");
		} else if (!discovery.commands.all) {
			skipped.push("skipped CI scaffold: define verify:all first");
		} else {
			mkdirSync(wfDir, { recursive: true });
			writeFileSync(join(wfDir, "ci.yml"), generateStarterCi(repoRoot, discovery.commands.all.command));
			applied.push(`created .github/workflows/ci.yml running \`${discovery.commands.all.command}\``);
		}
	}

	return { applied, skipped };
}
