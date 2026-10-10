import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Focusable, OverlayHandle, TUI } from "@earendil-works/pi-tui";

const COLUMN_WIDTH = 88;
const MIN_COLUMN_WIDTH = 40;
const FLEXIBLE_ITEM_WIDTH = 56;
const MIN_TERMINAL_WIDTH = 40;
const MIN_TERMINAL_HEIGHT = 18;
const COLUMN_MARGIN = 1;
const ITEM_GAP = 1;
const STACK_SINGLETON_KEY = Symbol.for("pi.right-overlay-stack.v2");
// Tools that show an inline dialog in the input dock. The column would cover its right side.
const DIALOG_TOOL_SUFFIX = "ask_user_question";

export type RightColumnItem = {
  minHeight: number;
  preferredHeight(width: number): number;
  preferredWidth?(): number;
  render(width: number, maxHeight: number): string[];
  handleInput?(data: string): void;
  setFocused?(focused: boolean): void;
  invalidate?(): void;
};

type ItemFactory = (tui: TUI, theme: Theme) => RightColumnItem;
type Entry = { id: string; order: number; visible: boolean; factory: ItemFactory; item?: RightColumnItem };

function allocate(entries: Entry[], width: number, height: number, activeId?: string) {
  const room = Math.max(0, height - Math.max(0, entries.length - 1) * ITEM_GAP);
  const budgets = entries.map(entry => entry.item?.minHeight ?? 0);
  let remaining = room - budgets.reduce((sum, value) => sum + value, 0);
  const priority = [...entries].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
  while (remaining > 0) {
    let changed = false;
    for (const entry of priority) {
      const index = entries.indexOf(entry);
      const target = entry.item?.preferredHeight(width) ?? budgets[index];
      if (budgets[index] >= target || remaining <= 0) continue;
      budgets[index]++;
      remaining--;
      changed = true;
    }
    if (!changed) break;
  }
  return budgets;
}

class RightColumn implements Component, Focusable {
  private _focused = false;
  private viewportHeight = MIN_TERMINAL_HEIGHT - COLUMN_MARGIN * 2;

  constructor(
    private tui: TUI, private theme: Theme,
    private entries: Map<string, Entry>, private active: () => string | undefined,
  ) {}

  get focused() { return this._focused; }
  set focused(value: boolean) {
    this._focused = value;
    this.syncFocus();
  }

  setViewportHeight(height: number) {
    this.viewportHeight = Math.max(1, height);
  }

  sync() {
    for (const entry of this.entries.values()) entry.item ??= entry.factory(this.tui, this.theme);
    this.syncFocus();
    this.tui.requestRender();
  }

  private syncFocus() {
    const activeId = this.active();
    for (const entry of this.entries.values()) entry.item?.setFocused?.(this._focused && entry.id === activeId);
  }

  handleInput(data: string) {
    const entry = this.entries.get(this.active() || "");
    if (this._focused) entry?.item?.handleInput?.(data);
  }

  invalidate() {
    for (const entry of this.entries.values()) entry.item?.invalidate?.();
  }

  render(width: number) {
    const entries = [...this.entries.values()].filter(entry => entry.visible).sort((a, b) => a.order - b.order);
    const budgets = allocate(entries, width, this.viewportHeight, this.active());
    const lines: string[] = [];
    entries.forEach((entry, index) => {
      if (index > 0) lines.push("");
      lines.push(...(entry.item?.render(width, budgets[index]) ?? []).slice(0, budgets[index]));
    });
    return lines;
  }
}

export class RightOverlayStack {
  private entries = new Map<string, Entry>();
  private component?: RightColumn;
  private handle?: OverlayHandle;
  private activeId?: string;
  private mounting = false;
  private mountEpoch = 0;
  private openDialogs = new Set<string>();
  private dialogHooks = new WeakSet<ExtensionAPI>();

  // Hide the column while a dialog tool runs. agent_end clears calls that never reported an end.
  hideDuringDialogs(pi: ExtensionAPI) {
    if (this.dialogHooks.has(pi)) return;
    this.dialogHooks.add(pi);
    pi.on("tool_execution_start", event => this.setDialog(event.toolCallId, event.toolName, true));
    pi.on("tool_execution_end", event => this.setDialog(event.toolCallId, event.toolName, false));
    pi.on("agent_end", () => {
      this.openDialogs.clear();
      this.component?.sync();
    });
  }

  private setDialog(toolCallId: string, toolName: string, open: boolean) {
    if (!toolName.endsWith(DIALOG_TOOL_SUFFIX)) return;
    if (open) this.openDialogs.add(toolCallId);
    else this.openDialogs.delete(toolCallId);
    this.component?.sync();
  }

  register(ctx: ExtensionContext, id: string, order: number, factory: ItemFactory) {
    const existing = this.entries.get(id);
    this.entries.set(id, { id, order, visible: existing?.visible ?? true, factory, item: existing?.item });
    this.ensureMounted(ctx);
    this.component?.sync();
  }

  remove(id: string) {
    this.entries.delete(id);
    if (this.activeId === id) this.unfocus(id);
    if (this.entries.size > 0) return this.component?.sync();
    this.mountEpoch++;
    this.handle?.hide();
    this.handle = undefined;
    this.component = undefined;
    this.mounting = false;
  }

  setVisible(id: string, visible: boolean) {
    const entry = this.entries.get(id);
    if (!entry || entry.visible === visible) return;
    entry.visible = visible;
    if (!visible && this.activeId === id) this.unfocus(id);
    this.component?.sync();
  }

  focus(id: string) {
    const entry = this.entries.get(id);
    if (!entry?.visible || !this.handle) return;
    this.activeId = id;
    this.handle.focus();
    this.component?.sync();
  }

  unfocus(id: string) {
    if (this.activeId !== id) return;
    this.handle?.unfocus();
    this.activeId = undefined;
    this.component?.sync();
  }

  suspend(id: string) {
    if (this.activeId === id) this.handle?.unfocus();
  }

  resume(id: string) {
    if (this.activeId === id && this.entries.get(id)?.visible) this.handle?.focus();
  }

  isFocused(id: string) {
    return this.activeId === id && Boolean(this.handle?.isFocused());
  }

  requestRender() {
    this.component?.sync();
  }

  // The column is as wide as its widest visible item needs.
  columnWidth() {
    const widths = [...this.entries.values()].filter(entry => entry.visible)
      .map(entry => entry.item?.preferredWidth?.() ?? FLEXIBLE_ITEM_WIDTH);
    return Math.min(COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, ...widths));
  }

  private ensureMounted(ctx: ExtensionContext) {
    if (this.component || this.mounting) return;
    const epoch = ++this.mountEpoch;
    this.mounting = true;
    void ctx.ui.custom<void>((tui, theme) => {
      const component = new RightColumn(tui, theme, this.entries, () => this.activeId);
      if (epoch !== this.mountEpoch || this.entries.size === 0) return component;
      this.component = component;
      component.sync();
      return component;
    }, this.overlayOptions(epoch));
  }

  private overlayOptions(epoch: number) {
    const stack = this;
    return {
      overlay: true as const,
      overlayOptions: {
        // Pi keeps this object and reads `width` on every render.
        get width() { return stack.columnWidth(); },
        anchor: "top-right" as const, maxHeight: "100%" as const,
        margin: COLUMN_MARGIN, nonCapturing: true,
        visible: (width: number, height: number) => this.updateViewport(width, height),
      },
      onHandle: (handle: OverlayHandle) => {
        if (epoch !== this.mountEpoch || this.entries.size === 0) return handle.hide();
        this.handle = handle;
        this.mounting = false;
      },
    };
  }

  private updateViewport(width: number, height: number) {
    this.component?.setViewportHeight(height - COLUMN_MARGIN * 2);
    const hasVisibleItem = [...this.entries.values()].some(entry => entry.visible);
    return this.openDialogs.size === 0 && hasVisibleItem && width >= MIN_TERMINAL_WIDTH && height >= MIN_TERMINAL_HEIGHT;
  }
}

// Separate extension loaders still share one process-wide column coordinator.
const globalStore = globalThis as unknown as Record<symbol, unknown>;
export const rightOverlayStack = (globalStore[STACK_SINGLETON_KEY] ??= new RightOverlayStack()) as RightOverlayStack;
