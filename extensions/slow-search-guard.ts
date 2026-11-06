import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Stops shell searches that walk whole trees. In the 48 h before 2026-10-28, `grep -r` and
// `find` over ~/Developer (43 GB) and ~/.pi/agent (5.4 GB) took 27 min of tool time, with
// single calls up to 263 s and two frozen sessions. A text rule in AGENTS.md did not stop
// them. Benchmark: `grep -r` 14.4 s on ~/Developer/gappd and over 120 s on ~/.pi/agent;
// `rg` 0.1 s on both.
// `grep -r` is rewritten to an equivalent `rg` call, and `find` over a very large root to `fd -HI`,
// so the agent needs no retry turn (a block cost one turn in 26 sessions). The result starts with
// a note that names the command that ran. A call that cannot be translated safely is blocked with a reason.
const HOME = homedir();
const BIG_ROOTS = new Set(["/", "/Users", HOME, `${HOME}/Developer`, `${HOME}/Library`, `${HOME}/.pi`, `${HOME}/.pi/agent`, `${HOME}/.pi/agent/sessions`]);
const CMD_START = String.raw`(^|[\s;&|(\x60]|\$\()`;
const GREP = new RegExp(String.raw`${CMD_START}(?<!git\s+)[ef]?grep(?=[ \t])`, "g");
const FIND = new RegExp(String.raw`${CMD_START}find(?=[ \t])`, "g");

const GREP_REASON =
	"Blocked recursive grep that could not be rewritten to rg: it reads every file, including node_modules, build output, " +
	"and large data folders (grep -r took 14 s on ~/Developer/gappd and over 120 s on ~/.pi/agent; rg took 0.1 s). " +
	"Use rg in one repo or folder: it skips .gitignore paths. Flags: -uu to include ignored files, -g '*.go' for --include, " +
	"-l for file names. To find past conversations, use session_lookup or hindsight.";

type Token = { raw: string; value?: string }; // value is unset when the word has a $ or ` expansion

// Reads one simple command from `start` to the first unquoted newline, ;, &, |, ), or `.
function readCommand(s: string, start: number): { tokens: Token[]; end: number } | undefined {
	const tokens: Token[] = [];
	let raw = "", value = "", plain = true, depth = 0, i = start;
	const push = () => {
		if (raw) tokens.push({ raw, value: plain ? value : undefined });
		raw = value = "";
		plain = true;
	};
	while (i < s.length) {
		const c = s[i];
		const redirectAmp = c === "&" && (s[i - 1] === ">" || s[i - 1] === "<" || s[i + 1] === ">"); // 2>&1, &>
		if (depth === 0 && /[|;&\n)`]/.test(c) && !redirectAmp) break;
		if (depth === 0 && (c === " " || c === "\t")) { push(); i++; continue; }
		if (c === "'") {
			const j = s.indexOf("'", i + 1);
			if (j < 0) return undefined;
			raw += s.slice(i, j + 1); value += s.slice(i + 1, j); i = j + 1;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			for (; j < s.length && s[j] !== '"'; j++) {
				if (s[j] === "\\" && j + 1 < s.length) { value += /[$`"\\\n]/.test(s[j + 1]) ? s[j + 1] : s[j] + s[j + 1]; j++; continue; }
				if (s[j] === "$" || s[j] === "`") plain = false;
				value += s[j];
			}
			if (j >= s.length) return undefined;
			raw += s.slice(i, j + 1); i = j + 1;
			continue;
		}
		if (c === "\\") { raw += s.slice(i, i + 2); value += s[i + 1] ?? ""; i += 2; continue; }
		if (c === "$") plain = false;
		if (c === "(" && (depth > 0 || s[i - 1] === "$")) depth++;
		if (c === ")") depth--;
		raw += c; value += c; i++;
	}
	push();
	return { tokens, end: i };
}

const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

function bracketEnd(p: string, i: number): number {
	let j = i + 1;
	if (p[j] === "^") j++;
	if (p[j] === "]") j++;
	while (j < p.length && p[j] !== "]") {
		if (p[j] === "[" && ":.=".includes(p[j + 1] ?? "")) {
			const k = p.indexOf(p[j + 1] + "]", j + 2);
			j = k < 0 ? p.length : k + 2;
			continue;
		}
		j++;
	}
	return Math.min(j + 1, p.length);
}

// POSIX basic or extended regex to rg (Rust) regex: in BRE, \| \( \) \{ \} \+ \? are operators
// and the bare characters are literal. \< and \> become \b in both.
function toRustRegex(p: string, basic: boolean): string {
	let out = "";
	for (let i = 0; i < p.length; ) {
		const c = p[i];
		if (c === "\\" && i + 1 < p.length) {
			const n = p[i + 1];
			out += n === "<" || n === ">" ? "\\b" : basic && "|(){}+?".includes(n) ? n : c + n;
			i += 2;
		} else if (c === "[") {
			const j = bracketEnd(p, i);
			out += p.slice(i, j);
			i = j;
		} else {
			out += basic && "|(){}+?".includes(c) ? "\\" + c : c;
			i++;
		}
	}
	return out;
}

const SHORT_FLAGS: Record<string, string> = {
	r: "", R: "-L", I: "", E: "", G: "", n: "-n", i: "-i", l: "-l", L: "--files-without-match", o: "-o", w: "-w",
	x: "-x", v: "-v", c: "-c --include-zero", q: "-q", s: "--no-messages", h: "--no-filename", H: "--with-filename",
};
const LONG_FLAGS: Record<string, string> = {
	"--recursive": "", "--dereference-recursive": "-L", "--ignore-case": "-i", "--line-number": "-n",
	"--files-with-matches": "-l", "--files-without-match": "--files-without-match", "--count": "-c --include-zero",
	"--word-regexp": "-w", "--line-regexp": "-x", "--invert-match": "-v", "--only-matching": "-o",
	"--no-messages": "--no-messages", "--extended-regexp": "", "--basic-regexp": "", "--binary-files=without-match": "",
	"--no-filename": "--no-filename", "--with-filename": "--with-filename", "--quiet": "-q", "--silent": "-q",
};
const COUNT_FLAGS = new Set(["m", "A", "B", "C"]);

// Returns the rg command, or undefined when the grep call uses something this cannot translate safely.
function grepToRg(tokens: Token[]): string | undefined {
	const flags: string[] = [], globs: string[] = [], excludes: string[] = [], operands: Token[] = [], redirects: string[] = [];
	const patterns: Token[] = [];
	let mode: "basic" | "extended" | "fixed" | "perl" = tokens[0].raw === "egrep" ? "extended" : tokens[0].raw === "fgrep" ? "fixed" : "basic";
	let endOfFlags = false;
	for (let k = 1; k < tokens.length; k++) {
		const t = tokens[k], v = t.value;
		if (isRedirect(t)) {
			redirects.push(t.raw);
			if (/[<>]$/.test(t.raw) && tokens[k + 1]) redirects.push(tokens[++k].raw);
			continue;
		}
		if (endOfFlags || v === undefined || !v.startsWith("-") || v === "-") {
			if (v === undefined && t.raw.startsWith("-")) return undefined;
			operands.push(t);
			continue;
		}
		if (v === "--") { endOfFlags = true; continue; }
		if (v.startsWith("--")) {
			const [name, arg] = [v.split("=")[0], v.includes("=") ? v.slice(v.indexOf("=") + 1) : undefined];
			if (v in LONG_FLAGS) { if (LONG_FLAGS[v]) flags.push(LONG_FLAGS[v]); }
			else if (name === "--color" || name === "--colour") continue;
			else if (name === "--include" && arg) globs.push(`-g ${sq(arg)}`);
			else if (name === "--exclude" && arg) excludes.push(`-g ${sq("!" + arg)}`);
			else if (name === "--exclude-dir" && arg) excludes.push(`-g ${sq("!" + arg.replace(/\/+$/, ""))}`);
			else if (name === "--max-count" && arg && /^\d+$/.test(arg)) flags.push(`-m ${arg}`);
			else if (name === "--context" && arg && /^\d+$/.test(arg)) flags.push(`-C ${arg}`);
			else return undefined;
			if (name === "--extended-regexp") mode = "extended";
			if (name === "--basic-regexp") mode = "basic";
			continue;
		}
		for (let j = 1; j < v.length; j++) {
			const ch = v[j];
			if (ch === "e" || COUNT_FLAGS.has(ch)) {
				const attached = v.slice(j + 1);
				const arg: Token | undefined = attached ? { raw: sq(attached), value: attached } : tokens[++k];
				if (!arg) return undefined;
				if (ch === "e") patterns.push(arg);
				else if (arg.value && /^\d+$/.test(arg.value)) flags.push(`-${ch} ${arg.value}`);
				else return undefined;
				break;
			}
			if (ch === "F") mode = "fixed";
			else if (ch === "P") mode = "perl";
			else if (ch === "E") mode = "extended";
			else if (ch === "G") mode = "basic";
			if (!(ch in SHORT_FLAGS) && !"FP".includes(ch)) return undefined;
			if (SHORT_FLAGS[ch]) flags.push(SHORT_FLAGS[ch]);
		}
	}
	if (!patterns.length) {
		const first = operands.shift();
		if (!first) return undefined;
		patterns.push(first);
	}
	const rgPatterns: string[] = [];
	for (const p of patterns) {
		if (mode === "fixed" || mode === "perl") { rgPatterns.push(`-e ${p.raw}`); continue; }
		if (p.value === undefined) {
			if (mode === "basic") return undefined; // a shell variable may hold BRE operators
			rgPatterns.push(`-e ${p.raw}`);
			continue;
		}
		const rust = toRustRegex(p.value, mode === "basic");
		rgPatterns.push(`-e ${rust === p.value ? p.raw : sq(rust)}`);
	}
	if (mode === "fixed") flags.push("-F");
	if (mode === "perl") flags.push("-P");
	// grep -r also searches hidden files and lists them in path order. rg needs a path, or it may read stdin instead of ".".
	const paths = operands.length ? operands.map((t) => t.raw) : ["."];
	return ["rg", "--hidden", "--sort", "path", ...flags, ...globs, ...excludes, "-g", "'!.git'", ...rgPatterns, ...paths, ...redirects].join(" ");
}

function isRecursiveGrep(tokens: Token[]): boolean {
	return tokens.slice(1).some(({ value: v }) => v !== undefined && (/^-[A-Za-z0-9]*[rR]/.test(v) || /^--(dereference-)?recursive$/.test(v)));
}

const isRedirect = (t: Token) => /^(\d*|&)[<>]/.test(t.raw);

function findPaths(tokens: Token[]): Token[] {
	const paths: Token[] = [];
	for (const t of tokens.slice(1)) {
		if (isRedirect(t) || /^(-|!|\\?\()/.test(t.raw)) break;
		paths.push(t);
	}
	return paths;
}

// A find over a very large root, unless -maxdepth is 2 or less.
function isBigFind(tokens: Token[]): boolean {
	const depth = tokens.findIndex((t) => t.value === "-maxdepth");
	if (depth > 0 && Number(tokens[depth + 1]?.value) <= 2) return false;
	return findPaths(tokens).some((t) => {
		const path = t.raw.replace(/^["']|["']$/g, "").replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, HOME).replace(/(.)\/+$/, "$1");
		return BIG_ROOTS.has(path);
	});
}

// fd -HI searches hidden and ignored files like find does, about 20x faster (0.2 s vs 3.9 s on ~/.pi).
// Returns undefined for find expressions this does not translate: -o, -prune, -exec, ( ), -regex, and others.
function findToFd(tokens: Token[]): string | undefined {
	const paths = findPaths(tokens);
	const opts: string[] = [], redirects: string[] = [];
	let name: string | undefined, insensitive = false;
	for (let k = 1 + paths.length; k < tokens.length; k++) {
		const t = tokens[k], v = t.value, next = tokens[k + 1]?.value;
		if (isRedirect(t)) {
			redirects.push(t.raw);
			if (/[<>]$/.test(t.raw) && tokens[k + 1]) redirects.push(tokens[++k].raw);
		} else if (v === "-print") continue;
		else if ((v === "-name" || v === "-iname") && next !== undefined && name === undefined) {
			name = next;
			insensitive = v === "-iname";
			k++;
		} else if (v === "-type" && next && /^[fdl]$/.test(next)) { opts.push(`-t ${next}`); k++; }
		else if ((v === "-maxdepth" || v === "-mindepth") && next && /^\d+$/.test(next)) {
			opts.push(`${v === "-maxdepth" ? "-d" : "--min-depth"} ${next}`);
			k++;
		} else if ((v === "-mtime" || v === "-mmin") && next && /^[-+]\d+$/.test(next)) {
			opts.push(`${next[0] === "-" ? "--changed-within" : "--changed-before"} ${next.slice(1)}${v === "-mtime" ? "d" : "min"}`);
			k++;
		} else if ((v === "-not" || v === "!") && tokens[k + 1]?.value === "-path") {
			const dir = /^\*\/([^*/]+)(\/\*)?$/.exec(tokens[k + 2]?.value ?? "");
			if (!dir) return undefined;
			opts.push(`-E ${sq(dir[1])}`);
			k += 2;
		} else return undefined;
	}
	if (!paths.length) return undefined;
	// find -name is case-sensitive; fd uses smart case unless -s.
	const match = name === undefined ? ["."] : [insensitive ? "-i" : "-s", "-g", sq(name)];
	return ["fd", "-HI", ...opts, ...match, ...paths.map((t) => t.raw), ...redirects].join(" ");
}

const FIND_REASON =
	"Blocked find over a very large tree (~, ~/Developer, ~/Library, ~/.pi). Use fd: fd -HI -g '<name>' <dir> " +
	"finds the same files about 20x faster; drop -HI to skip hidden and .gitignore paths. Or start find in one repo, or add -maxdepth 2 or less.";

type Converter = { pattern: RegExp; applies: (tokens: Token[]) => boolean; convert: (tokens: Token[]) => string | undefined; reason: string };
const CONVERTERS: Converter[] = [
	{ pattern: FIND, applies: isBigFind, convert: findToFd, reason: FIND_REASON },
	{ pattern: GREP, applies: isRecursiveGrep, convert: grepToRg, reason: GREP_REASON },
];

// Rewrites each `grep -r`, and each find over a very large root, in a shell script.
// Returns the new script and the commands that replaced them, or a reason to block the call.
export function guardScript(script: string): { script: string; rewrites: string[] } | { reason: string } {
	const rewrites: string[] = [];
	for (const { pattern, applies, convert, reason } of CONVERTERS) {
		let out = "", last = 0;
		for (const match of script.matchAll(pattern)) {
			const start = match.index + match[1].length;
			if (start < last) continue;
			const command = readCommand(script, start);
			if (!command) return { reason };
			if (!applies(command.tokens)) continue;
			const replacement = convert(command.tokens);
			if (!replacement) return { reason };
			out += script.slice(last, start) + replacement;
			last = command.end;
			rewrites.push(replacement);
		}
		script = out + script.slice(last);
	}
	return { script, rewrites };
}

type ShellField = { get: () => string; set: (script: string) => void };

function shellFields(toolName: string, input: Record<string, unknown>): ShellField[] {
	const field = (obj: Record<string, unknown>, key: string): ShellField => ({ get: () => String(obj[key] ?? ""), set: (s) => (obj[key] = s) });
	if (toolName === "bash") return [field(input, "command")];
	if (toolName === "ctx_execute" && input.language === "shell") return [field(input, "code")];
	if (toolName === "ctx_batch" && Array.isArray(input.commands)) {
		const commands = input.commands as unknown[];
		return commands.flatMap((c, i) => (typeof c === "string" ? [{ get: () => String(commands[i]), set: (s: string) => (commands[i] = s) }] : []));
	}
	return [];
}

export default function slowSearchGuard(pi: ExtensionAPI) {
	const notes = new Map<string, string>();

	pi.on("tool_call", (event) => {
		const fields = shellFields(event.toolName, event.input as Record<string, unknown>);
		const results = fields.map((f) => guardScript(f.get()));
		const blocked = results.find((r) => "reason" in r);
		if (blocked && "reason" in blocked) return { block: true, reason: blocked.reason };
		const rewrites: string[] = [];
		results.forEach((r, k) => {
			if (!("script" in r) || !r.rewrites.length) return;
			fields[k].set(r.script);
			rewrites.push(...r.rewrites);
		});
		if (!rewrites.length) return;
		const caveat = rewrites.some((r) => r.startsWith("rg ")) ? " rg skips .gitignore paths; rg -uu includes them." : "";
		notes.set(event.toolCallId, `[slow-search-guard] Ran instead, for speed: ${rewrites.map((r) => `\`${r}\``).join(" ; ")}.${caveat} Use rg and fd directly.\n\n`);
	});

	pi.on("tool_result", (event) => {
		const note = notes.get(event.toolCallId);
		if (!note) return;
		notes.delete(event.toolCallId);
		return { content: [{ type: "text", text: note }, ...event.content] };
	});
}
