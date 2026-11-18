# Layout check

Find content that runs past its box at phone, tablet, and desktop widths: an input under the next button, a cut-off button, tabs wider than their card, an avatar under another control, a page that scrolls sideways.

Use it after a UI change that touches layout, toolbars, buttons, or text that can grow, and before taking PR screenshots.

Goal → no element runs past its parent's content box. Check → `scripts/layout-scan.js` at each width. Pass signal → `"pageScrollsSideways": false` and `"overflow": []` on every page and width.

## Steps

1. Run the app and sign in as the project's agent account (see the project's `AGENTS.md`).
2. List the screens: every top-level route, plus states that change layout (tabs, view switches such as List and Cards, open popovers and dialogs, empty and long data).
3. For each screen, run one `agent_browser` `batch --bail`:
   - `open <url>`, then `wait --fn` for a selector that shows content has loaded (not `--load networkidle`: dev servers keep a socket open, so it times out).
   - Run the scan file in the page with `eval --stdin` (pass the file's text as stdin; never join its lines, because a `//` comment then hides the rest of the code).
   - For each width in 320, 390, 768, 1024, 1280: `set viewport <w> 800`, `wait 500`, `eval __layoutScan()`.
   - `open` clears `__layoutScan`; run the file again after each navigation.
4. Take a screenshot of each hit at its width before you fix it. A hit of a few pixels inside the parent's padding can be invisible; the scan ignores 2 px or less (`__layoutScan(0)` shows all).
5. Fix the cause (table below), then run the same batch again until it passes.

The scan checks the right edge only (left-to-right pages). It does not check vertical fit; for a view that must fit one screen, also compare `document.scrollingElement.scrollHeight` with `innerHeight`.

## Common causes

| Symptom | Cause | Fix |
|---|---|---|
| Input runs under the next button | A flex input keeps `min-width: auto`, its default size | `min-width: 0` on the input (and `text-overflow: ellipsis` for the placeholder) |
| Last button cut off at the card's edge | A flex row of `white-space: nowrap` buttons with no wrap | `flex-wrap: wrap` on the row |
| Tabs or segmented control wider than the card | `width: fit-content` with `nowrap` labels | Under a breakpoint: full width, `flex: 1 1 auto; min-width: 0; white-space: normal` on each tab |
| Avatar or icon slides under the next control | Its parent has `min-width: 0` and shrinks below the fixed-size child | Give the parent a `min-width` equal to the child's width |
| Overflow only between two breakpoints | The breakpoint was guessed | Measure the width one row needs (sum of item widths, gaps, padding) and set the breakpoint above it |
| A sideways-scrolling row hides items | Nothing shows there is more | Right-edge fade: `mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent)` plus `padding-right: 28px` |

Do not hide a hit with `overflow: hidden` on the container: the content is then cut off, not fixed.
