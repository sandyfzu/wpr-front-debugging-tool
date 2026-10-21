/** Refresh reuse through real capture, boundary validation and panel pushes. */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { bundleModuleForPage } from '../helpers/page-bundle';

test('focus restoration in Chromium requires a real move and respects transfer, removal and disposal', async ({
  extension
}) => {
  const page = await extension.browserContext.newPage();
  try {
    // Exercise the shipped module (with its own helpers) in a real DOM; no
    // app/store test hook.
    await page.addScriptTag({
      content: await bundleModuleForPage('components/ui/virtual-list-focus.ts', '__listFocus')
    });
    const run = (mode: 'document' | 'shadow'): Promise<Record<string, boolean>> =>
      page.evaluate(async (mount) => {
        const preserve = (
          window as unknown as {
            __listFocus: { preserveMovedFocus: (container: HTMLElement) => () => void };
          }
        ).__listFocus.preserveMovedFocus;
        const results: Record<string, boolean> = {};
        for (const scenario of [
          'move',
          'ancestor',
          'blur',
          'unrelated',
          'transfer',
          'stopped-transfer',
          'removed',
          'replaced',
          'disposed'
        ]) {
          const container = document.createElement('div');
          const wrapper = document.createElement('div');
          const button = document.createElement('button');
          const outside = document.createElement('button');
          wrapper.append(button);
          container.append(wrapper);
          // Shadow mode: the list lives in a shadow root (injected UIs), where
          // the document reports only the host as focused.
          const host = document.createElement('div');
          const tree = mount === 'shadow' ? host.attachShadow({ mode: 'open' }) : document;
          if (mount === 'shadow') {
            host.shadowRoot?.append(container);
            document.body.append(host, outside);
          } else document.body.append(container, outside);
          button.focus();
          const cancel = preserve(container);
          if (scenario === 'blur') button.blur();
          else if (scenario === 'unrelated') {
            const sibling = document.createElement('span');
            container.append(sibling);
            sibling.remove();
            button.blur();
          } else {
            const moved = scenario === 'ancestor' ? wrapper : button;
            moved.remove();
            if (scenario === 'replaced') container.append(document.createElement('button'));
            else if (scenario !== 'removed') container.append(moved);
            if (scenario === 'stopped-transfer')
              outside.addEventListener('focusin', (event) => {
                event.stopPropagation();
              });
            if (scenario === 'transfer' || scenario === 'stopped-transfer') {
              outside.focus();
              outside.blur();
            }
            if (scenario === 'disposed') cancel();
          }
          await new Promise<void>((resolve) => {
            queueMicrotask(resolve);
          });
          results[scenario] = tree.activeElement === button;
          container.remove();
          host.remove();
          outside.remove();
        }
        return results;
      }, mode);
    const expected = {
      move: true,
      ancestor: true,
      blur: false,
      unrelated: false,
      transfer: false,
      'stopped-transfer': false,
      removed: false,
      replaced: false,
      disposed: false
    };
    expect(await run('document')).toEqual(expected);
    expect(await run('shadow')).toEqual(expected);
  } finally {
    await page.close();
  }
});

test('script occurrence keys and expanded state survive insertion/reorder and prune on removal', async ({
  extension
}) => {
  const pattern = '**/pipeline/script-reuse.html*';
  const duplicate =
    '<script type="rocketlazyloadscript" data-rocket-src="https://example.test/repeated.js"></script>';
  const inline =
    '<script type="rocketlazyloadscript">const one = 1;\nconst two = 2;\nconst three = 3;\nconst four = 4;\nconst five = 5;</script>';
  const added =
    '<script type="rocketlazyloadscript" data-rocket-src="https://example.test/added.js"></script>';
  let scripts = [duplicate, duplicate, inline];
  await extension.browserContext.route(pattern, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Script reuse</title></head><body><h1>Script reuse</h1>${scripts.join('')}</body></html>`
    });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/script-reuse.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    const root = panel.locator('[data-fdt-page="javascript"]');
    const chip = root.locator('[data-fdt-filter-chip="all"]');
    await expect(chip).toHaveAccessibleName('Show all 3 matching');
    const toggle = root.locator('[data-fdt="script-code-toggle"]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.focus();
    const focused = await toggle.elementHandle();
    const duplicates = await root
      .locator('[data-fdt="script-row"][data-fdt-script-type="external"]')
      .elementHandles();
    expect(duplicates).toHaveLength(2);
    scripts = [added, inline, duplicate, duplicate];
    await fixture.page.reload({ waitUntil: 'load' });
    await expect(chip).toHaveAccessibleName('Show all 4 matching');
    expect(
      await focused.evaluate((element) => ({
        connected: element.isConnected,
        focused: element === document.activeElement,
        active: document.activeElement?.outerHTML
      }))
    ).toMatchObject({ connected: true, focused: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const row of duplicates)
      expect(await row.evaluate((element) => element.isConnected)).toBe(true);
    scripts = [added, duplicate, duplicate];
    await fixture.page.reload({ waitUntil: 'load' });
    await expect(chip).toHaveAccessibleName('Show all 3 matching');
    expect(await focused.evaluate((element) => element.isConnected)).toBe(false);
    scripts = [added, inline, duplicate, duplicate];
    await fixture.page.reload({ waitUntil: 'load' });
    await expect(chip).toHaveAccessibleName('Show all 4 matching');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await focused.dispose();
    for (const row of duplicates) await row.dispose();
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(pattern);
  }
});

/**
 * Generate inert inventories with a count change that proves the refresh settled.
 * @param count Number of entries in each inventory.
 * @param revision Change resource data without changing its positional identity.
 * @returns A page captured by the shipped content script without remote requests.
 */
function inventory(count: number, revision = 0): string {
  const rows = Array.from({ length: count }, (_, index) => {
    const url = `https://example.test/reuse-${String(index)}-${String(revision)}.js`;
    return `<script type="rocketlazyloadscript" data-rocket-src="${url}"></script>
      <img data-lazy-src="${url}" alt="Fixture ${String(index)}">
      <link data-rocket-preload as="image" href="${url}">`;
  });
  return `<!doctype html><html lang="en"><head><title>List reuse</title></head><body>
    <h1>List reuse</h1>${rows.join('')}</body></html>`;
}

for (const id of ['javascript', 'lazyload', 'preloaded-resources']) {
  test(`${id} preserves a focused row and scroll through a captured append/delete refresh`, async ({
    extension
  }) => {
    const pattern = '**/pipeline/list-reuse.html*';
    let count = 100;
    let revision = 0;
    await extension.browserContext.route(pattern, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: inventory(count, revision) });
    });
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/list-reuse.html', {
      bootHash: `#/${id}`
    });
    try {
      await panel.emulateMedia({ reducedMotion: 'reduce' });
      const root = panel.locator(`[data-fdt-page="${id}"]`);
      const chip = root.locator('[data-fdt-filter-chip="all"]');
      await expect(chip).toHaveAccessibleName('Show all 100 matching');
      const scroller = root.locator('[data-fdt="virtual-list"]');
      await scroller.evaluate((element) => {
        element.scrollTop = 400;
      });
      // Focus a currently visible row, not an offscreen overscan entry.
      await expect
        .poll(() =>
          scroller.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const link = [
              ...element.querySelectorAll<HTMLAnchorElement>('[data-fdt="external-link"]')
            ].find((candidate) => {
              const box = candidate.getBoundingClientRect();
              return box.top >= bounds.top && box.bottom <= bounds.bottom;
            });
            if (link === undefined) return false;
            link.focus();
            return document.activeElement === link;
          })
        )
        .toBe(true);
      const focused = await panel.evaluateHandle(() => document.activeElement);
      const top = await scroller.evaluate((element) => element.scrollTop);
      expect(top).toBeGreaterThan(0);
      for (const nextCount of [101, 100]) {
        count = nextCount;
        await fixture.page.reload({ waitUntil: 'load' });
        await expect(chip).toHaveAccessibleName(`Show all ${String(nextCount)} matching`);
        expect(
          await focused.evaluate(
            (element) => element === document.activeElement && element?.isConnected
          )
        ).toBe(true);
        await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(top);
      }
      // Same resource IDs, changed payload: never retain stale DOM or move focus
      // onto a replacement control. Script keys change with their URLs instead.
      revision = 1;
      count = 102;
      await fixture.page.reload({ waitUntil: 'load' });
      await expect(chip).toHaveAccessibleName('Show all 102 matching');
      expect(await focused.evaluate((element) => element?.isConnected)).toBe(false);
      await expect(root.locator('[data-fdt="external-link"]').first()).toHaveAttribute(
        'href',
        /-1\.js$/
      );
      expect(await panel.evaluate(() => document.activeElement === document.body)).toBe(true);
      await focused.dispose();
    } finally {
      await panel.close();
      await fixture.page.close();
      await extension.browserContext.unroute(pattern);
    }
  });
}
