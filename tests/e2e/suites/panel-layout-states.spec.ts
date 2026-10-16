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
    // A painted native track occupies the border box, not the canvas's usable scrollport.
    const regionLeft = region.left + element.clientLeft;
    const regionRight = regionLeft + element.clientWidth;
    const box = body.getBoundingClientRect();
    const contentLeft = box.left + 12;
    const contentRight = box.right - 12;
    return {
      regionWidth: element.clientWidth,
      trackWidth: region.width - element.clientWidth,
      hash: location.hash,
      classes: body.className,
      width: box.width,
      left: box.left - regionLeft,
      right: regionRight - box.right,
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
 * Audit the whole fallback document after paint without excluding any axe rules.
 * The visible h1 names the actual state, never pretends route data is ready.
 * @param panel The visible loading or data-error document to audit.
 * @returns Resolves after every axe result has been asserted.
 */
async function auditState(panel: Page): Promise<void> {
  await expect(panel.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(panel.getByRole('heading', { level: 1 })).toBeVisible();
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
  expect(result).toEqual({ violations: [], incomplete: [] });
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
      await expect(panel.getByRole('heading', { name: 'Loading page data' })).toBeFocused();
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

for (const theme of ['light', 'dark']) {
  for (const recoveryWidth of [320, 1920]) {
    test(`keeps fetch failure, held Retry and crash recovery accessible in ${theme} at ${String(recoveryWidth)}px`, async ({
      extension
    }, info) => {
      await extension.evaluateInWorker(async (appearance: string) => {
        await chrome.storage.sync.set({ options: { appearance, improvements: {}, features: {} } });
      }, theme);
      const fixture = await openFixturePage(extension, '/pipeline/markers.html');
      const panel = await extension.browserContext.newPage();
      try {
        await panel.emulateMedia({ reducedMotion: 'reduce' });
        await panel.addInitScript((tabId: number) => {
          // WXT reads the available browser namespace; messaging uses Chrome's callback API.
          const namespaces = window as unknown as {
            chrome: typeof chrome;
            browser?: typeof chrome;
          };
          for (const ns of [namespaces.chrome, namespaces.browser]) {
            if (ns)
              Object.defineProperty(ns, 'devtools', {
                configurable: true,
                value: { inspectedWindow: { tabId } }
              });
          }
          const win = window as unknown as {
            releaseStateReply: () => void;
            stateReplyHeld: boolean;
          };
          let released = sessionStorage.getItem('state-recovered') === 'yes';
          const pending: (() => void)[] = [];
          win.releaseStateReply = (): void => {
            released = true;
            sessionStorage.setItem('state-recovered', 'yes');
            for (const reply of pending.splice(0)) reply();
          };
          const send = chrome.tabs.sendMessage.bind(chrome.tabs);
          chrome.tabs.sendMessage = ((...args: unknown[]): unknown => {
            const callback = args.pop() as (reply: unknown) => void;
            return Reflect.apply(send, chrome.tabs, [
              ...args,
              (reply: unknown) => {
                if (sessionStorage.getItem('state-failed') !== 'yes') {
                  sessionStorage.setItem('state-failed', 'yes');
                  callback({
                    err: 'Could not establish connection. Receiving end does not exist.'
                  });
                } else if (released) callback(reply);
                else {
                  pending.push(() => {
                    callback(reply);
                  });
                  win.stateReplyHeld = true;
                }
              }
            ]);
          }) as typeof chrome.tabs.sendMessage;
        }, fixture.tabId);
        await panel.goto(`${await panelPageUrl(extension)}#/undefined-references`);
        const title = panel.getByRole('heading', { level: 1 });
        await expect(title).toHaveText("Couldn't load page data");
        await expect(panel.getByRole('alert')).toContainText('no data source reachable');
        expect(await panel.evaluate(() => sessionStorage.getItem('state-failed'))).toBe('yes');
        for (const width of [320, 1920]) {
          await panel.setViewportSize({ width, height: 220 });
          await canvasGeometry(panel, 'undefined-references');
          if (width === 320) {
            // Keep this a genuine occupied-track regression, never an overlay-only pass.
            expect(
              await panel.locator('[data-fdt="panel-content"]').evaluate((element) => ({
                overflows: element.scrollHeight > element.clientHeight,
                trackWidth: element.getBoundingClientRect().width - element.clientWidth
              }))
            ).toEqual({ overflows: true, trackWidth: 8 });
          }
          await auditState(panel);
          await info.attach(`fetch-error-${theme}-${String(width)}`, {
            body: await panel.screenshot(),
            contentType: 'image/png'
          });
        }
        await panel.setViewportSize({ width: recoveryWidth, height: 220 });
        const retry = panel.getByRole('button', { name: 'Retry', exact: true });
        for (let stop = 0; stop < 30; stop += 1) {
          await panel.keyboard.press('Tab');
          if (await retry.evaluate((el) => el === document.activeElement)) break;
        }
        await expect(retry).toBeFocused();
        await panel.keyboard.press('Enter');
        await expect(title).toHaveText('Loading page data');
        await expect(panel.getByRole('alert')).toHaveCount(0);
        await expect
          .poll(() =>
            panel.evaluate(() => (window as unknown as { stateReplyHeld: boolean }).stateReplyHeld)
          )
          .toBe(true);
        for (const width of [320, 1920]) {
          await panel.setViewportSize({ width, height: 220 });
          await canvasGeometry(panel, 'undefined-references');
          await auditState(panel);
        }
        await panel.evaluate(() => {
          (window as unknown as { releaseStateReply: () => void }).releaseStateReply();
        });
        await expect(title).toHaveText('Undefined References');
        await expect(panel.locator('[data-fdt-page="fetching"]')).toHaveCount(0);
        // Throw once at an actual route render, restoring the native method first.
        await panel.evaluate(() => {
          // Keep the native function identity for restoration; calls below bind the element.
          // eslint-disable-next-line @typescript-eslint/unbound-method
          const setAttribute = Element.prototype.setAttribute;
          /** Fail only the requested render; all other writes retain their native receiver. */
          Element.prototype.setAttribute = function (name: string, value: string): void {
            if (name === 'data-fdt-page' && value === 'javascript') {
              Element.prototype.setAttribute = setAttribute;
              throw new Error('One-shot browser render failure');
            }
            setAttribute.call(this, name, value);
          };
          location.hash = '#/javascript';
        });
        await expect(title).toHaveText('The panel came apart');
        await expect(panel.getByText('One-shot browser render failure')).toHaveCount(0);
        for (const width of [320, 1920]) {
          await panel.setViewportSize({ width, height: 220 });
          for (const id of ROUTES) {
            await panel.evaluate((route) => {
              location.hash = `#/${route}`;
            }, id);
            await expect(panel).toHaveURL(new RegExp(`#/${id}$`));
            await canvasGeometry(panel, id);
          }
          await auditState(panel);
          await info.attach(`crash-${theme}-${String(width)}`, {
            body: await panel.screenshot(),
            contentType: 'image/png'
          });
        }
        await panel.setViewportSize({ width: recoveryWidth, height: 220 });
        for (let stop = 0; stop < 30; stop += 1) {
          await panel.keyboard.press('Tab');
          if (await retry.evaluate((el) => el === document.activeElement)) break;
        }
        await expect(retry).toBeFocused();
        await panel.keyboard.press('Enter');
        await expect(panel.locator('[data-fdt-page="diagnoser"]')).toBeVisible();
        await expect(panel.getByRole('alert')).toHaveCount(0);
        await expect(title).toHaveCount(1);
        await auditState(panel);
      } finally {
        await panel.close();
        await fixture.page.close();
      }
    });
  }
}
