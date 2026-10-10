// Drive a macOS app through the Accessibility API (System Events, JXA).
// Usage:
//   osascript -l JavaScript ax.js <process> windows
//   osascript -l JavaScript ax.js <process> dump  [window] [filter]
//   osascript -l JavaScript ax.js <process> press <index> [window]
//   osascript -l JavaScript ax.js <process> set   <index> <value> [window]
// <window> is a 0-based index or a window-title substring (default 0).
// <index> comes from the latest dump of the same window. Dump again after
// any action, because indexes shift when the UI changes.

function run(argv) {
  const [proc, cmd, ...rest] = argv;
  if (!proc || !cmd) return "usage: ax.js <process> windows|dump|press|set ...";
  const se = Application("System Events");
  if (!se.processes.whose({ name: proc }).length) return `error: process "${proc}" not running. Launch it with open -a first.`;
  const p = se.processes.byName(proc);
  const ws = p.windows();
  if (cmd === "windows") return ws.map((w, i) => `${i}\t${safe(() => w.name())}\t${box(w)}`).join("\n") || "no windows";

  const winArg = cmd === "set" ? rest[2] : cmd === "dump" ? rest[0] : rest[1];
  const w = pickWindow(ws, winArg);
  if (!w) return `error: window "${winArg ?? 0}" not found. Run: ax.js "${proc}" windows`;
  const els = w.entireContents();

  if (cmd === "dump") {
    const filter = (rest[1] || "").toLowerCase();
    return els.map((e, i) => line(e, i)).filter(l => l && (!filter || l.toLowerCase().includes(filter))).join("\n");
  }
  const el = /^\d+$/.test(rest[0] || "") && els[Number(rest[0])];
  if (!el) return `error: element ${rest[0]} not found. Dump again; the UI changed.`;
  if (cmd === "press") {
    const acts = safe(() => el.actions().map(a => a.name()), []);
    if (!acts.includes("AXPress")) return `error: element ${rest[0]} has no AXPress (actions: ${acts.join(",") || "none"}). Use click-at coordinates instead.`;
    el.actions.byName("AXPress").perform();
    return `pressed ${line(el, rest[0])}`;
  }
  if (cmd === "set") {
    el.focused = true;
    el.value = rest[1];
    return `set ${line(el, rest[0])}`;
  }
  return `error: unknown command "${cmd}"`;
}

function pickWindow(ws, arg) {
  if (arg === undefined || /^\d+$/.test(arg)) return ws[Number(arg || 0)];
  return ws.find(w => safe(() => w.name(), "").includes(arg));
}

function line(e, i) {
  const role = safe(() => e.role(), "");
  if (!role) return "";
  const attr = name => safe(() => e.attributes.byName(name).value(), "");
  const text = [attr("AXTitle"), attr("AXDescription"), attr("AXIdentifier"), String(safe(() => e.value(), "") ?? "")]
    .filter(Boolean).map(String).map(s => s.replace(/\s+/g, " ").slice(0, 80)).join(" | ");
  return `${i}\t${role}\t${text}\t${box(e)}`;
}

function box(e) {
  const p = safe(() => e.position(), null), s = safe(() => e.size(), null);
  return p && s ? `@${p[0]},${p[1]} ${s[0]}x${s[1]}` : "";
}

function safe(f, fallback) {
  try { return f(); } catch (_) { return fallback; }
}
