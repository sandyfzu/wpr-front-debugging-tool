import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config, {
  extensionApiBeforeMessaging,
  messagingPrelude,
  missingMessagingEntryError,
  FIREFOX_ADDON_ID,
  FIREFOX_MIN_VERSION
} from './wxt.config';

/** The manifest the config emits for one target browser. */
async function manifestFor(browser: string): Promise<Record<string, unknown>> {
  const build = config.manifest;
  if (typeof build !== 'function') throw new Error('manifest is not the function form');
  return await build({
    browser,
    manifestVersion: browser === 'firefox' ? 2 : 3,
    mode: 'production',
    command: 'build'
  });
}

describe('manifest browser_specific_settings', () => {
  it('pins the Firefox add-on id, floor and data-collection declaration', async () => {
    expect(FIREFOX_ADDON_ID).toBe('{f6991cc9-09e3-43d0-a6dd-4aae5f676452}');
    expect(FIREFOX_MIN_VERSION).toBe('150.0');
    expect((await manifestFor('firefox')).browser_specific_settings).toEqual({
      gecko: {
        id: FIREFOX_ADDON_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        // Store-facing: nothing required at install; the page address leaves
        // the browser only on two user commands (RUCSS Tester, PageSpeed
        // Insights), each asking this optional type first — never change silently.
        data_collection_permissions: { required: ['none'], optional: ['browsingActivity'] }
      }
    });
  });

  it('declares data collection on a floor that supports it (Firefox 140+)', () => {
    expect(Number.parseFloat(FIREFOX_MIN_VERSION)).toBeGreaterThanOrEqual(140);
  });

  it('keeps Firefox-only keys out of the Chromium manifest', async () => {
    for (const browser of ['chrome', 'edge']) {
      expect(await manifestFor(browser)).not.toHaveProperty('browser_specific_settings');
    }
  });
});

describe('store summary', () => {
  it('keeps the manifest description (every store summary) within the Chrome Web Store limit', () => {
    const { description } = JSON.parse(readFileSync('package.json', 'utf8')) as {
      description: string;
    };
    // Chrome Web Store: summary ≤ 132 characters, plain text (no markup).
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(132);
    expect(description).not.toMatch(/[<>*_`]/);
  });
});

describe('zip', () => {
  it('keeps the store listing folder out of the Firefox sources zip', () => {
    expect(config.zip?.excludeSources).toEqual(['store/**']);
  });
});

describe('manifest toolbar button', () => {
  it('declares the button without a popup in the config for every target', async () => {
    for (const browser of ['chrome', 'edge', 'firefox']) {
      // The badge and the action-menu rows need the key; WXT emits it only
      // for a popup entrypoint, so the config declares it. This reads the
      // config's raw `action`; WXT renames it `browser_action` in the MV2
      // manifest it writes, which only a build shows.
      expect((await manifestFor(browser)).action).toEqual({
        default_title: 'WPR Front Debugging Tool',
        // The full-bleed toolbar icons only, never a padded (store-layout) size.
        default_icon: { '16': 'icon/16.png', '32': 'icon/32.png' }
      });
    }
  });
});

describe('extension namespace alias', () => {
  it('resolves exactly `@wxt-dev/browser` to the project resolver in every build', async () => {
    const vite = config.vite;
    if (typeof vite !== 'function') throw new Error('vite is not the function form');
    const { resolve } = await vite({
      browser: 'chrome',
      manifestVersion: 3,
      command: 'build',
      mode: 'production'
    });
    const aliases = resolve?.alias;
    if (!Array.isArray(aliases)) throw new Error('resolve.alias is not the array form');
    const [entry] = aliases as { find: RegExp; replacement: string }[];
    expect(aliases).toHaveLength(1);
    expect(entry?.find.test('@wxt-dev/browser')).toBe(true);
    for (const other of ['@wxt-dev/browser/x', 'wxt/browser', '@wxt-dev/storage']) {
      expect(entry?.find.test(other)).toBe(false);
    }
    expect(entry?.replacement.endsWith('/utils/extension-api/index.ts')).toBe(true);
    expect(existsSync(entry?.replacement ?? '')).toBe(true);
  });
});

describe('extension namespace before the messaging library', () => {
  /** Run the plugin's transform hook (built for one browser) over one module. */
  const transform = (id: string, browser = 'chrome'): unknown => {
    const hook = extensionApiBeforeMessaging(browser).transform;
    if (typeof hook !== 'function') throw new Error('transform is not the function form');
    return (hook as (code: string, id: string) => unknown).call({}, 'BODY', id);
  };
  const pnpmDist =
    '/repo/node_modules/.pnpm/@webext-core+messaging@4.0.1/node_modules/@webext-core/messaging/dist/';

  it('Chromium: prepends the pin call itself to the library entry (plain or queried id)', () => {
    // The call sits in the library's own module, so whichever chunk the
    // library lands in pins before its first `chrome` read.
    for (const browser of ['chrome', 'edge']) {
      for (const id of [`${pnpmDist}index.mjs`, `${pnpmDist}index.mjs?v=1`]) {
        const lines = (transform(id, browser) as { code: string }).code.split('\n');
        expect(lines[0]).toMatch(
          /^import \{ chromiumExtensionApi, pinChromeNamespace \} from ".*[\\/]utils[\\/]extension-api[\\/]chromium\.ts";$/
        );
        expect(lines[1]).toBe('pinChromeNamespace(globalThis, chromiumExtensionApi(globalThis));');
        expect(lines.slice(2)).toEqual(['BODY']);
      }
    }
  });

  it('Firefox: prepends the namespace module import only (no pin there)', () => {
    const lines = (transform(`${pnpmDist}index.mjs`, 'firefox') as { code: string }).code.split(
      '\n'
    );
    expect(lines[0]).toMatch(/^import ".*[\\/]utils[\\/]extension-api[\\/]index\.ts";$/);
    expect(lines.slice(1)).toEqual(['BODY']);
  });

  it('the prelude names exports the Chromium module really has', () => {
    // Read as text: the resolver is never imported outside the build alias.
    const source = readFileSync(
      path.join(import.meta.dirname, 'utils/extension-api/chromium.ts'),
      'utf8'
    );
    for (const name of ['chromiumExtensionApi', 'pinChromeNamespace']) {
      expect(source).toContain(`export function ${name}(`);
      expect(messagingPrelude('chrome')).toContain(name);
    }
  });

  it('leaves every other module alone', () => {
    for (const id of [
      `${pnpmDist}page.mjs`,
      `${pnpmDist}generic-67DrFc4U.mjs`,
      '/repo/node_modules/@webext-core/isolated-element/dist/index.mjs',
      '/repo/lib/messaging/index.ts'
    ]) {
      expect(transform(id)).toBeNull();
    }
  });

  /**
   * Drive one build (or dev) pass through the plugin's hooks: resolve each
   * specifier, transform each module id, then end the pass.
   *
   * @param pass - What the pass resolves and transforms; `failed` = an earlier error.
   * @param plugin - The plugin instance (reuse one to run consecutive passes).
   * @returns The `this.error` message raised at `buildEnd`, or `null`.
   */
  const runPass = (
    pass: { specifiers: string[]; ids: string[]; command?: 'build' | 'serve'; failed?: Error },
    plugin = extensionApiBeforeMessaging('chrome')
  ): string | null => {
    const call = (hook: unknown, self: object, ...args: unknown[]): unknown => {
      if (typeof hook !== 'function') throw new Error('hook is not the function form');
      return (hook as (...a: unknown[]) => unknown).apply(self, args);
    };
    const raised: { message: string | null } = { message: null };
    const context = {
      error: (message: string): never => {
        raised.message = message;
        throw new Error(message);
      }
    };
    call(plugin.configResolved, {}, { command: pass.command ?? 'build' });
    call(plugin.buildStart, {});
    for (const source of pass.specifiers) expect(call(plugin.resolveId, {}, source)).toBeNull();
    for (const id of pass.ids) call(plugin.transform, {}, 'BODY', id);
    try {
      call(plugin.buildEnd, context, pass.failed);
    } catch (thrown) {
      // Only the plugin's own `this.error` is the expected outcome.
      if (raised.message === null) throw thrown;
    }
    return raised.message;
  };

  it('a build pass that imports and transforms the library passes', () => {
    expect(
      runPass({ specifiers: ['@webext-core/messaging'], ids: [`${pnpmDist}index.mjs`] })
    ).toBeNull();
  });

  it('a build pass that imports the library but never transforms its entry fails loudly', () => {
    // The entry was renamed: the library loads, the prelude never lands.
    const message = runPass({
      specifiers: ['@webext-core/messaging'],
      ids: [`${pnpmDist}main.mjs`]
    });
    expect(message).toContain(
      '@webext-core/messaging was imported but its entry was never transformed'
    );
    expect(message).toContain('@webext-core/messaging/dist/index.mjs');
    expect(message).toContain('MESSAGING_ENTRY');
  });

  it('a pass that never imports the library (or only its page subpath) passes', () => {
    expect(runPass({ specifiers: [], ids: [] })).toBeNull();
    expect(
      runPass({ specifiers: ['@webext-core/messaging/page'], ids: [`${pnpmDist}page.mjs`] })
    ).toBeNull();
  });

  it('dev serving and an already failing pass are never checked', () => {
    // Dev transforms lazily: an unrequested entry is not a broken one.
    expect(
      runPass({ specifiers: ['@webext-core/messaging'], ids: [], command: 'serve' })
    ).toBeNull();
    expect(
      runPass({ specifiers: ['@webext-core/messaging'], ids: [], failed: new Error('earlier') })
    ).toBeNull();
  });

  it('each pass starts unrecorded (buildStart resets the previous pass)', () => {
    const plugin = extensionApiBeforeMessaging('chrome');
    const imported = { specifiers: ['@webext-core/messaging'], ids: [] };
    expect(runPass({ ...imported, failed: new Error('earlier') }, plugin)).toBeNull();
    // The next pass never imports messaging: the previous record must not leak.
    expect(runPass({ specifiers: [], ids: [] }, plugin)).toBeNull();
    // Control: the same plugin still fails a broken pass.
    expect(runPass(imported, plugin)).not.toBeNull();
  });

  it('the error message is null exactly when the pass is consistent', () => {
    expect(missingMessagingEntryError(false, false)).toBeNull();
    expect(missingMessagingEntryError(true, true)).toBeNull();
    expect(missingMessagingEntryError(false, true)).toBeNull();
    expect(missingMessagingEntryError(true, false)).toMatch(/^\[WPR FDT\] /);
  });

  it('the installed library reads the bare chrome global only in its extension entry', () => {
    // A new file reading `chrome` would escape the ordering the plugin pins.
    const require = createRequire(import.meta.url);
    const dist = path.dirname(require.resolve('@webext-core/messaging'));
    const readers = readdirSync(dist)
      .filter((file) => file.endsWith('.mjs'))
      .filter((file) => /(^|[^.\w$])chrome\./.test(readFileSync(path.join(dist, file), 'utf8')));
    expect(readers).toEqual(['index.mjs']);
  });
});
