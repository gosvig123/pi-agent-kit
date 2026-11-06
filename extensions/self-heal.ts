import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  RetryLedger, classifyFailure, recoveryDetails, recoveryPrompt,
  inputFingerprint, needsRecovery, noticeKey, uniqueFailures, type Failure, type RecoveryDetails,
} from "../lib/self-heal-policy";


type ToolFailureEvent = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
};

function contentText(content: Array<{ type: string; text?: string }>): string {
  return content.flatMap((item) => item.type === "text" && item.text ? [item.text] : []).join("\n");
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

  constructor(private readonly pi: ExtensionAPI) {}

  start(): void {
    this.bindTurnHooks();
    this.pi.on("session_start", (_event, ctx) => this.restore(ctx.sessionManager.getEntries()));
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

  private flushTurn(turnIndex?: number): void {
    const failures = this.turnFailures;
    this.turnFailures = [];
    this.emit(failures, turnIndex);
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
    this.ledger.reset();
    for (const details of restoredDetails(entries)) this.restoreRecord(details);
  }
}

export default function selfHeal(pi: ExtensionAPI): void {
  new SelfHealRuntime(pi).start();
}
