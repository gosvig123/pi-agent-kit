import {
  getLanguageFromPath,
  highlightCode,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { parsePatch, type DiffKind, type DiffRow } from "./patch";
import { safeText } from "./sanitize";

const MAX_ROWS = 160;
const EMPTY_LINE = " ";

type ViewInput = {
  patch: string;
  filePath: string;
  theme: Theme;
};

function sideColor(kind: DiffKind): "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext" {
  if (kind === "add") return "toolDiffAdded";
  if (kind === "remove") return "toolDiffRemoved";
  return "toolDiffContext";
}

function lineNumber(value: number | undefined, width: number): string {
  return value === undefined ? " ".repeat(width) : String(value).padStart(width);
}

function highlighted(row: DiffRow, language: string | undefined, theme: Theme): string {
  const text = safeText(row.text);
  if (!text) return EMPTY_LINE;
  const code = language ? highlightCode(text, language)[0] : undefined;
  return code ?? theme.fg(sideColor(row.kind), text);
}

function codeLine(row: DiffRow, numberWidth: number, language: string | undefined, theme: Theme): string {
  const oldNo = lineNumber(row.oldLine, numberWidth);
  const newNo = lineNumber(row.newLine, numberWidth);
  const sign = row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " ";
  const gutter = theme.fg(sideColor(row.kind), `│ ${oldNo} ${newNo} ${sign} `);
  return gutter + highlighted(row, language, theme);
}

function specialLine(row: DiffRow, theme: Theme): string {
  const clean = safeText(row.text);
  const text = row.kind === "hunk" ? clean : `  ${clean}`;
  return theme.fg(row.kind === "hunk" ? "accent" : "dim", `├─ ${text}`);
}

function renderRow(row: DiffRow, width: number, numberWidth: number, language: string | undefined, theme: Theme): string {
  const line = row.kind === "hunk" || row.kind === "meta"
    ? specialLine(row, theme)
    : codeLine(row, numberWidth, language, theme);
  return truncateToWidth(line, width);
}

function maxLine(rows: DiffRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.oldLine ?? 0, row.newLine ?? 0), 0);
}

class InlineDiffView implements Component {
  // The TUI renders every component on each spinner frame; the patch never changes, so reuse the lines.
  private cache: { width: number; lines: string[] } | undefined;

  constructor(private readonly input: ViewInput) {}

  render(width: number): string[] {
    if (this.cache?.width !== width) this.cache = { width, lines: this.renderLines(width) };
    return this.cache.lines;
  }

  private renderLines(width: number): string[] {
    const parsed = parsePatch(this.input.patch);
    const shown = parsed.rows.slice(0, MAX_ROWS);
    const numberWidth = Math.max(2, String(maxLine(shown)).length);
    const language = getLanguageFromPath(this.input.filePath);
    const header = this.input.theme.fg("accent", `╭─ ✦ Hunk · +${parsed.additions} −${parsed.removals}`);
    const lines = shown.map((row) => renderRow(row, width, numberWidth, language, this.input.theme));
    if (parsed.rows.length > shown.length) lines.push(this.input.theme.fg("dim", `│ ⋯ ${parsed.rows.length - shown.length} more lines`));
    return [header, ...lines, this.input.theme.fg("borderMuted", "╰─")].map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {
    this.cache = undefined;
  }
}

export function createInlineDiffView(input: ViewInput): Component {
  return new InlineDiffView(input);
}
