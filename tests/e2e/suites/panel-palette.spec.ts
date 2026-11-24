/**
 * The palette's data-path suite: with the panel READY through the devtools
 * contract, the palette jumps the shell to every page and runs one action
 * whose effect is observable in the data.
 *
 * The chord layer is NOT asserted here — `panel-shortcuts` pins open/Esc,
 * the overlay chords and the hint-matches-binding rows — and a single jump
 * (the launcher at overflow heights) is `panel-nav`'s. The reception this
 * suite adds: every registry page reachable from the palette on real data,
 * the shortcuts overlay listing the advertised set, the export row's data
 * gate open, and the Reload
 * action's refresh flight re-settling the top bar's freshness answer through
 * the real machine.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/* The overlay's advertised row count repeats the shortcut table's committed
 * constant — test literals pin behavior; importing the panel module would
 * drag its logger graph into the spec's node context (like the cold-start
 * spec's mark-name rule below). */
const OVERLAY_ROW_COUNT = 11;

/** The route bodies' own heading, in registry naming (the jump's landing). */
const JUMPS: ReadonlyArray<{ readonly ticker: string; readonly heading: string }> = [
  { ticker: 'javascript', heading: 'JavaScript' },
  { ticker: 'lazyload', heading: 'LazyLoad' },
  { ticker: 'preloaded', heading: 'Preloaded Resources' },
  { ticker: 'undefined', heading: 'Undefined References' },
  { ticker: 'detections', heading: 'Detections' }
];

/** The route body's single heading. */
function h1(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
  );
}

/** The top bar's rendered answers. */
function barText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null => document.querySelector('[data-fdt="panel-top-bar"]')?.textContent ?? null
  );
}

/**
 * The palette row Enter would run: the field's own
 * `aria-activedescendant` target (the highlight the user sees just above
 * the Enter press). Reading the real attribute keeps the run deterministic
 * — the matcher re-arms the highlight one settle-tick after ranking, and a
 * blind wait turns that into a guess.
 *
 * @param panel The panel page with the palette open.
 */
async function highlightedRow(panel: Page): Promise<string | null> {
  return await panel.evaluate((): string | null => {
    const field = document.querySelector<HTMLElement>('[data-fdt="palette-input"]');
    const targetId = field?.getAttribute('aria-activedescendant') ?? null;
    if (field === null || targetId === null) return null;
    const row = document.getElementById(targetId);
    if (row === null) return null;
    // The row's label span rides beside the hint slot.
    return (
      [...row.querySelectorAll<HTMLElement>('span')].find((node) => !node.hasAttribute('data-fdt'))
        ?.textContent ?? null
    );
  });
}

/**
 * Open the palette, run the row whose highlighted state is visible: the
 * user-visible sequence, decided (never a timing guess).
 *
 * @param panel The panel page.
 * @param query The query the row's label/keywords answer.
 * @param expectedRow The label the highlight must carry before Enter.
 */
async function runTopRow(panel: Page, query: string, expectedRow: string): Promise<void> {
  await panel.keyboard.press('ControlOrMeta+k');
  const field = panel.getByRole('combobox');
  await expect(field).toBeVisible();
  await field.fill(query);
  // The ranked highlight re-arms one settle-tick after the ranking; the
  // expected row becoming the highlight is the deterministic arm point.
  await expect
    .poll(async () => await highlightedRow(panel), { timeout: 5_000, intervals: [25, 50, 100] })
    .toBe(expectedRow);
  await panel.keyboard.press('Enter');
  await expect(field).toHaveCount(0);
}

/** The freshness detail's capture stamp, as the top bar renders it. */
function captureStamp(page: Page): Promise<string | null> {
  return page.evaluate((): string | null => {
    const bar = document.querySelector<HTMLElement>('[data-fdt="panel-top-bar"]');
    if (bar === null) return null;
    const detail = [...bar.querySelectorAll<HTMLElement>('span')].find((node) =>
      node.textContent.startsWith('Page data fetched at')
    );
    if (detail === undefined) return null;
    const match = /Page data fetched at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC/.exec(
      detail.textContent
    );
    return match?.[1] ?? null;
  });
}

test.describe('command palette over the data path', () => {
  test('jumps to every page; the export row’s gate is open', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');

      // Every page: type the row's distinctive fragment and run the row the
      // highlight names (the deterministic arm point); the palette unmounts
      // on run and the route body lands. One assert per arm — the same
      // ranker cadence panel-nav's palette leg waits for.
      for (const jump of JUMPS) {
        await runTopRow(panel, jump.ticker, jump.heading);
        await expect.poll(async () => await h1(panel)).toBe(jump.heading);
      }

      // One open to read the row states: the export row is runnable thanks
      // to the loaded data (its gate is the open state).
      await panel.keyboard.press('ControlOrMeta+k');
      const field = panel.getByRole('combobox');
      await expect(field).toBeVisible();
      const exportRow = panel.getByRole('option', { name: 'Export JSON' });
      await expect(exportRow).toBeVisible();
      // Kobalte stamps the flag on every row; the enabled state reads false.
      expect(await exportRow.getAttribute('aria-disabled')).not.toBe('true');
      await panel.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('runs the Reload action: the data machine refetches and the top bar re-stamps', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');
      expect(await barText(panel)).toContain('Cached');
      const before = await captureStamp(panel);
      if (before === null || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(before)) {
        throw new Error(`the freshness stamp caption is not stamped text: ${String(before)}`);
      }

      // The top bar renders the settle's second-ROUNDED stamp
      // (`absoluteStampFromMs` forms `formatCacheTimestamp(Math.round(ms / 1000))`),
      // so one rendered string covers a one-second wall window. Waiting (raw
      // wall ms) past its +0.5 s edge makes the flight's re-stamp determinate:
      // any later settle rounds to a later second, whatever the flight's
      // latency — no raw-second-against-rendered-second guess.
      const boundaryMs = Date.parse(`${before.replace(' ', 'T')}Z`) + 500;
      await expect
        .poll(async () => await panel.evaluate((): number => Date.now()), {
          timeout: 5_000,
          intervals: [25, 50, 100]
        })
        .toBeGreaterThanOrEqual(boundaryMs);

      await runTopRow(panel, 'reload', 'Reload data');

      // The flight must RE-STAMP on the rendered text: its settle (past the
      // boundary) rounds to a later second, so the rendered claim moves past
      // before's — `captureStamp`'s null (the flight-owned span unseen) and
      // the stale string both keep polling. Without the action's refetch
      // nothing replaces `fetchedAt`, the aging tick re-renders the same
      // rounded string, and this poll times out: the change is the flight's
      // proof, never a clock race.
      await expect
        .poll(
          async (): Promise<boolean> => {
            const stamp = await captureStamp(panel);
            const epochMs = stamp === null ? Number.NaN : Date.parse(`${stamp.replace(' ', 'T')}Z`);
            return Number.isFinite(epochMs) && epochMs >= boundaryMs + 500;
          },
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBe(true);
      expect(await barText(panel)).toContain('Cached');
      expect(await barText(panel)).toContain('WP Rocket 3.20.1');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the shortcuts overlay lists the advertised set (run from the palette row)', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toBe('Detections');

      // The launcher's discoverability path: the palette's own shortcuts row
      // runs to open the overlay from real keyboard input.
      await runTopRow(panel, 'shortcuts', 'Show keyboard shortcuts');

      const overlay = panel.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await expect(overlay).toBeVisible();

      // The list renders the shipped table whole: the DOM count is pinned to
      // the table's committed length (a added/dropped advertised row fails
      // here loudly).
      const rows = overlay.locator('[data-fdt="shortcut-row"]');
      await expect(rows).toHaveCount(OVERLAY_ROW_COUNT);

      // The panel's own rows…
      await expect(overlay.getByText('Open or close the command palette')).toBeVisible();
      await expect(overlay.getByText('Open or close this list')).toBeVisible();
      // …the DevTools find-bar rows (the transport face is the panel's protocol
      // receiver, so the table names that surface honestly)…
      await expect(overlay.getByText('Next / previous match')).toBeVisible();
      await expect(overlay.getByText('Clear the search')).toBeVisible();

      // The overlay dismisses topmost: the palette underneath was closed by
      // the run; the Escape lands on the overlay and leaves no field.
      await panel.keyboard.press('Escape');
      await expect(overlay).toHaveCount(0);
      await expect(panel.getByRole('combobox')).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});
