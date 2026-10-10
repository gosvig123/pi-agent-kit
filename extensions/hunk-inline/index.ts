import {
  createEditToolDefinition,
  createWriteToolDefinition,
  generateUnifiedPatch,
  type EditToolDetails,
  type EditToolInput,
  type ExtensionAPI,
  type Theme,
  type WriteOperations,
  type WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { safeText } from "./sanitize";
import { createInlineDiffView } from "./view";

const MAX_WRITE_RECORDS = 40;
type EditDefinition = ReturnType<typeof createEditToolDefinition>;
type WriteDefinition = ReturnType<typeof createWriteToolDefinition>;
type EditExecuteArgs = Parameters<EditDefinition["execute"]>;
type WriteExecuteArgs = Parameters<WriteDefinition["execute"]>;
type EditRenderArgs = Parameters<NonNullable<EditDefinition["renderResult"]>>;
type WriteRenderArgs = Parameters<NonNullable<WriteDefinition["renderResult"]>>;
type ToolResult = EditRenderArgs[0] | WriteRenderArgs[0];
type PatchRecord = { patch: string; filePath: string };
type WriteState = { record?: PatchRecord };

function callView(tool: string, path: string, detail: string, theme: Theme): Text {
  const icon = theme.fg("accent", "✦");
  const name = theme.fg("toolTitle", theme.bold(tool));
  const label = `${icon} ${name} ${theme.fg("muted", safeText(path))}`;
  return new Text(`${label} ${theme.fg("dim", `· ${safeText(detail)}`)}`, 0, 0);
}

function errorText(result: ToolResult, theme: Theme): Text {
  const output = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  return new Text(theme.fg("error", safeText(output || "Tool failed")), 0, 0);
}

function remember(records: Map<string, PatchRecord>, id: string, record: PatchRecord): void {
  records.set(id, record);
  while (records.size > MAX_WRITE_RECORDS) {
    const oldest = records.keys().next().value;
    if (oldest === undefined) return;
    records.delete(oldest);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readBefore(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    return isMissing(error) ? "" : undefined;
  }
}

function writeOperations(capture: (value: string | undefined) => void): WriteOperations {
  return {
    mkdir: async (dir) => void (await mkdir(dir, { recursive: true })),
    writeFile: async (path, content) => {
      capture(await readBefore(path));
      await writeFile(path, content, "utf8");
    },
  };
}

async function executeEdit(...args: EditExecuteArgs) {
  return createEditToolDefinition(args[4].cwd).execute(...args);
}

function editCall(args: Partial<EditToolInput>, theme: Theme): Component {
  const path = typeof args.path === "string" ? args.path : "…";
  const detail = Array.isArray(args.edits) ? `${args.edits.length} block(s)` : "pending";
  return callView("edit", path, detail, theme);
}

function editResult(result: EditRenderArgs[0], _options: EditRenderArgs[1], theme: Theme, context: EditRenderArgs[3]): Component {
  if (context.isError) return errorText(result, theme);
  const patch = (result.details as EditToolDetails | undefined)?.patch;
  const filePath = typeof context.args.path === "string" ? context.args.path : "file";
  return patch
    ? createInlineDiffView({ patch, filePath, theme })
    : new Text(theme.fg("dim", "Edited file"), 0, 0);
}

function editOverride(): EditDefinition {
  return {
    ...createEditToolDefinition(process.cwd()),
    label: "Edit ✦ Hunk",
    renderShell: "self",
    execute: executeEdit,
    renderCall: editCall,
    renderResult: editResult,
  };
}

function writeCall(args: Partial<WriteToolInput>, theme: Theme): Component {
  const path = typeof args.path === "string" ? args.path : "…";
  const detail = typeof args.content === "string" ? `${args.content.split("\n").length} line(s)` : "pending";
  return callView("write", path, detail, theme);
}

function takeRecord(records: Map<string, PatchRecord>, id: string, state: WriteState): PatchRecord | undefined {
  if (state.record) return state.record;
  state.record = records.get(id);
  if (state.record) records.delete(id);
  return state.record;
}

function writeResult(records: Map<string, PatchRecord>, ...args: WriteRenderArgs): Component {
  const [result, , theme, context] = args;
  if (context.isError) return errorText(result, theme);
  const record = takeRecord(records, context.toolCallId, context.state as WriteState);
  return record
    ? createInlineDiffView({ patch: record.patch, filePath: record.filePath, theme })
    : new Text(theme.fg("dim", "Wrote file · diff unavailable"), 0, 0);
}

async function executeWrite(records: Map<string, PatchRecord>, ...args: WriteExecuteArgs) {
  const [id, params, signal, onUpdate, ctx] = args;
  let before: string | undefined;
  const tool = createWriteToolDefinition(ctx.cwd, { operations: writeOperations((value) => (before = value)) });
  const result = await tool.execute(id, params, signal, onUpdate, ctx);
  if (before !== undefined) {
    const patch = generateUnifiedPatch(params.path, before, params.content, 3);
    remember(records, id, { patch, filePath: params.path });
  }
  return result;
}

function writeOverride(records: Map<string, PatchRecord>): WriteDefinition {
  return {
    ...createWriteToolDefinition(process.cwd()),
    label: "Write ✦ Hunk",
    renderShell: "self",
    execute: (...args) => executeWrite(records, ...args),
    renderCall: writeCall,
    renderResult: (...args) => writeResult(records, ...args),
  };
}

export default function hunkInline(pi: ExtensionAPI): void {
  const writes = new Map<string, PatchRecord>();
  pi.registerTool(editOverride());
  pi.registerTool(writeOverride(writes));
}
