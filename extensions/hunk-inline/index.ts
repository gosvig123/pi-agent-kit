import type {
  createEditToolDefinition,
  createWriteToolDefinition,
  EditToolDetails,
  EditToolInput,
  ExtensionAPI,
  Theme,
  WriteToolInput,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { safeText } from "./sanitize";
import { createInlineDiffView } from "./view";

type EditDefinition = ReturnType<typeof createEditToolDefinition>;
type WriteDefinition = ReturnType<typeof createWriteToolDefinition>;
type EditRenderArgs = Parameters<NonNullable<EditDefinition["renderResult"]>>;
type WriteRenderArgs = Parameters<NonNullable<WriteDefinition["renderResult"]>>;
type ToolResult = EditRenderArgs[0] | WriteRenderArgs[0];

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

function editCall(args: Partial<EditToolInput>, theme: Theme): Component {
  const path = typeof args.path === "string" ? args.path : "…";
  const detail = Array.isArray(args.edits) ? `${args.edits.length} block(s)` : "pending";
  return callView("edit", path, detail, theme);
}

function editResult(result: EditRenderArgs[0], options: EditRenderArgs[1], theme: Theme, context: EditRenderArgs[3]): Component {
  if (context.isError) return errorText(result, theme);
  if (options.isPartial) return new Text(theme.fg("dim", "Editing…"), 0, 0);
  const patch = (result.details as EditToolDetails | undefined)?.patch;
  const filePath = typeof context.args.path === "string" ? context.args.path : "file";
  return patch
    ? createInlineDiffView({ patch, filePath, theme })
    : new Text(theme.fg("dim", "Edited file"), 0, 0);
}

function writeCall(args: Partial<WriteToolInput>, theme: Theme): Component {
  const path = typeof args.path === "string" ? args.path : "…";
  const detail = typeof args.content === "string" ? `${args.content.split("\n").length} line(s)` : "pending";
  return callView("write", path, detail, theme);
}

function writeResult(result: WriteRenderArgs[0], options: WriteRenderArgs[1], theme: Theme, context: WriteRenderArgs[3]): Component {
  if (context.isError) return errorText(result, theme);
  if (options.isPartial) return new Text(theme.fg("dim", "Writing…"), 0, 0);
  return new Text(theme.fg("dim", "Wrote file"), 0, 0);
}

export default function hunkInline(pi: ExtensionAPI): void {
  // Execution belongs to the active tool, which may target a remote host.
  pi.registerToolRenderer((name, next) => {
    if (name === "edit") return { renderShell: "self", renderCall: editCall, renderResult: editResult };
    if (name === "write") return { renderShell: "self", renderCall: writeCall, renderResult: writeResult };
    return next();
  });
}
