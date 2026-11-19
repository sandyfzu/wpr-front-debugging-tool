/**
 * The search relay's browser suite (the search-stream contract's
 * harness-drivable share): the devtools-native find's `panelSearch` actions
 * delivered over the real wire (the exact envelope + scope contract) into
 * two simulated panel instances, each inspecting its own tab.
 *
 * Pinned here, through the panels' real runtime receivers and their boundary
 * validator:
 * - the relay tab scoping — a valid action relayed for panel B's tab is
 *   accepted by B's own store silently and dropped by the sibling panel at
 *   its foreign-window warn (master #42's two-instance approximation; the
 *   true two-devtools-windows case stays manual);
 * - the Esc/cancel, next/prev relay actions ride the same scoping (all four
 *   actions are the devtools page's relay set);
 * - a payload outside the contract (an over-limit query) is dropped at the
 *   boundary by every panel — the delivery never reaches store state.
 *
 * Not pinned here, by design: the debounce commit cadence and the immediate
 * clear are state math —
 * `state/search.test.ts` pins those semantics at the unit tier, and moving
 * them to this tier would require either a shipped search UI or an
 * app-side test hook (both out of scope here).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture, relaySearchAction, type InspectedPanel } from '../helpers/panel-data';

/** The foreign-scoping drop's own line (scoping fact, the unit tier's twin). */
const FOREIGN_DROP = 'Search action dropped';

/** The boundary drop's line (the contract-violating delivery). */
const BOUNDARY_DROP = 'Dropped an invalid panelSearch message';

/** The panel page's warn lines that name a search intake decision. */
function collectWarns(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') lines.push(message.text());
  });
  return lines;
}

test.describe('panelSearch relay (two instances, one wire)', () => {
  test('deliveries scope to the relaying tab; the sibling panel drops them at warn', async ({
    extension
  }) => {
    const own: InspectedPanel = await openPanelForFixture(extension, '/pipeline/markers.html');
    // A second panel on ANOTHER tab ids — the two-instance approximation.
    const sibling: InspectedPanel = await openPanelForFixture(extension, '/pipeline/plain.html');
    try {
      const ownWarns = collectWarns(own.panel);
      const siblingWarns = collectWarns(sibling.panel);

      // The four relay actions, all scoped to the SECOND panel's tab:
      // its store accepts each silently; the first panel drops all at warn.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'cached',
        tabId: sibling.fixture.tabId
      });
      await relaySearchAction(extension, { action: 'cancelSearch', tabId: sibling.fixture.tabId });
      await relaySearchAction(extension, {
        action: 'nextSearchResult',
        tabId: sibling.fixture.tabId
      });
      await relaySearchAction(extension, {
        action: 'previousSearchResult',
        tabId: sibling.fixture.tabId
      });

      // The sibling's silence is the acceptance observable: no warn exists
      // for its own scope (the drop paths are the only search warn lines).
      await expect
        .poll(async () => await sibling.panel.evaluate((): number => Date.now()))
        .toBeGreaterThan(0);
      await sibling.panel.waitForTimeout(400);
      expect(
        siblingWarns.filter((line) => line.includes(FOREIGN_DROP) || line.includes(BOUNDARY_DROP)),
        `the scoped panel logged no search warns: ${JSON.stringify(siblingWarns)}`
      ).toEqual([]);

      expect(ownWarns.filter((line) => line.includes(FOREIGN_DROP))).toHaveLength(4);
      // The scoping fact names the delivered id against the inspected one.
      for (const line of ownWarns.filter((line) => line.includes(FOREIGN_DROP))) {
        expect(line).toContain(String(sibling.fixture.tabId));
        expect(line).toContain(String(own.fixture.tabId));
      }
      expect(
        ownWarns.filter((line) => line.includes(BOUNDARY_DROP)),
        'the valid relay payloads must clear the boundary validator'
      ).toEqual([]);
    } finally {
      await own.panel.close();
      await own.fixture.page.close();
      await sibling.panel.close();
      await sibling.fixture.page.close();
    }
  });

  test('a payload outside the contract is dropped at the boundary on both panels', async ({
    extension
  }) => {
    const own: InspectedPanel = await openPanelForFixture(extension, '/pipeline/markers.html');
    const sibling: InspectedPanel = await openPanelForFixture(extension, '/pipeline/plain.html');
    try {
      const ownWarns = collectWarns(own.panel);
      const siblingWarns = collectWarns(sibling.panel);

      // Over the validator's 200-char query limit: null at the boundary.
      await relaySearchAction(extension, {
        action: 'performSearch',
        query: 'x'.repeat(201),
        tabId: sibling.fixture.tabId
      });
      await own.panel.waitForTimeout(400);
      await sibling.panel.waitForTimeout(400);

      expect(ownWarns.filter((line) => line.includes(BOUNDARY_DROP))).toHaveLength(1);
      expect(siblingWarns.filter((line) => line.includes(BOUNDARY_DROP))).toHaveLength(1);
      // The scoping never reached the store: no foreign-window warn rides it.
      expect(ownWarns.filter((line) => line.includes(FOREIGN_DROP))).toEqual([]);
      expect(siblingWarns.filter((line) => line.includes(FOREIGN_DROP))).toEqual([]);
    } finally {
      await own.panel.close();
      await own.fixture.page.close();
      await sibling.panel.close();
      await sibling.fixture.page.close();
    }
  });
});
