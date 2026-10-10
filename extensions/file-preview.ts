/**
 * Click TUI file links (including :line-range) to open them in the external editor (nvim).
 * Alt+O / /preview: Quick Open. Preview: g goto, e edit, f @file, l @file:line, o search.
 * Keys: settings.json filePreview.keys. Remote: --ssh / PI_SSH_TARGET / .pi/ssh.json.
 * Target: settings.json filePreview.open = "split" (default: nvim in a cmux split on the right,
 * reused across clicks; falls back to "editor" outside cmux or for SSH files) | "editor" (nvim takes
 * over the Pi window until you quit) | "panel" (upstream right-side preview panel).
 *
 * Forked from pi-file-preview 0.2.3 (MIT, nephen): https://github.com/nephen/pi-file-preview
 * Local change: openPreview routes to the external editor unless filePreview.open is "panel".
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	fuzzyFilter,
	getCapabilities,
	Input,
	matchesKey,
	parseKey,
	setCapabilities,
	Text,
	TuiAltScreen,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { OverlayHandle, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";

const HOOK_OPEN = Symbol.for("pi.file-preview.openUrl");
const HOOK_FN = Symbol.for("pi.file-preview.openUrl.fn");
const HOOK_PROTO = Symbol.for("pi.file-preview.openUrl.proto");
const HOOK_TEXT = Symbol.for("pi.file-preview.setText");
const PAD = 40;
const MAX_LINES = 800;
const PREVIEW_PCT = 48;
const PREVIEW_MIN = 42;
const CLOSE_LABEL = " × Close ";
const FD_MAX = 500;
const FD_MAX_QUERY = 10000;
const PICKER_DEBOUNCE_MS = 80;

type SshInfo = { destination: string; remoteCwd?: string };
type Loc = { path: string; start?: number; end?: number };

let eventRemote: SshInfo | null | undefined;
let panel: PreviewPanel | undefined;
let closeHandle: OverlayHandle | undefined;
let pendingLoc: Loc | undefined;
let opening = false;
let editing = false;
let picking = false;
let activePicker: FilePicker | undefined;
let currentCtx: ExtensionContext | undefined;

function previewPanelWidth(cols: number): number {
	return Math.min(cols, Math.max(PREVIEW_MIN, Math.floor((cols * PREVIEW_PCT) / 100)));
}

function dismissPreview(): void {
	closeHandle?.hide();
	closeHandle = undefined;
	panel = undefined;
}

function sshBin(): string {
	const envBin = process.env.PI_SSH?.trim();
	return envBin && existsSync(envBin) ? envBin : "ssh";
}

function localRoot(): string {
	return currentCtx?.cwd ?? process.cwd();
}

function asRemote(value: unknown): SshInfo | null {
	if (!value || typeof value !== "object") return null;
	const destination = (value as { destination?: unknown }).destination;
	if (typeof destination !== "string" || !destination.trim()) return null;
	const remoteCwd = (value as { remoteCwd?: unknown }).remoteCwd;
	return {
		destination: destination.trim(),
		remoteCwd: typeof remoteCwd === "string" && remoteCwd.trim() ? remoteCwd : undefined,
	};
}

function parseSshSpec(spec: string): SshInfo | null {
	const trimmed = spec.trim();
	if (!trimmed) return null;
	const portPath = trimmed.match(/^(.+):(\d+):(.+)$/);
	if (portPath) return { destination: portPath[1], remoteCwd: portPath[3] };
	const abs = trimmed.match(/^(.+):(\/.+|~(?:\/.*)?)$/);
	if (abs) return { destination: abs[1], remoteCwd: abs[2] };
	if (/^.+:\d+$/.test(trimmed)) return { destination: trimmed.replace(/:\d+$/, "") };
	const rel = trimmed.match(/^(.+):(.+)$/);
	if (rel) return { destination: rel[1], remoteCwd: rel[2] };
	return { destination: trimmed };
}

function argvValue(name: string): string | undefined {
	const prefix = `--${name}=`;
	const argv = process.argv;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === `--${name}`) {
			const next = argv[i + 1];
			return next && !next.startsWith("-") ? next : undefined;
		}
		if (a.startsWith(prefix)) return a.slice(prefix.length) || undefined;
	}
}

function readSshJson(file: string): string | undefined {
	try {
		const target = JSON.parse(readFileSync(file, "utf8"))?.target;
		if (typeof target === "string" && target.trim()) return target.trim();
	} catch {
		// optional project ssh config
	}
}

function fromConfig(): SshInfo | null {
	const spec =
		argvValue("ssh")?.trim() ||
		process.env.PI_SSH_TARGET?.trim() ||
		readSshJson(join(localRoot(), ".pi-web", "ssh.json")) ||
		readSshJson(join(localRoot(), ".pi", "ssh.json"));
	if (!spec) return null;
	const parsed = parseSshSpec(spec);
	if (!parsed) return null;
	const cwd = argvValue("ssh-cwd")?.trim();
	if (!parsed.remoteCwd && cwd) return { destination: parsed.destination, remoteCwd: cwd };
	return parsed;
}

function discoverRemote(): SshInfo | null {
	if (eventRemote !== undefined) return eventRemote;
	return fromConfig();
}

function remoteRoot(): string {
	return (discoverRemote()?.remoteCwd ?? ".").replace(/\/$/, "") || ".";
}

function cwdLine(): string {
	const info = discoverRemote();
	if (info?.destination) return `SSH ${info.destination}  ${info.remoteCwd || "."}`;
	return `local  ${localRoot()}`;
}

function onRemoteStatus(data: { connected?: boolean; destination?: string; remoteCwd?: string }): void {
	const next = data?.connected ? asRemote(data) : null;
	const dropped = Boolean(eventRemote) && !next;
	eventRemote = next;
	if (dropped) activePicker?.cancel("SSH disconnected");
}

/** Fold `:110-149` after a file:// OSC 8 link into the hyperlink (`#L110-149`). */
export function rewriteFileLinks(text: string): string {
	return text.replace(
		/\x1b\]8;;(file:\/\/[^\x07\x1b]*)(?:\x07|\x1b\\)([\s\S]*?)\x1b\]8;;(?:\x07|\x1b\\)((?:\x1b\[[\d;]*m)*:(\d+)(?:-(\d+))?)/g,
		(_m, url: string, inner: string, range: string, start: string, end?: string) => {
			const base = url.replace(/#L\d+(?:-\d+)?$/, "");
			const frag = end ? `#L${start}-${end}` : `#L${start}`;
			return `\x1b]8;;${base}${frag}\x1b\\${inner}${range}\x1b]8;;\x1b\\`;
		},
	);
}

function parseFileUrl(url: string): Loc | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== "file:") return null;
	let filePath: string;
	try {
		filePath = fileURLToPath(parsed);
	} catch {
		filePath = decodeURIComponent(parsed.pathname);
	}
	filePath = filePath.replace(/\\/g, "/");
	const m = parsed.hash.match(/^#L(\d+)(?:-(\d+))?$/);
	return {
		path: filePath,
		start: m ? Number(m[1]) : undefined,
		end: m?.[2] ? Number(m[2]) : undefined,
	};
}

function forceHyperlinks(): void {
	const caps = getCapabilities();
	if (!caps.hyperlinks) setCapabilities({ ...caps, hyperlinks: true });
}

function hookText(): void {
	const proto = Text.prototype as Text & { [HOOK_TEXT]?: boolean };
	if (proto[HOOK_TEXT]) return;
	proto[HOOK_TEXT] = true;
	const origSet = proto.setText;
	proto.setText = function setText(text: string) {
		return origSet.call(this, typeof text === "string" ? rewriteFileLinks(text) : text);
	};
	const origRender = proto.render;
	proto.render = function render(width: number) {
		if (typeof this.text === "string") {
			const next = rewriteFileLinks(this.text);
			if (next !== this.text) {
				this.text = next;
				this.invalidate();
			}
		}
		return origRender.call(this, width);
	};
}

function interceptUrl(url: string, fallback?: (url: string) => void): void {
	const loc = parseFileUrl(url);
	if (loc && currentCtx?.hasUI) {
		openPreview(currentCtx, loc);
		return;
	}
	fallback?.(url);
}

function hookAltScreenProto(): void {
	const proto = TuiAltScreen.prototype as TuiAltScreen & { [HOOK_PROTO]?: boolean };
	if (proto[HOOK_PROTO]) return;
	proto[HOOK_PROTO] = true;
	Object.defineProperty(proto, "openUrl", {
		configurable: true,
		enumerable: false,
		get() {
			return (this as { [HOOK_FN]?: (url: string) => void })[HOOK_FN];
		},
		set(fn: ((url: string) => void) | undefined) {
			(this as { [HOOK_FN]: (url: string) => void })[HOOK_FN] = (url: string) => interceptUrl(url, fn);
		},
	});
}

function grabTui(ctx: ExtensionContext): TUI | undefined {
	let tui: TUI | undefined;
	ctx.ui.setWidget("file-preview-init", (ui) => {
		tui = ui as TUI;
		return { render: () => [] };
	});
	ctx.ui.setWidget("file-preview-init", undefined);
	return tui;
}

function hookOpenUrl(tui: TUI): void {
	const alt = tui as TUI & {
		openUrl?: (url: string) => void;
		[HOOK_OPEN]?: (url: string) => void;
	};
	if (typeof alt.openUrl !== "function") return;
	if (!alt[HOOK_OPEN]) alt[HOOK_OPEN] = alt.openUrl.bind(alt);
	const orig = alt[HOOK_OPEN];
	alt.openUrl = (url: string) => interceptUrl(url, orig);
}

function spawnCapture(
	cmd: string,
	args: string[],
	opts: {
		cwd?: string;
		signal?: AbortSignal;
		timeoutMs?: number;
		maxLines?: number;
		lineFilter?: (line: string) => boolean;
	} = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve, reject) => {
		if (opts.signal?.aborted) {
			reject(new Error("aborted"));
			return;
		}
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		let lines = 0;
		let limited = false;
		let pending = "";
		const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 12000);
		const onAbort = () => child.kill();
		const takeLine = (line: string) => {
			if (opts.lineFilter && !opts.lineFilter(line)) return;
			out.push(Buffer.from(`${line}\n`));
			lines++;
			if (opts.maxLines && lines >= opts.maxLines) {
				limited = true;
				child.kill();
			}
		};
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout?.on("data", (d: Buffer) => {
			if (opts.lineFilter) {
				pending += d.toString("utf8");
				const parts = pending.split("\n");
				pending = parts.pop() ?? "";
				for (const line of parts) {
					takeLine(line);
					if (limited) return;
				}
				return;
			}
			out.push(d);
			if (!opts.maxLines) return;
			for (const b of d) if (b === 10) lines++;
			if (lines >= opts.maxLines) {
				limited = true;
				child.kill();
			}
		});
		child.stderr?.on("data", (d: Buffer) => err.push(d));
		child.on("error", (error) => {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			if (opts.lineFilter && pending && !limited) takeLine(pending);
			resolve({
				stdout: Buffer.concat(out).toString("utf8"),
				stderr: Buffer.concat(err).toString("utf8"),
				code: limited ? 0 : code,
			});
		});
	});
}

function spawnInherit(cmd: string, args: string[]): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", reject);
		child.on("close", (code) => resolve(code));
	});
}

function sshArgs(destination: string, remote: string, tty = false): string[] {
	const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new"];
	const safe = `${destination}-default`.replace(/[^a-zA-Z0-9._@-]/g, "_");
	const controlPath = join(tmpdir(), `pi-ssh-${safe}`).replace(/\\/g, "/");
	if (process.platform !== "win32" && !/\.exe$/i.test(sshBin()) && existsSync(controlPath)) {
		args.push("-o", "ControlMaster=auto", "-o", `ControlPath=${controlPath}`);
	} else {
		args.push("-o", "ControlMaster=no");
	}
	if (tty) args.push("-t");
	args.push(destination, remote);
	return args;
}

const DEFAULT_KEYS = {
	quickOpen: ["alt+o"],
	search: ["o"],
	goto: ["g"],
	edit: ["e"],
	mention: ["f"],
	mentionLine: ["l"],
	close: ["q"],
} as const;

type Keys = { [K in keyof typeof DEFAULT_KEYS]: string[] };

let keys: Keys = cloneKeys(DEFAULT_KEYS);

function cloneKeys(src: { [K in keyof Keys]: readonly string[] }): Keys {
	return {
		quickOpen: [...src.quickOpen],
		search: [...src.search],
		goto: [...src.goto],
		edit: [...src.edit],
		mention: [...src.mention],
		mentionLine: [...src.mentionLine],
		close: [...src.close],
	};
}

function asKeyList(value: unknown, fallback: readonly string[]): string[] {
	const raw = Array.isArray(value) ? value : value != null ? [value] : [];
	const list = raw
		.filter((x): x is string => typeof x === "string")
		.map((x) => x.trim().toLowerCase())
		.filter(Boolean);
	return list.length ? list : [...fallback];
}

function loadKeys(): Keys {
	try {
		const raw = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
		const src = raw?.filePreview?.keys;
		if (!src || typeof src !== "object") return cloneKeys(DEFAULT_KEYS);
		return {
			quickOpen: asKeyList(src.quickOpen, DEFAULT_KEYS.quickOpen),
			search: asKeyList(src.search, DEFAULT_KEYS.search),
			goto: asKeyList(src.goto, DEFAULT_KEYS.goto),
			edit: asKeyList(src.edit, DEFAULT_KEYS.edit),
			mention: asKeyList(src.mention, DEFAULT_KEYS.mention),
			mentionLine: asKeyList(src.mentionLine, DEFAULT_KEYS.mentionLine),
			close: asKeyList(src.close, DEFAULT_KEYS.close),
		};
	} catch {
		return cloneKeys(DEFAULT_KEYS);
	}
}

function hit(data: string, specs: string[]): boolean {
	return specs.some((spec) => {
		if (spec.length === 1) return matchesKey(data, spec) || matchesKey(data, `shift+${spec}`);
		return matchesKey(data, spec);
	});
}

function piBinDir(): string {
	return join(getAgentDir(), "bin");
}

function whichOnPath(name: string): string | undefined {
	for (const dir of [piBinDir(), ...(process.env.PATH ?? "").split(delimiter)]) {
		if (!dir) continue;
		const p = join(dir, name);
		if (existsSync(p)) return p;
	}
	return undefined;
}

function listBin(): { bin: string; kind: "fd" | "rg" } {
	const fdNames = process.platform === "win32" ? ["fd.exe", "fd"] : ["fd", "fdfind"];
	for (const name of fdNames) {
		const found = whichOnPath(name);
		if (found) return { bin: found, kind: "fd" };
	}
	const rgNames = process.platform === "win32" ? ["rg.exe", "rg"] : ["rg"];
	for (const name of rgNames) {
		const found = whichOnPath(name);
		if (found) return { bin: found, kind: "rg" };
	}
	throw new Error(`fd/rg not found (PATH or ${piBinDir()})`);
}

function queryTokens(query: string): string[] {
	return query
		.trim()
		.split(/[\s/]+/)
		.filter(Boolean);
}

function escapeRegex(token: string): string {
	return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest path token — VSCode-like prefilter so `src/` does not crowd out `cert_parser.cc`. */
function searchPattern(query: string): string {
	const tokens = queryTokens(query);
	if (!tokens.length) return "";
	return escapeRegex(tokens.reduce((a, b) => (b.length > a.length ? b : a)));
}

function resultCap(query: string): number {
	return query.trim() ? FD_MAX_QUERY : FD_MAX;
}

function fdArgs(query: string, noRequireGit: boolean): string[] {
	const pattern = searchPattern(query);
	const args = [
		"--type",
		"f",
		"--hidden",
		"--follow",
		"--exclude",
		".git",
		"--exclude",
		"node_modules",
		"--max-results",
		String(resultCap(query)),
		"--color=never",
	];
	if (noRequireGit) args.push("--no-require-git");
	if (pattern) args.push("--full-path", "--", pattern);
	return args;
}

function rgListArgs(noRequireGit: boolean): string[] {
	const args = [
		"--files",
		"--hidden",
		"--follow",
		"--glob",
		"!.git",
		"--glob",
		"!node_modules",
		"--color=never",
		"--no-config",
	];
	if (noRequireGit) args.push("--no-require-git");
	return args;
}

function splitPaths(stdout: string): string[] {
	return stdout
		.split("\n")
		.map((s) => s.replace(/^\.\//, "").trim())
		.filter(Boolean);
}

function listOk(code: number | null): boolean {
	return code === 0 || code === 1 || code === 141 || code === 143;
}

async function listLocal(query: string, signal: AbortSignal): Promise<string[]> {
	const cwd = localRoot();
	const noGit = !existsSync(join(cwd, ".git"));
	const cap = resultCap(query);
	try {
		const { bin, kind } = listBin();
		const pattern = searchPattern(query);
		const re = pattern ? new RegExp(pattern, "i") : undefined;
		const r = await spawnCapture(bin, kind === "fd" ? fdArgs(query, noGit) : rgListArgs(noGit), {
			cwd,
			signal,
			timeoutMs: 12000,
			maxLines: cap,
			lineFilter: kind === "rg" && re ? (line) => re.test(line) : undefined,
		});
		if (kind === "fd" ? r.code !== 0 : !listOk(r.code)) {
			throw new Error(r.stderr.trim() || `${kind} exit ${r.code}`);
		}
		return splitPaths(r.stdout).slice(0, cap);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`fd/rg not found (PATH or ${piBinDir()})`);
		throw error;
	}
}

async function listRemote(query: string, signal: AbortSignal): Promise<string[]> {
	const info = discoverRemote();
	const dest = info?.destination;
	if (!dest) throw new Error("SSH disconnected");
	const cwd = info?.remoteCwd || ".";
	const pattern = searchPattern(query);
	const cap = resultCap(query);
	const fullPath = pattern ? " --full-path" : "";
	const q = pattern ? ` -- ${JSON.stringify(pattern)}` : "";
	const rgFilter = pattern
		? ` | "$bin" -i --color=never --no-config --max-count ${cap} -e ${JSON.stringify(pattern)}`
		: ` | head -n ${cap}`;
	const remote = [
		`cd ${JSON.stringify(cwd)} || exit 1`,
		"extra=$(test -d .git || echo --no-require-git)",
		"if bin=$(command -v fd || command -v fdfind); then",
		`  "$bin" --type f --hidden --follow --exclude .git --exclude node_modules --max-results ${cap} --color=never $extra${fullPath}${q}`,
		"  exit $?",
		"fi",
		"if bin=$(command -v rg); then",
		`  "$bin" --files --hidden --follow --glob '!.git' --glob '!node_modules' --color=never --no-config $extra${rgFilter}`,
		"  exit 0",
		"fi",
		'echo "fd/rg not found on remote (install fd, fdfind, or rg)" >&2',
		"exit 127",
	].join("\n");
	const r = await spawnCapture(sshBin(), sshArgs(dest, remote), { signal, timeoutMs: 12000 });
	if (!listOk(r.code) && r.code !== 127) throw new Error(r.stderr.trim() || `ssh list exit ${r.code}`);
	if (r.code === 127) throw new Error(r.stderr.trim() || "fd/rg not found on remote (install fd, fdfind, or rg)");
	return splitPaths(r.stdout).slice(0, cap);
}

function listFiles(query: string, signal: AbortSignal): Promise<string[]> {
	if (discoverRemote()?.destination) return listRemote(query, signal);
	return listLocal(query, signal);
}

function toRelPath(filePath: string): string {
	const norm = filePath.replace(/\\/g, "/");
	if (discoverRemote()?.destination) {
		const root = remoteRoot();
		const local = localRoot().replace(/\\/g, "/").replace(/\/$/, "");
		if (local && (norm === local || norm.startsWith(`${local}/`))) {
			return norm.slice(local.length + (norm === local ? 0 : 1)) || basename(norm);
		}
		if (root && (norm === root || norm.startsWith(`${root}/`))) {
			return norm.slice(root.length + (norm === root ? 0 : 1)) || basename(norm);
		}
		return norm.replace(/^\.\//, "");
	}
	const root = localRoot();
	const abs = isAbsolute(filePath) ? filePath : join(root, filePath);
	const rel = relative(root, abs);
	if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
	return norm;
}

export function mentionToken(filePath: string, start?: number, end?: number): string {
	const rel = toRelPath(filePath);
	const core = rel.includes(" ") ? `"${rel}"` : rel;
	if (start && end && end !== start) return `@${core}:${start}-${end}`;
	if (start) return `@${core}:${start}`;
	return `@${core}`;
}

function attachMention(token: string): void {
	if (!currentCtx?.hasUI) return;
	const existing = currentCtx.ui.getEditorText() ?? "";
	const next = existing.trim() ? `${existing.replace(/\s+$/, "")} ${token}` : token;
	currentCtx.ui.setEditorText(next);
	currentCtx.ui.notify(`attached ${token}`, "info");
}

function toRemoteReadPath(filePath: string): string {
	const norm = filePath.replace(/\\/g, "/");
	if (norm.startsWith("/")) {
		const local = localRoot().replace(/\\/g, "/").replace(/\/$/, "");
		if (local && (norm === local || norm.startsWith(`${local}/`))) {
			const rel = norm.slice(local.length + (norm === local ? 0 : 1));
			return rel ? `${remoteRoot()}/${rel}` : remoteRoot();
		}
		return norm;
	}
	return `${remoteRoot()}/${norm}`;
}

type OpenTarget = "split" | "editor" | "panel";

function openTarget(): OpenTarget {
	try {
		const raw = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
		const open = raw?.filePreview?.open;
		return open === "panel" || open === "editor" ? open : "split";
	} catch {
		return "split";
	}
}

const cmuxBin = () => process.env.CMUX_BUNDLED_CLI_PATH || "cmux";
// Short fixed path: macOS limits Unix socket paths to 104 bytes, and $TMPDIR is long.
const splitSocket = () => `/tmp/pi-nvim-${(process.env.CMUX_SURFACE_ID ?? String(process.pid)).slice(0, 8)}.sock`;
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
let splitSurface: string | undefined;

/** Reuse the nvim split this session opened, if it still runs. */
async function reuseSplit(sock: string, file: string, line: number): Promise<boolean> {
	if (!splitSurface || !existsSync(sock)) return false;
	const path = file.replace(/'/g, "''");
	const jump = line >= 1 ? `+${line} ` : "";
	const r = await spawnCapture("nvim", ["--server", sock, "--remote-expr", `execute('edit ${jump}' . fnameescape('${path}'))`], { timeoutMs: 3000 });
	if (r.code !== 0) return false;
	await spawnCapture(cmuxBin(), ["focus-panel", "--panel", splitSurface], { timeoutMs: 3000 });
	return true;
}

/** Open a local file in nvim in a cmux split on the right. False when cmux or local nvim is not available. */
async function openInSplit(loc: Loc): Promise<boolean> {
	if (!process.env.CMUX_SURFACE_ID || discoverRemote()?.destination) return false;
	const file = isAbsolute(loc.path) ? loc.path : join(localRoot(), loc.path);
	const line = loc.start ?? 0;
	const { bin, args } = editorArgv(file, line);
	const sock = splitSocket();
	const isNvim = basename(bin) === "nvim";
	if (isNvim && (await reuseSplit(sock, file, line))) return true;
	if (isNvim) rmSync(sock, { force: true });
	const argv = isNvim ? [bin, "--listen", sock, ...args] : [bin, ...args];
	// exec replaces the split's shell, so the split closes when the editor quits.
	const r = await spawnCapture(
		cmuxBin(),
		["--id-format", "uuids", "new-split", "right", "--surface", process.env.CMUX_SURFACE_ID, "--command", `exec ${argv.map(shQuote).join(" ")}`, "--focus", "true"],
		{ timeoutMs: 5000 },
	);
	const surface = r.stdout.match(/^OK ([0-9A-F-]{36})/i)?.[1];
	if (r.code !== 0 || !surface) throw new Error(`cmux new-split failed: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
	splitSurface = surface;
	return true;
}

async function openInEditor(ctx: ExtensionContext, loc: Loc): Promise<void> {
	const tui = grabTui(ctx);
	if (!tui || editing) return;
	editing = true;
	try {
		tui.stop();
		await editFile(loc.path, loc.start ?? 0);
	} catch (error) {
		ctx.ui.notify(`preview: cannot open ${loc.path} in editor: ${error instanceof Error ? error.message : String(error)}`, "error");
	} finally {
		editing = false;
		tui.start();
		tui.requestRender(true);
	}
}

function openPreview(ctx: ExtensionContext, loc: Loc): void {
	const target = openTarget();
	if (target === "split") {
		void openInSplit(loc)
			.then((opened) => opened || openInEditor(ctx, loc))
			.catch((error) => ctx.ui.notify(`preview: cannot open ${loc.path} in a split: ${error instanceof Error ? error.message : String(error)}. Set filePreview.open to "editor" to open in place.`, "error"));
		return;
	}
	if (target === "editor") {
		void openInEditor(ctx, loc);
		return;
	}
	if (panel) {
		panel.show(loc);
		return;
	}
	if (opening) {
		pendingLoc = loc;
		return;
	}
	opening = true;
	void ctx.ui
		.custom(
			(tui, theme, _kb, done) => {
				const start = pendingLoc ?? loc;
				pendingLoc = undefined;
				const close = () => {
					dismissPreview();
					done();
				};
				panel = new PreviewPanel(tui as TUI, theme, start, close);
				opening = false;
				if (pendingLoc) {
					panel.show(pendingLoc);
					pendingLoc = undefined;
				}
				return panel;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "right-center",
					width: `${PREVIEW_PCT}%`,
					minWidth: PREVIEW_MIN,
					maxHeight: "100%",
					margin: 0,
				},
				onHandle: () => {
					if (panel && !closeHandle) closeHandle = panel.attachCloseChip();
				},
			},
		)
		.finally(() => {
			opening = false;
		});
}

function openPicker(ctx: ExtensionContext): void {
	if (ctx.mode !== "tui" || !ctx.hasUI) {
		ctx.ui.notify("preview: TUI only", "warning");
		return;
	}
	if (picking) return;
	currentCtx = ctx;
	picking = true;
	void ctx.ui
		.custom(
			(tui, theme, _kb, done) =>
				new FilePicker(tui as TUI, theme, (loc) => {
					done();
					if (loc) openPreview(ctx, loc);
				}),
			{
				overlay: true,
				overlayOptions: {
					anchor: "top-center",
					width: "70%",
					minWidth: 40,
					maxHeight: "50%",
					offsetY: 2,
				},
			},
		)
		.finally(() => {
			picking = false;
		});
}

function windowFor(start?: number, end?: number): { from: number; to: number } {
	const from = Math.max(1, (start ?? 1) - PAD);
	const last = Math.max(from, (end ?? (start ?? 1) + 200) + PAD);
	return { from, to: Math.min(last, from + MAX_LINES - 1) };
}

function readLocal(filePath: string, from: number, to: number): string[] {
	const abs = isAbsolute(filePath) ? filePath : join(localRoot(), filePath);
	const buf = readFileSync(abs);
	if (buf.includes(0)) throw new Error("binary file");
	return buf.toString("utf8").split(/\r?\n/).slice(from - 1, to);
}

async function sshSed(destination: string, remotePath: string, from: number, to: number): Promise<string[]> {
	const remote = `sed -n ${from},${to}p < ${JSON.stringify(remotePath)}`;
	const r = await spawnCapture(sshBin(), sshArgs(destination, remote));
	if (r.code !== 0) throw new Error(r.stderr.trim() || `ssh exit ${r.code}`);
	return r.stdout.split(/\r?\n/);
}

async function loadLines(filePath: string, from: number, to: number): Promise<string[]> {
	const info = discoverRemote();
	if (info?.destination) return sshSed(info.destination, toRemoteReadPath(filePath), from, to);
	return readLocal(filePath, from, to);
}

function editorCommand(): string {
	try {
		const raw = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
		if (typeof raw?.externalEditor === "string" && raw.externalEditor.trim()) return raw.externalEditor.trim();
	} catch {
		// same fallback as pi Ctrl+G
	}
	return (process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano")).trim();
}

function editorArgv(file: string, line: number): { bin: string; args: string[] } {
	const [bin, ...rest] = editorCommand().split(/\s+/).filter(Boolean);
	const name = basename(bin ?? "").replace(/\.exe$/i, "").toLowerCase();
	const jump = line >= 1 && /^(n?vim|vi|view|nano|emacs)$/.test(name) ? [`+${line}`] : [];
	return { bin: bin || "nano", args: [...rest, ...jump, file] };
}

function shJoin(parts: string[]): string {
	return parts.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

async function editFile(filePath: string, line: number): Promise<void> {
	const info = discoverRemote();
	if (info?.destination) {
		const { bin, args } = editorArgv(toRemoteReadPath(filePath), line);
		await spawnInherit(sshBin(), sshArgs(info.destination, shJoin([bin, ...args]), true));
		return;
	}
	const local = isAbsolute(filePath) ? filePath : join(localRoot(), filePath);
	const { bin, args } = editorArgv(local, line);
	await spawnInherit(bin, args);
}

function padLine(s: string, width: number): string {
	const vis = visibleWidth(s);
	if (vis >= width) return truncateToWidth(s, width);
	return s + " ".repeat(width - vis);
}

class CloseChip {
	constructor(
		private theme: Theme,
		private onClose: () => void,
	) {}

	handleMouse(event: TuiMouseEvent): { handled: true } | undefined {
		if (event.button !== "left" || event.type !== "press") return undefined;
		this.onClose();
		return { handled: true };
	}

	render(width: number): string[] {
		const th = this.theme;
		return [th.bg("selectedBg", th.fg("text", padLine(CLOSE_LABEL, width)))];
	}

	invalidate(): void {}
}

class FilePicker {
	private _focused = true;
	private input: Input;
	private filtered: string[] = [];
	private selected = 0;
	private status = "searching…";
	private timer: ReturnType<typeof setTimeout> | undefined;
	private abort: AbortController | undefined;
	private closed = false;

	constructor(
		private tui: TUI,
		private theme: Theme,
		private onDone: (loc: Loc | undefined) => void,
	) {
		this.input = new Input({ prompt: "> ", placeholder: "file or file:line" });
		this.input.focused = true;
		this.input.onSubmit = () => this.confirm();
		this.input.onEscape = () => this.finish(undefined);
		activePicker = this;
		void this.search();
	}

	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	dispose(): void {
		this.abort?.abort();
		if (this.timer) clearTimeout(this.timer);
	}

	private finish(loc: Loc | undefined): void {
		if (this.closed) return;
		this.closed = true;
		if (activePicker === this) activePicker = undefined;
		this.dispose();
		this.onDone(loc);
	}

	cancel(message?: string): void {
		if (message && currentCtx?.hasUI) currentCtx.ui.notify(message, "warning");
		this.finish(undefined);
	}

	private confirm(): void {
		const path = this.filtered[this.selected];
		if (!path) return;
		const spec = parseLocSpec(this.input.getValue());
		this.finish({ path, start: spec?.start, end: spec?.end });
	}

	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.search(), PICKER_DEBOUNCE_MS);
	}

	private async search(): Promise<void> {
		this.abort?.abort();
		const ac = new AbortController();
		this.abort = ac;
		const raw = this.input.getValue();
		const spec = parseLocSpec(raw);
		const q = spec?.path ?? raw;
		this.status = "searching…";
		this.tui.requestRender();
		try {
			const items = await listFiles(q, ac.signal);
			if (ac.signal.aborted) return;
			this.filtered = fuzzyFilter(items, q, (s) => s);
			this.selected = 0;
			this.status = this.filtered.length ? "" : q.trim() ? "no matches" : "no files";
		} catch (error) {
			if (ac.signal.aborted) return;
			this.filtered = [];
			this.status = error instanceof Error ? error.message : String(error);
		}
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.finish(undefined);
			return;
		}
		if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
			this.confirm();
			return;
		}
		const page = 8;
		if (matchesKey(data, "up")) this.selected--;
		else if (matchesKey(data, "down")) this.selected++;
		else if (matchesKey(data, "pageup")) this.selected -= page;
		else if (matchesKey(data, "pagedown")) this.selected += page;
		else if (matchesKey(data, "home")) this.selected = 0;
		else if (matchesKey(data, "end")) this.selected = this.filtered.length - 1;
		else {
			const before = this.input.getValue();
			this.input.handleInput(data);
			if (this.input.getValue() !== before) this.schedule();
		}
		this.tui.requestRender();
	}

	private listHeight(): number {
		const rows = this.tui.terminal.rows ?? 24;
		const maxH = Math.max(10, Math.floor(rows * 0.5));
		return Math.max(4, Math.min(12, maxH - 6));
	}

	private listStart(): number {
		const listH = this.listHeight();
		return Math.max(0, Math.min(this.selected - Math.floor(listH / 2), Math.max(0, this.filtered.length - listH)));
	}

	handleMouse(event: TuiMouseEvent): { handled: true } | undefined {
		if (event.type === "wheel") {
			this.selected += event.wheelDelta ?? 0;
			this.tui.requestRender();
			return { handled: true };
		}
		if (event.button !== "left" || event.type !== "press") return undefined;
		const idx = this.listStart() + event.y - 5;
		if (idx >= 0 && idx < this.filtered.length) {
			this.selected = idx;
			this.confirm();
		}
		return { handled: true };
	}

	render(width: number): string[] {
		const th = this.theme;
		const inner = Math.max(1, width - 2);
		const border = (c: string) => th.fg("border", c);
		const row = (s: string) => border("│") + padLine(s, inner) + border("│");
		const listH = this.listHeight();
		if (this.filtered.length) this.selected = Math.max(0, Math.min(this.selected, this.filtered.length - 1));
		else this.selected = 0;
		const title = truncateToWidth(cwdLine(), inner - 1);
		const out: string[] = [];
		out.push(border(`╭${"─".repeat(inner)}╮`));
		out.push(border("│") + padLine(` ${th.fg("accent", title)}`, inner) + border("│"));
		out.push(border(`├${"─".repeat(inner)}┤`));
		out.push(border("│") + (this.input.render(inner)[0] ?? padLine("", inner)) + border("│"));
		out.push(border(`├${"─".repeat(inner)}┤`));
		if (this.status) {
			out.push(row(` ${th.fg("warning", this.status)}`));
			for (let i = 1; i < listH; i++) out.push(row(""));
		} else {
			const start = this.listStart();
			for (let i = 0; i < listH; i++) {
				const idx = start + i;
				const item = this.filtered[idx];
				if (!item) {
					out.push(row(""));
					continue;
				}
				const body = ` ${truncateToWidth(item, inner - 1)}`;
				out.push(idx === this.selected ? border("│") + th.bg("selectedBg", padLine(body, inner)) + border("│") : row(body));
			}
		}
		out.push(border(`╰${"─".repeat(inner)}╯`));
		return out;
	}

	invalidate(): void {}
}

class PreviewPanel {
	focused = true;
	private tui: TUI;
	private theme: Theme;
	private loc: Loc;
	private done: () => void;
	private from = 1;
	private lines: string[] = [];
	private highlighted: string[] = [];
	private scroll = 0;
	private status = "loading…";
	private gen = 0;
	private cursorLine = 1;
	private cursorTouched = false;
	private goto: string | null = null;

	constructor(tui: TUI, theme: Theme, loc: Loc, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.loc = loc;
		this.done = done;
		this.show(loc);
	}

	attachCloseChip(): OverlayHandle {
		const tui = this.tui;
		return tui.showOverlay(new CloseChip(this.theme, () => this.done()), {
			anchor: "top-right",
			width: visibleWidth(CLOSE_LABEL),
			offsetY: 1,
			nonCapturing: true,
			margin: {
				get right() {
					return previewPanelWidth(tui.terminal.columns ?? 80) + 1;
				},
			},
		});
	}

	dispose(): void {
		closeHandle?.hide();
		closeHandle = undefined;
	}

	show(loc: Loc): void {
		this.loc = loc;
		this.cursorTouched = false;
		this.goto = null;
		this.load(windowFor(loc.start, loc.end), loc.start ?? 1);
	}

	private load(win: { from: number; to: number }, cursor: number): void {
		this.status = "loading…";
		this.lines = [];
		this.highlighted = [];
		this.scroll = 0;
		this.from = win.from;
		this.cursorLine = cursor;
		this.tui.requestRender();
		const gen = ++this.gen;
		const loc = this.loc;
		void loadLines(loc.path, win.from, win.to)
			.then((lines) => {
				if (gen !== this.gen) return;
				if (lines.length && lines[lines.length - 1] === "") lines.pop();
				this.lines = lines;
				this.status = "";
				try {
					this.highlighted = highlightCode(lines.join("\n"), getLanguageFromPath(loc.path));
				} catch {
					this.highlighted = lines;
				}
				this.centerOn(cursor);
				this.tui.requestRender();
			})
			.catch((error) => {
				if (gen !== this.gen) return;
				this.status = error instanceof Error ? error.message : String(error);
				this.tui.requestRender();
			});
	}

	private jumpTo(n: number): void {
		this.goto = null;
		this.cursorTouched = true;
		this.cursorLine = Math.max(1, n);
		const last = this.from + this.lines.length - 1;
		if (!this.lines.length || this.cursorLine < this.from || this.cursorLine > last) {
			this.load(windowFor(this.cursorLine, this.cursorLine), this.cursorLine);
			return;
		}
		this.centerOn(this.cursorLine);
		this.tui.requestRender();
	}

	private centerOn(line: number): void {
		const bodyH = Math.max(1, (this.tui.terminal.rows ?? 24) - 5);
		this.scroll = line - this.from - Math.floor(bodyH / 2);
	}

	private handleGoto(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.goto = null;
			return;
		}
		if (matchesKey(data, "enter") || data === "\r" || data === "\n") {
			const n = Number(this.goto);
			if (this.goto && Number.isFinite(n) && n >= 1) this.jumpTo(Math.floor(n));
			else this.goto = null;
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.goto = this.goto!.slice(0, -1);
			return;
		}
		const key = parseKey(data);
		if (key && key.length === 1 && key >= "0" && key <= "9") this.goto += key;
	}

	private async openEditor(): Promise<void> {
		if (editing) return;
		editing = true;
		let failed = false;
		try {
			this.tui.stop();
			await editFile(this.loc.path, this.cursorLine);
		} catch (error) {
			failed = true;
			this.status = error instanceof Error ? error.message : String(error);
		} finally {
			editing = false;
			this.tui.start();
			this.tui.requestRender(true);
		}
		if (!failed) this.load(windowFor(this.cursorLine, this.cursorLine), this.cursorLine);
	}

	private attachCurrent(withLine: boolean): void {
		if (withLine) {
			const useRange = !this.cursorTouched && this.loc.start && this.loc.end && this.loc.end !== this.loc.start;
			attachMention(
				useRange ? mentionToken(this.loc.path, this.loc.start, this.loc.end) : mentionToken(this.loc.path, this.cursorLine),
			);
			return;
		}
		attachMention(mentionToken(this.loc.path));
	}

	handleInput(data: string): void {
		if (this.goto !== null) {
			this.handleGoto(data);
			this.tui.requestRender();
			return;
		}
		if (hit(data, keys.close) || matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}
		if (hit(data, keys.goto)) {
			this.goto = "";
			this.tui.requestRender();
			return;
		}
		if (hit(data, keys.search) || hit(data, keys.quickOpen)) {
			if (currentCtx) openPicker(currentCtx);
			return;
		}
		if (hit(data, keys.mention)) {
			this.attachCurrent(false);
			return;
		}
		if (hit(data, keys.mentionLine)) {
			this.attachCurrent(true);
			return;
		}
		if (hit(data, keys.edit)) {
			void this.openEditor();
			return;
		}
		const page = Math.max(1, (this.tui.terminal.rows ?? 24) - 5);
		if (matchesKey(data, "up")) this.scroll--;
		else if (matchesKey(data, "down")) this.scroll++;
		else if (matchesKey(data, "pageup")) this.scroll -= page;
		else if (matchesKey(data, "pagedown")) this.scroll += page;
		else if (matchesKey(data, "home")) this.scroll = 0;
		else if (matchesKey(data, "end")) this.scroll = 99999;
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): { handled: true } | undefined {
		if (event.type === "wheel") {
			this.scroll += event.wheelDelta ?? 0;
			this.tui.requestRender();
			return { handled: true };
		}
		if (event.button !== "left" || event.type !== "press" || this.status) return undefined;
		const bodyY = event.y - 4;
		if (bodyY < 0) return { handled: true };
		const n = this.from + this.scroll + bodyY;
		if (n >= this.from && n < this.from + this.lines.length) {
			this.cursorLine = n;
			this.cursorTouched = true;
			this.tui.requestRender();
		}
		return { handled: true };
	}

	render(width: number): string[] {
		const th = this.theme;
		const h = Math.max(6, this.tui.terminal.rows ?? 24);
		const inner = Math.max(1, width - 2);
		const border = (c: string) => th.fg("border", c);
		const row = (s: string) => border("│") + padLine(s, inner) + border("│");
		const range = this.loc.start
			? `:${this.loc.start}${this.loc.end ? `-${this.loc.end}` : ""}`
			: "";
		const name = truncateToWidth(basename(this.loc.path), Math.max(4, inner - visibleWidth(range) - 2));
		const title =
			this.goto !== null
				? ` Go to line: ${this.goto}`
				: ` ${th.fg("accent", `${name}${range}`)}`;
		const header = this.goto !== null ? th.fg("accent", title) : title;
		const where = ` ${th.fg("dim", truncateToWidth(cwdLine(), Math.max(1, inner - 1)))}`;

		const lines: string[] = [];
		lines.push(border(`╭${"─".repeat(inner)}╮`));
		lines.push(border("│") + padLine(header, inner) + (this.focused ? CURSOR_MARKER : "") + border("│"));
		lines.push(row(where));
		lines.push(border(`├${"─".repeat(inner)}┤`));

		const bodyH = Math.max(1, h - 5);
		if (this.status) {
			lines.push(row(` ${th.fg("warning", this.status)}`));
			for (let i = 1; i < bodyH; i++) lines.push(row(""));
		} else {
			const gutter = String(this.from + this.lines.length - 1).length;
			const maxScroll = Math.max(0, this.lines.length - bodyH);
			this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
			for (let i = 0; i < bodyH; i++) {
				const idx = this.scroll + i;
				if (idx >= this.lines.length) {
					lines.push(row(""));
					continue;
				}
				const n = this.from + idx;
				const inRange =
					this.loc.start !== undefined &&
					n >= this.loc.start &&
					n <= (this.loc.end ?? this.loc.start);
				const mark = n === this.cursorLine ? th.fg("accent", ">") : " ";
				const num = th.fg("dim", String(n).padStart(gutter));
				const src = (this.highlighted[idx] ?? this.lines[idx] ?? "").replace(/\t/g, "  ");
				const body = `${mark}${num} ${src}`;
				lines.push(inRange ? border("│") + th.bg("selectedBg", padLine(body, inner)) + border("│") : row(body));
			}
		}

		const hint = ` ${keys.close[0]} close · ${keys.search[0]} search · ${keys.goto[0]} line · ${keys.edit[0]} edit · ${keys.mention[0]} @file · ${keys.mentionLine[0]} @line `;
		const hintW = visibleWidth(hint);
		if (hintW + 2 <= inner) {
			const left = Math.max(1, Math.floor((inner - hintW) / 2));
			lines.push(
				border("╰") +
					border("─".repeat(left)) +
					th.fg("dim", hint) +
					border("─".repeat(inner - left - hintW)) +
					border("╯"),
			);
		} else {
			lines.push(border(`╰${"─".repeat(inner)}╯`));
		}
		return lines;
	}
}

function parseLocSpec(spec: string): Loc | null {
	const raw = spec.trim();
	if (!raw) return null;
	const ranged = raw.match(/^(.*?):(\d+)(?::\d+)?(?:-(\d+))?$/);
	if (ranged?.[1]) {
		return {
			path: ranged[1],
			start: Number(ranged[2]),
			end: ranged[3] ? Number(ranged[3]) : undefined,
		};
	}
	return { path: raw };
}

export default function (pi: ExtensionAPI): void {
	keys = loadKeys();
	forceHyperlinks();
	hookText();
	hookAltScreenProto();
	pi.events.on("ssh:status", onRemoteStatus);
	pi.events.on("remote:status", onRemoteStatus);
	pi.on("session_start", (_event, ctx) => {
		if (!eventRemote) eventRemote = undefined;
		dismissPreview();
		pendingLoc = undefined;
		opening = false;
		picking = false;
		currentCtx = ctx;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		forceHyperlinks();
		const tui = grabTui(ctx);
		if (tui) hookOpenUrl(tui);
	});
	pi.registerCommand("preview", {
		description: "Preview a file on the right (path[:start[-end]]), or Quick Open if empty",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				ctx.ui.notify("preview: TUI only", "warning");
				return;
			}
			currentCtx = ctx as ExtensionContext;
			const loc = parseLocSpec(args);
			if (!loc) {
				openPicker(ctx as ExtensionContext);
				return;
			}
			openPreview(ctx as ExtensionContext, loc);
		},
	});
	for (const shortcut of keys.quickOpen) {
		pi.registerShortcut(shortcut, {
			description: "Quick-open file preview",
			handler: async (ctx) => {
				currentCtx = ctx;
				openPicker(ctx);
			},
		});
	}
}
