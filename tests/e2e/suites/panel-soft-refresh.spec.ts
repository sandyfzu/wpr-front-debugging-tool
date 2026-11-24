/**
 * The soft refresh over the real push (the shell's in-place refresh
 * contract, browser twin): a navigation on the inspected tab refetches in
 * place — the content script's sender-tab-checked `notifyPanelReload`
 * starts a refresh flight, the machine swaps the data under the same DOM,
 * and route and focus survive it (the render-level contract's browser
 * twin). The scroll leg shrinks the window to the 90 px band, where the
 * Detections body genuinely overflows the content region (asserted before
 * the swap).
 *
 * The second test is the master-#42 approximation's transport face: with two
 * simulated panel instances (each inspecting its own tab), the OTHER tab's
 * navigation delivers its push to both panels' receivers and only its own
 * panel's scope accepts it — the sibling's page keeps its answers verbatim
 * (no reload and no refetch; its freshness stamp never reset). The real
 * cross-window topology (two DevTools windows) stays manual.
 *
 * Probe-recorded harness fact (2026-10-14, three runs): at a NORMAL viewport
 * the push flight preserves the focused rail anchor exactly (no focusout at
 * all); inside the 90 px degenerate band the rail's own overflow re-slicing
 * recreates row nodes on data-swap relayouts, so the focus leg is asserted
 * at the normal viewport and the scroll leg at the band — each fact where it
 * is genuinely observable. The focus-loss at the band is the band's reslice
 * morphing (panel-nav's rail surface), not the refresh contract.
 */
import type { Page } from '@playwright/test';
import { expect, test, ORIGIN_A } from '../helpers/extension';
import { openPanelForFixture, type InspectedPanel } from '../helpers/panel-data';

/** The route body's single heading (the ready body's first observable). */
function h1(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
  );
}

/** The top bar's rendered answers (the full text of the segments). */
function barText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null => document.querySelector('[data-fdt="panel-top-bar"]')?.textContent ?? null
  );
}

/** Mark the page's JS realm so "no frame reload" is readable after the flight. */
function stampRealm(page: Page): Promise<number> {
  return page.evaluate((): number => {
    const token = Date.now() % 1_000_000;
    (window as { __e2eRealm?: number }).__e2eRealm = token;
    return token;
  });
}

/** True when the realm token is still the same number (the realm is untouched). */
function realmSustained(page: Page, expected: number): Promise<boolean> {
  return page.evaluate(
    (value: number): boolean =>
      (window as { __e2eRealm?: number }).__e2eRealm === value &&
      document.querySelector('[data-fdt="panel-shell"]') !== null,
    expected
  );
}

test.describe('panel soft refresh (the real push)', () => {
  test('refetches in place: route and focus survive the fixture navigation', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');

      // Route: a real deep link (the router reads the hashchange) — the same
      // surface a bookmarked panel link rides; the top bar belongs to the shell.
      await panel.evaluate(() => {
        location.hash = '#/lazyload';
      });
      await expect.poll(async () => await h1(panel)).toBe('LazyLoad');
      expect(await barText(panel)).toContain('WP Rocket 3.20.1');

      // The realm marker + focused rail anchor: state the swap must not touch
      // (a focused anchor deliberately NOT the active route — the render lore).
      const realm = await stampRealm(panel);
      const focusTake = await panel.evaluate((): boolean => {
        // Scoped to the nav: the top bar's answers also link #/detections.
        const row = document.querySelector<HTMLElement>(
          '[data-fdt="panel-nav"] a[href="#/detections"]'
        );
        if (row === null) throw new Error('the detections rail row vanished before the refresh');
        row.focus();
        (window as { __focusedRow?: HTMLElement }).__focusedRow = row;
        return document.activeElement === row;
      });
      expect(focusTake).toBe(true);

      // The fixture tab navigates for real: the content script recaptures,
      // pushes `notifyPanelReload` (sender = its own tab), the flight runs.
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, {
        waitUntil: 'load'
      });

      // The data swap is the headline: the present answer flips to the new
      // page's absence state — nothing injected, the content script's actual
      // detection output recomputed over the new page.
      await expect
        .poll(async () => await barText(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toContain('Not detected');

      // In place: same realm (no frame-level reload), same route + body, and
      // the rail anchor held its focus through the ready→refreshing→ready walk.
      expect(await realmSustained(panel, realm)).toBe(true);
      expect(
        await panel.evaluate((): { hash: string; h1: string | null } => ({
          hash: location.hash,
          h1: document.querySelector('[data-fdt-page] h1')?.textContent ?? null
        }))
      ).toEqual({ hash: '#/lazyload', h1: 'LazyLoad' });
      expect(
        await panel.evaluate(
          (): boolean =>
            document.activeElement === (window as { __focusedRow?: HTMLElement }).__focusedRow
        )
      ).toBe(true);
      expect(await barText(panel)).not.toContain('WP Rocket 3.20.1');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the scrolled position survives the swap (the 90 px band, a real scroll)', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');

      // At the 90 px band the Detections body overflows the content
      // region, so a real scroll offset exists to survive the swap.
      await panel.setViewportSize({ width: 700, height: 90 });
      await panel.waitForTimeout(200);
      const precondition = await panel.evaluate((): boolean => {
        const main = document.querySelector<HTMLElement>('[data-fdt="panel-content"]');
        if (main === null) throw new Error('the content region vanished before the refresh');
        main.scrollTop = 3;
        return main.scrollHeight > main.clientHeight && main.scrollTop === 3;
      });
      expect(precondition, 'the content region must really scroll before the swap').toBe(true);
      const realm = await stampRealm(panel);

      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, {
        waitUntil: 'load'
      });
      await expect
        .poll(async () => await barText(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toContain('Not detected');

      expect(await realmSustained(panel, realm)).toBe(true);
      expect(
        await panel.evaluate((): number => {
          const main = document.querySelector<HTMLElement>('[data-fdt="panel-content"]');
          if (main === null) throw new Error('the content region vanished after the refresh');
          return main.scrollTop;
        })
      ).toBe(3);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('another panel’s tab navigation never drives the sibling panel', async ({ extension }) => {
    const own: InspectedPanel = await openPanelForFixture(extension, '/pipeline/markers.html');
    const sibling: InspectedPanel = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(own.panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');
      await expect
        .poll(async () => await h1(sibling.panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');

      const ownRealm = await stampRealm(own.panel);
      const ownBar = await barText(own.panel);
      expect(ownBar).toContain('WP Rocket 3.20.1');
      expect(await barText(sibling.panel)).toContain('WP Rocket 3.20.1');

      // The SIBLING's tab navigates: both panels receive the push (runtime
      // broadcasts reach every extension listener), and only the sibling's
      // scope (`sender.tabId === its inspected tab`) drives its flight.
      await sibling.fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, {
        waitUntil: 'load'
      });
      await expect
        .poll(async () => await barText(sibling.panel), {
          timeout: 15_000,
          intervals: [50, 100, 250]
        })
        .toContain('Not detected');

      // The OWN panel's page: the same JS realm (no reload), the same top bar
      // answers verbatim — its freshness stamp never reset to a fresh settle,
      // which a drive-by refresh flight would have rewritten.
      expect(await realmSustained(own.panel, ownRealm)).toBe(true);
      await expect.poll(async () => await barText(own.panel)).toBe(ownBar);
    } finally {
      await own.panel.close();
      await own.fixture.page.close();
      await sibling.panel.close();
      await sibling.fixture.page.close();
    }
  });
});
