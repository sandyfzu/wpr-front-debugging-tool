/** Independent adversarial checks of the panel's bounded workspaces. */
import { expect, openFixturePage, panelPageUrl, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Every route. */
const ROUTES = [
  'detections',
  'javascript',
  'stylesheets',
  'lazyload',
  'preloaded-resources',
  'headers-cookies',
  'undefined-references',
  'rucss-tester',
  'beacon-tester',
  'lcp-vitals'
];

test('contains long captured URLs and retains virtualization on 5000 scripts', async ({
  extension
}, info) => {
  const context = extension.browserContext;
  const pattern = '**/panel-layout-audit.html*';
  const scripts = Array.from(
    { length: 5000 },
    (_, index) =>
      `<script type="text/rocketlazyloadscript" data-rocket-src="https://example.invalid/${String(index)}/${index === 0 ? 'a'.repeat(4000) : 'asset'}.js"></script>`
  ).join('');
  await context.route(pattern, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="generator" content="WP Rocket 3.20.1"><title>Audit script inventory</title></head><body><h1>Audit</h1>${scripts}</body></html>`
    });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/panel-layout-audit.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByText('5,000 scripts', { exact: true })).toBeVisible();
    const list = panel.locator('[data-fdt="virtual-list"]');
    const rows = list.getByRole('listitem');
    await expect(rows.first()).toHaveAttribute('aria-setsize', '5000');
    expect(await rows.count()).toBeLessThan(100);
    for (const width of [320, 1280, 3440]) {
      await panel.setViewportSize({ width, height: 800 });
      expect(
        await panel
          .locator('[data-fdt="panel-content"]')
          .evaluate((el) => el.scrollWidth - el.clientWidth)
      ).toBe(0);
      await info.attach(`long-url-${String(width)}`, {
        body: await panel.screenshot(),
        contentType: 'image/png'
      });
    }
    await panel.evaluate(() => {
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
        throw new Error('Long-task observation unavailable');
      const audit = window as unknown as {
        auditLongTasks: number[];
        auditObserver: PerformanceObserver;
      };
      audit.auditLongTasks = [];
      audit.auditObserver = new PerformanceObserver((entries) => {
        audit.auditLongTasks.push(...entries.getEntries().map((entry) => entry.duration));
      });
      audit.auditObserver.observe({ type: 'longtask', buffered: false });
    });
    const search = panel.getByRole('searchbox');
    await search.fill('/4999/');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('/4999/');
    await search.fill('');
    await expect(rows.first()).toHaveAttribute('aria-setsize', '5000');
    await panel.evaluate(() => {
      location.hash = '#/detections';
    });
    await expect(panel.getByRole('heading', { name: 'Detections', exact: true })).toBeFocused();
    const durations = await panel.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          })
        )
      );
      const audit = window as unknown as {
        auditLongTasks: number[];
        auditObserver: PerformanceObserver;
      };
      audit.auditObserver.disconnect();
      return audit.auditLongTasks;
    });
    await info.attach('5000-row-action-long-tasks.json', {
      body: JSON.stringify(durations),
      contentType: 'application/json'
    });
    expect(durations.filter((duration) => duration > 50)).toEqual([]);
  } finally {
    await panel.close();
    await fixture.page.close();
    await context.unroute(pattern);
  }
});

test('reflows all routes under native 200 percent browser zoom', async ({ extension }, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
  try {
    await panel.setViewportSize({ width: 1280, height: 800 });
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    const before = await panel.evaluate(() => innerWidth);
    await extension.evaluateInWorker(
      async (url: string) => {
        const tabs = await chrome.tabs.query({ url });
        const id = tabs[0]?.id;
        if (id === undefined) throw new Error('Audit panel tab missing');
        await chrome.tabs.setZoom(id, 2);
      },
      panel.url().split('#')[0] ?? panel.url()
    );
    await expect.poll(() => panel.evaluate(() => innerWidth)).toBe(before / 2);
    for (const route of ROUTES) {
      await panel.evaluate((id) => {
        location.hash = `#/${id}`;
      }, route);
      const root = panel.locator(`[data-fdt-page="${route}"]`);
      await expect(root).toBeVisible();
      expect(await root.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      if (route === 'detections')
        await info.attach('native-zoom-200', {
          body: await panel.screenshot(),
          contentType: 'image/png'
        });
    }
  } finally {
    await extension.evaluateInWorker(
      async (url: string) => {
        const tabs = await chrome.tabs.query({ url });
        const id = tabs[0]?.id;
        if (id === undefined) throw new Error('Audit panel tab missing during zoom restore');
        await chrome.tabs.setZoom(id, 1);
      },
      panel.url().split('#')[0] ?? panel.url()
    );
    await panel.close();
    await fixture.page.close();
  }
});

test('keeps routes and hostile search contained at narrow, ultrawide and shallow sizes', async ({
  extension
}, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.evaluate(() => {
      location.hash = '#/undefined-references';
    });
    await expect(panel.locator('[data-fdt-page="undefined-references"]')).toBeVisible();
    for (const size of [
      { width: 320, height: 220 },
      { width: 3440, height: 220 },
      { width: 3440, height: 800 }
    ]) {
      await panel.setViewportSize(size);
      for (const route of ROUTES) {
        await panel.evaluate((id) => {
          location.hash = `#/${id}`;
        }, route);
        const root = panel.locator(`[data-fdt-page="${route}"]`);
        await expect(root).toBeVisible();
        await expect.poll(() => root.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
        const main = panel.locator('[data-fdt="panel-content"]');
        expect(await main.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
        // Actual route focus, not a test-issued focus() that could conceal a regression.
        await expect(root.getByRole('heading', { level: 1 })).toBeFocused();
        if (
          size.width === 3440 &&
          ['detections', 'javascript', 'undefined-references'].includes(route)
        ) {
          await info.attach(`${route}-${String(size.height)}`, {
            body: await panel.screenshot(),
            contentType: 'image/png'
          });
        }
      }
    }
    await panel.setViewportSize({ width: 320, height: 800 });
    await panel.evaluate(() => {
      location.hash = '#/javascript';
    });
    const search = panel.getByRole('searchbox');
    await search.fill('<svg/onload=alert(1)>'.repeat(100));
    await expect(panel.getByText('No matches', { exact: true })).toBeVisible();
    expect(
      await panel
        .locator('[data-fdt="panel-content"]')
        .evaluate((el) => el.scrollWidth - el.clientWidth)
    ).toBe(0);
    await panel.emulateMedia({ forcedColors: 'active' });
    await search.focus();
    await info.attach('forced-colors-long-query', {
      body: await panel.screenshot(),
      contentType: 'image/png'
    });
    await panel.getByRole('button', { name: 'Clear search', exact: true }).last().click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('loading placeholder uses the same centered bounded canvas as ready data', async ({
  extension
}, info) => {
  const fixture = await openFixturePage(extension, '/pipeline/markers.html');
  const panel = await extension.browserContext.newPage();
  try {
    await panel.setViewportSize({ width: 1920, height: 800 });
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    // Delay only the real tab-targeted API response; do not replace app state or results.
    await panel.addInitScript((tabId: number) => {
      const win = window as unknown as Record<
        string,
        { devtools: unknown; tabs: { sendMessage: (...args: unknown[]) => unknown } }
      >;
      for (const key of ['chrome', 'browser']) {
        const ns = win[key];
        if (!ns) continue;
        ns.devtools = { inspectedWindow: { tabId } };
        const send = ns.tabs.sendMessage.bind(ns.tabs);
        ns.tabs.sendMessage = (...args: unknown[]): unknown => {
          const callback = args.pop() as (response: unknown) => void;
          return send(...args, (response: unknown) => {
            setTimeout(() => {
              callback(response);
            }, 2000);
          });
        };
      }
    }, fixture.tabId);
    await panel.goto(await panelPageUrl(extension));
    const loading = panel.locator('[data-fdt-page="fetching"]');
    await expect(loading).toBeVisible();
    await info.attach('loading-1920', { body: await panel.screenshot(), contentType: 'image/png' });
    const geometry = await loading.evaluate((el) => {
      // The loading body's own box: its first bar may sit inset inside a card
      // (the page's shape), so the canvas edge is read on the body itself.
      const body = el.querySelector('[data-fdt="route-loading"]');
      if (!body) throw new Error('Missing loading body');
      const region = el.getBoundingClientRect();
      return { regionWidth: region.width, left: body.getBoundingClientRect().left - region.left };
    });
    await panel.setViewportSize({ width: 320, height: 800 });
    await expect(loading).toBeVisible();
    await panel.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          })
        )
      );
    });
    await info.attach('loading-320', { body: await panel.screenshot(), contentType: 'image/png' });
    const overflow = await loading.evaluate((el) => el.scrollWidth - el.clientWidth);
    await info.attach('loading-geometry.json', {
      body: JSON.stringify({ ...geometry, overflow }),
      contentType: 'application/json'
    });
    expect.soft(geometry.left).toBeCloseTo((geometry.regionWidth - 1280) / 2 + 12, 0);
    expect.soft(overflow).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
