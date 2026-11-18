// Layout scan: lists visible elements that run past the right edge of their parent's content box,
// and says whether the page scrolls sideways. Run it in the page with `agent_browser eval --stdin`.
// It also defines window.__layoutScan, so a check at another width needs only `__layoutScan()`.
// Navigation clears it; run this file again after each `open`.
(() => {
  const label = (el) => el.tagName.toLowerCase()
    + [...el.classList].filter((c) => !/^(svelte|css|jsx)-/.test(c)).map((c) => '.' + c).join('')
    + ` "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;

  // Overflow in px past the parent's content box, or 0 when the element may overflow on purpose.
  const overflow = (el) => {
    const parent = el.parentElement;
    if (!parent || !el.getClientRects().length || el.closest('[popover]:not(:popover-open)')) return 0;
    const style = getComputedStyle(el), ps = getComputedStyle(parent);
    if (style.position === 'fixed' || style.position === 'absolute' || ps.display === 'contents') return 0;
    if (/auto|scroll/.test(ps.overflowX)) return 0; // a scroll container overflows on purpose
    const box = el.getBoundingClientRect(), pbox = parent.getBoundingClientRect();
    if (!box.width || !pbox.width) return 0;
    return box.right - (pbox.right - parseFloat(ps.paddingRight) - parseFloat(ps.borderRightWidth));
  };

  window.__layoutScan = (tolerance = 2) => {
    const hits = new Map();
    for (const el of document.querySelectorAll('body *')) {
      const over = overflow(el);
      if (over <= tolerance) continue;
      const key = label(el), hit = hits.get(key) ?? { el: key, overPx: 0, count: 0 };
      hit.count += 1;
      hit.overPx = Math.max(hit.overPx, Math.round(over));
      hits.set(key, hit);
    }
    return JSON.stringify({
      width: innerWidth,
      pageScrollsSideways: document.documentElement.scrollWidth > innerWidth,
      overflow: [...hits.values()].slice(0, 15),
    });
  };
  return window.__layoutScan();
})();
