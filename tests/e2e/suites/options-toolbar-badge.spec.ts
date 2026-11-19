/**
 * The toolbar-badge toggle at the SW seam, driven by the real options
 * page.
 *
 * The options page writes the feature through the model's Save; the background's
 * existing options watch (`entrypoints/background/badge.ts`) re-applies the
 * gate live. The honest browser observable is the `chrome.action` state read
 * back in the service worker (helpers/badge.ts's seam): turning the option
 * off clears the rendered badge; turning it on restores it FROM THE KEPT
 * PAGE SUMMARY — the fixture page is never reloaded and never re-reports, so
 * a restoration can only come from the background's own live re-application.
 *
 * The round makes no restart claim (none is possible from a page anyway):
 * what it proves is that the flip applies without any navigation, summary
 * push, or worker restart leg in the driving path.
 */

import { expect, openFixturePage, test } from '../helpers/extension';
import { BADGE_COLORS, BADGE_DOT, POLLED_BADGE_OPTIONS, readBadge } from '../helpers/badge';
import {
  expectRealmAlive,
  openOptionsPage,
  resetStoredOptions,
  rowSwitchInput,
  rowSwitchTrack,
  saveOptions,
  stampRealm
} from '../helpers/options';

/** The badge row's storage id. */
const BADGE_ROW_ID = 'toolbarBadge';

test.describe('options toolbar badge', () => {
  test('the toggle applies the gate live at the SW seam: off clears, on restores without a page reprocess', async ({
    extension
  }) => {
    await resetStoredOptions(extension); // Fresh-install defaults: badge on.
    const marker = await openFixturePage(extension, '/pipeline/markers.html');
    try {
      // The page's summary push landed: the cached state renders (green).
      await expect
        .poll(async () => (await readBadge(extension, marker.tabId)).text, POLLED_BADGE_OPTIONS)
        .toBe(BADGE_DOT);
      expect(
        (await readBadge(extension, marker.tabId)).color,
        'the marked fixture reads the cached state'
      ).toBe(BADGE_COLORS.cached);

      // The driving page: the real options UI, not a storage write.
      const options = await openOptionsPage(extension, { colorScheme: 'light' });
      await stampRealm(marker.page);

      // Off + Save: the background's watch sweeps and clears the rendered
      // badge on the still-open, still-unreloaded fixture tab.
      await rowSwitchTrack(options, BADGE_ROW_ID).click();
      await expect(rowSwitchInput(options, BADGE_ROW_ID)).not.toBeChecked();
      await saveOptions(options);
      await expect
        .poll(async () => (await readBadge(extension, marker.tabId)).text, POLLED_BADGE_OPTIONS)
        .toBe('');
      await expectRealmAlive(marker.page);

      // On + Save: the gate re-arms and the state machine re-resolves the
      // KEPT summary for the tab — nothing about the page ran again.
      await rowSwitchTrack(options, BADGE_ROW_ID).click();
      await expect(rowSwitchInput(options, BADGE_ROW_ID)).toBeChecked();
      await saveOptions(options);
      await expect
        .poll(async () => (await readBadge(extension, marker.tabId)).text, POLLED_BADGE_OPTIONS)
        .toBe(BADGE_DOT);
      expect(
        (await readBadge(extension, marker.tabId)).color,
        "the restoration is the page's own state, re-applied live"
      ).toBe(BADGE_COLORS.cached);
      await expectRealmAlive(marker.page);
      await options.close();
    } finally {
      await resetStoredOptions(extension);
      await marker.page.close();
    }
  });
});
