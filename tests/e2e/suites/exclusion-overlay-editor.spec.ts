/**
 * The exclusion builder's editor in the real overlay over the real session
 * backend (Chromium interception): compose → validate → apply → counts, and
 * the pick flows (on the page, and the keyboard path through "On this page").
 *
 * Owner-visible flows: a row the preview refuses blocks Apply (the page
 * stays, the row says why, the notice counts it); a valid set applies — the
 * page reloads through the session and the fulfilled document carries the
 * engine's transform (the matched script restored and run, the unmatched
 * one still delayed); the lane counts what it restored, each row its
 * matches, the banner and the indicator name the no-match row; dropping it
 * re-applies clean; the feature-wide switch restores everything. Picking:
 * Esc cancels back to the Pick button, a hit lands focused in its lane and
 * is announced, a second pick of it says it is already there; the page list
 * filters by lane, marks what is added and adds by keyboard; applied, every
 * added element is de-stamped and the others are kept.
 */
import type { Page } from '@playwright/test';

import { expect, test } from '../helpers/extension';
import {
  DEFER,
  DELAY,
  LAZY_RENDER,
  OVERLAY_HOST,
  applyButton,
  reloadThroughSession,
  lane,
  laneRow,
  openBuilder,
  readBanners,
  readIndicator,
  typeRow
} from '../helpers/exclusion-overlay';

/** Two scripts served as Delay JavaScript execution delays them. */
const DELAYED = '/exclusion/delayed.html';

/** Three sections served as Automatic Lazy Rendering stamps them. */
const LAZY_RENDERED = '/exclusion/lazy-render.html';

/** The page's navigation count since it opened (a reload adds one). */
async function navigations(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const store = window as unknown as { e2eLoads?: number };
    return store.e2eLoads ?? 0;
  });
}

/** Each delayed fixture script as the document holds it: its `type` and whether it ran. */
async function delayedScripts(
  page: Page
): Promise<{ readonly id: string; readonly type: string | null; readonly ran: boolean }[]> {
  return await page.evaluate(() =>
    [
      ['jquery-ui-js', 'jqueryUiRan'],
      ['ab-js', 'abRan']
    ].map(([id = '', flag = '']) => ({
      id,
      type: document.getElementById(id)?.getAttribute('type') ?? null,
      ran: document.documentElement.dataset[flag] === 'true'
    }))
  );
}

test.describe('exclusion builder editor', () => {
  test('compose, validate and count: a refused row blocks Apply; applied, the counts and the served document agree', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension, DELAYED);
    // Mark this document: a reload starts a fresh window without the mark.
    await page.evaluate(() => {
      (window as unknown as { e2eLoads: number }).e2eLoads = 1;
    });
    expect(await readIndicator(page, 'header')).toEqual({
      label: 'Not applied',
      tone: 'neutral',
      glyph: 'lucide-circle-dashed'
    });
    // The empty editor says what to do; no banner while nothing is applied.
    await expect(page.getByText('Pick elements or write rows, then apply')).toBeVisible();
    expect(await readBanners(page)).toEqual([]);

    await typeRow(page, DELAY, 'jquery-ui');
    await page.keyboard.press('Enter');
    await page.keyboard.type('nothing-here');
    // Kept by WP Rocket's save, refused here (a backtracking risk).
    await typeRow(page, DEFER, '(a+)+$');
    await applyButton(page).click();
    const refused = laneRow(page, DEFER, 1);
    await expect(refused).toHaveAttribute('aria-invalid', 'true');
    await expect(refused).not.toHaveAccessibleDescription('');
    await expect
      .poll(() => readBanners(page))
      .toEqual([
        {
          tone: 'warn',
          glyph: 'lucide-triangle-alert',
          title: 'Fix 1 row before applying',
          body: 'Each marked row says what is wrong with it.',
          notes: [],
          actions: ['Dismiss: Fix 1 row before applying']
        }
      ]);
    // Nothing was armed: the page stayed and the session is still off.
    expect(await navigations(page)).toBe(1);
    expect((await readIndicator(page, 'header'))?.label).toBe('Not applied');
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);

    // The problem leaves with its row; the notice leaves with the last problem.
    await lane(page, DEFER)
      .getByRole('button', { name: `Remove ${DEFER} row 1` })
      .click();
    await expect.poll(async () => (await readBanners(page)).length).toBe(0);
    await reloadThroughSession(page, () => applyButton(page).click());
    expect(await navigations(page)).toBe(0);

    // The fulfilled document carries the transform: the matched script was
    // restored and ran; the other is still delayed as served.
    await expect
      .poll(() => delayedScripts(page))
      .toEqual([
        { id: 'jquery-ui-js', type: null, ran: true },
        { id: 'ab-js', type: 'rocketlazyloadscript', ran: false }
      ]);
    const delay = lane(page, DELAY);
    await expect(delay.getByText('1 of 2 delayed scripts restored')).toBeVisible();
    const rows = delay.getByRole('listitem');
    await expect(rows.nth(0)).toContainText('1 match');
    await expect(rows.nth(1)).toContainText('No match');
    await expect
      .poll(async () => (await readBanners(page))[0]?.title)
      .toBe('Applied, with rows that matched nothing');
    expect((await readBanners(page))[0]?.body).toBe(
      '1 row matches no element on this page. Check the rows marked “No match”.'
    );
    expect(await readIndicator(page, 'header')).toEqual({
      label: 'Applied · no-match rows',
      tone: 'warn',
      glyph: 'lucide-triangle-alert'
    });

    // Drop the no-match row and re-apply: clean.
    await delay.getByRole('button', { name: `Remove ${DELAY} row 2` }).click();
    await reloadThroughSession(page, () => applyButton(page).click());
    expect(await readIndicator(page, 'header')).toEqual({
      label: 'Applied',
      tone: 'ok',
      glyph: 'lucide-check'
    });
    const clean = await readBanners(page);
    expect(clean.map(({ tone, glyph, title, body }) => ({ tone, glyph, title, body }))).toEqual([
      {
        tone: 'ok',
        glyph: 'lucide-check',
        title: 'Applied',
        body: 'This page was rendered with your exclusions.'
      }
    ]);
    await expect(delay.getByRole('listitem').nth(0)).toContainText('1 match');

    // The feature-wide switch: every delayed script restored, no per-row count.
    const disable = page.getByRole('switch', { name: `Disable feature: ${DELAY} on this page` });
    await disable.click();
    await expect(disable).toHaveAttribute('aria-checked', 'true');
    await reloadThroughSession(page, () => applyButton(page).click());
    await expect(
      delay.getByText('All 2 delayed scripts restored (feature disabled)')
    ).toBeVisible();
    await expect(delay.getByRole('listitem').nth(0)).not.toContainText('match');
    await expect
      .poll(() => delayedScripts(page))
      .toEqual([
        { id: 'jquery-ui-js', type: null, ran: true },
        { id: 'ab-js', type: null, ran: true }
      ]);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });

  test('pick on the page: Esc cancels to the Pick button; a hit lands focused in its lane, a second pick says it is there', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension, LAZY_RENDERED);
    const pickButton = page.getByRole('button', { name: 'Pick on page' });
    const bar = page.getByRole('group', { name: 'Picking on the page' });

    await pickButton.click();
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Point at an image or a lazily rendered section, then click.');
    // The panel steps aside while picking (inert, out of the tab order).
    await expect(page.getByRole('heading', { name: 'Exclusion builder' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect(pickButton).toBeFocused();
    await expect(laneRow(page, LAZY_RENDER, 1)).toHaveCount(0);

    await pickButton.click();
    await page.locator('#alr-two').hover();
    // The highlight names the lane and the element.
    await expect(page.locator(`${OVERLAY_HOST} .xo-highlight-lane`)).toHaveText(LAZY_RENDER);
    await page.locator('#alr-two').click();
    await expect(bar).toHaveCount(0);
    const row = laneRow(page, LAZY_RENDER, 1);
    await expect(row).toHaveValue('alr-two');
    await expect(row).toBeFocused();
    await expect(announcer(page)).toHaveText(/^Added .*alr-two.* to Automatic Lazy Rendering$/);

    await pickButton.click();
    await page.locator('#alr-two').click();
    await expect(announcer(page)).toHaveText(/alr-two.* is already in Automatic Lazy Rendering$/);
    // Its row is focused, not doubled.
    await expect(laneRow(page, LAZY_RENDER, 2)).toHaveCount(0);
    await expect(row).toBeFocused();
    await page.close();
  });

  test('"On this page": filter by lane, added entries marked, add by keyboard; applied, only the added elements are de-stamped', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension, LAZY_RENDERED);
    await typeRow(page, LAZY_RENDER, 'alr-two');
    await page.keyboard.press('Tab');
    const toggle = page.getByRole('button', { name: /^On this page/ });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByRole('list', { name: 'Elements on this page' });
    await expect(list.getByRole('listitem')).toHaveCount(3);

    const chips = page.getByRole('group', { name: 'Show elements of' });
    await chips.getByRole('button', { name: /^Delay JavaScript execution/ }).click();
    await expect(
      page
        .getByRole('region', { name: 'On this page' })
        .getByText('No delayed scripts on this page.')
    ).toBeVisible();
    await chips.getByRole('button', { name: /^Automatic Lazy Rendering/ }).click();
    await expect(chips.getByRole('button', { name: /^Automatic Lazy Rendering/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(list.getByRole('listitem')).toHaveCount(3);

    // The typed row already holds alr-two: its entry says so.
    await expect(
      list.getByRole('button', { name: /^Added: .*alr-two.* is in Automatic Lazy Rendering/ })
    ).toBeVisible();
    const addThree = list.getByRole('button', { name: /^Add .*alr-three.* to Automatic/ });
    await addThree.focus();
    await page.keyboard.press('Enter');
    // Focus stays on the list; the entry flips to Added.
    await expect(
      list.getByRole('button', { name: /^Added: .*alr-three.* is in Automatic Lazy Rendering/ })
    ).toBeFocused();
    await expect(laneRow(page, LAZY_RENDER, 2)).toHaveValue('alr-three');
    // An added entry shows its row: focus moves there, nothing is added again.
    await list
      .getByRole('button', { name: /^Added: .*alr-two.* is in Automatic Lazy Rendering/ })
      .click();
    await expect(laneRow(page, LAZY_RENDER, 1)).toBeFocused();
    await expect(laneRow(page, LAZY_RENDER, 3)).toHaveCount(0);

    await reloadThroughSession(page, () => applyButton(page).click());
    await expect(
      lane(page, LAZY_RENDER).getByText('2 of 3 lazily rendered elements restored')
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          ['alr-one', 'alr-two', 'alr-three'].map((id) =>
            document.getElementById(id)?.hasAttribute('data-wpr-lazyrender')
          )
        )
      )
      .toEqual([true, false, false]);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });
});

/** The overlay's polite announcer (the last live status in its tree). */
const announcer = (page: Page): ReturnType<Page['locator']> =>
  page.locator(`${OVERLAY_HOST} p.xo-sr-only[role="status"]`);
