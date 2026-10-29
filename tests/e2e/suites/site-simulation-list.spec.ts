/**
 * The exclusion list a Delay JS simulation runs, over a real session on the
 * docker site's off page (`/fdt/` with the delay scenario, served without
 * Delay JS, never stored).
 *
 * The harness resolves the latest list's endpoint to nothing (see
 * `helpers/extension.ts`), so the background's start-up refresh misses
 * with a network error and is kept as that miss — the run never reaches
 * the real endpoint. A kept latest copy is staged in the profile's storage
 * the way the background keeps a fetched one, and the browser relaunched so
 * the background reads it: the copy carries one extra row that matches a
 * scenario script, so the simulation running it is visible in the served
 * bytes, not only in its words. The staged copy is dropped (relaunch again)
 * whatever the outcome, so every later suite runs with the miss.
 */
import { expect, test } from '../helpers/extension';
import {
  applySimulated,
  bundledDeferLists,
  bundledExclusionList,
  delayedScriptCount,
  delayLaneLines,
  documentSimulation,
  dropLatestList,
  keepLatestList,
  latestListRecord,
  openCapturedBuilder
} from '../helpers/simulation';
import { openSitePage, SITE_URL } from '../helpers/site';

/** The page WP Rocket serves without Delay JS. */
const OFF = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1&nowprocket=1`;

/** The version simulated on a page that names none, whose bundled list the copy extends. */
const SIMULATED_VERSION = '3.24';

/** The extra row: matches the scenario's benign delayed script (one of five). */
const EXTRA_ROW = 'fdt-delayed-lifecycle';

/** How old the kept copy is (its words say so). */
const COPY_AGE_MS = 3 * 60 * 60 * 1_000;

/** Bounded wait for the background's start-up refresh. */
const SETTLED = { timeout: 15_000, intervals: [100, 250, 500] };

test('the start-up refresh never reaches the endpoint; a kept latest copy runs instead of the bundled list', async ({
  extension
}) => {
  // The host block: the refresh was attempted and missed, nothing is kept.
  await expect
    .poll(async () => (await latestListRecord(extension))?.lastMiss, SETTLED)
    .toBe('network-error');
  expect((await latestListRecord(extension))?.copy).toBeUndefined();

  const fetchedAt = Date.now() - COPY_AGE_MS;
  // Staged inside the try: a failed relaunch still drops the stored copy.
  try {
    await keepLatestList(
      extension,
      [...bundledExclusionList(SIMULATED_VERSION), EXTRA_ROW],
      fetchedAt,
      bundledDeferLists(SIMULATED_VERSION)
    );
    const { opened, lastDocument } = await openCapturedBuilder(extension, (hook) =>
      openSitePage(extension, OFF, hook)
    );
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page)).toBe('Applied');
      const report = await documentSimulation(extension, tabId);
      expect(report).toMatchObject({
        state: 'simulated',
        listSource: 'latest',
        listFetchedAt: fetchedAt,
        delayed: 4
      });
      expect('listMiss' in report).toBe(false);
      // The copy's extra row is WP Rocket's own exclusion here: four scripts delayed, not five.
      const html = await lastDocument();
      expect(delayedScriptCount(html)).toBe(4);
      expect(html).toMatch(
        /<script\b(?![^>]*rocketlazyloadscript)[^>]*\bid="fdt-delayed-lifecycle-js"/
      );
      expect(await delayLaneLines(page)).toEqual(
        expect.arrayContaining([
          '4 delayed by the simulation · 0 excluded by your rows',
          'Exclusion list: latest (fetched 3 h ago)'
        ])
      );
      // A copy younger than a day is not refreshed: the endpoint was never asked again.
      expect(await latestListRecord(extension)).toMatchObject({ attemptedAt: fetchedAt });
      expect((await latestListRecord(extension))?.lastMiss).toBeUndefined();
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  } finally {
    await dropLatestList(extension);
  }
  await expect
    .poll(async () => (await latestListRecord(extension))?.lastMiss, SETTLED)
    .toBe('network-error');
  expect((await latestListRecord(extension))?.copy).toBeUndefined();
});
