/**
 * Suite 1 — Boot & registry.
 *
 * Asserts, after the harness's own install-equivalent (unpacked bundle over a
 * fresh profile) and after an extension reload:
 * - the service worker is alive and answering (a running extension, not a
 *   dead target);
 * - all five context-menu entries exist exactly once.
 *
 * Assert surface: service-worker state (`chrome.*` evaluated in the worker
 * target). The menu registry has NO runtime read-back — `contextMenus.getAll`
 * does not exist in Chromium (verified live against the installed build and
 * the committed `@types/chrome`), so exactly-once is probed by duplicate
 * id creation (the browser rejects a second item with the same id), and the
 * title/contexts/documentUrlPatterns parity shapes stay pinned by the P2 unit
 * table (`entrypoints/background/context-menus.test.ts`), which this suite
 * cross-checks against the probe list by id.
 *
 * Reload leg: the in-place `chrome.runtime.reload()` in this Chromium build
 * destroys any content-script extension without ever rebuilding it (verified:
 * the extension disappears from chrome://extensions-internals; recorded in
 * the phase doc), so the harness closes the browser and relaunches on the
 * SAME profile — the bundle re-registers over persistent browser-owned state,
 * which is the checklist's actual question (ids survive extension reload
 * exactly once, legacy's duplicate-id fix preserved).
 */

import { expect, test } from '../helpers/extension';

test.describe('boot & registry', () => {
  test('service worker is alive and answers', async ({ extension }) => {
    const manifest = await extension.evaluateInWorker(
      () => chrome.runtime.getManifest(),
      undefined
    );
    expect(manifest.name).toBe('WPR Front Debugging Tool');
    expect(manifest.version).toBe('0.0.0');
    // The worker target is the MV3 background itself; the id derivation is
    // the official Playwright extension-docs surface.
    const id = await extension.extensionId();
    expect(id.length).toBeGreaterThanOrEqual(32);
  });

  test('the five context-menu entries exist exactly once after install', async ({ extension }) => {
    // Negative control first: proves the probe can answer "absent" at all
    // (and that its transient probe item is removed again).
    await extension.probeAbsenceControl();
    const results = await extension.probeRegisteredMenus();
    expect(results, 'all five registry ids must already be registered').toEqual([
      'registered',
      'registered',
      'registered',
      'registered',
      'registered'
    ]);
    // The probe list is the parity table's id column: a registry that renamed
    // or dropped a menu fails either the probe or the P2 unit table.
  });

  test('the five context-menu entries still exist exactly once after extension reload', async ({
    extension
  }) => {
    const before = await extension.probeRegisteredMenus();
    expect(before).toEqual(['registered', 'registered', 'registered', 'registered', 'registered']);

    await extension.relaunch();

    // The absence control re-affirms the probe works on the re-registered
    // bundle as well (a fresh probe answer "absent" is evidence, not habit).
    await extension.probeAbsenceControl();
    const after = await extension.probeRegisteredMenus();
    expect(after, 'menu ids must survive the extension reload exactly once').toEqual([
      'registered',
      'registered',
      'registered',
      'registered',
      'registered'
    ]);
  });
});
