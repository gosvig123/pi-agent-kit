#!/usr/bin/env node
// Claude Code PreToolUse hook adapter for pi-agent-kit's shared guards.
// Brings Pi's deterministic rules (slow-search-guard, force-push block, brief-check,
// cross-model review rotation across {sol 6.2, opus 5.5, neon}, default child-target,
// and ask_user_question multiSelect block) to Claude Code in T3 Code.
import { existsSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardScript } from "../extensions/slow-search-guard.ts";
import {
	DELEGATE_TOOLS,
	checkDelegateBrief,
	checkReviewModelDiversity,
	defaultChildTarget,
	needsDefaultChildTarget,
	pickReviewTarget,
	type DelegateInput,
} from "../lib/guards/delegate.ts";
import { checkAskQuestion, checkForcePush } from "../lib/guards/safety.ts";

type HookPayload = {
	session_id?: string;
	cwd?: string;
	model?: string;
	transcript_path?: string;
	tool_name?: string;
	tool_input?: Record<string, unknown>;
};

function respond(output: Record<string, unknown>): never {
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...output } }) + "\n");
	process.exit(0);
}

function deny(reason: string): never {
	respond({ permissionDecision: "deny", permissionDecisionReason: reason });
}

function rewriteInput(updatedInput: Record<string, unknown>, reason?: string): never {
	// Omit permissionDecision so Claude Code still applies its normal permission prompts
	// (setting permissionDecision: "allow" would auto-approve arbitrary compound commands).
	respond({
		...(reason ? { permissionDecisionReason: reason } : {}),
		updatedInput,
	});
}

function safeId(sessionId: string | undefined): string {
	return (sessionId || "default").replace(/[^A-Za-z0-9._-]/g, "_");
}

function hasWarnedOnce(sessionId: string, key: string): boolean {
	const statePath = join(tmpdir(), `claude-guard-warned-${safeId(sessionId)}.json`);
	let seen: string[] = [];
	try {
		if (existsSync(statePath)) seen = JSON.parse(readFileSync(statePath, "utf8"));
	} catch {
		seen = [];
	}
	if (seen.includes(key)) return true;
	seen.push(key);
	try {
		writeFileSync(statePath, JSON.stringify(seen.slice(-50)));
	} catch {
		// Ignore state write failures; never crash the hook.
	}
	return false;
}

function nextReviewIndex(sessionId: string): number {
	const statePath = join(tmpdir(), `claude-guard-review-idx-${safeId(sessionId)}.json`);
	let idx = 0;
	try {
		if (existsSync(statePath)) {
			const parsed = JSON.parse(readFileSync(statePath, "utf8"));
			if (typeof parsed?.idx === "number" && Number.isInteger(parsed.idx)) idx = parsed.idx;
		}
	} catch {
		idx = 0;
	}
	try {
		writeFileSync(statePath, JSON.stringify({ idx: idx + 1 }));
	} catch {
		// Ignore state write failures.
	}
	return idx;
}

function detectParentModel(payload: HookPayload): string {
	if (typeof payload.model === "string" && payload.model.trim()) return payload.model.trim();
	if (typeof payload.transcript_path === "string" && existsSync(payload.transcript_path)) {
		try {
			const size = statSync(payload.transcript_path).size;
			const chunkSize = Math.min(size, 65536);
			const buf = Buffer.alloc(chunkSize);
			const fd = openSync(payload.transcript_path, "r");
			try {
				readSync(fd, buf, 0, chunkSize, Math.max(0, size - chunkSize));
			} finally {
				closeSync(fd);
			}
			const lines = buf.toString("utf8").split("\n").reverse();
			for (const line of lines) {
				if (!line.includes("model")) continue;
				try {
					const obj = JSON.parse(line);
					const m = obj?.message?.model ?? obj?.model;
					if (typeof m === "string" && m.trim()) return m.trim();
				} catch {
					// Skip partial first line from tail slice.
				}
			}
		} catch {
			// Fall back below.
		}
	}
	return process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
}

let payload: HookPayload;
try {
	const raw = readFileSync(0, "utf8").trim();
	if (!raw) process.exit(0);
	payload = JSON.parse(raw) as HookPayload;
} catch {
	process.exit(0);
}

const toolName = payload.tool_name ?? "";
const input = (payload.tool_input ?? {}) as Record<string, unknown>;
const cwd = payload.cwd || process.cwd();

const askBlock = checkAskQuestion(toolName, input);
if (askBlock) deny(askBlock);

if (toolName === "Bash" && typeof input.command === "string") {
	const pushBlock = checkForcePush(input.command);
	if (pushBlock) deny(pushBlock);

	const guarded = guardScript(input.command);
	if ("reason" in guarded) deny(guarded.reason);
	if (guarded.rewrites.length > 0) {
		rewriteInput(
			{ ...input, command: guarded.script },
			`[slow-search-guard] Rewrote slow search to: ${guarded.rewrites.join(" ; ")}`,
		);
	}
}

if (DELEGATE_TOOLS.has(toolName)) {
	const dInput = input as DelegateInput;
	const check = checkDelegateBrief(dInput, cwd);
	if (check.hard) deny(check.hard);
	if (check.soft.length > 0) {
		const key = JSON.stringify({ task: dInput.task, role: dInput.role, isolation: dInput.isolation });
		if (!hasWarnedOnce(payload.session_id ?? "default", key)) {
			deny(`brief-check (blocked once): ${check.soft.join(" ")} To start the child anyway, call delegate_task again with the same input.`);
		}
	}

	if (dInput.role === "review") {
		const parentModel = detectParentModel(payload);
		if (needsDefaultChildTarget(dInput)) {
			const picked = pickReviewTarget(parentModel, nextReviewIndex(payload.session_id ?? "default"));
			rewriteInput(
				{ ...input, target: picked.target },
				`[review-model] Auto-selected ${picked.label} (different from orchestrator ${parentModel}).`,
			);
		}
		const sameModel = checkReviewModelDiversity(dInput, parentModel);
		if (sameModel) {
			const key = JSON.stringify({ kind: "review-model", target: dInput.target, task: dInput.task });
			if (!hasWarnedOnce(payload.session_id ?? "default", key)) {
				deny(`${sameModel} If the user explicitly requested the same model, call delegate_task again with the same input.`);
			}
		}
	} else if (needsDefaultChildTarget(dInput)) {
		rewriteInput(
			{ ...input, target: defaultChildTarget() },
			"[child-target] Applied default child target (GPT-6.2 Sol high via Pi).",
		);
	}
}
