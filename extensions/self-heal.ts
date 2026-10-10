import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  RetryLedger, classifyFailure, recoveryDetails, recoveryPrompt,
  inputFingerprint, needsRecovery, noticeKey, uniqueFailures, type Failure, type RecoveryDetails,
} from "../lib/self-heal-policy";

const COMPLETE_EVENT = "subagent:async-complete";
const ENTRY_TYPE = "self-heal-recovery";
const GLOBAL_KEY = "__piSelfHealCleanup";

type Completion = {
  runId?: string;
  success?: boolean;
  state?: string;
  summary?: string;
  results?: Array<{ status?: string; success?: boolean; error?: string }>;
};

type ToolFailureEvent = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
};

function contentText(content: Array<{ type: string; text?: string }>): string {
  return content.flatMap((item) => item.type === "text" && item.text ? [item.text] : []).join("\n");
}

function completionFailed(event: Completion): boolean {
  if (event.state === "stopped" || event.state === "paused") return false;
  if (event.success === false || event.state === "failed") return true;
  return event.results?.some((item) => item.success === false || item.status === "failed") ?? false;
}

function completionText(event: Completion): string {
  const failed = event.results?.filter((item) => item.success === false || item.status === "failed") ?? [];
  const errors = failed.flatMap((item) => item.error ? [item.error] : []);
  return [event.summary, ...errors].filter(Boolean).join("\n").slice(0, 4000)
    || "Subagent reported a failed completion without error text.";
}

function targetText(input: Record<string, unknown>): string | undefined {
  const keys = ["path", "url", "list", "taskId", "calendarId"];
  for (const key of keys) if (typeof input[key] === "string") return String(input[key]);
  return undefined;
}

function toolFailure(event: ToolFailureEvent): Failure | undefined {
  return classifyFailure({
    source: `tool ${event.toolName}`,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    target: targetText(event.input),
    inputHash: inputFingerprint(event.input),
    command: typeof event.input.command === "string" ? event.input.command : undefined,
    summary: contentText(event.content),
  });
}

function completionFailure(event: Completion): Failure | undefined {
  return classifyFailure({
    source: `subagent ${event.runId ?? "run"}`,
    summary: completionText(event),
  });
}

function restoredDetails(entries: unknown[]): RecoveryDetails[] {
  const records: RecoveryDetails[] = [];
  for (const value of entries) {
    const entry = value as { type?: string; customType?: string; data?: RecoveryDetails };
    if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE || entry.data?.version !== 1) continue;
    records.push(entry.data);
  }
  return records;
}

class SelfHealRuntime {
  private readonly ledger = new RetryLedger();
  private readonly seen = new Set<string>();
  private turnFailures: Failure[] = [];
  private asyncFailures: Failure[] = [];
  private asyncScheduled = false;
  private unsubscribe = () => {};

  constructor(private readonly pi: ExtensionAPI) {}

  start(): () => void {
    this.unsubscribe = this.pi.events.on(COMPLETE_EVENT, (value) => this.onCompletion(value as Completion));
    this.bindTurnHooks();
    this.bindSessionHooks();
    return () => this.unsubscribe();
  }

  private emit(failures: Failure[], turnIndex?: number): void {
    const unique = uniqueFailures(failures).filter((failure) => !this.seen.has(noticeKey(failure)));
    if (!unique.length) return;
    for (const failure of unique) this.seen.add(noticeKey(failure));
    const details = recoveryDetails(unique, this.ledger, turnIndex);
    this.pi.appendEntry(ENTRY_TYPE, details);
    const active = details.failures.filter(needsRecovery);
    if (!active.length) return; // The original tool result remains visible; no extra model turn.
    const promptDetails = { ...details, failures: active };
    this.pi.sendMessage({ customType: "self-heal", content: recoveryPrompt(promptDetails), display: true, details: promptDetails },
      { deliverAs: "steer", triggerTurn: true });
  }

  private bindTurnHooks(): void {
    this.pi.on("tool_result", (event) => {
      if (!event.isError) return;
      const failure = toolFailure(event as ToolFailureEvent);
      if (failure) this.turnFailures.push(failure);
    });
    this.pi.on("turn_start", () => { this.turnFailures = []; });
    this.pi.on("turn_end", (event) => this.flushTurn(event.turnIndex));
    this.pi.on("agent_end", () => this.flushTurn());
  }

  private bindSessionHooks(): void {
    this.pi.on("session_start", (_event, ctx) => this.restore(ctx.sessionManager.getEntries()));
    this.pi.on("session_shutdown", () => this.unsubscribe());
  }

  private flushTurn(turnIndex?: number): void {
    const failures = this.turnFailures;
    this.turnFailures = [];
    this.emit(failures, turnIndex);
  }

  private onCompletion(event: Completion): void {
    const failure = completionFailed(event) ? completionFailure(event) : undefined;
    if (failure) this.queueAsync(failure);
  }

  private queueAsync(failure: Failure): void {
    this.asyncFailures.push(failure);
    if (this.asyncScheduled) return;
    this.asyncScheduled = true;
    queueMicrotask(() => this.flushAsync());
  }

  private flushAsync(): void {
    this.asyncScheduled = false;
    const failures = this.asyncFailures;
    this.asyncFailures = [];
    this.emit(failures);
  }

  private restoreRecord(details: RecoveryDetails): void {
    for (const saved of details.failures) {
      const failure = saved.operationKey.startsWith("v2:") ? saved : classifyFailure(saved);
      if (!failure) continue;
      this.seen.add(noticeKey(failure));
      const retried = details.retry.some((item) => item.operationKey === saved.operationKey && item.allowed);
      if (retried) this.ledger.restore([failure.operationKey]);
    }
  }

  private restore(entries: unknown[]): void {
    this.seen.clear();
    this.turnFailures = [];
    this.asyncFailures = [];
    this.asyncScheduled = false;
    this.ledger.reset();
    for (const details of restoredDetails(entries)) this.restoreRecord(details);
  }
}

export default function selfHeal(pi: ExtensionAPI): void {
  const store = globalThis as Record<string, unknown>;
  if (typeof store[GLOBAL_KEY] === "function") (store[GLOBAL_KEY] as () => void)();
  const cleanup = new SelfHealRuntime(pi).start();
  store[GLOBAL_KEY] = cleanup;
}
