import { SessionManager, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "subright";
const CMUX = "cmux";
const PI = "pi";
const RIGHT = "right";
const TRUE = "true";

type ExecOutput = {
  stdout: string;
  stderr: string;
  code: number | null;
};

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandFor(cwd: string, sessionFile: string) {
  return `cd ${shellQuote(cwd)} && exec ${PI} --session ${shellQuote(sessionFile)}\\n`;
}

function parseFocusedSurface(output: string) {
  const payload = JSON.parse(output) as { focused?: { surface_ref?: unknown } };
  return typeof payload.focused?.surface_ref === "string" ? payload.focused.surface_ref : undefined;
}

function assertOk(result: ExecOutput, operation: string) {
  if (result.code === 0) return;

  const cause = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
  throw new Error(`${operation} failed: ${cause}`);
}

async function run(pi: ExtensionAPI, command: string, args: string[]) {
  const result = (await pi.exec(command, args, { timeout: 10_000 })) as ExecOutput;
  assertOk(result, `${command} ${args.join(" ")}`);
  return result;
}

function createBranchedSession(ctx: ExtensionCommandContext) {
  const source = ctx.sessionManager.getSessionFile();
  const leaf = ctx.sessionManager.getLeafId();
  if (!source || !leaf) throw new Error("Need saved non-empty session");

  const sm = SessionManager.open(source, ctx.sessionManager.getSessionDir(), ctx.cwd);
  return sm.createBranchedSession(leaf);
}

async function createRightPane(pi: ExtensionAPI) {
  await run(pi, CMUX, ["new-pane", "--direction", RIGHT, "--focus", TRUE]);
  const identify = await run(pi, CMUX, ["identify", "--json"]);
  const surface = parseFocusedSurface(identify.stdout);
  if (!surface) throw new Error("cmux did not report focused surface");
  return surface;
}

async function openSubsessionRight(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();
  const sessionFile = createBranchedSession(ctx);
  if (!sessionFile) throw new Error("Could not write branched session");

  const surface = await createRightPane(pi);
  await run(pi, CMUX, ["send", "--surface", surface, commandFor(ctx.cwd, sessionFile)]);
  ctx.ui.notify(`Opened ${COMMAND_NAME} in ${surface}`, "info");
}

function registerSubright(pi: ExtensionAPI, name: string) {
  pi.registerCommand(name, {
    description: "Open current pi branch in a new cmux pane to the right",
    handler: async (_args, ctx) => {
      try {
        await openSubsessionRight(pi, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`${name}: ${message}`, "error");
      }
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerSubright(pi, COMMAND_NAME);
}
