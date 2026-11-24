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
 * - the same contract runs on the shared resource-list page (LazyLoad) and
 *   on the Headers & Cookies page (whose match set is its filtered name
 *   rows among the section scaffolding), so the seam is real for every page
 *   family, not just the JavaScript one;
 * - on the Headers & Cookies page the walk also lands viewports deep in a
 *   long cookie list (a real scroll there, with a cookie row carrying the
 *   marker), and cancel restores the full list with its exact count.
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
      <link rel="preload" data-rocket-preload as="image" href="${url}">`;
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
      // live geometry (measured now, not seeded by row estimates): it stops
      // short of the marked row's bottom edge, so the row stays inside the
      // viewport and provably mounted even with zero overscan — the marker
      // claim is valid by construction, not windowing luck.
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
        const distance = Math.min(350, Math.floor(toRowBottom) - 4);
        list.scrollTop += distance;
        return distance;
      });
      // A real push, not a nudge: most of a row's height.
      expect(pushed).toBeGreaterThanOrEqual(40);
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

  test('the Headers & Cookies page joins the find: the query filters names, the cursor walks the matches', async ({
    extension
  }) => {
    // The filter fixture's header set gives the term `cach` exactly two
    // matches (cache-control, x-cache). The restored count below pins this
    // fixture's 10 headers + 3 page-set cookies, and cookies persist per
    // origin across suites (the shared worker-scoped profile — e.g. the
    // sticky-headings suite's 60 `fdt_deep_*`), so they are cleared first.
    await extension.browserContext.clearCookies();
    const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/header-filter', {
      bootHash: '#/headers-cookies'
    });
    try {
      const page = panel.locator('[data-fdt-page="headers-cookies"]');
      await expect(page.locator('input[type="search"]')).toBeVisible();
      /** The find-named row's header name, or null while none is named. */
      const markedName = (): Promise<string | null> =>
        panel.evaluate(
          () =>
            document.querySelector(
              '[data-fdt-page] [data-fdt-inventory-row="header"][aria-current="true"] [data-fdt-key-value-term]'
            )?.textContent ?? null
        );
      const field = page.locator('input[type="search"]');

      // The find bar's stream filters the page: the field adopts the
      // foreign query and the matched rows are the narrowed list.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'cach',
        tabId: fixture.tabId
      });
      await expect(field).toHaveValue('cach');
      await expect.poll(markedName).toBe('cache-control');
      // The cursor walks the two matches; cancel ends the find and restores.
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
      await expect.poll(markedName).toBe('x-cache');
      await relaySearchAction(extension, { action: 'previousSearchResult', tabId: fixture.tabId });
      await expect.poll(markedName).toBe('cache-control');
      await relaySearchAction(extension, { action: 'cancelSearch', tabId: fixture.tabId });
      await expect.poll(markedName).toBeNull();
      await expect(field).toHaveValue('');
      // The restore is the whole list, not a surviving row: the status line
      // names the full count again.
      await expect(page.locator('[data-fdt="headers-results-status"]')).toHaveText(
        'Showing all 13 entries'
      );
      await expect(
        page.locator('[data-fdt-inventory-row="header"]', { hasText: 'x-unique-header' })
      ).toBeVisible();
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the find walks deep into the Headers page’s cookie list: a real scroll there, a cookie row marked', async ({
    extension
  }) => {
    // Cookies persist per origin across suites (the shared worker-scoped
    // profile), so this leg clears them first: the exact counts below pin
    // this fixture's list alone.
    await extension.browserContext.clearCookies();
    const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/header-find-deep', {
      bootHash: '#/headers-cookies'
    });
    try {
      const page = panel.locator('[data-fdt-page="headers-cookies"]');
      // The capture's precondition: the full list (10 response headers + 60
      // cookie names) is there before any find action is relayed.
      const status = page.locator('[data-fdt="headers-results-status"]');
      await expect(status).toHaveText('Showing all 70 entries');
      const field = page.locator('input[type="search"]');
      /**
       * The find-named row's cookie-name token, or null while none is named.
       * A cookie row's name is its whole visible text (the term span is the
       * header rows' affordance), so the token is read from the row's text.
       */
      const markedName = (): Promise<string | null> =>
        panel.evaluate(() => {
          const row = document.querySelector(
            '[data-fdt-page] [data-fdt-inventory-row][aria-current="true"]'
          );
          return row?.textContent.match(/fdt_deep_\d{2}/)?.[0] ?? null;
        });

      // The term matches ten cookie names (fdt_deep_50..59); the first sits
      // viewports deep in the list, so landing it is a real scroll — and the
      // marked row is a cookie row, not a header one.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'fdt_deep_5',
        tabId: fixture.tabId
      });
      await expect(field).toHaveValue('fdt_deep_5');
      await expect.poll(markedName).toBe('fdt_deep_50');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'first cookie match visible' })
        .toMatchObject({ inView: true });
      // The walk steps onward through the cookie rows, each landing in view.
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
      await expect.poll(markedName).toBe('fdt_deep_51');
      await expect
        .poll(() => markedRowGeometry(panel), { message: 'next cookie match visible' })
        .toMatchObject({ inView: true });

      // Cancel restores the whole list: nothing named, field emptied, the
      // exact full count back on the status line.
      await relaySearchAction(extension, { action: 'cancelSearch', tabId: fixture.tabId });
      await expect.poll(markedName).toBeNull();
      await expect(field).toHaveValue('');
      await expect(status).toHaveText('Showing all 70 entries');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});
