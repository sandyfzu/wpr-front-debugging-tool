/**
 * P9.1 — the options page's deferred §D legs from the P9B audit, plus the
 * page's keyboard/audit floor:
 *
 * - **D-1 width walk** (the options tab's L-2 floor ≥ 320 px): at 320/480/
 *   768/1280 the document never scrolls horizontally (`scrollWidth ===
 *   clientWidth` on the document and the page's regions) and every control
 *   is reachable by real Tab — the walk asserts the exact tab order (reading
 *   order), each focused stop horizontally inside the viewport, and the
 *   visible focus treatment on it.
 * - **D-2 deferred leg** — `prefers-reduced-motion: reduce` emulated: no
 *   running animation survives the mount, every animation the engine still
 *   lists reads a collapsed duration (≤ 1 ms), and the entrance's computed
 *   animation-duration pins the token stylesheet's collapse (finished
 *   fill-mode objects are not motion).
 * - **D-4** — strict axe (the shared runner; its only allowance is the
 *   virtual-list clip shape, which cannot fire on this page — a page with
 *   no virtual list resolves `incomplete` empty outright).
 *
 * States here are the page's stable ones (the ready page, seeded fresh).
 * The KC row's per-state audits ride `options-kc-freshness` (their own
 * seeded states); the failed/retry boot state is the unit tier's pin — the
 * browser cannot order a storage-read failure deterministically without a
 * test double the built page cannot mount.
 */

import { expect, test } from '../helpers/extension';
import { runPanelAxe } from '../helpers/audit';
import { choiceTile, openOptionsPage, resetStoredOptions } from '../helpers/options';

/** The badge row's storage id (the walk's dirty-making toggle). */
const BADGE_ROW_ID = 'toolbarBadge';

/** The default shortcut as the field shows it on this machine (the harness runs the host OS). */
const DEFAULT_CHORD_TEXT = process.platform === 'darwin' ? '⌥K' : 'Alt+K';

/** The widths the walk covers: the L-2 floor, regular, wide, and the D-1 top. */
const WALK_WIDTHS = [320, 480, 768, 1280] as const;
/** The walk viewport's height (the short-height canvas balance is a panel leg). */
const WALK_HEIGHT = 800;

/** One keyboard walk stop, identified by what the DOM carries. */
interface WalkStop {
  /** The focused element's tag (`BUTTON`/`INPUT`). */
  tag: string;
  /** The input's type (`radio`/`checkbox`), null for buttons. */
  type: string | null;
  /** The owning option row's id, when the stop sits inside one. */
  row: string | null;
  /** The focused radio's tile value (the choice the arrows landed on). */
  choice: string | null;
  /** The button's own text (Save/Refresh now). */
  text: string | null;
  /** The stop's box (for the in-viewport assert). */
  box: { left: number; right: number; top: number; bottom: number };
  /** Whether a visible focus treatment (outline/box-shadow) is applied. */
  ring: boolean;
}

/**
 * The expected walk, in keyboard-move order. Radio groups expose ONE tab
 * stop (the checked radio — the platform's native roving behavior; no
 * `tabindex` attribute involved) and the arrow keys rove through the group,
 * so the walk walks Tab to the group's stop and then presses ArrowRight
 * twice — genuinely reaching all three choices from the keyboard, exactly
 * the APG radio pattern the unit tier pins.
 */
const EXPECTED_STOPS: Array<{
  tag: 'BUTTON' | 'INPUT';
  row: string | null;
  choice: string | null;
  text: string | null;
  /** Whether reaching this stop takes an arrow press (inside the radio group). */
  arrow?: boolean;
}> = [
  { tag: 'BUTTON', row: null, choice: null, text: 'Save' },
  { tag: 'INPUT', row: 'wp-dashboard-dbugger-entry', choice: null, text: null },
  { tag: 'INPUT', row: 'appearance', choice: 'system', text: null },
  { tag: 'INPUT', row: 'appearance', choice: 'dark', text: null, arrow: true },
  { tag: 'INPUT', row: 'appearance', choice: 'light', text: null, arrow: true },
  { tag: 'INPUT', row: 'page-ui-gate', choice: null, text: null },
  // The shortcut field shows the default chord in the host OS's notation.
  { tag: 'BUTTON', row: 'palette-chord', choice: null, text: DEFAULT_CHORD_TEXT },
  { tag: 'INPUT', row: 'toolbarBadge', choice: null, text: null },
  { tag: 'BUTTON', row: null, choice: null, text: 'Refresh now' }
];

test.describe('options layout & a11y', () => {
  test('the width walk: no horizontal scroll at every width and the exact tab order reachable', async ({
    extension
  }) => {
    await resetStoredOptions(extension); // Fresh-install defaults.
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      // Dirty the page so Save is enabled and joins the walk (a disabled
      // control is not a keyboard stop — its resting state is asserted in
      // the persistence suite).
      await page.locator(`[data-fdt-option="${BADGE_ROW_ID}"] [data-fdt-switch-track]`).click();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

      for (const width of WALK_WIDTHS) {
        await page.setViewportSize({ width, height: WALK_HEIGHT });

        // Normalize the group's roving stop back to System (the previous
        // width's arrow walk left Light checked) and keep the page dirty on
        // the dbugger row so Save joins the walk enabled.
        await choiceTile(page, 'system').click();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

        // No horizontal scroll anywhere: the document, the page root and
        // the content body all agree scrollWidth === clientWidth.
        const geometry = await page.evaluate(() => {
          const documentElement = document.documentElement;
          const pageRoot = document.querySelector<HTMLElement>('main[data-fdt-page="options"]');
          const body = document.querySelector<HTMLElement>('[data-fdt="options-body"]');
          const measure = (el: HTMLElement | null): number | null =>
            el === null ? null : el.scrollWidth - el.clientWidth;
          return {
            documentOverflow: documentElement.scrollWidth - documentElement.clientWidth,
            pageRootOverflow: measure(pageRoot),
            bodyOverflow: measure(body)
          };
        });
        expect(
          geometry.documentOverflow,
          `no document horizontal scroll at ${String(width)}px`
        ).toBe(0);
        expect(
          geometry.pageRootOverflow,
          `the page root never overflows at ${String(width)}px`
        ).toBe(0);
        expect(
          geometry.bodyOverflow,
          `the content body never overflows at ${String(width)}px`
        ).toBe(0);

        // The keyboard walk: restart the sequential navigation from the
        // document top (a click on the non-interactive h1 — the verified
        // restart; a programmatic body.focus() continues from the last
        // position on this Chromium build, probed), then real Tab presses,
        // stepping the radio group with real arrow presses.
        await page.locator('h1').click();
        const stops: WalkStop[] = [];
        for (const expected of EXPECTED_STOPS) {
          await page.keyboard.press(expected.arrow === true ? 'ArrowRight' : 'Tab');
          const stop = await page.evaluate((): WalkStop | null => {
            const active = document.activeElement;
            if (!(active instanceof HTMLElement) || active === document.body) return null;
            const box = active.getBoundingClientRect();
            const css = getComputedStyle(active);
            return {
              tag: active.tagName,
              type: active instanceof HTMLInputElement ? active.type : null,
              row: active.closest('[data-fdt-option]')?.getAttribute('data-fdt-option') ?? null,
              choice:
                active.closest('[data-fdt="choice"]')?.getAttribute('data-fdt-choice-value') ??
                null,
              text: active.tagName === 'BUTTON' ? active.textContent.trim() : null,
              box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
              ring:
                css.boxShadow !== 'none' ||
                (css.outlineStyle !== 'none' && css.outlineWidth !== '0px')
            };
          });
          if (stop === null)
            throw new Error(
              `the walk lost focus before ${expected.row ?? expected.text ?? expected.choice ?? '?'}`
            );
          stops.push(stop);
        }
        // The walk ends where it began: one more Tab leaves the page's
        // controls (no extra focusable lurks outside the registry's set).
        await page.keyboard.press('Tab');
        expect(
          await page.evaluate(() => document.activeElement === document.body),
          `no extra control hides outside the registry at ${String(width)}px`
        ).toBe(true);

        expect(
          stops.length,
          `exactly the registry's controls are reachable at ${String(width)}px`
        ).toBe(EXPECTED_STOPS.length);
        for (const [index, stop] of stops.entries()) {
          const expected = EXPECTED_STOPS[index];
          if (expected === undefined) throw new Error('walk overrun');
          expect(
            `${stop.tag}:${stop.row ?? ''}:${stop.choice ?? stop.text ?? ''}`,
            `stop ${String(index)} is the expected control at ${String(width)}px`
          ).toBe(`${expected.tag}:${expected.row ?? ''}:${expected.choice ?? expected.text ?? ''}`);
          // The focused stop sits inside the viewport horizontally (the
          // no-horizontal-overflow companion) and on screen vertically.
          expect(stop.box.left, `stop ${String(index)} starts on screen`).toBeGreaterThanOrEqual(0);
          expect(stop.box.right, `stop ${String(index)} ends on screen`).toBeLessThanOrEqual(width);
          expect(
            stop.box.top,
            `stop ${String(index)} intersects the viewport vertically`
          ).toBeLessThan(WALK_HEIGHT);
          expect(
            stop.box.bottom,
            `stop ${String(index)} is not above the viewport`
          ).toBeGreaterThan(0);
          expect(stop.ring, `stop ${String(index)} shows the visible focus treatment`).toBe(true);
        }

        // The narrow and wide ends audit clean (strict, both axes empty).
        if (width === 320 || width === 1280) {
          const audit = await runPanelAxe(page);
          expect(audit.violations, audit.detail.join('\n')).toEqual([]);
          expect(audit.incomplete, audit.detail.join('\n')).toEqual([]);
        }
      }
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('reduced motion: no running animation survives the mount', async ({ extension }) => {
    await resetStoredOptions(extension);
    // The emulated preference applies before the navigation (the helper's
    // pre-goto emulation), so the mount's entrance ran collapsed.
    const page = await openOptionsPage(extension, {
      colorScheme: 'light',
      reducedMotion: 'reduce'
    });
    try {
      // The shipped reduction finishes animations instantly: finished
      // fill-mode objects are not motion — a RUNNING one would be.
      await expect
        .poll(
          async () =>
            await page.evaluate(
              () =>
                document.getAnimations().filter((animation) => animation.playState === 'running')
                  .length
            )
        )
        .toBe(0);
      // The distinguishing half: collapsed BY the media rule, not merely
      // elapsed. Every animation the engine still lists reads an effective
      // duration ≤ 1 ms (0.01 under the rule; a real 180 ms entrance would
      // fail here for as long as it is listed). The entrance is `fill:
      // backwards` by design (no post-run keyframe pin), so it leaves the
      // animation set on the tick after it finishes and that read can be
      // empty — the entrance element's own computed animation-duration is
      // the time-invariant fingerprint of the same collapse.
      const listed = await page.evaluate(() =>
        document.getAnimations().map((animation) => {
          const duration = animation.effect?.getComputedTiming().duration;
          return typeof duration === 'number' ? duration : null;
        })
      );
      expect(
        listed.every((duration) => duration !== null && duration <= 1),
        'every animation the engine still lists is collapsed (≤ 1 ms), not merely elapsed'
      ).toBe(true);
      const entranceDuration = await page.evaluate(() => {
        const entrance = document.querySelector<HTMLElement>(
          ".fdt-page > [data-fdt='options-body']"
        );
        if (entrance === null) return null;
        const declared = getComputedStyle(entrance).animationDuration;
        // `1e-05s` (this build's serialization) or `0.01ms` — read as
        // milliseconds either way.
        return Number.parseFloat(declared) * (declared.trim().endsWith('ms') ? 1 : 1000);
      });
      expect(entranceDuration, 'the mount entrance element is present').not.toBeNull();
      expect(
        entranceDuration,
        "the entrance's computed animation-duration is the media rule's collapse (≤ 1 ms)"
      ).toBeLessThanOrEqual(1);
      // The page is real, not stranded: the controls answer (state is never
      // hidden behind a motion state — M-6's strand rule).
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
      await expect(
        page.locator('[data-fdt="option-row"][data-fdt-option="wp-dashboard-dbugger-entry"]')
      ).toBeVisible();
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });
});
