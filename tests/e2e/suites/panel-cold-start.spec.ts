/**
 * The panel's cold-start gate: the budget table's typed timing row
 * (`panel cold-start ≤ 500 ms on the harness fixture`) measured against the
 * shell's committed User Timing chain — script start → shell interactive →
 * first data state.
 *
 * Why a browser pin: the marks land only in the real document timeline; the
 * budgeted span is the entry's execution → the first data settle. The ESM
 * import graph (fetch/parse/eval) completes BEFORE the entry body's first
 * statement — the script-start mark — so that pre-span cost is visible only
 * in that mark's absolute `startTime`, not in this span; a pre-mark ceiling
 * is a candidate addition for the P5.1 execution, not planned budget work
 * today. The storage appearance read and the boot flight sit inside the
 * span, on the same chromium the harness loads the extension in.
 *
 * Settle leg, pinned with its transport fact: the harness drives the panel
 * as a standalone extension page — `devtools.inspectedWindow.tabId` does not
 * exist there, and the boot fetch's broadcast (`runtime.sendMessage`, the
 * library's no-tab arm) never reaches content scripts, so the chain settles
 * into the recorded error state. That is the deterministic cold start this
 * gate covers: both marks and the full entry-execution → settle span. The
 * ready-leg cold start (the real data round trip) needs the inspected-tab
 * data path the panel-shell suites' fixture plan owns.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, panelPageUrl, test } from '../helpers/extension';

/** The committed budget table — the timing row's single declaring site. */
const budgets = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'budgets.json'),
    'utf8'
  )
) as Array<{ surface: string; kind?: string; maxMs?: number; measuredBy?: string }>;

/** The row this spec measures by; a lost row is a broken gate. */
const coldStartRow = budgets.find(
  (row) => row.kind === 'timing' && row.surface === 'panel cold-start (harness fixture)'
);
if (coldStartRow === undefined || typeof coldStartRow.maxMs !== 'number') {
  throw new Error(
    'scripts/budgets.json lost the "panel cold-start (harness fixture)" timing row — the gate has nothing to assert'
  );
}

/** The ceiling comes from the committed table, never duplicated here. */
const COLD_START_MAX_MS = coldStartRow.maxMs;

/* The mark names below repeat the panel's committed constants — test literals
 * pin behavior; importing the entry module would drag Solid into the spec's
 * node context (and Playwright serialize the values only incidentally). */

/** Script start: the bundled panel entry's first statement. */
const SCRIPT_START = 'wpr-fdt:panel:script-start';
/** The shell is mounted and interactive. */
const SHELL_INTERACTIVE = 'wpr-fdt:panel:shell-interactive';
/** The boot flight's first settle (ready or error — both genuine answers). */
const FIRST_DATA_STATE = 'wpr-fdt:panel:first-data-state';
/** The budgeted span: script start → first data state. */
const COLD_START_SPAN = 'wpr-fdt:panel:cold-start';

/** A serialized-evaluate helper is not possible (module scope does not cross);
 * the polls inline the one literal they need. */

/** One committed mark's start time; a missing entry names itself. */
function markAt(marks: Record<string, number>, name: string): number {
  const at = marks[name];
  if (at === undefined) throw new Error(`the ${name} mark is missing from the timeline`);
  return at;
}

/** One committed span's duration; a missing window names itself. */
function spanOf(spans: Record<string, number>, name: string): number {
  const duration = spans[name];
  if (duration === undefined) throw new Error(`the ${name} window is missing from the timeline`);
  return duration;
}

test.describe('panel cold start (the timing row)', () => {
  test('the boot chain marks once and stays under the committed ceiling', async ({ extension }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

      // The settle: the last chain entry only exists after the boot flight
      // completed (the error leg on the harness — see the file header). A
      // boot that still hangs fails this poll, which is the gate's job.
      await expect
        .poll(
          async () =>
            await page.evaluate(
              (): number => performance.getEntriesByName('wpr-fdt:panel:first-data-state').length
            ),
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBeGreaterThan(0);

      const legAndTimeline = await page.evaluate(() => {
        // Raw buffer reads, not name-deduplicated: a once-guard regression
        // fires a mark twice and a dictionary would overwrite one key — the
        // per-name entry counts and the buffer's own order are the record.
        const names = [
          'wpr-fdt:panel:script-start',
          'wpr-fdt:panel:shell-interactive',
          'wpr-fdt:panel:first-data-state'
        ] as const;
        const marks: Record<string, number> = {};
        const markCounts: Record<string, number> = {};
        for (const name of names) {
          // Type-filtered: the shell-interactive name carries BOTH its mark
          // and its window (the window's name is the mark's, by design), so
          // an untyped name lookup double-counts it.
          const entries = performance.getEntriesByName(name, 'mark');
          markCounts[name] = entries.length;
          marks[name] = entries[0]?.startTime ?? -1;
        }
        const ordered = performance
          .getEntriesByType('mark')
          .filter((entry) => entry.name.startsWith('wpr-fdt:panel:'))
          .map((entry) => entry.name);
        const spans: Record<string, number> = {};
        for (const entry of performance.getEntriesByType('measure')) {
          if (entry.name.startsWith('wpr-fdt:panel:')) spans[entry.name] = entry.duration;
        }
        return {
          ordered,
          markCounts,
          marks,
          spans,
          errorShown: document.body.textContent.includes("Couldn't load page data")
        };
      });

      // Exactly three panel marks, each recorded exactly once, in boot
      // order — the raw timeline's own record (a repeated mark would append
      // a second entry and this count would read 4).
      expect(legAndTimeline.ordered).toEqual([
        'wpr-fdt:panel:script-start',
        'wpr-fdt:panel:shell-interactive',
        'wpr-fdt:panel:first-data-state'
      ]);
      for (const count of Object.values(legAndTimeline.markCounts)) {
        expect(count).toBe(1);
      }
      const scriptStart = markAt(legAndTimeline.marks, SCRIPT_START);
      const shellInteractive = markAt(legAndTimeline.marks, SHELL_INTERACTIVE);
      const firstDataState = markAt(legAndTimeline.marks, FIRST_DATA_STATE);
      expect(scriptStart).toBeGreaterThan(0);
      expect(shellInteractive).toBeGreaterThanOrEqual(scriptStart);
      expect(firstDataState).toBeGreaterThanOrEqual(shellInteractive);

      // Both windows exist, in their truthful magnitudes…
      expect(spanOf(legAndTimeline.spans, SHELL_INTERACTIVE)).toBeGreaterThan(0);
      expect(spanOf(legAndTimeline.spans, SHELL_INTERACTIVE)).toBeLessThanOrEqual(
        COLD_START_MAX_MS
      );
      // …and the budgeted span is the row's gate: cold start ≤ 500 ms.
      const coldStart = spanOf(legAndTimeline.spans, COLD_START_SPAN);
      expect(coldStart).toBeGreaterThan(0);
      expect(coldStart).toBeLessThanOrEqual(COLD_START_MAX_MS);

      // The settle leg the harness can drive: the honest recorded error (its
      // own retry affordance is the recovery; a ready boot is the inspected-
      // tab path's suite).
      expect(legAndTimeline.errorShown).toBe(true);
    } finally {
      await page.close();
    }
  });
});
