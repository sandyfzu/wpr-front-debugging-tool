/**
 * TEST MODE — the words every surface uses for a page whose styles a RUCSS
 * test replaced (until the page reloads): the panel's Detections notice,
 * the tester's own result and the on-page widget's card line and pill
 * glyph. One declaring site, so the surfaces can never disagree.
 */

/** The marker the panel shows once per page while a test's CSS is on it. */
export const RUCSS_TEST_MODE_TAG = '(TEST MODE)';

/** The panel's sentence beside the marker (what happened + the one remedy). */
export const RUCSS_TEST_MODE_SENTENCE =
  "A RUCSS test replaced this page's styles. Reload the page to restore them.";

/** The on-page widget's tab-level card line. */
export const RUCSS_TEST_MODE_LINE = 'RUCSS test applied — reload to restore';

/** What the widget's pill adds to its spoken name while the glyph shows. */
export const RUCSS_TEST_MODE_PILL_SPOKEN = ', RUCSS test applied';

/**
 * The repeat-run warning: a second test would strip the first one's result
 * too, so the user chooses between a clean reload and running on top.
 *
 * @param runs Tests already applied on the page (at least 1).
 * @returns The warning sentence.
 */
export function rucssRepeatRunWarning(runs: number): string {
  const already = runs === 1 ? 'A test already replaced' : `${String(runs)} tests already replaced`;
  return `${already} this page's styles. Reload for a clean run, or run this test on top of the current result.`;
}

/**
 * The repeat-run warning when no earlier test is confirmed, but one may have
 * applied (the page never answered its apply).
 */
export const RUCSS_UNCONFIRMED_REPEAT_WARNING =
  "An earlier test may have replaced this page's styles — the page never confirmed it. Reload for a clean run, or run this test on top of whatever the page shows now.";
