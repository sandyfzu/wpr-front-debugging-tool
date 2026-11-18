import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config, {
  extensionApiBeforeMessaging,
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
  it('pins the Firefox add-on id and floor', async () => {
    expect(FIREFOX_ADDON_ID).toBe('{f6991cc9-09e3-43d0-a6dd-4aae5f676452}');
    expect(FIREFOX_MIN_VERSION).toBe('150.0');
    expect((await manifestFor('firefox')).browser_specific_settings).toEqual({
      gecko: { id: FIREFOX_ADDON_ID, strict_min_version: FIREFOX_MIN_VERSION }
    });
  });

  it('keeps Firefox-only keys out of the Chromium manifest', async () => {
    for (const browser of ['chrome', 'edge']) {
      expect(await manifestFor(browser)).not.toHaveProperty('browser_specific_settings');
    }
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
        default_title: 'WPR Front Debugging Tool'
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
  /** Run the plugin's transform hook over one module. */
  const transform = (id: string): unknown => {
    const hook = extensionApiBeforeMessaging().transform;
    if (typeof hook !== 'function') throw new Error('transform is not the function form');
    return (hook as (code: string, id: string) => unknown).call({}, 'BODY', id);
  };
  const pnpmDist =
    '/repo/node_modules/.pnpm/@webext-core+messaging@4.0.1/node_modules/@webext-core/messaging/dist/';

  it('prepends the namespace module import to the library entry (plain or queried id)', () => {
    for (const id of [`${pnpmDist}index.mjs`, `${pnpmDist}index.mjs?v=1`]) {
      const out = transform(id) as { code: string };
      const [first, rest] = out.code.split('\n');
      expect(first).toMatch(/^import ".*[\\/]utils[\\/]extension-api[\\/]index\.ts";$/);
      expect(rest).toBe('BODY');
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
