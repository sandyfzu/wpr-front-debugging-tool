/** Geometry, keyboard and accessibility regressions for the shared panel canvas. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Injected by the debugger because extension CSP disallows inline scripts. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** All shipped routes plus the reserved page, with their expected width policy. */
const ROUTES = [
  { id: 'detections', label: 'Detections' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'lazyload', label: 'Lazyload' },
  { id: 'preloaded-resources', label: 'Preloaded Resources' },
  { id: 'headers-cookies', label: 'Headers & Cookies' },
  { id: 'undefined-references', label: 'Undefined References' },
  { id: 'diagnoser', label: 'Diagnoser' },
  { id: 'rucss-tester', label: 'RUCSS Tester' }
];

test('page entrances do not add transient scrollbars or suppress real overflow', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
  try {
    await panel.emulateMedia({ reducedMotion: 'no-preference' });
    for (const width of [1280, 768, 480, 320]) {
      for (const height of [800, 360]) {
        await panel.setViewportSize({ width, height });
        for (const route of ROUTES) {
          await panel.evaluate((id) => {
            location.hash = `#/${id}`;
          }, route.id);
          const root = panel.locator(`[data-fdt-page="${route.id}"]`);
          await expect(root).toBeVisible();
          const geometry = await root.evaluate((element) => {
            const region = element.closest<HTMLElement>('[data-fdt="panel-content"]');
            if (!region) throw new Error('Panel content missing');
            const animation = element
              .getAnimations({ subtree: true })
              .find(
                (candidate) =>
                  candidate instanceof CSSAnimation &&
                  candidate.animationName === 'panel-page-enter'
              );
            if (!animation) throw new Error('Page entrance missing');
            animation.pause();
            animation.currentTime = 0;
            const initial = { width: region.scrollWidth, height: region.scrollHeight };
            animation.currentTime = Number(animation.effect?.getTiming().duration) / 2;
            const middle = { width: region.scrollWidth, height: region.scrollHeight };
            animation.finish();
            const settled = { width: region.scrollWidth, height: region.scrollHeight };
            // Tall pages must still reach their bottom through the shell scroller.
            region.scrollTop = region.scrollHeight;
            const bottom = region.scrollTop;
            region.scrollTop = 0;
            return {
              initial,
              middle,
              settled,
              bottom,
              maxScroll: region.scrollHeight - region.clientHeight,
              width: region.clientWidth,
              overflow: getComputedStyle(region).overflowY
            };
          });
          expect(geometry.initial, `${route.id} at ${String(width)}×${String(height)}`).toEqual(
            geometry.settled
          );
          expect(geometry.initial.width).toBe(geometry.width);
          expect(geometry.middle).toEqual(geometry.settled);
          expect(geometry.bottom).toBe(geometry.maxScroll);
          expect(geometry.overflow).toBe('auto');
        }
      }
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

for (const theme of ['light', 'dark'] as const) {
  for (const height of [360, 800]) {
    test(`balances page canvases in ${theme} at ${String(height)}px height`, async ({
      extension
    }, info) => {
      await extension.evaluateInWorker(async (appearance: string) => {
        await chrome.storage.sync.set({ options: { appearance, improvements: {}, features: {} } });
      }, theme);
      const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
      try {
        await panel.emulateMedia({ reducedMotion: 'reduce' });
        await expect(panel.locator('html')).toHaveAttribute('data-theme', theme);
        for (const width of [320, 480, 768, 1280, 1920]) {
          await panel.setViewportSize({ width, height });
          for (const route of ROUTES) {
            await panel.evaluate((id) => {
              location.hash = `#/${id}`;
            }, route.id);
            const root = panel.locator(`[data-fdt-page="${route.id}"]`);
            await expect(root).toBeVisible();
            const heading = root.getByRole('heading', { level: 1 });
            await expect(heading).toHaveText(route.label);
            // Fill-mode entrances retain a finished Animation object, not running motion.
            await expect
              .poll(() =>
                panel.evaluate(
                  () =>
                    document
                      .getAnimations()
                      .filter((animation) => animation.playState !== 'finished').length
                )
              )
              .toBe(0);
            // Route focus and layout are observed after the browser has committed its frame.
            await heading.focus();
            const geometry = await root.evaluate((element) => {
              const body = element.querySelector<HTMLElement>('[data-fdt="page-body"]');
              const header = element.querySelector<HTMLElement>('[data-fdt="page-header"]');
              if (!body || !header) throw new Error('Page canvas or header missing');
              const region = element.getBoundingClientRect();
              const canvas = body.getBoundingClientRect();
              return {
                regionWidth: region.width,
                canvasWidth: canvas.width,
                left: canvas.left - region.left,
                right: region.right - canvas.right,
                headerWidth: header.getBoundingClientRect().width,
                overflow: element.scrollWidth - element.clientWidth
              };
            });
            const cap = ['undefined-references', 'diagnoser'].includes(route.id) ? 896 : 1280;
            expect(geometry.canvasWidth).toBeCloseTo(Math.min(geometry.regionWidth, cap), 0);
            expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(1);
            expect(geometry.headerWidth).toBeCloseTo(geometry.canvasWidth - 24, 0);
            expect(geometry.overflow).toBe(0);
            for (const list of await root.locator('[data-fdt="virtual-list"]').all()) {
              const listBox = await list.boundingBox();
              expect(listBox).not.toBeNull();
              // A result-local cap must never leave the header spanning a different canvas.
              expect(listBox?.width).toBeGreaterThanOrEqual(geometry.headerWidth - 2);
              expect(listBox?.width).toBeLessThanOrEqual(geometry.headerWidth + 8);
            }
            await expect(heading).toBeFocused();
            await panel.keyboard.press('Tab');
            const focus = await panel.evaluate(() => {
              const active = document.activeElement;
              if (!(active instanceof HTMLElement)) throw new Error('No keyboard focus');
              const box = active.getBoundingClientRect();
              const css = getComputedStyle(active);
              return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                ring:
                  css.boxShadow !== 'none' ||
                  (css.outlineStyle !== 'none' && css.outlineWidth !== '0px')
              };
            });
            expect(focus.left).toBeGreaterThanOrEqual(0);
            expect(focus.right).toBeLessThanOrEqual(width);
            expect(focus.top).toBeGreaterThanOrEqual(0);
            expect(focus.bottom).toBeLessThanOrEqual(height);
            expect(focus.ring).toBe(true);
            if (height === 800 && [320, 1280, 1920].includes(width)) {
              await panel.evaluate(AXE_SOURCE);
              const audit = await panel.evaluate(async () => {
                const axe = (
                  window as unknown as {
                    axe: {
                      run: () => Promise<{
                        violations: { id: string }[];
                        incomplete: {
                          id: string;
                          nodes: {
                            any: { data: { messageKey?: string } | null }[];
                            target: unknown;
                          }[];
                        }[];
                      }>;
                    };
                  }
                ).axe;
                const result = await axe.run();
                // The one reviewed incomplete allowance: contrast unresolved
                // because a virtual row sits half-clipped at the scroller's
                // edge (`elmPartiallyObscured` — the row is fully readable by
                // scrolling; the P6F receipt discloses exactly this for
                // virtual lists and P6.1 carries the same allowance). Every
                // node must match the message AND resolve inside a virtual
                // list; anything else stays unresolved and fails.
                const insideVirtualList = (target: unknown): boolean => {
                  if (!(target instanceof Array) || target.length === 0) return false;
                  const selector = target.filter((part) => typeof part === 'string').join(' ');
                  try {
                    // Resolve explicitly: an unresolvable target (row
                    // unmounted, selector drift) must stay unresolved —
                    // `null?.closest() !== null` would classify it in-list.
                    const el = document.querySelector(selector);
                    return el !== null && el.closest('[data-fdt="virtual-list"]') !== null;
                  } catch {
                    return false;
                  }
                };
                const unresolved = result.incomplete.filter(
                  (rule) =>
                    !(
                      rule.id === 'color-contrast' &&
                      rule.nodes.length > 0 &&
                      rule.nodes.every(
                        (node) =>
                          node.any.length > 0 &&
                          node.any.every(
                            (check) => check.data?.messageKey === 'elmPartiallyObscured'
                          ) &&
                          insideVirtualList(node.target)
                      )
                    )
                );
                return {
                  violations: result.violations.map((rule) => rule.id),
                  incomplete: unresolved.map((rule) => rule.id)
                };
              });
              expect(audit).toEqual({ violations: [], incomplete: [] });
            }
            if (
              height === 800 &&
              [320, 768, 1920].includes(width) &&
              ['detections', 'javascript', 'undefined-references'].includes(route.id)
            ) {
              await info.attach(`${route.id}-${String(width)}`, {
                body: await panel.screenshot(),
                contentType: 'image/png'
              });
            }
          }
        }
      } finally {
        await panel.close();
        await fixture.page.close();
      }
    });
  }
}

test('preserves the canvas and search through live appearance and data changes', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.setViewportSize({ width: 1920, height: 800 });
    const search = panel.getByRole('searchbox');
    const rows = panel.locator('[data-fdt="virtual-list"]').getByRole('listitem');
    await search.fill('marked-page');
    await expect(rows).toHaveCount(1);
    const body = panel.locator('[data-fdt="page-body"]');
    const before = await body.boundingBox();
    for (const appearance of ['system', 'light', 'dark']) {
      await extension.evaluateInWorker(async (value: string) => {
        await chrome.storage.sync.set({
          options: { appearance: value, improvements: {}, features: {} }
        });
      }, appearance);
      if (appearance === 'system') {
        await expect(panel.locator('html')).not.toHaveAttribute('data-theme');
        await panel.emulateMedia({ colorScheme: 'dark' });
        const dark = await body.evaluate((element) => getComputedStyle(element).color);
        await panel.emulateMedia({ colorScheme: 'light' });
        await expect
          .poll(() => body.evaluate((element) => getComputedStyle(element).color))
          .not.toBe(dark);
      } else {
        await expect(panel.locator('html')).toHaveAttribute('data-theme', appearance);
      }
      expect(await body.boundingBox()).toEqual(before);
      await expect(search).toHaveValue('marked-page');
    }
    await search.focus();
    await fixture.page.goto(new URL('/clipboard/scripts.html', fixture.page.url()).href);
    await expect(panel.getByText('No matches', { exact: true })).toBeVisible();
    await expect(search).toHaveValue('marked-page');
    await expect(search).toBeFocused();
    await expect(rows).toHaveCount(0);
    expect(await body.boundingBox()).toEqual(before);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
