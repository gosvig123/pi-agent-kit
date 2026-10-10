export type DiffKind = "add" | "remove" | "context" | "hunk" | "meta";

export type DiffRow = {
  kind: DiffKind;
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type ParsedPatch = {
  rows: DiffRow[];
  additions: number;
  removals: number;
};

type Cursor = { oldLine: number; newLine: number; active: boolean };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function startHunk(line: string, cursor: Cursor): DiffRow | undefined {
  const match = HUNK_HEADER.exec(line);
  if (!match) return undefined;
  cursor.oldLine = Number(match[1]);
  cursor.newLine = Number(match[2]);
  cursor.active = true;
  return { kind: "hunk", text: line };
}

function changedRow(line: string, cursor: Cursor): DiffRow | undefined {
  if (line.startsWith("+")) {
    return { kind: "add", text: line.slice(1), newLine: cursor.newLine++ };
  }
  if (line.startsWith("-")) {
    return { kind: "remove", text: line.slice(1), oldLine: cursor.oldLine++ };
  }
  return undefined;
}

function contextRow(line: string, cursor: Cursor): DiffRow | undefined {
  if (!line.startsWith(" ")) return undefined;
  return {
    kind: "context",
    text: line.slice(1),
    oldLine: cursor.oldLine++,
    newLine: cursor.newLine++,
  };
}

function parseLine(line: string, cursor: Cursor): DiffRow | undefined {
  const hunk = startHunk(line, cursor);
  if (hunk) return hunk;
  if (!cursor.active || line.startsWith("diff ") || line.startsWith("index ")) return undefined;
  if (line.startsWith("\\ No newline")) return { kind: "meta", text: line };
  return changedRow(line, cursor) ?? contextRow(line, cursor);
}

export function parsePatch(patch: string): ParsedPatch {
  const cursor: Cursor = { oldLine: 0, newLine: 0, active: false };
  const rows = patch.replaceAll("\r\n", "\n").split("\n").flatMap((line) => {
    const row = parseLine(line, cursor);
    return row ? [row] : [];
  });
  return {
    rows,
    additions: rows.filter((row) => row.kind === "add").length,
    removals: rows.filter((row) => row.kind === "remove").length,
  };
}
