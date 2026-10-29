/**
 * The background's simulation sources: the runtime source reads the
 * packaged data file through the extension's own URL with the platform
 * fetch (once), the marker id source draws and remembers ids, and the
 * other sources keep their inert defaults.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INERT_SIMULATION_SOURCES } from '../../lib/exclusion-session/simulation-sources';
import { SIMULATION_DATA_PATH } from '../../lib/wp-rocket-simulation/simulation-data';
import type { InterceptedDocument } from '../../lib/exclusion-session/backend';
import { getTabSimulationMarkers } from '../../lib/storage/simulation-markers';
import { createSimulationSources, cspBrowser } from './simulation-sources';

const DATA_TEXT = readFileSync(join(process.cwd(), 'public', SIMULATION_DATA_PATH), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSimulationSources', () => {
  it('serves the packaged runtime from the extension URL, read once', async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(() =>
      Promise.resolve(new Response(DATA_TEXT))
    );
    vi.stubGlobal('fetch', fetch);
    const log = { error: vi.fn() };
    const sources = createSimulationSources(log);
    await expect(sources.runtime('3.24')).resolves.toMatchObject({ ok: true });
    await expect(sources.runtime('3.23.5.1')).resolves.toMatchObject({ ok: true });
    expect(fetch.mock.calls).toEqual([[browser.runtime.getURL(`/${SIMULATION_DATA_PATH}`)]]);
    expect(fetch.mock.calls[0]?.[0]).toMatch(
      /^chrome-extension:\/\/[^/]+\/wp-rocket-simulation\/simulation-data\.json$/
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('answers asset-unreachable (logged) when the packaged file cannot be fetched', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const log = { error: vi.fn() };
    await expect(createSimulationSources(log).runtime('3.24')).resolves.toEqual({
      ok: false,
      cause: 'asset-unreachable'
    });
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('keeps every other source inert', () => {
    const sources = createSimulationSources({ error: vi.fn() });
    expect(sources.list).toBe(INERT_SIMULATION_SOURCES.list);
  });

  it("reads a document's CSP headers and head metas for this build's engine", () => {
    const sources = createSimulationSources({ error: vi.fn() });
    const document = {
      tabId: 7,
      documentUrl: 'https://site.test/',
      body: new Uint8Array(),
      status: 200,
      method: 'GET',
      contentType: 'text/html',
      cspHeaders: [{ name: 'content-security-policy', value: "script-src 'self'" }]
    } satisfies InterceptedDocument;
    const html = '<head><meta http-equiv="Content-Security-Policy" content="img-src *">';
    expect(sources.csp(document, html)).toEqual({
      browser: cspBrowser(),
      headers: document.cspHeaders,
      metas: [{ content: 'img-src *', offset: 6 }]
    });
  });

  it('names the engine from the build target', () => {
    vi.stubEnv('BROWSER', 'firefox');
    expect(cspBrowser()).toBe('firefox');
    vi.stubEnv('BROWSER', 'chrome');
    expect(cspBrowser()).toBe('chromium');
    vi.unstubAllEnvs();
  });

  it('draws a fresh marker id per document and remembers it for the tab and origin', async () => {
    const sources = createSimulationSources({ error: vi.fn() });
    const document = {
      tabId: 7,
      documentUrl: 'https://site.test/page/?q=1',
      body: new Uint8Array(),
      contentType: 'text/html',
      status: 200
    } as unknown as InterceptedDocument;
    const first = await sources.markerId(document, { features: ['delay_js'] });
    const second = await sources.markerId(document, { features: ['delay_js'] });
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    await expect(getTabSimulationMarkers(7)).resolves.toEqual([
      { markerId: second, origin: 'https://site.test', features: ['delay_js'] },
      { markerId: first, origin: 'https://site.test', features: ['delay_js'] }
    ]);
  });
});
