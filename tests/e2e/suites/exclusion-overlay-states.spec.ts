/**
 * The exclusion builder's session states in the real overlay: the state
 * matrix arms the real backend cannot be made to reach on demand are pushed
 * at the message seam (the background's own `exclusionSessionChanged`
 * envelope, validated by the overlay's port like any push); Stop, Reset,
 * Retry and Reload run against the real session backend.
 *
 * Per arm: the banner's tone, glyph, words, notes and forward actions; the
 * header's session indicator (word + glyph, never color alone) and the
 * folded pill's; the footer's session actions. Real flows: Retry on a
 * retryable cause re-applies the draft; Reload on an armed session renders
 * the page through it; Stop ends the session without a navigation (the
 * rewritten page stays, said with Reload) and Reload then serves the page
 * as WP Rocket does; Reset discards edits and re-applies the applied set;
 * a session page the engine never rewrites (a 206 on the reload) is
 * recorded with its reason instead of leaving the overlay waiting.
 */
import type { Page } from '@playwright/test';

import type { ExclusionSet } from '../../../lib/exclusion-builder/set';
import {
  INTERCEPTION_UNAVAILABLE_CAUSES,
  type ExclusionDocumentFailure,
  type InterceptionUnavailableCause
} from '../../../lib/messaging/exclusion-session';
import { documentRecordWaitMs } from '../../../lib/exclusion-session/timeouts';
import { expect, ORIGIN_A, test } from '../helpers/extension';
import { storedSession } from '../helpers/simulation';
import {
  DELAY,
  OVERLAY_HOST,
  activeStatus,
  applyButton,
  lane,
  laneRow,
  openBuilder,
  pushStatus,
  openSessionNotes,
  readBanners,
  readIndicator,
  reloadThroughSession,
  servedIdentity,
  typeRow,
  type BannerReading,
  type IndicatorReading
} from '../helpers/exclusion-overlay';

/** Two scripts served as Delay JavaScript execution delays them. */
const DELAYED = '/exclusion/delayed.html';

/** The pushed sessions' applied set (what the editor holds). */
const SET: ExclusionSet = {
  rows: { delayJs: ['jquery-ui'], deferJs: [], lazyload: [], lazyRender: [] },
  disable: { delayJs: false, deferJs: false, lazyRender: false }
};

/** Every banner of an active session says, behind its session notes, it outlives the page… */
const PERSISTS =
  'Stays on in this tab until Stop or the tab closes; every page of this site you open here loads with these exclusions.';
/** …or, where this page did not get the exclusions, that it is still on. */
const STILL_ON = 'Stays on in this tab until Stop or the tab closes.';
/** The collapsed session-notes toggle of a banner holding one note. */
const ONE_NOTE = '1 session note';

/** Each unavailable cause's words and whether it offers Retry (a new cause fails to compile here). */
const UNAVAILABLE: Readonly<
  Record<InterceptionUnavailableCause, { title: string; body: string; retry: boolean }>
> = {
  'attach-denied': {
    title: 'The browser refused interception',
    body: 'Another debugger may hold this tab. Close it, then retry.',
    retry: true
  },
  'debugging-policy': {
    title: 'Debugging is blocked by policy',
    body: 'This browser is managed and forbids extension debugging. Ask its administrator, or use an unmanaged profile.',
    retry: false
  },
  'infobar-cancelled': {
    title: 'Interception was cancelled',
    body: 'The browser’s “started debugging” bar was closed with Cancel. Retry, and leave the bar open while the session runs.',
    retry: true
  },
  detached: {
    title: 'Interception ended',
    body: 'The browser ended it while the tab stayed open (for example after a crash). Retry to start it again.',
    retry: true
  },
  'unsupported-page': {
    title: 'This page can’t be intercepted',
    body: 'Only regular http and https pages can be rewritten. Open the site page itself in a normal tab.',
    retry: false
  },
  'unsupported-browser': {
    title: 'This browser can’t rewrite pages',
    body: 'Rewriting pages before they render needs Chrome (or another Chromium browser) or Firefox.',
    retry: false
  },
  'session-limit': {
    title: 'Too many sessions',
    body: 'Other tabs hold every available session. Stop one of them, then retry.',
    retry: true
  }
};

/** Each served-unmodified failure's words. */
const FAILED: Readonly<Record<ExclusionDocumentFailure, string>> = {
  'body-unavailable': 'Its HTML could not be read (too large, or the response was cut short).',
  'decode-failed': 'Its character encoding is not supported for rewriting.',
  'encode-failed': 'The rewritten HTML could not be saved back in the page’s character encoding.',
  'engine-failed': 'The exclusion engine failed on this page.',
  'not-served': 'The rewrite was not delivered: the navigation ended first.',
  'timed-out': 'Rewriting it took too long, so the original was served. Reload to try again.',
  'ineligible-response':
    'Its response isn’t a complete HTML page (for example a partial or XHTML response), so it can’t be rewritten.',
  'network-error': 'Its response failed on the network. Reload to try again.'
};

/** The footer's session buttons, in order. */
async function footerActions(page: Page): Promise<string[]> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    return Array.from(root?.querySelectorAll('.xo-footer-actions button') ?? [], (button) =>
      button.textContent.trim()
    );
  }, OVERLAY_HOST);
}

/** One arm as the overlay must show it. */
interface Arm {
  readonly banner: BannerReading;
  readonly indicator: IndicatorReading;
  readonly footer: readonly string[];
}

/** Wait until the overlay shows `arm` exactly (banner list, indicator, footer). */
async function expectArm(page: Page, arm: Arm, at: string): Promise<void> {
  await expect.poll(() => readBanners(page), at).toEqual([arm.banner]);
  expect(await readIndicator(page, 'header'), at).toEqual(arm.indicator);
  expect(await footerActions(page), at).toEqual(arm.footer);
}

/** A warn arm's banner (the alert glyph, Reload offered). */
function warnBanner(title: string, body: string, glyph = 'lucide-triangle-alert'): BannerReading {
  return {
    tone: 'warn',
    glyph,
    title,
    body,
    notes: [],
    sessionNotes: ONE_NOTE,
    actions: ['Reload page']
  };
}

test.describe('exclusion builder session states', () => {
  test('the state matrix, pushed at the message seam: banner, indicator, pill and footer per arm', async ({
    extension
  }) => {
    const { page, tabId } = await openBuilder(extension, DELAYED);
    await typeRow(page, DELAY, 'jquery-ui');
    await page.keyboard.press('Tab');
    const ownPage = await servedIdentity(page, page.url());
    const otherPage = await servedIdentity(page, `${ORIGIN_A}/exclusion/deferred.html`);

    for (const [cause, words] of Object.entries(UNAVAILABLE) as [
      InterceptionUnavailableCause,
      (typeof UNAVAILABLE)[InterceptionUnavailableCause]
    ][]) {
      // The table and the contract agree on what can be retried.
      expect(words.retry, cause).toBe(INTERCEPTION_UNAVAILABLE_CAUSES[cause].retryable);
      await pushStatus(extension, tabId, { state: 'unavailable', cause, at: Date.now() });
      await expectArm(
        page,
        {
          banner: {
            tone: 'error',
            glyph: 'lucide-ban',
            title: words.title,
            body: words.body,
            notes: [],
            sessionNotes: null,
            actions: words.retry ? ['Retry'] : []
          },
          indicator: { label: 'Unavailable', tone: 'error', glyph: 'lucide-ban' },
          // Nothing applied: Stop clears the warning; there is nothing to reset.
          footer: ['Stop', 'Apply']
        },
        `unavailable ${cause}`
      );
    }

    await pushStatus(extension, tabId, activeStatus(ORIGIN_A, SET, null));
    await expectArm(
      page,
      {
        banner: {
          tone: 'info',
          glyph: 'lucide-clock',
          title: 'Applied — waiting for the page',
          body: 'Reload to render this page through the session.',
          notes: [],
          sessionNotes: ONE_NOTE,
          actions: ['Reload page']
        },
        indicator: { label: 'Applied · waiting', tone: 'info', glyph: 'lucide-clock' },
        footer: ['Stop', 'Reset', 'Re-apply']
      },
      'armed'
    );
    // Collapsed by default; opened, it holds exactly the next-page promise.
    expect(await openSessionNotes(page)).toEqual([PERSISTS]);

    await pushStatus(
      extension,
      tabId,
      activeStatus(ORIGIN_A, SET, { outcome: 'rewritten', reports: [], served: otherPage })
    );
    await expectArm(
      page,
      {
        banner: warnBanner(
          'This page was not intercepted',
          'The session is on, but this load bypassed it. Reload to render it with your exclusions.'
        ),
        indicator: { label: 'Not intercepted', tone: 'warn', glyph: 'lucide-triangle-alert' },
        footer: ['Stop', 'Reset', 'Re-apply']
      },
      'not intercepted'
    );
    expect(await openSessionNotes(page)).toEqual([STILL_ON]);

    // No identity in the record: no honest verdict.
    await pushStatus(
      extension,
      tabId,
      activeStatus(ORIGIN_A, SET, { outcome: 'rewritten', reports: [] })
    );
    await expectArm(
      page,
      {
        banner: warnBanner(
          'Can’t verify this page',
          'The session is on, but this page changed its address or loaded from history, so it may not be the rewritten one. Reload to be sure.',
          'lucide-circle-question-mark'
        ),
        indicator: { label: 'Can’t verify', tone: 'warn', glyph: 'lucide-circle-question-mark' },
        footer: ['Stop', 'Reset', 'Re-apply']
      },
      'can’t verify'
    );

    const unmodified: IndicatorReading = {
      label: 'Served unmodified',
      tone: 'warn',
      glyph: 'lucide-triangle-alert'
    };
    for (const [reason, body] of Object.entries(FAILED) as [ExclusionDocumentFailure, string][]) {
      await pushStatus(
        extension,
        tabId,
        activeStatus(ORIGIN_A, SET, { outcome: 'failed', reason, served: ownPage })
      );
      await expectArm(
        page,
        {
          banner: warnBanner('Served unmodified', body),
          indicator: unmodified,
          footer: ['Stop', 'Reset', 'Re-apply']
        },
        `unmodified ${reason}`
      );
    }
    await pushStatus(
      extension,
      tabId,
      activeStatus(ORIGIN_A, SET, {
        outcome: 'over-budget',
        feature: 'delay_js',
        row: 'jquery-ui',
        budgetMs: 250,
        served: ownPage
      })
    );
    await expectArm(
      page,
      {
        banner: warnBanner(
          'Served unmodified',
          'Delay JavaScript execution (row jquery-ui) took longer than 250 ms, so the page was served unmodified. Simplify the row, then apply again.'
        ),
        indicator: unmodified,
        footer: ['Stop', 'Reset', 'Re-apply']
      },
      'over budget'
    );

    // Folded, the pill carries the same indicator; Enter brings the panel back.
    await page.keyboard.press('Escape');
    const pill = page.getByRole('button', { name: /open the exclusion builder$/ });
    await expect(pill).toBeFocused();
    expect(await readIndicator(page, 'pill')).toEqual(unmodified);
    await expect(pill).toHaveAccessibleName(/Served unmodified/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Exclusion builder' })).toBeFocused();

    // Back to nothing applied: no banner, Apply only.
    await pushStatus(extension, tabId, { state: 'inactive' });
    await expect.poll(() => readBanners(page)).toEqual([]);
    expect(await readIndicator(page, 'header')).toEqual({
      label: 'Not applied',
      tone: 'neutral',
      glyph: 'lucide-circle-dashed'
    });
    expect(await footerActions(page)).toEqual(['Apply']);
    await page.close();
  });

  test('Retry on a retryable cause re-applies the draft; Reload on an armed session renders through it', async ({
    extension
  }) => {
    const { page, tabId } = await openBuilder(extension, DELAYED);
    await typeRow(page, DELAY, 'jquery-ui');
    await page.keyboard.press('Tab');
    await pushStatus(extension, tabId, {
      state: 'unavailable',
      cause: 'attach-denied',
      at: Date.now()
    });
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    expect(await reloadThroughSession(page, () => retry.click())).toBe('Applied');
    await expect(lane(page, DELAY).getByText('1 of 2 delayed scripts restored')).toBeVisible();

    // The real session is on; a pushed "armed" offers Reload, which renders through it.
    await pushStatus(extension, tabId, activeStatus(ORIGIN_A, SET, null));
    const reload = page.getByRole('button', { name: 'Reload page' });
    await expect(reload).toBeVisible();
    expect(await reloadThroughSession(page, () => reload.click())).toBe('Applied');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.jqueryUiRan))
      .toBe('true');
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });

  test('Stop ends the session without a navigation; Reload then serves the page as WP Rocket does', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension, DELAYED);
    await typeRow(page, DELAY, 'jquery-ui');
    await page.keyboard.press('Tab');
    expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe('Applied');
    await page.evaluate(() => {
      (window as unknown as { e2eBeforeStop: boolean }).e2eBeforeStop = true;
    });

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect
      .poll(() => readBanners(page))
      .toEqual([
        {
          tone: 'info',
          glyph: 'lucide-check',
          title: 'Session stopped',
          body: 'Reload to see the page without exclusions.',
          notes: [],
          sessionNotes: null,
          actions: ['Dismiss: Session stopped', 'Reload page']
        }
      ]);
    expect(await readIndicator(page, 'header')).toEqual({
      label: 'Not applied',
      tone: 'neutral',
      glyph: 'lucide-circle-dashed'
    });
    // The unmounted Stop hands focus to the heading, never to the page.
    await expect(page.getByRole('heading', { name: 'Exclusion builder' })).toBeFocused();
    expect(await footerActions(page)).toEqual(['Apply']);
    // No navigation: the rewritten document is still the one on screen; the draft is kept.
    expect(await page.evaluate(() => 'e2eBeforeStop' in window)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.jqueryUiRan)).toBe('true');
    await expect(laneRow(page, DELAY, 1)).toHaveValue('jquery-ui');

    // Reload: the page comes back as served (script delayed again); nothing re-opens the builder.
    await page.getByRole('button', { name: 'Reload page' }).click();
    await expect
      .poll(() =>
        page
          .evaluate(() => ({
            fresh: !('e2eBeforeStop' in window),
            type: document.getElementById('jquery-ui-js')?.getAttribute('type') ?? null,
            ran: document.documentElement.dataset.jqueryUiRan ?? null
          }))
          .catch(() => null)
      )
      .toEqual({ fresh: true, type: 'rocketlazyloadscript', ran: null });
    await expect(page.locator(OVERLAY_HOST)).toHaveCount(0);
    await page.close();
  });

  test('a session page the engine never rewrites (206 on the reload) leaves the wait: its reason, Reload; Stop ends the session', async ({
    extension
  }) => {
    const { page, tabId } = await openBuilder(
      extension,
      `/__e2e/partial-on-reload?run=${String(Date.now())}-${String(Math.random()).slice(2)}`
    );
    await typeRow(page, DELAY, 'jquery-ui');
    await page.keyboard.press('Tab');
    const applied = Date.now();
    expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe(
      'Served unmodified'
    );
    // Recorded by the background: well within the overlay's own record wait.
    expect(Date.now() - applied).toBeLessThan(documentRecordWaitMs(false));
    await expectArm(
      page,
      {
        // The session still bypassed service workers and guarded prefetching here.
        banner: {
          ...warnBanner('Served unmodified', FAILED['ineligible-response']),
          sessionNotes: '3 session notes'
        },
        indicator: { label: 'Served unmodified', tone: 'warn', glyph: 'lucide-triangle-alert' },
        // Reload on the banner; Stop and Re-apply in the footer.
        footer: ['Stop', 'Reset', 'Re-apply']
      },
      '206 session page'
    );

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect
      .poll(() => readBanners(page).then((banners) => banners[0]?.title))
      .toBe('Session stopped');
    expect(await readIndicator(page, 'header')).toMatchObject({ label: 'Not applied' });
    expect(await footerActions(page)).toEqual(['Apply']);
    expect(await storedSession(extension, tabId)).toBeNull();
    await page.close();
  });

  test('Reset is held while the draft is the applied set; with edits it discards them and re-applies', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension, DELAYED);
    await typeRow(page, DELAY, 'jquery-ui');
    await page.keyboard.press('Tab');
    expect(await reloadThroughSession(page, () => applyButton(page).click())).toBe('Applied');
    const reset = page.getByRole('button', { name: 'Reset' });
    await expect(reset).toHaveAttribute('aria-disabled', 'true');
    await expect(reset).toHaveAttribute('title', 'Nothing to reset: the draft is the applied set');
    await expect(applyButton(page)).toHaveText('Re-apply');
    // A held Reset does nothing: no reload, the page stays.
    await page.evaluate(() => {
      (window as unknown as { e2eHeld: boolean }).e2eHeld = true;
    });
    await reset.focus();
    await page.keyboard.press('Enter');

    await lane(page, DELAY).getByRole('button', { name: 'Add row' }).click();
    await page.keyboard.type('a\\+b');
    await page.keyboard.press('Tab');
    await expect(reset).not.toHaveAttribute('aria-disabled', 'true');
    await expect(reset).toHaveAttribute(
      'title',
      'Discard edits and re-apply the applied exclusions'
    );
    await expect(applyButton(page)).toHaveText('Apply changes');
    // The held press did nothing meanwhile: still the same document.
    expect(await page.evaluate(() => 'e2eHeld' in window)).toBe(true);

    expect(await reloadThroughSession(page, () => reset.click())).toBe('Applied');
    // The edit is gone; the applied set is back, counted.
    await expect(laneRow(page, DELAY, 1)).toHaveValue('jquery-ui');
    await expect(laneRow(page, DELAY, 2)).toHaveCount(0);
    await expect(lane(page, DELAY).getByText('1 of 2 delayed scripts restored')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(await page.evaluate(() => document.documentElement.dataset.abRan ?? null)).toBeNull();
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });
});
