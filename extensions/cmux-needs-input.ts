import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ASK_USER_PROMPT_EVENT = "rpiv:ask-user:prompt";
const CMUX_NOTIFICATION_TYPE = "needs_input";
const FALLBACK_MESSAGE = "Question needs your input";

type AskUserPromptPayload = {
  questions?: ReadonlyArray<{ question?: unknown }>;
};

type ActiveSession = {
  cwd: string;
  id: string;
};

function firstQuestion(payload: unknown): string {
  if (!payload || typeof payload !== "object") return FALLBACK_MESSAGE;
  const question = (payload as AskUserPromptPayload).questions?.[0]?.question;
  return typeof question === "string" && question.trim() ? question.trim() : FALLBACK_MESSAGE;
}

function cmuxExecutable(): string {
  return process.env.CMUX_PI_CMUX_BIN || process.env.CMUX_BUNDLED_CLI_PATH || "cmux";
}

function activeSession(ctx: ExtensionContext): ActiveSession | null {
  const id = ctx.sessionManager.getSessionId();
  if (typeof id !== "string" || !id.trim()) return null;
  return { cwd: ctx.cwd || process.cwd(), id: id.trim() };
}

function notifyCmux(session: ActiveSession, payload: unknown): void {
  if (process.env.CMUX_PI_HOOKS_DISABLED === "1" || !process.env.CMUX_SURFACE_ID) return;

  const hookPayload = {
    session_id: session.id,
    cwd: session.cwd,
    hook_event_name: "Notification",
    event: "Notification",
    message: firstQuestion(payload),
    notification: { type: CMUX_NOTIFICATION_TYPE },
  };

  try {
    const child = spawn(cmuxExecutable(), ["hooks", "pi", "notification"], {
      cwd: session.cwd,
      detached: true,
      env: process.env,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(hookPayload));
    child.unref();
  } catch (_) {}
}

export default function cmuxNeedsInput(pi: ExtensionAPI) {
  let session: ActiveSession | null = null;
  const unsubscribe = pi.events.on(ASK_USER_PROMPT_EVENT, (payload) => {
    if (session) notifyCmux(session, payload);
  });

  pi.on("session_start", async (_event, ctx) => {
    session = activeSession(ctx);
  });

  pi.on("session_shutdown", async () => {
    session = null;
    unsubscribe?.();
  });
}
