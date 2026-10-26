import { describe, expect, it } from 'vitest';
import config, { FIREFOX_ADDON_ID, FIREFOX_MIN_VERSION } from './wxt.config';

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
