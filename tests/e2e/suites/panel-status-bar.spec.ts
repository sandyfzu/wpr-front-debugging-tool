/**
 * The status-bar suite: the four segments' browser answers rendered from the
 * devtools-contract fixture data (the 0-interaction layer) — presence
 * and version, cached-or-not with the stamp's bucketed age, the platform
 * header answer, and the data-freshness answer — plus the navigation
 * contract: each answer sits in a real link to the Detections overview, and
 * the freshness segment stays non-navigable text (data age is shell-owned; a
 * page owning it is the revisit's row).
 *
 * Expected values derive from the fixture's SERVED detection payload (read
 * through the same contract the panel used) and the panel's own shipped
 * formatters — the suite reuses the code that renders the values, it never
 * re-types the rules (buckets, stamp format), so a drift between the spec
 * and the strip fails the suite loudly.
 *
 * The standalone harness seam stamps `devtools.inspectedWindow.tabId` (see
 * `helpers/panel-data.ts`); all data below flows through the real channels.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { relativeAge } from '../../../entrypoints/panel/status-bar/relative-age';
import { formatCacheTimestamp } from '../../../lib/detection/describe';

/** The strip's rendered answers (the full text of the four segments). */
function stripText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null =>
      document.querySelector('[data-fdt="panel-status-bar"]')?.textContent ?? null
  );
}

test.describe('panel status bar (the 0-interaction answers)', () => {
  test('renders the four answers from the fixture data, exactly', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    // The marked fixture's served truth (the same contract the panel used).
    const served = await extension.sendToTab<{
      wprDetections: {
        wpr: {
          present: boolean;
          cached: boolean;
          version: string | null;
          timeStamp: number | null;
        };
      };
    } | null>(fixture.tabId, 'getFdtData');
    try {
      await expect
        .poll(async () => await stripText(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toContain('WP Rocket 3.20.1');

      // Presence + version: the marked fixture's generator meta, verbatim.
      const wprLink = panel.getByRole('link', { name: 'WP Rocket 3.20.1' });
      await expect(wprLink).toBeVisible();
      expect(served?.wprDetections.wpr.present).toBe(true);
      expect(served?.wprDetections.wpr.version).toBe('3.20.1');

      // Cached: the chip plus the stamp's bucketed age — the bucket computed
      // by the shipped formatter over the served stamp (narrowed first: a
      // vanished or unrepresentable stamp is its own failure, named).
      const stamp = served?.wprDetections.wpr.timeStamp;
      if (stamp === null || stamp === undefined) {
        throw new Error('the served cache stamp vanished (the payload named none)');
      }
      expect(stamp).toBe(1791342253);
      const stampText = formatCacheTimestamp(stamp);
      if (stampText === null) {
        throw new Error(`the served stamp is not representable: ${String(stamp)}`);
      }
      expect(served?.wprDetections.wpr.cached).toBe(true);
      const cacheLink = panel.getByRole('link', { name: /^Cached/ });
      await expect(cacheLink).toBeVisible();
      const expectedAge = relativeAge(Date.now() - stamp * 1000);
      await expect(cacheLink).toHaveText(new RegExp(`^Cached${expectedAge}$`));
      // The stamp's absolute form rides the segment's hover detail — the
      // shared tooltip's content, not a title attribute (the strip's segment
      // is a tooltip trigger wrapping the link).
      await cacheLink.focus();
      await expect(panel.getByRole('tooltip')).toContainText(`Cache generated at ${stampText}`);
      await panel.keyboard.press('Escape');
      await expect(panel.getByRole('tooltip')).toHaveCount(0);

      // Platform: the fixture server's responses carry neither platform
      // header — captured headers with neither name answer "unknown" (the
      // honest silence, distinct from a missing capture's dash).
      const platform = await panel.evaluate((): { text: string; isLink: boolean } | null => {
        const strip = document.querySelector<HTMLElement>('[data-fdt="panel-status-bar"]');
        if (strip === null) return null;
        const answer = [...strip.querySelectorAll<HTMLElement>('span, a')].find(
          (node) => node.textContent.trim() === 'unknown'
        );
        if (answer === undefined) return null;
        return { text: answer.textContent.trim(), isLink: answer.tagName === 'A' };
      });
      expect(platform?.isLink, 'the unknown answer is quiet text, not a control').toBe(false);

      // Freshness: current data, "Updated <age>" with its capture stamp; the
      // stamp parses to seconds ago (never yesterday's data rendered fresh).
      // The detail text sits in inner spans; the stamp title rides the
      // segment's own root span, so the read gathers both.
      const freshness = await panel.evaluate(
        (): { text: string; title: string; isLink: boolean } | null => {
          const strip = document.querySelector<HTMLElement>('[data-fdt="panel-status-bar"]');
          if (strip === null) return null;
          // The freshness segment root: the sr-only stamp detail + the
          // "Updated <age>" detail, inside one non-interactive span.
          const answer = [...strip.querySelectorAll<HTMLElement>('span')].find(
            (node) =>
              node.textContent.startsWith('Page data captured at') &&
              node.textContent.includes('Updated')
          );
          if (answer === undefined) return null;
          const detail = [...answer.querySelectorAll<HTMLElement>('span')].find((node) =>
            node.textContent.startsWith('Updated')
          );
          if (detail === undefined) return null;
          return {
            text: detail.textContent.trim(),
            title: answer.getAttribute('title') ?? '',
            isLink: answer.tagName === 'A'
          };
        }
      );
      expect(freshness?.isLink, 'freshness is shell-owned text, never a control').toBe(false);
      expect(freshness?.text).toMatch(/^Updated just now$/);
      const freshnessTitle = freshness?.title;
      if (freshnessTitle === undefined) {
        throw new Error('the freshness segment lost its stamp title');
      }
      const capture = /^Page data captured at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC\.$/.exec(
        freshnessTitle
      );
      if (capture?.[1] === undefined) {
        throw new Error(`the freshness segment lost its stamp title: ${freshnessTitle}`);
      }
      const capturedAt = Date.parse(`${capture[1]}Z`);
      expect(
        Number.isFinite(capturedAt) && Date.now() - capturedAt < 60_000,
        `the stamp is seconds fresh (${freshnessTitle})`
      ).toBe(true);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the navigable answers link the Detections overview; freshness stays text', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await stripText(panel), { timeout: 15_000, intervals: [50, 100, 250] })
        .toContain('Cached');

      // Every strip link carries the segment table's one hash target (the
      // freshness answer alone contributes no anchor at this fixture).
      const hrefs = await panel.evaluate((): string[] =>
        [...document.querySelectorAll<HTMLElement>('[data-fdt="panel-status-bar"] a')].map(
          (anchor) => anchor.getAttribute('href') ?? ''
        )
      );
      expect(hrefs.length).toBeGreaterThanOrEqual(2); // presence + cache (platform answers quietly)
      for (const href of hrefs) expect(href).toBe('#/detections');

      // A segment click navigates: the rail's active row follows.
      await panel.getByRole('link', { name: /^Cached/ }).click();
      await panel.waitForURL(/#\/detections$/);
      const current = await panel.evaluate(
        (): string | null =>
          document.querySelector('[aria-current="page"]')?.getAttribute('href') ?? null
      );
      expect(current).toBe('#/detections');

      // And the freshness segment stayed out of the link surface entirely.
      const anchors = await panel.evaluate((): string[] =>
        [...document.querySelectorAll<HTMLElement>('[data-fdt="panel-status-bar"] a')].map(
          (anchor) => anchor.textContent.trim()
        )
      );
      for (const anchor of anchors) {
        expect(
          anchor.startsWith('Updated'),
          `'${anchor}' keeps the freshness text out of the anchors`
        ).toBe(false);
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});
