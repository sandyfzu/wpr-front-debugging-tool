/**
 * The panel-wide find's browser suite: the search actions delivered over the
 * real wire (the `panelSearch` envelope the devtools page relays) into a
 * panel showing a real captured inventory, with the pages' own rendering
 * under it:
 *
 * - a `performSearch` delivery commits and names the first match the current
 *   row (marker + `aria-current`), and the in-page search field adopts the
 *   foreign query;
 * - a next/previous step lands the cursor's row fully visible in the list
 *   (the real scroll), and both wraps travel the whole set — first→last on
 *   previous, last→first on next;
 * - user scrolling afterwards stays where the user put it (no snap back to
 *   the marked row), while the marker stays with the cursor's row;
 * - a `cancelSearch` delivery ends the find: no row is named, the field
 *   empties;
 * - the same contract runs on the shared resource-list page (Lazyload), so
 *   the seam is real for both page families, not just the JavaScript one.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture, relaySearchAction } from '../helpers/panel-data';

/** Rows in the generated inventory: a few viewports of each list page. */
const ROW_COUNT = 48;

/**
 * Build inert inventories whose URLs segment the rows, so a find match can
 * land several viewports deep and the scroll-to-match is a real movement.
 */
function navInventory(): string {
  const rows = Array.from({ length: ROW_COUNT }, (_, index) => {
    const url = `https://nav.test/segment${String(Math.floor(index / 12))}/deep-${String(
      index
    ).padStart(2, '0')}-part.js`;
    return `<script type="rocketlazyloadscript" data-rocket-src="${url}"></script>
      <img data-lazy-src="${url}" alt="Fixture ${String(index)}">
      <link data-rocket-preload as="image" href="${url}">`;
  });
  return `<!doctype html><html lang="en"><head><title>Search nav fixture</title></head>
    <body><h1>Search nav fixture</h1>${rows.join('')}</body></html>`;
}

/**
 * The marked row's own name token (the URL's `deep-NN` part) or null while no
 * row is named — the page's route nav also carries `aria-current`, so the
 * row selector pins the listitem shape the pages give their rows.
 */
function markedRowName(panel: Page): Promise<string | null> {
  return panel.evaluate(() => {
    const row = document.querySelector('[data-fdt-page] [role="listitem"][aria-current="true"]');
    if (row === null) return null;
    // The row's visible text carries the URL's `deep-NN` segment; a render
    // through the row's own tokens cannot miss it while it is named.
    return row.textContent.match(/deep-\d{2}/)?.[0] ?? null;
  });
}

/**
 * Whether the marked row is fully inside its list's viewport. Read against
 * the real scroller geometry (the virtual list renders only the window, so a
 * useful mount is proof of the scroll, not just of presence).
 */
function markedRowGeometry(panel: Page): Promise<{ inView: boolean; scrollTop: number } | null> {
  return panel.evaluate(() => {
    const list = document.querySelector('[data-fdt-page] [role="list"]');
    const row = list?.querySelector('[aria-current="true"]');
    if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) return null;
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    return {
      inView: rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom + 1,
      scrollTop: list.scrollTop
    };
  });
}

test.describe('panel find navigation (wire-delivered)', () => {
  test('commits, wraps both ways, scrolls to the match, clears on cancel — on both page families', async ({
    extension
  }) => {
    await extension.browserContext.route('**/pipeline/search-nav.html*', async (route) => {
      await route.fulfill({ contentType: 'text/html', body: navInventory() });
    });
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/search-nav.html', {
      bootHash: '#/javascript'
    });
    try {
      const page = panel.locator('[data-fdt-page="javascript"]');
      // The fixture's real capture is the precondition: the captured list is
      // there (and exactly sized) before any find action is relayed.
      await expect(page.locator('[data-fdt="script-total"]')).toHaveText('48 scripts');
      const field = panel.locator('input[type="search"]');

      // --- The JavaScript page: one find over the wire lands the first match.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'deep-30',
        tabId: fixture.tabId
      });
      await expect.poll(() => markedRowName(panel)).toBe('deep-30');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'deep-30 visible' })
        .toMatchObject({ inView: true });
      // A foreign find is the one query: the page's field adopts it.
      await expect(field).toHaveValue('deep-30');

      // The segmented term matches every row, starting at the first one.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'nav.test',
        tabId: fixture.tabId
      });
      await expect.poll(() => markedRowName(panel)).toBe('deep-00');

      // Previous from the first match wraps to the last row of the set —
      // several viewports down, so the panel must actually scroll there.
      await relaySearchAction(extension, {
        action: 'previousSearchResult',
        tabId: fixture.tabId
      });
      const lastName = `deep-${String(ROW_COUNT - 1).padStart(2, '0')}`;
      await expect.poll(() => markedRowName(panel)).toBe(lastName);
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'last row visible after prev-wrap' })
        .toMatchObject({ inView: true });

      // Next wraps back to the first match and, one more next, steps onward.
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
      await expect.poll(() => markedRowName(panel)).toBe('deep-00');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'first row visible after next-wrap' })
        .toMatchObject({ inView: true });
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
      await expect.poll(() => markedRowName(panel)).toBe('deep-01');

      // User scrolling stays the user's own. The push is bounded by the
      // live viewport geometry (measured now, not seeded by row estimates),
      // so the marked row provably stays mounted even with zero overscan —
      // the marker claim is valid by construction, not windowing luck.
      const base = await panel.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
        if (list === null) throw new Error('list missing for the scroll probe');
        return list.scrollTop;
      });
      const pushed = await panel.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
        const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
        if (!(list instanceof HTMLElement) || !(row instanceof HTMLElement)) {
          throw new Error('list or marked row missing for the scroll probe');
        }
        const toRowBottom = row.getBoundingClientRect().bottom - list.getBoundingClientRect().top;
        const distance = Math.min(350, Math.max(120, list.clientHeight - toRowBottom - 4));
        list.scrollTop += distance;
        return distance;
      });
      await panel.waitForTimeout(350);
      const pushedTop = await panel.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
        return list?.scrollTop ?? -1;
      });
      expect(
        pushedTop,
        `push ${String(pushed)}px from ${String(base)} must survive the beat`
      ).toBeGreaterThanOrEqual(base + Math.floor(pushed / 2));
      expect(await markedRowName(panel)).toBe('deep-01');
      // A deep push cannot name the row in the DOM (it unmounts) — it only
      // proves the panel never re-scrolls for the live find: the position
      // still holds after another beat.
      await panel.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
        if (list === null) throw new Error('list missing for the scroll probe');
        list.scrollTop = list.scrollHeight;
      });
      await panel.waitForTimeout(350);
      const deepTop = await panel.evaluate(() => {
        const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
        return list?.scrollTop ?? -1;
      });
      expect(deepTop).toBeGreaterThan(pushedTop);

      // The cancel ends the find completely: nothing named, field emptied.
      await relaySearchAction(extension, { action: 'cancelSearch', tabId: fixture.tabId });
      await expect.poll(() => markedRowName(panel)).toBeNull();
      await expect(field).toHaveValue('');

      // --- The Lazyload page (the other page family, one shared body).
      await panel.evaluate(() => {
        location.hash = '#/lazyload';
      });
      await expect(panel.locator('[data-fdt-page="lazyload"]')).toBeVisible();
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'deep-20',
        tabId: fixture.tabId
      });
      await expect.poll(() => markedRowName(panel)).toBe('deep-20');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'lazyload match visible' })
        .toMatchObject({ inView: true });
      await relaySearchAction(extension, { action: 'cancelSearch', tabId: fixture.tabId });
      await expect.poll(() => markedRowName(panel)).toBeNull();
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});
