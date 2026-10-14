/**
 * The shell's accessibility suite (the keyboard + audit floor's outstanding
 * legs): the route-switch focus rule landed on a real page body (needs the
 * ready boot — data
 * absent blobs have no heading to land on), keyboard-only reach for the
 * shell's header control on the same boot, and the structured a11y audit
 * (the axe run the study committed as the floor gate).
 *
 * Three axe scopes, all strict — a rule is clean only when axe reports it
 * neither `violating` nor unresolved, except the modal scopes' one reviewed
 * allowance (the `aria-hidden-focus`/`#root` unresolved shape the dialog
 * primitive itself creates — see {@link assertAxeClean}; any other
 * unresolved rule or node fails, named):
 * - the ready shell over real fixture data (nav + page + strip + live region);
 * - the palette open (the shell's heaviest ARIA surface: a modal dialog
 *   wrapping an APG combobox/listbox);
 * - the shortcuts overlay open (the shell's second modal — its portaled
 *   dialog is audited in its own mount state).
 *
 * Assertions read the app's real rendered semantics only; no test-only
 * surface is installed. The rail's own keyboard reach, focus rings and the
 * overflow affordance's keyboard walk are `panel-nav`'s standing pins and
 * are not repeated here.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The node resolver for the a11y engine's script (the tier's only consumer). */
const require = createRequire(import.meta.url);

/**
 * The a11y engine's source, installed through the debugger's evaluate (an
 * extension page's CSP is `script-src 'self'`, so no inline script tag can
 * carry it; `Runtime.evaluate` is outside the page's policy surface).
 */
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * Wait for a settled paint state: the page's mount keyframe completes (the
 * tokens' own animation ends), the fonts finish and a compositor frame is
 * up. Probed 2026-10-14 (3/3 runs): contrast audits racing the entrance
 * animation report a false `color-contrast` on the same computed colors
 * that pass once the settle completes.
 *
 * @param page The panel page to settle before an audit.
 */
async function settlePaint(page: Page): Promise<void> {
  await panelSettle(page);
  await page.waitForTimeout(200);
  // A second windmill pass guards the post-keyframe layout across resizes.
  await panelSettle(page);
}

/** Double-RAF plus the document's fonts promise (a real paint's row inputs). */
async function panelSettle(page: Page): Promise<void> {
  await page.evaluate(
    (): Promise<void> =>
      new Promise<void>((resolve) => {
        const raf = (): Promise<void> =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                done();
              });
            })
          );
        void Promise.all([document.fonts.ready, raf()]).then(() => {
          resolve();
        });
      })
  );
}

/** The axe run's per-rule fail slice the assertion reads. */
interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly nodes: readonly { readonly target: readonly string[] }[];
}

/** The axe.run result slice the suite consumes (violations + incompletes + targets). */
interface AxeResults {
  readonly violations: readonly AxeViolation[];
  /**
   * Rules axe could not resolve (unresolvable contrast pairs land here) —
   * asserted empty like `violations`: "strict" claims the resolved cases are
   * facts, never an unset list's assumption.
   */
  readonly incomplete: readonly AxeViolation[];
}

/**
 * Inject the a11y engine and run it over the document (or one include
 * selector), returning the rules that fail or remain unresolved (the caller
 * asserts them against the scope's allowance).
 *
 * The open-modal scopes audit the DIALOG's own surface deliberately: the
 * page under the modal scrim is dimmed by design, and WCAG's contrast rules
 * (1.4.3) apply to text the user is meant to read — not to a page an active
 * modal has covered. The scrimmed-below text is still audited clean when no
 * modal is up (the ready-shell run over the same document).
 *
 * @param page The panel page running the render under audit.
 * @param include An optional include selector narrowing the audit's context.
 */
async function runAxe(page: Page, include?: string): Promise<AxeResults> {
  await settlePaint(page);
  await page.evaluate(AXE_SOURCE);
  return await page.evaluate((includeSelector: string | null): Promise<AxeResults> => {
    const axe = (window as { axe?: { run(options?: object): Promise<AxeResults> } }).axe;
    if (axe === undefined) throw new Error('the axe engine did not install into the page');
    return axe.run(
      includeSelector === null ? undefined : { context: { include: [includeSelector] } }
    );
  }, include ?? null);
}

/**
 * The strict audit's gate, shared by every scope: a rule that arrives in
 * `violations` OR in `incomplete` fails, named (kind, impact, id, targets) —
 * an axe case it cannot resolve is not a pass by omission. A scope may
 * carry a reviewed allowance: the exact unresolved (rule, node-target)
 * shapes the round proved are the app's own deterministic render — probed
 * 2026-10-14 with six identical successive evaluations per modal scope:
 *
 * - `aria-hidden-focus` + `#root` (both modal scopes): the shared modal
 *   dialog shadows the shell by marking the app root `aria-hidden="true"`
 *   while the outside stays a focusable subtree (the rail's
 *   triggers/anchors, the strip's links); axe's `focusable-modal-open`
 *   check asks a person what a static engine cannot answer ("Check that
 *   focusable elements are not tabbable in the current state") for an
 *   ARIA-hidden — not `inert` — shadow. The dialog's own modal focus trap
 *   answers it in practice (the keyboard layers' pins exercise it).
 * - `aria-valid-attr-value` + the palette input (palette scope): the
 *   field's `aria-controls="fdt-command-palette-listbox"` — the referenced
 *   listbox EXISTS in the document (probed at check time), the engine's
 *   `controlsWithinPopup` review ("Unable to determine if aria-controls
 *   referenced ID exists on the page while using aria-haspopup…") is its
 *   4.14 needsReview shape for the haspopup+controls pair.
 * - `color-contrast` rows (each scope): "partially obscured" on the
 *   highlighted palette row's eliding name span (a token-transparent span,
 *   the row's highlight paints behind it) and "Element content contains
 *   only non-text characters" on the overlay's arrows kbd (`↑ ↓` — no text
 *   ratio to compute). The whole-document run — no modal up — resolves
 *   `incomplete` empty (asserted outright below).
 *
 * @param results The axe output the caller's scope produced.
 * @param allowance The scope's reviewed unresolved (rule, target) rows.
 */
function assertAxeClean(results: AxeResults, allowance: readonly UnresolvedAllowance[] = []): void {
  for (const [kind, found] of [
    ['violation', results.violations],
    ['unresolved', results.incomplete]
  ] as const) {
    for (const rule of found) {
      for (const node of rule.nodes) {
        const reported = node.target.join(' ');
        const tolerated =
          kind === 'unresolved' &&
          allowance.some(
            (row) =>
              row.id === rule.id &&
              row.targets.some((shape) =>
                typeof shape === 'string' ? shape === reported : shape.test(reported)
              )
          );
        expect(
          tolerated,
          `axe found ${kind} '${rule.impact ?? 'unknown'}' ${rule.id}: ${node.target.join(' ')}`
        ).toBe(true);
      }
    }
  }
}

/** One reviewed unresolved node: the rule id plus the target shape(s) the review covered. */
interface UnresolvedAllowance {
  /** The unresolved rule's id. */
  readonly id: string;
  /**
   * The node targets the review covered: a string must equal the engine's
   * reported target verbatim; a regex covers the engine's selector
   * minimization of the same node (the class-set breadth varies with what
   * is unambiguous in that run's document snapshot).
   */
  readonly targets: readonly (string | RegExp)[];
}

/** The open palette's reviewed unresolved rows (derivation on {@link assertAxeClean}). */
const PALETTE_ALLOWANCE: readonly UnresolvedAllowance[] = [
  { id: 'aria-hidden-focus', targets: ['#root'] },
  { id: 'aria-valid-attr-value', targets: ['#fdt-command-palette-input'] },
  {
    id: 'color-contrast',
    // The highlighted row's eliding name span (generated per-registry row id → a shape).
    targets: [/^#fdt-command-palette-listbox-item-.* > \.truncate/]
  }
];

/** The open shortcuts overlay's reviewed unresolved rows (see {@link assertAxeClean}). */
const OVERLAY_ALLOWANCE: readonly UnresolvedAllowance[] = [
  { id: 'aria-hidden-focus', targets: ['#root'] },
  {
    id: 'color-contrast',
    // The arrows kbd chip (the engine minimizes its class set across documents).
    targets: [/^\.gap-2\\\.5(\\\.items-center)?\[data-fdt="shortcut-row"\]:nth-child\(2\) > kbd$/]
  }
];

test.describe('panel keyboard + a11y', () => {
  test('route switches land keyboard focus on the page’s own h1', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(
          async () =>
            await panel.evaluate(
              (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
            ),
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBe('Detections');

      // A nav click: the focus rule (shared owner) moves focus to the body's
      // own h1 — program-focusable, so the destination announces to AT. The
      // poll takes the swap in (Solid's body keyed-when reads after the hash).
      // Scoped to the nav: page bodies may carry links naming the same page
      // (e.g. the Detections cards' "Open JavaScript").
      await panel
        .getByRole('navigation', { name: 'WPR FDT pages' })
        .getByRole('link', { name: 'JavaScript' })
        .click();
      await panel.waitForURL(/#\/javascript$/);
      await expect
        .poll(
          async (): Promise<{ text: string | null; tabindex: string | null; ownsFocus: boolean }> =>
            await panel.evaluate(
              (): { text: string | null; tabindex: string | null; ownsFocus: boolean } => {
                const heading = document.querySelector<HTMLElement>('[data-fdt-page] h1');
                return {
                  text: heading?.textContent ?? null,
                  tabindex: heading?.getAttribute('tabindex') ?? null,
                  ownsFocus: document.activeElement === heading
                };
              }
            ),
          { timeout: 10_000, intervals: [50, 100, 250] }
        )
        .toEqual({ text: 'JavaScript', tabindex: '-1', ownsFocus: true });

      // The deep-link arm of the same rule: writing the hash (a real hash
      // change, as a bookmark or the devtools window would produce) lands
      // focus the same way.
      await panel.evaluate(() => {
        location.hash = '#/undefined-references';
      });
      await expect
        .poll(
          async (): Promise<{ text: string | null; ownsFocus: boolean }> =>
            await panel.evaluate((): { text: string | null; ownsFocus: boolean } => ({
              text: document.querySelector('[data-fdt-page] h1')?.textContent ?? null,
              ownsFocus:
                document.activeElement === document.querySelector<HTMLElement>('[data-fdt-page] h1')
            })),
          { timeout: 10_000, intervals: [50, 100, 250] }
        )
        .toEqual({ text: 'Undefined References', ownsFocus: true });
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the palette trigger is keyboard-reachable with its visible ring on the ready boot', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(
          async () =>
            await panel.evaluate(
              (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
            ),
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBe('Detections');

      // Keyboard-only walk: the shell's brand-row control is the trigger; a
      // focused-by-keyboard control shows the real ring (computed outline).
      let reached = false;
      for (let step = 0; step < 4; step += 1) {
        await panel.keyboard.press('Tab');
        const state = await panel.evaluate((): { name: string; outline: string } => {
          const active = document.activeElement;
          return {
            name: active?.getAttribute('aria-label') ?? '(none)',
            outline: active instanceof HTMLElement ? getComputedStyle(active).outlineStyle : ''
          };
        });
        if (state.name === 'Command palette') {
          expect(state.outline).toBe('solid');
          reached = true;
          break;
        }
      }
      expect(reached, 'the palette trigger was not reachable within four tab stops').toBe(true);

      // And it opens the palette from the keyboard (Enter on the trigger).
      await panel.keyboard.press('Enter');
      await expect(panel.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
      await panel.keyboard.press('Escape');
      await expect(panel.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the ready shell audits clean (axe, strict)', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(
          async () =>
            await panel.evaluate(
              (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
            ),
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBe('Detections');
      await panel.setViewportSize({ width: 700, height: 900 });

      const results = await runAxe(panel);
      assertAxeClean(results);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the open palette audits clean (axe, strict)', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(
          async () =>
            await panel.evaluate(
              (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
            ),
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBe('Detections');
      await panel.setViewportSize({ width: 700, height: 900 });

      await panel.keyboard.press('ControlOrMeta+k');
      await expect(panel.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
      const results = await runAxe(panel, '[data-fdt="dialog"]');
      assertAxeClean(results, PALETTE_ALLOWANCE);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the open shortcuts overlay audits clean (axe, strict)', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(
          async () =>
            await panel.evaluate(
              (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
            ),
          { timeout: 15_000, intervals: [50, 100, 250] }
        )
        .toBe('Detections');
      await panel.setViewportSize({ width: 700, height: 900 });

      // The shell's second modal, opened from its advertised binding (the
      // unshifted `/` — `panel-shortcuts`' anti-trap pin): the audit rides
      // its own mount state (the palette was never opened here), scoped to
      // the portaled dialog's surface like the palette's run above.
      await panel.keyboard.press('/');
      await expect(panel.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();

      const results = await runAxe(panel, '[data-fdt="dialog"]');
      assertAxeClean(results, OVERLAY_ALLOWANCE);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
});
