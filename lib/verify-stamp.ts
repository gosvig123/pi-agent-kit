// Shared 3-tier verification discovery and commit/tree-hash stamping for any git repo.
// Works across Pi, Claude Code, Codex, and Antigravity because stamps live in the worktree gitdir.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type VerifyTier = "fast" | "all" | "live";

export type VerifyCommand = {
	tier: VerifyTier;
	source: "package.json" | "Makefile" | "script";
	command: string;
	scriptName?: string;
};

export type VerifyDiscovery = {
	packageManager: "pnpm" | "bun" | "yarn" | "npm" | null;
	commands: Partial<Record<VerifyTier, VerifyCommand>>;
	isCodeRepo: boolean;
};

export type VerifyStamp = {
	version: 1;
	tier: VerifyTier;
	head: string | null;
	treeHash: string;
	clean: boolean;
	command: string;
	isOverride: boolean;
	passedAt: string;
};

export type VerifyStampCheck = {
	configured: boolean;
	valid: boolean;
	reason: string;
	command: string | null;
	head: string | null;
	headTree: string | null;
	stamp: VerifyStamp | null;
};

const VALID_HASH = /^[0-9a-f]{40,64}$/i;

function stripTrailingNewline(s: string): string {
	return s.replace(/\r?\n$/, "");
}

function runGit(
	repoRoot: string,
	args: string[],
	opts: { env?: NodeJS.ProcessEnv; preserveSpaces?: boolean } = {},
): { ok: boolean; stdout: string; stderr: string } {
	const res = spawnSync("git", args, {
		cwd: repoRoot,
		encoding: "utf8",
		env: opts.env ?? process.env,
	});
	const rawOut = res.stdout ?? "";
	return {
		ok: res.status === 0,
		stdout: opts.preserveSpaces ? stripTrailingNewline(rawOut) : rawOut.trim(),
		stderr: (res.stderr ?? "").trim(),
	};
}

export function resolveRepoRoot(startDir: string = process.cwd()): string | null {
	const res = runGit(startDir, ["rev-parse", "--show-toplevel"], { preserveSpaces: true });
	return res.ok && res.stdout ? res.stdout : null;
}

export function resolveGitDir(repoRoot: string): string | null {
	const res = runGit(repoRoot, ["rev-parse", "--git-dir"], { preserveSpaces: true });
	if (!res.ok || !res.stdout) return null;
	return isAbsolute(res.stdout) ? res.stdout : resolve(repoRoot, res.stdout);
}

function pmRunCommand(pm: "pnpm" | "bun" | "yarn" | "npm", scriptName: string): string {
	return pm === "yarn" ? `yarn ${scriptName}` : `${pm} run ${scriptName}`;
}

function parseMakeTargets(content: string): Set<string> {
	const targets = new Set<string>();
	for (const line of content.split("\n")) {
		const m = line.match(/^([A-Za-z0-9._-]+)\s*:(?!=)/);
		if (m && !m[1].startsWith(".")) targets.add(m[1]);
	}
	return targets;
}

function buildDiscovery(inputs: {
	rootEntries: Set<string>;
	scriptEntries: Set<string>;
	packageJsonText: string | null;
	makefileText: string | null;
}): VerifyDiscovery {
	const commands: Partial<Record<VerifyTier, VerifyCommand>> = {};
	const codeMarkers = ["package.json", "Makefile", "go.mod", "pyproject.toml", "Cargo.toml", "Package.swift"];
	const isCodeRepo = codeMarkers.some((m) => inputs.rootEntries.has(m));

	let packageManager: "pnpm" | "bun" | "yarn" | "npm" | null = null;
	if (inputs.packageJsonText !== null) {
		if (inputs.rootEntries.has("pnpm-lock.yaml")) packageManager = "pnpm";
		else if (inputs.rootEntries.has("bun.lock") || inputs.rootEntries.has("bun.lockb")) packageManager = "bun";
		else if (inputs.rootEntries.has("yarn.lock")) packageManager = "yarn";
		else packageManager = "npm";

		try {
			const pkg = JSON.parse(inputs.packageJsonText) as { scripts?: Record<string, string> };
			const scripts = pkg.scripts ?? {};
			const tierNames: Record<VerifyTier, string[]> = {
				fast: ["verify:fast"],
				all: ["verify:all", "verify"],
				live: ["verify:live", "verify:release"],
			};
			for (const tier of ["fast", "all", "live"] as const) {
				const found = tierNames[tier].find((name) => typeof scripts[name] === "string" && scripts[name].trim().length > 0);
				if (found) {
					commands[tier] = {
						tier,
						source: "package.json",
						command: pmRunCommand(packageManager, found),
						scriptName: found,
					};
				}
			}
		} catch {
			// Invalid package.json is handled gracefully.
		}
	}

	if (inputs.makefileText !== null) {
		const makeTargets = parseMakeTargets(inputs.makefileText);
		const makeMap: Record<VerifyTier, string[]> = {
			fast: ["verify-fast", "verify_fast"],
			all: ["verify-all", "verify_all", "verify"],
			live: ["verify-live", "verify-release"],
		};
		for (const tier of ["fast", "all", "live"] as const) {
			if (commands[tier]) continue;
			const found = makeMap[tier].find((t) => makeTargets.has(t));
			if (found) {
				commands[tier] = { tier, source: "Makefile", command: `make ${found}`, scriptName: found };
			}
		}
	}

	const scriptMap: Record<VerifyTier, string[]> = {
		fast: ["verify-fast"],
		all: ["verify-all", "verify"],
		live: ["verify-live", "verify-release"],
	};
	for (const tier of ["fast", "all", "live"] as const) {
		if (commands[tier]) continue;
		for (const base of scriptMap[tier]) {
			for (const ext of ["", ".sh", ".mjs", ".js", ".ts"]) {
				const name = `${base}${ext}`;
				if (inputs.scriptEntries.has(name)) {
					const rel = `scripts/${name}`;
					const cmd =
						ext === ".mjs" || ext === ".js" || ext === ".ts"
							? `node ${rel}`
							: ext === ".sh"
								? `bash ${rel}`
								: `./${rel}`;
					commands[tier] = { tier, source: "script", command: cmd };
					break;
				}
			}
			if (commands[tier]) break;
		}
	}

	return { packageManager, commands, isCodeRepo };
}

export function discoverVerifyCommands(repoRoot: string): VerifyDiscovery {
	const rootEntries = new Set<string>();
	for (const name of [
		"package.json",
		"pnpm-lock.yaml",
		"bun.lock",
		"bun.lockb",
		"yarn.lock",
		"Makefile",
		"go.mod",
		"pyproject.toml",
		"Cargo.toml",
		"Package.swift",
	]) {
		if (existsSync(join(repoRoot, name))) rootEntries.add(name);
	}

	const scriptEntries = new Set<string>();
	const scriptsDir = join(repoRoot, "scripts");
	if (existsSync(scriptsDir)) {
		for (const base of ["verify-fast", "verify-all", "verify", "verify-live", "verify-release"]) {
			for (const ext of ["", ".sh", ".mjs", ".js", ".ts"]) {
				const name = `${base}${ext}`;
				if (existsSync(join(scriptsDir, name))) scriptEntries.add(name);
			}
		}
	}

	let packageJsonText: string | null = null;
	if (rootEntries.has("package.json")) {
		try {
			packageJsonText = readFileSync(join(repoRoot, "package.json"), "utf8");
		} catch {
			packageJsonText = null;
		}
	}
	let makefileText: string | null = null;
	if (rootEntries.has("Makefile")) {
		try {
			makefileText = readFileSync(join(repoRoot, "Makefile"), "utf8");
		} catch {
			makefileText = null;
		}
	}

	return buildDiscovery({ rootEntries, scriptEntries, packageJsonText, makefileText });
}

export function discoverVerifyCommandsAtRef(repoRoot: string, ref: string = "HEAD"): VerifyDiscovery {
	const rootRes = runGit(repoRoot, ["ls-tree", "--name-only", ref]);
	if (!rootRes.ok) return { packageManager: null, commands: {}, isCodeRepo: false };
	const rootEntries = new Set(rootRes.stdout.split("\n").filter(Boolean));

	const scriptsRes = runGit(repoRoot, ["ls-tree", "--name-only", `${ref}:scripts`]);
	const scriptEntries = new Set(scriptsRes.ok ? scriptsRes.stdout.split("\n").filter(Boolean) : []);

	let packageJsonText: string | null = null;
	if (rootEntries.has("package.json")) {
		const pkgRes = runGit(repoRoot, ["show", `${ref}:package.json`]);
		if (pkgRes.ok) packageJsonText = pkgRes.stdout;
	}

	let makefileText: string | null = null;
	if (rootEntries.has("Makefile")) {
		const mkRes = runGit(repoRoot, ["show", `${ref}:Makefile`]);
		if (mkRes.ok) makefileText = mkRes.stdout;
	}

	return buildDiscovery({ rootEntries, scriptEntries, packageJsonText, makefileText });
}

export function findHiddenIndexPaths(repoRoot: string): string[] {
	const res = runGit(repoRoot, ["ls-files", "-v"], { preserveSpaces: true });
	if (!res.ok || !res.stdout) return [];
	const hidden: string[] = [];
	for (const line of res.stdout.split("\n")) {
		if (!line) continue;
		const tag = line[0];
		// Lowercase status letters = assume-unchanged; 'S' = skip-worktree.
		if ((tag >= "a" && tag <= "z") || tag === "S") {
			hidden.push(line.slice(2));
		}
	}
	return hidden;
}

export function computeWorkingTreeHash(repoRoot: string): {
	head: string | null;
	treeHash: string | null;
	clean: boolean;
	hiddenPaths: string[];
} {
	const headRes = runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
	const head = headRes.ok ? headRes.stdout : null;
	const hiddenPaths = findHiddenIndexPaths(repoRoot);
	if (hiddenPaths.length > 0) {
		return { head, treeHash: null, clean: false, hiddenPaths };
	}

	const statusRes = runGit(repoRoot, ["status", "--porcelain"]);
	const clean = statusRes.ok && statusRes.stdout.length === 0;
	if (clean && head) {
		const treeRes = runGit(repoRoot, ["rev-parse", `${head}^{tree}`]);
		return { head, treeHash: treeRes.ok ? treeRes.stdout : null, clean: true, hiddenPaths: [] };
	}

	const gitDir = resolveGitDir(repoRoot);
	if (!gitDir) return { head, treeHash: null, clean, hiddenPaths: [] };

	const tmpIndex = join(tmpdir(), `pi-verify-idx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	try {
		const realIndex = join(gitDir, "index");
		if (existsSync(realIndex)) {
			copyFileSync(realIndex, tmpIndex);
		}
		const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
		const addRes = runGit(repoRoot, ["add", "-A"], { env });
		if (!addRes.ok) return { head, treeHash: null, clean, hiddenPaths: [] };
		const writeRes = runGit(repoRoot, ["write-tree"], { env });
		return { head, treeHash: writeRes.ok ? writeRes.stdout : null, clean: false, hiddenPaths: [] };
	} finally {
		rmSync(tmpIndex, { force: true });
	}
}

function tierStampPath(repoRoot: string, tier: VerifyTier): string | null {
	const gitDir = resolveGitDir(repoRoot);
	if (!gitDir) return null;
	return join(gitDir, `pi-verify-stamp-${tier}.json`);
}

function parseStampRecord(raw: unknown, expectedTier: VerifyTier): VerifyStamp | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (r.tier !== expectedTier) return null;
	if (typeof r.treeHash !== "string" || !VALID_HASH.test(r.treeHash)) return null;
	if (typeof r.command !== "string" || !r.command.trim()) return null;
	if (typeof r.passedAt !== "string" || !r.passedAt.trim()) return null;
	if (r.head !== null && r.head !== undefined && (typeof r.head !== "string" || !VALID_HASH.test(r.head))) return null;
	return {
		version: 1,
		tier: expectedTier,
		head: typeof r.head === "string" ? r.head : null,
		treeHash: r.treeHash,
		clean: r.clean === true,
		command: r.command,
		isOverride: r.isOverride === true,
		passedAt: r.passedAt,
	};
}

export function readVerifyStamp(repoRoot: string, tier: VerifyTier): VerifyStamp | null {
	const path = tierStampPath(repoRoot, tier);
	if (!path || !existsSync(path)) return null;
	try {
		return parseStampRecord(JSON.parse(readFileSync(path, "utf8")), tier);
	} catch {
		return null;
	}
}

export function writeVerifyStamp(
	repoRoot: string,
	tier: VerifyTier,
	command: string,
	opts: { isOverride?: boolean; preSnapshot?: { head: string | null; treeHash: string; clean: boolean } } = {},
): VerifyStamp | null {
	const path = tierStampPath(repoRoot, tier);
	if (!path) return null;
	const state = opts.preSnapshot ?? computeWorkingTreeHash(repoRoot);
	if (!state.treeHash) return null;
	const stamp: VerifyStamp = {
		version: 1,
		tier,
		head: state.head,
		treeHash: state.treeHash,
		clean: state.clean,
		command,
		isOverride: opts.isOverride === true,
		passedAt: new Date().toISOString(),
	};
	const dir = resolve(path, "..");
	mkdirSync(dir, { recursive: true });
	const tmpFile = join(dir, `.pi-verify-stamp-${tier}.${process.pid}.${Date.now()}.tmp`);
	try {
		writeFileSync(tmpFile, JSON.stringify(stamp, null, 2) + "\n");
		renameSync(tmpFile, path);
	} catch (err) {
		rmSync(tmpFile, { force: true });
		throw err;
	}
	return stamp;
}

export function checkVerifyStamp(
	repoRoot: string,
	tier: VerifyTier = "all",
	opts: { allowWorkingTree?: boolean } = {},
): VerifyStampCheck {
	const headRes = runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
	const head = headRes.ok ? headRes.stdout : null;
	const headTreeRes = head ? runGit(repoRoot, ["rev-parse", `${head}^{tree}`]) : { ok: false, stdout: "" };
	const headTree = headTreeRes.ok ? headTreeRes.stdout : null;

	// For PR publishing (allowWorkingTree=false), resolve verify config from committed HEAD so uncommitted edits cannot bypass the gate.
	const discovery = !opts.allowWorkingTree && head ? discoverVerifyCommandsAtRef(repoRoot, head) : discoverVerifyCommands(repoRoot);
	const cmd = discovery.commands[tier]?.command ?? null;
	const stamp = readVerifyStamp(repoRoot, tier);

	if (!cmd) {
		return {
			configured: false,
			valid: true,
			reason: `No verify:${tier} command configured.`,
			command: null,
			head,
			headTree,
			stamp,
		};
	}

	if (!head || !headTree) {
		return {
			configured: true,
			valid: false,
			reason: "Repository has no commits yet (HEAD missing).",
			command: cmd,
			head,
			headTree,
			stamp,
		};
	}

	if (!stamp) {
		return {
			configured: true,
			valid: false,
			reason: `No verify:${tier} stamp recorded for HEAD (${head.slice(0, 7)}).`,
			command: cmd,
			head,
			headTree,
			stamp: null,
		};
	}

	if (stamp.isOverride || stamp.command !== cmd) {
		return {
			configured: true,
			valid: false,
			reason: `verify:${tier} stamp used \`${stamp.command}\` instead of configured \`${cmd}\`.`,
			command: cmd,
			head,
			headTree,
			stamp,
		};
	}

	if (stamp.treeHash === headTree) {
		return {
			configured: true,
			valid: true,
			reason: `verify:${tier} passed for HEAD (${head.slice(0, 7)}) at ${stamp.passedAt}.`,
			command: cmd,
			head,
			headTree,
			stamp,
		};
	}

	if (opts.allowWorkingTree) {
		const current = computeWorkingTreeHash(repoRoot);
		if (current.hiddenPaths.length > 0) {
			return {
				configured: true,
				valid: false,
				reason: `Tracked file(s) hidden by assume-unchanged/skip-worktree (${current.hiddenPaths.slice(0, 3).join(", ")}).`,
				command: cmd,
				head,
				headTree,
				stamp,
			};
		}
		if (current.treeHash && current.treeHash === stamp.treeHash) {
			return {
				configured: true,
				valid: true,
				reason: `verify:${tier} passed for current working tree (${stamp.treeHash.slice(0, 7)}, uncommitted) at ${stamp.passedAt}.`,
				command: cmd,
				head,
				headTree,
				stamp,
			};
		}
	}

	return {
		configured: true,
		valid: false,
		reason: `verify:${tier} stamp is stale (stamped tree ${stamp.treeHash.slice(0, 7)}, HEAD tree ${headTree.slice(0, 7)}).`,
		command: cmd,
		head,
		headTree,
		stamp,
	};
}
