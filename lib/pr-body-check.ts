// Pure PR body and diff lint rules shared by `pr-publish` and guard hooks.
// Enforces the static invariants from work-items/references/pr.md without API calls.

const UI_EXT = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html|htm|ejs|hbs|mjml|astro)$/i;
const UI_DIR = /(^|\/)(components|pages|views|templates|emails|styles|layouts)\//i;
const TEST_FILE = /(\.(test|spec)\.[^/]+$|(^|\/)__tests__\/|(^|\/)fixtures\/)/i;
const SCREENSHOT_IMG = /(<img\b[^>]*\bsrc\s*=\s*["'][^"']+["']|!\[[^\]]*\]\([^)]+(pr-screenshots|raw=true|user-attachments|uploads\.linear\.app|\.png|\.jpe?g|\.webp)[^)]*\))/i;
const LINEAR_KEY = /\b([A-Z]{2,10}-[0-9]+)\b/g;
const IGNORED_KEYS = new Set(["UTF", "ISO", "SHA", "MD", "RFC", "CVE", "CWE", "HTTP", "HTTPS", "TLS", "SSL", "TCP", "UDP", "ES", "ECMA", "PR", "GH", "NODE"]);

export function extractMermaidBlocks(body: string): string[] {
	const blocks: string[] = [];
	const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
	for (const match of body.matchAll(re)) {
		blocks.push(match[1].trim());
	}
	return blocks;
}

export function lintMermaidBlock(code: string): string[] {
	const issues: string[] = [];
	if (!code.trim()) {
		issues.push("Mermaid block is empty.");
		return issues;
	}
	if (/%%\{\s*init\b/i.test(code)) {
		issues.push("Remove %%{init}%% theme override; GitHub picks the reader's theme.");
	}
	for (const line of code.split("\n")) {
		const trimmed = line.trim();
		if (/^(classDef|style)\s+/i.test(trimmed) && /\bfill\s*:/i.test(trimmed) && !/\bcolor\s*:/i.test(trimmed)) {
			issues.push(`Mermaid line sets fill without color (unreadable in dark mode): "${trimmed}"`);
		}
	}
	return issues;
}

export function isUiPath(filePath: string): boolean {
	if (TEST_FILE.test(filePath)) return false;
	return UI_EXT.test(filePath) || UI_DIR.test(filePath);
}

export function hasScreenshots(body: string): boolean {
	return SCREENSHOT_IMG.test(body);
}

export function extractLinearKeys(text: string): string[] {
	const keys = new Set<string>();
	for (const match of text.matchAll(LINEAR_KEY)) {
		const key = match[1];
		const prefix = key.split("-")[0];
		if (!IGNORED_KEYS.has(prefix)) keys.add(key);
	}
	return [...keys];
}

export type PrCheckResult = {
	ok: boolean;
	errors: string[];
	warnings: string[];
	forceDraft: boolean;
	uiFiles: string[];
	linearKeys: string[];
	mermaidBlocks: string[];
	usesClassDef: boolean;
};

export function checkPrBody(opts: {
	body: string;
	changedFiles?: string[];
	title?: string;
	branch?: string;
	allowNoDiagram?: boolean;
	allowNoScreenshots?: boolean;
}): PrCheckResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const mermaidBlocks = extractMermaidBlocks(opts.body);
	if (mermaidBlocks.length === 0 && !opts.allowNoDiagram) {
		errors.push("Missing ```mermaid diagram block. Add a diagram right after Why (or pass --allow-no-diagram).");
	}
	for (const [idx, block] of mermaidBlocks.entries()) {
		for (const issue of lintMermaidBlock(block)) {
			errors.push(`Diagram #${idx + 1}: ${issue}`);
		}
	}
	const usesClassDef = mermaidBlocks.some((b) => /\bclassDef\b/.test(b));
	const uiFiles = (opts.changedFiles ?? []).filter(isUiPath);
	let forceDraft = false;
	if (uiFiles.length > 0 && !hasScreenshots(opts.body) && !opts.allowNoScreenshots) {
		forceDraft = true;
		warnings.push(
			`Changed ${uiFiles.length} UI file(s) (${uiFiles.slice(0, 5).join(", ")}) without screenshots in the PR body. PR must stay a draft until screenshots are added.`,
		);
	}
	const linearKeys = extractLinearKeys([opts.title ?? "", opts.branch ?? "", opts.body].join("\n"));
	return {
		ok: errors.length === 0,
		errors,
		warnings,
		forceDraft,
		uiFiles,
		linearKeys,
		mermaidBlocks,
		usesClassDef,
	};
}
