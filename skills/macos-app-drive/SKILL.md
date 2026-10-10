---
name: macos-app-drive
description: Drive and check native macOS app UI (SwiftUI, AppKit, Electron, menu bar apps) through the Accessibility API, then capture one window as proof. Use when verifying a local app build; clicking buttons, menus, or hotkeys in a desktop app; reading its on-screen text; or taking a window screenshot to show a UI fix. Not for web pages (use the browser tools).
---

# macOS App Drive

Drive the real app, read the result, and show a window screenshot as evidence.
Scripts are in `scripts/`; run them with paths relative to this skill directory.

## Loop

1. **Run the right build.** After a rebuild, quit the old process and open the new `.app`.
   Check that the running binary is the fresh one:
   `ps -o lstart=,command= -p "$(pgrep -x <Process>)"` and compare with the build time
   (`stat -f %Sm <path>.app/Contents/MacOS/<binary>`). A stale process is the most common false result.
2. **Find the window.** `osascript -l JavaScript scripts/ax.js <Process> windows`
   The process name is the name System Events shows. It can differ from the app name
   (for example, a dev Electron build shows as `Electron`).
3. **Find the element.** `osascript -l JavaScript scripts/ax.js <Process> dump [window] [filter]`
   Each line is `index  role  title|description|identifier|value  @x,y wxh`.
   Always pass a filter (`AXButton`, a label word) on large windows. A full dump can take several seconds.
4. **Act.**
   - Press: `ax.js <Process> press <index> [window]` (needs `AXPress`).
   - Set text: `ax.js <Process> set <index> "<text>" [window]`.
   - Menu: `osascript -e 'tell application "System Events" to tell process "<P>" to click menu item "<Item>" of menu "<Menu>" of menu bar 1'`
   - Hotkey: `osascript -e 'tell application "System Events" to key code 49 using {shift down}'` (49 = Space).
   - Frontmost first when keys or clicks go to the app: `tell process "<P>" to set frontmost to true`.
   - No AXPress, or a custom-drawn control: click the element center from the dump:
     `osascript -e 'tell application "System Events" to click at {x, y}'`.
     If the app ignores that, post a real mouse event with Swift `CGEvent` (`leftMouseDown`/`leftMouseUp` at the point).
5. **Wait, then dump again.** UI updates are async. Sleep 0.5–2 s, then dump again. Indexes shift after any UI change;
   never reuse an old index.
6. **Capture proof.** `id=$(swift scripts/window-id.swift <Owner> [title] | head -1 | cut -f1)`, then
   `screencapture -x -l "$id" /tmp/<app>-<state>.png`. Read the PNG and describe what it shows.
   Capture one window, not the full screen: the full screen can show private content from other apps.

## Electron apps

If the app accepts `--remote-debugging-port`, CDP is faster than Accessibility:
`open -a <App>.app --args --remote-debugging-port=9229`, then check `curl -s http://127.0.0.1:9229/json/version`.
Use Accessibility for native parts (menu bar, tray, permission dialogs).

## Failures and recovery

| Error | Cause | Recovery |
|---|---|---|
| `osascript is not allowed assistive access` | The terminal host (cmux, Terminal, Pi host) has no Accessibility permission | Ask the user to enable it in System Settings → Privacy & Security → Accessibility, then restart the host. Do not try to get around TCC. |
| `Can't get window 1 … Invalid index` | The app has no window yet, or it is a menu bar app | Wait and run `windows` again; for menu bar apps, click `menu bar item 1 of menu bar 2` first. |
| `could not create image from window` | Stale window id, window off-screen, or no Screen Recording permission | Get the id again with `window-id.swift`; if titles are empty, ask the user to grant Screen Recording to the host. |
| `window-id.swift` shows empty titles | No Screen Recording permission | Select by owner and size, or ask for the permission. |
| `Can't get object (-1728)` | Element or process went away during the call | Check the process is running and dump again. |

## Boundaries

- Do not press controls that send, delete, pay, publish, or grant permissions without explicit user approval.
- Never type passwords, 2FA codes, or payment data.
- Quit only apps that this task opened. Use `quit saving no` only for documents this task created.
- Keep screenshots in `/tmp`. Do not attach them anywhere outside the conversation.
