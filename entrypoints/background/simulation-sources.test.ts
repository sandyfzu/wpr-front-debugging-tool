/**
 * The background's simulation sources: the runtime source reads the
 * packaged data file through the extension's own URL with the platform
 * fetch (once), and the other sources keep their inert defaults.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INERT_SIMULATION_SOURCES } from '../../lib/exclusion-session/simulation-sources';
import { SIMULATION_DATA_PATH } from '../../lib/wp-rocket-simulation/simulation-data';
import { createSimulationSources } from './simulation-sources';

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
    expect(sources.markerId).toBe(INERT_SIMULATION_SOURCES.markerId);
    expect(sources.csp).toBe(INERT_SIMULATION_SOURCES.csp);
  });
});
