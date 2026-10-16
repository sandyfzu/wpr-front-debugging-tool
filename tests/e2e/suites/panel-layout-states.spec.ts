/** Real boot flights hold their genuine replies while every route's fallback is measured. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { expect, openFixturePage, panelPageUrl, test } from '../helpers/extension';

/** Debugger injection is required by extension CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);
/** Width expectations deliberately pin behavior independently of production metadata. */
const ROUTES = [
  'detections',
  'javascript',
  'lazyload',
  'preloaded-resources',
  'headers-cookies',
  'undefined-references',
  'diagnoser'
];

/**
 * Assert real containment, not clipping that could hide an oversized bar.
 * @param panel The extension document to measure after layout commits.
 * @param id The destination route whose independent width expectation applies.
 * @returns Canvas offset and width for loading-to-ready equality checks.
 */
async function canvasGeometry(panel: Page, id: string): Promise<{ left: number; width: number }> {
  const main = panel.locator('[data-fdt="panel-content"]');
  const geometry = await main.evaluate(async (element) => {
    // Container-query layout must commit after a resize/class change before measurement.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    const body = element.querySelector<HTMLElement>('[data-fdt="page-body"]');
    if (!body) throw new Error('Missing page canvas');
    const region = element.getBoundingClientRect();
    const box = body.getBoundingClientRect();
    const contentLeft = box.left + 12;
    const contentRight = box.right - 12;
    return {
      regionWidth: region.width,
      hash: location.hash,
      classes: body.className,
      width: box.width,
      left: box.left - region.left,
      right: region.right - box.right,
      overflow: element.scrollWidth - element.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth,
      barsContained: [...body.querySelectorAll('[data-fdt="skeleton"]')].every((bar) => {
        const rect = bar.getBoundingClientRect();
        return rect.left >= contentLeft && rect.right <= contentRight;
      })
    };
  });
  const cap = ['undefined-references', 'diagnoser'].includes(id) ? 896 : 1280;
  expect(geometry.width, JSON.stringify({ id, ...geometry })).toBeCloseTo(
    Math.min(geometry.regionWidth, cap),
    0
  );
  expect(geometry.left).toBeCloseTo(geometry.right, 0);
  expect(geometry.overflow).toBe(0);
  expect(geometry.bodyOverflow).toBe(0);
  expect(geometry.barsContained).toBe(true);
  return { left: geometry.left, width: geometry.width };
}

/**
 * Audit fallbacks after paint, pinning the existing heading-less shell exception.
 * Loading must not invent a route heading; the ready route owns the real h1.
 * No rules are disabled: any other violation or incomplete result fails.
 * @param panel The visible loading or data-error document to audit.
 * @returns Resolves after every axe result has been asserted.
 */
async function auditState(panel: Page): Promise<void> {
  await panel.evaluate(AXE_SOURCE);
  const result = await panel.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      })
    );
    const axe = (
      window as unknown as {
        axe: { run: () => Promise<{ violations: { id: string }[]; incomplete: { id: string }[] }> };
      }
    ).axe;
    const audit = await axe.run();
    return {
      violations: audit.violations.map((rule) => rule.id),
      incomplete: audit.incomplete.map((rule) => rule.id)
    };
  });
  expect(result).toEqual({ violations: ['page-has-heading-one'], incomplete: [] });
}

for (const theme of ['system', 'light', 'dark']) {
  test(`aligns genuine delayed loading, ready and error canvases in ${theme}`, async ({
    extension
  }, info) => {
    await extension.evaluateInWorker(async (appearance: string) => {
      await chrome.storage.sync.set({ options: { appearance, improvements: {}, features: {} } });
    }, theme);
    const fixture = await openFixturePage(extension, '/pipeline/markers.html');
    const panel = await extension.browserContext.newPage();
    try {
      await panel.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
      await panel.addInitScript((tabId: number) => {
        const win = window as unknown as {
          chrome: typeof chrome;
          browser?: typeof chrome;
          releaseLayoutReply?: () => void;
          layoutReplyHeld?: boolean;
        };
        let released = false;
        const pending: (() => void)[] = [];
        win.releaseLayoutReply = (): void => {
          released = true;
          for (const reply of pending.splice(0)) reply();
        };
        for (const ns of [win.chrome, win.browser]) {
          if (!ns) continue;
          Object.defineProperty(ns, 'devtools', {
            configurable: true,
            value: { inspectedWindow: { tabId } }
          });
          const send = ns.tabs.sendMessage.bind(ns.tabs);
          ns.tabs.sendMessage = ((...args: unknown[]): unknown => {
            const callback = args.pop() as (reply: unknown) => void;
            return Reflect.apply(send, ns.tabs, [
              ...args,
              (reply: unknown) => {
                if (released) callback(reply);
                else {
                  pending.push(() => {
                    callback(reply);
                  });
                  win.layoutReplyHeld = true;
                }
              }
            ]);
          }) as typeof ns.tabs.sendMessage;
        }
      }, fixture.tabId);
      await panel.goto(`${await panelPageUrl(extension)}#/undefined-references`);
      const loading = panel.locator('[data-fdt-page="fetching"]');
      await expect(loading).toBeVisible();
      await expect
        .poll(() =>
          panel.evaluate(() => (window as unknown as { layoutReplyHeld: boolean }).layoutReplyHeld)
        )
        .toBe(true);
      await panel.setViewportSize({ width: 320, height: 800 });
      const destination = panel.getByRole('link', { name: 'JavaScript', exact: true });
      for (let stop = 0; stop < 30; stop += 1) {
        await panel.keyboard.press('Tab');
        if (await destination.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(destination).toBeFocused();
      await panel.keyboard.press('Enter');
      await expect(panel).toHaveURL(/#\/javascript$/);
      await expect(loading).toBeVisible();
      await expect
        .poll(() =>
          panel.evaluate(
            () =>
              document.getAnimations().filter((animation) => animation.playState !== 'finished')
                .length
          )
        )
        .toBe(0);
      for (const width of [320, 480, 768, 1280, 1920]) {
        await panel.setViewportSize({ width, height: 800 });
        for (const id of ROUTES) {
          await panel.evaluate((route) => {
            location.hash = `#/${route}`;
          }, id);
          await expect(loading).toBeVisible();
          await expect
            .poll(async () => {
              const cap = ['undefined-references', 'diagnoser'].includes(id)
                ? 'max-w-4xl'
                : 'max-w-7xl';
              return panel
                .locator('[data-fdt="page-body"]')
                .evaluate((el, cls) => el.classList.contains(cls), cap);
            })
            .toBe(true);
          await canvasGeometry(panel, id);
          if ([320, 1920].includes(width) && ['detections', 'undefined-references'].includes(id)) {
            await auditState(panel);
            await info.attach(`loading-${theme}-${id}-${String(width)}`, {
              body: await panel.screenshot(),
              contentType: 'image/png'
            });
          }
        }
      }
      const before = await canvasGeometry(panel, 'diagnoser');
      await panel.evaluate(() => {
        (window as unknown as { releaseLayoutReply: () => void }).releaseLayoutReply();
      });
      await expect(panel.locator('[data-fdt-page="diagnoser"]')).toBeVisible();
      expect(await canvasGeometry(panel, 'diagnoser')).toEqual(before);
      for (const width of [320, 1920]) {
        await panel.setViewportSize({ width, height: 800 });
        for (const id of ['javascript', 'undefined-references']) {
          await panel.evaluate((route) => {
            location.hash = `#/${route}`;
          }, id);
          const heading = panel.locator(`[data-fdt-page="${id}"] h1`);
          await expect(heading).toBeFocused();
          await canvasGeometry(panel, id);
          await info.attach(`ready-${theme}-${id}-${String(width)}`, {
            body: await panel.screenshot(),
            contentType: 'image/png'
          });
        }
      }
      await panel.evaluate(() => {
        location.hash = '#/javascript';
      });
      await panel.reload();
      await expect(loading).toBeVisible();
      await expect
        .poll(() =>
          panel.evaluate(() => (window as unknown as { layoutReplyHeld: boolean }).layoutReplyHeld)
        )
        .toBe(true);
      const dataBefore = await canvasGeometry(panel, 'javascript');
      await panel.evaluate(() => {
        (window as unknown as { releaseLayoutReply: () => void }).releaseLayoutReply();
      });
      await expect(panel.locator('[data-fdt-page="javascript"]')).toBeVisible();
      expect(await canvasGeometry(panel, 'javascript')).toEqual(dataBefore);
      await expect
        .poll(() =>
          panel.evaluate(
            () =>
              document.getAnimations().filter((animation) => animation.playState !== 'finished')
                .length
          )
        )
        .toBe(0);
      // A standalone extension page takes the real missing-inspected-tab error path.
      // Remove the boot shim only in a fresh document, not in the app store.
      const errorPanel = await extension.browserContext.newPage();
      try {
        await errorPanel.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
        await errorPanel.goto(await panelPageUrl(extension));
        await expect(
          errorPanel.getByText("Couldn't load page data", { exact: true })
        ).toBeVisible();
        for (const width of [320, 480, 768, 1280, 1920]) {
          await errorPanel.setViewportSize({ width, height: 800 });
          for (const id of ['javascript', 'undefined-references']) {
            await errorPanel.evaluate((route) => {
              location.hash = `#/${route}`;
            }, id);
            await expect
              .poll(async () => {
                const cap = id === 'undefined-references' ? 'max-w-4xl' : 'max-w-7xl';
                return errorPanel
                  .locator('[data-fdt="page-body"]')
                  .evaluate((el, cls) => el.classList.contains(cls), cap);
              })
              .toBe(true);
            await canvasGeometry(errorPanel, id);
            if ([320, 1920].includes(width)) {
              await auditState(errorPanel);
              const retry = errorPanel.getByRole('button', { name: 'Retry', exact: true });
              for (let stop = 0; stop < 30; stop += 1) {
                await errorPanel.keyboard.press('Tab');
                if (await retry.evaluate((el) => el === document.activeElement)) break;
              }
              await expect(retry).toBeFocused();
              expect(
                await retry.evaluate((el) => {
                  const css = getComputedStyle(el);
                  return (
                    css.boxShadow !== 'none' ||
                    (css.outlineStyle !== 'none' && css.outlineWidth !== '0px')
                  );
                })
              ).toBe(true);
              await info.attach(`error-${theme}-${id}-${String(width)}`, {
                body: await errorPanel.screenshot(),
                contentType: 'image/png'
              });
              await errorPanel.keyboard.press('Enter');
              await expect(
                errorPanel.getByText("Couldn't load page data", { exact: true })
              ).toBeVisible();
            }
          }
        }
      } finally {
        await errorPanel.close();
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
