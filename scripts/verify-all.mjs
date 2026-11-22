#!/usr/bin/env node
// Real end-to-end verification suite for repo-doctor, verify-repo, pr-publish, worktree-setup, and brief-init.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = {
	doctor: join(KIT_ROOT, "bin", "repo-doctor"),
	verify: join(KIT_ROOT, "bin", "verify-repo"),
	publish: join(KIT_ROOT, "bin", "pr-publish"),
	brief: join(KIT_ROOT, "bin", "brief-init"),
};

function run(cmd, args, opts = {}) {
	return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function initTempRepo(t, suffix = "") {
	const base = mkdtempSync(join(tmpdir(), "pi-kit-verify-"));
	t.after(() => rmSync(base, { recursive: true, force: true }));
	const repo = join(base, `repo${suffix}`);
	mkdirSync(repo, { recursive: true });
	assert.equal(run("git", ["init", "-q", "-b", "main"], { cwd: repo }).status, 0);
	run("git", ["config", "user.email", "test@example.com"], { cwd: repo });
	run("git", ["config", "user.name", "Test"], { cwd: repo });
	return { base, repo };
}

function writePrBody(dir) {
	const p = join(dir, "pr.md");
	writeFileSync(p, "## Why\nTest PR.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n");
	return p;
}

test("verify-repo + pr-publish enforce full-tree integrity, overrides, mutations, hidden flags, and fail-closed PR head", (t) => {
	const { base, repo } = initTempRepo(t, " with space ");
	const prBody = writePrBody(base);

	writeFileSync(join(repo, ".gitignore"), ".env\n");
	writeFileSync(join(repo, "state"), "ok\n");
	writeFileSync(
		join(repo, "package.json"),
		JSON.stringify({
			name: "stamp-test",
			scripts: {
				"verify:fast": "echo fast",
				"verify:all": "grep -qx ok state",
			},
		}),
	);
	assert.equal(run("git", ["add", "."], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "init"], { cwd: repo }).status, 0);
	assert.equal(run("git", ["checkout", "-q", "-b", "feat/x"], { cwd: repo }).status, 0);
	writeFileSync(join(repo, "file.txt"), "v1\n");
	assert.equal(run("git", ["add", "file.txt"], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "feat"], { cwd: repo }).status, 0);

	// 1. Unverified forces draft.
	const r1 = run("node", [BIN.publish, "create", "--title", "t", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api", "--dry-run"], { cwd: repo });
	assert.equal(r1.status, 0, r1.stderr);
	assert.equal(JSON.parse(r1.stdout).isDraft, true);

	// 2. --cmd override cannot mint a valid PR gate stamp.
	const rOverride = run("node", [BIN.verify, "all", "--cmd", "true"], { cwd: repo });
	assert.equal(rOverride.status, 0, rOverride.stderr);
	const rAfterOverride = run("node", [BIN.publish, "create", "--title", "t", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api", "--dry-run"], { cwd: repo });
	assert.equal(JSON.parse(rAfterOverride.stdout).isDraft, true);

	// 3. Real verify-repo stamps HEAD (and works in path with trailing space).
	const rReal = run("node", [BIN.verify, "all"], { cwd: repo });
	assert.equal(rReal.status, 0, rReal.stderr);
	const rAfterReal = run("node", [BIN.publish, "create", "--title", "t", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api", "--dry-run"], { cwd: repo });
	assert.equal(JSON.parse(rAfterReal.stdout).isDraft, false);

	// 4. Uncommitted package.json wipe cannot disable committed HEAD gate after an edit.
	writeFileSync(join(repo, "file.txt"), "v2\n");
	assert.equal(run("git", ["commit", "-q", "-am", "edit"], { cwd: repo }).status, 0);
	writeFileSync(join(repo, "package.json"), "{}");
	const rWiped = run("node", [BIN.publish, "create", "--title", "t", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api", "--dry-run"], { cwd: repo });
	const wipedJson = JSON.parse(rWiped.stdout);
	assert.equal(wipedJson.verifyStatus.configured, true);
	assert.equal(wipedJson.isDraft, true);
	assert.equal(run("git", ["checkout", "--", "package.json"], { cwd: repo }).status, 0);

	// 5. Untracked file required by check cannot validate commit without that file.
	writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stamp-test", scripts: { "verify:all": "test -f helper" } }));
	assert.equal(run("git", ["commit", "-q", "-am", "need helper"], { cwd: repo }).status, 0);
	writeFileSync(join(repo, "helper"), "yes\n");
	assert.equal(run("node", [BIN.verify, "all"], { cwd: repo }).status, 0);
	rmSync(join(repo, "helper"));
	const rMissingHelper = run("node", [BIN.publish, "create", "--title", "t", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api", "--dry-run"], { cwd: repo });
	assert.equal(JSON.parse(rMissingHelper.stdout).isDraft, true);

	// 6. Mutation during verify rejects stamping.
	writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stamp-test", scripts: { "verify:all": "grep -qx ok state && printf 'bad\\n' > state" } }));
	assert.equal(run("git", ["commit", "-q", "-am", "mutating verify"], { cwd: repo }).status, 0);
	const rMut = run("node", [BIN.verify, "all"], { cwd: repo });
	assert.notEqual(rMut.status, 0);
	assert.equal(run("git", ["checkout", "--", "state"], { cwd: repo }).status, 0);

	// 7. assume-unchanged hidden flag blocks stamping.
	writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stamp-test", scripts: { "verify:all": "grep -qx ok state" } }));
	assert.equal(run("git", ["commit", "-q", "-am", "restore verify"], { cwd: repo }).status, 0);
	assert.equal(run("git", ["update-index", "--assume-unchanged", "state"], { cwd: repo }).status, 0);
	const rHidden = run("node", [BIN.verify, "all"], { cwd: repo });
	assert.notEqual(rHidden.status, 0);
	assert.equal(run("git", ["update-index", "--no-assume-unchanged", "state"], { cwd: repo }).status, 0);

	// 8. Malformed stamp file does not crash pr-publish.
	const gitDir = run("git", ["rev-parse", "--git-dir"], { cwd: repo }).stdout.replace(/\r?\n$/, "");
	writeFileSync(resolve(repo, gitDir, "pi-verify-stamp-all.json"), JSON.stringify({ version: 1, tier: "all" }));
	const rMalformed = run("node", [BIN.publish, "create", "--title", "t", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api", "--dry-run"], { cwd: repo });
	assert.equal(rMalformed.status, 0);
	assert.equal(JSON.parse(rMalformed.stdout).isDraft, true);

	// 9. Verbose --json check (>1MB stdout) succeeds with valid JSON.
	writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stamp-test", scripts: { "verify:all": "node -e 'process.stdout.write(\"a\".repeat(1200000))'" } }));
	assert.equal(run("git", ["commit", "-q", "-am", "verbose verify"], { cwd: repo }).status, 0);
	const rVerbose = run("node", [BIN.verify, "all", "--json"], { cwd: repo });
	assert.equal(rVerbose.status, 0, rVerbose.stderr);
	const vJson = JSON.parse(rVerbose.stdout);
	assert.equal(vJson.ok, true);
	assert.equal(vJson.truncated, true);

	// 10. Failed gh headRefOid fails closed on `pr-publish edit --ready`.
	const fakeBin = join(base, "fakebin");
	mkdirSync(fakeBin, { recursive: true });
	const fakeGh = join(fakeBin, "gh");
	writeFileSync(
		fakeGh,
		`#!/usr/bin/env bash
if [[ "$*" == *"--json files"* ]]; then echo "file.txt"; exit 0; fi
if [[ "$*" == *"headRefOid"* ]]; then echo "api error" >&2; exit 1; fi
exit 0
`,
	);
	chmodSync(fakeGh, 0o755);
	const rFailClosed = run(
		"node",
		[BIN.publish, "edit", "12", "--ready", "--body-file", prBody, "--base", "main", "--allow-no-screenshots", "--skip-markdown-api"],
		{ cwd: repo, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
	);
	assert.notEqual(rFailClosed.status, 0);
	assert.match(rFailClosed.stderr, /Could not verify PR #12 remote head SHA/);
});

test("repo-doctor handles non-git refusal, dangling CLAUDE.md, doc-links precision, non-Node/pnpm CI, and nested .env worktree setup", (t) => {
	// 1. Refuses --fix outside a git repo.
	const plain = mkdtempSync(join(tmpdir(), "pi-kit-plain-"));
	t.after(() => rmSync(plain, { recursive: true, force: true }));
	const rPlain = run("node", [BIN.doctor, plain, "--fix"]);
	assert.notEqual(rPlain.status, 0);
	assert.equal(existsSync(join(plain, ".gitignore")), false);

	// 2. Dangling CLAUDE.md symlink + doc-links precision + pnpm CI without packageManager.
	const { base, repo } = initTempRepo(t);
	writeFileSync(join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
	writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "web", scripts: { dev: "echo dev", "verify:all": "echo ok" }, devDependencies: { typescript: "5.0.0" } }));
	writeFileSync(join(repo, "index.ts"), "export {};\n");
	writeFileSync(join(repo, "AGENTS.md"), [
		"# Web",
		"- Tools: `pnpm prisma migrate`, `pnpm tsc --noEmit`, `npm run -w web dev`, `yarn workspace web dev`, `bun index.ts`.",
		"- Flag path: `--config=config/app.json`.",
		"- Example: prefer `src/some_module.rs` instead of `src/some_module/mod.rs`.",
		"- Cross-repo: `workflows/outbox.go` in `platform`.",
		"~~~sh",
		"`npm run inside-tilde-fence`",
		"~~~",
		"- Broken md link: [guide](docs/missing.md#top)",
		"- Broken script: `npm run nope`",
	].join("\n"));
	symlinkSync("docs/nonexistent.md", join(repo, "CLAUDE.md"));
	assert.equal(run("git", ["add", "pnpm-lock.yaml", "package.json", "index.ts", "AGENTS.md"], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "init"], { cwd: repo }).status, 0);

	const rFix = run("node", [BIN.doctor, repo, "--fix", "--scaffold-worktree", "--scaffold-ci", "--json"]);
	const parsed = JSON.parse(rFix.stdout);
	assert.ok(parsed.fixes.skipped.some((s) => s.includes("broken symlink")));
	const docCheck = parsed.report.checks.find((c) => c.id === "doc-links");
	assert.equal(docCheck.status, "fail");
	assert.deepEqual(
		docCheck.details,
		["AGENTS.md:9 links to missing file `docs/missing.md`", "AGENTS.md:10 cites missing script `nope`"],
	);
	const ciText = readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8");
	assert.match(ciText, /pnpm\/action-setup@v4\n\s+with:\n\s+version: 9/);

	// 3. Worktree setup copies nested ignored .env* files and writes .env.worktree.
	writeFileSync(join(repo, ".gitignore"), ".briefs/\n.env.worktree\n**/.env*\n");
	mkdirSync(join(repo, "apps/api"), { recursive: true });
	writeFileSync(join(repo, ".env"), "ROOT=1\n");
	writeFileSync(join(repo, "apps/api/.env.local"), "API=1\n");
	assert.equal(run("git", ["add", ".gitignore", "scripts/worktree-setup.sh"], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "wt setup"], { cwd: repo }).status, 0);
	const wt = join(base, "wt-1");
	assert.equal(run("git", ["worktree", "add", "-q", "-b", "wt-branch", wt], { cwd: repo }).status, 0);
	// Pre-create node_modules so the test stays offline while verifying .env* copy and PORT generation.
	mkdirSync(join(wt, "node_modules"), { recursive: true });
	const rWt = run("bash", ["scripts/worktree-setup.sh"], { cwd: wt });
	assert.equal(rWt.status, 0, rWt.stderr);
	assert.equal(readFileSync(join(wt, ".env"), "utf8"), "ROOT=1\n");
	assert.equal(readFileSync(join(wt, "apps/api/.env.local"), "utf8"), "API=1\n");
	assert.match(readFileSync(join(wt, ".env.worktree"), "utf8"), /^PORT=\d+/m);

	// 4. Python + Makefile CI does not emit npm install.
	const { repo: pyRepo } = initTempRepo(t);
	writeFileSync(join(pyRepo, "pyproject.toml"), "[project]\nname='py'\n");
	writeFileSync(join(pyRepo, "Makefile"), "verify-all:\n\t@echo ok\n");
	assert.equal(run("git", ["add", "."], { cwd: pyRepo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "py"], { cwd: pyRepo }).status, 0);
	run("node", [BIN.doctor, pyRepo, "--fix", "--scaffold-ci"]);
	const pyCi = readFileSync(join(pyRepo, ".github/workflows/ci.yml"), "utf8");
	assert.doesNotMatch(pyCi, /npm install|setup-node/);
	assert.match(pyCi, /setup-python/);
});

test("brief-init diff-triggered invariants handle quoted paths, renames, +++queue, focus(), **/*.ts, ReDoS cap, and slug refresh", (t) => {
	const { repo } = initTempRepo(t);
	const slug = `verify-all-${process.pid}-${Date.now()}`;
	t.after(() => rmSync(`/tmp/brief-${slug}`, { recursive: true, force: true }));

	mkdirSync(join(repo, "api"), { recursive: true });
	mkdirSync(join(repo, "src"), { recursive: true });
	mkdirSync(join(repo, ".agent"), { recursive: true });
	writeFileSync(join(repo, "api/old.ts"), "export const x = 1;\n");
	writeFileSync(join(repo, "plain.js"), "let queue = 0;\n");
	writeFileSync(
		join(repo, ".agent/invariants.json"),
		JSON.stringify({
			invariants: [
				{ id: "globstar-rule", title: "Root src TS rule", paths: ["src/**/*.ts"], check: "Check root and nested TS." },
				{ id: "redos-rule", title: "Unsafe regex", contentRegex: "^(a+)+$", check: "Should be rejected." },
			],
		}),
	);
	assert.equal(run("git", ["add", "."], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "init"], { cwd: repo }).status, 0);

	// Initial harmless change -> create brief slug.
	writeFileSync(join(repo, "README.md"), "hello\n");
	assert.equal(run("git", ["add", "README.md"], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "readme"], { cwd: repo }).status, 0);
	const b1 = run("node", [BIN.brief, slug, "--base", "HEAD~1", "--review"], { cwd: repo });
	assert.equal(b1.status, 0, b1.stderr);
	assert.equal(JSON.parse(b1.stdout).triggeredInvariants.length, 0);

	// Now add: rename out of api/, quoted non-ASCII path, +++queue + control.focus() + localStorage, and root src/job.ts.
	assert.equal(run("git", ["mv", "api/old.ts", "renamed.ts"], { cwd: repo }).status, 0);
	writeFileSync(join(repo, "café.tsx"), "export const A = () => null;\n");
	writeFileSync(join(repo, "src/job.ts"), "export const j = 1;\n");
	writeFileSync(join(repo, "plain.js"), "let queue = 0;\n++queue;\ncontrol.focus();\nlocalStorage.setItem('k','v');\n");
	assert.equal(run("git", ["add", "."], { cwd: repo }).status, 0);
	assert.equal(run("git", ["commit", "-q", "-m", "risky"], { cwd: repo }).status, 0);

	// Reuse SAME slug without --force -> context.md invariants MUST refresh!
	const b2 = run("node", [BIN.brief, slug, "--base", "HEAD~2", "--review"], { cwd: repo });
	assert.equal(b2.status, 0, b2.stderr);
	const ids = JSON.parse(b2.stdout).triggeredInvariants.map((x) => x.id);
	assert.ok(ids.includes("concurrency-stale-state"), `missing concurrency: ${ids}`);
	assert.ok(ids.includes("account-workspace-boundary"), `missing account: ${ids}`);
	assert.ok(ids.includes("narrow-ui-focus"), `missing ui/focus: ${ids}`);
	assert.ok(ids.includes("globstar-rule"), `missing globstar: ${ids}`);
	const ctxText = readFileSync(`/tmp/brief-${slug}/context.md`, "utf8");
	assert.match(ctxText, /- \[ \] \*\*Concurrency & stale state\*\*/);
	assert.match(ctxText, /api\/old\.ts -> renamed\.ts/);
	assert.match(ctxText, /café\.tsx/);
	assert.match(ctxText, /Skipped unsafe custom contentRegex on rule `redos-rule`/);
});
