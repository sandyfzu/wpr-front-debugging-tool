/**
 * LazyLoad's sources: the packaged runtime file checked against its pin
 * (once per path, damaged kept, unreachable retried, logged once), the
 * version's LazyLoad package from verified data, and the preparation
 * asking for the runtime check (alongside the lists; a bad runtime fails
 * LazyLoad alone) and the LazyLoad input only when LazyLoad is simulated.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InterceptedDocument } from './backend';
import {
  checkPackagedLazyloadRuntime,
  createPackagedLazyloadRuntimeSource,
  type PackagedBytesFetch
} from './packaged-simulation-data';
import { LAZYLOAD_PACKAGE_FIXTURE } from './simulation-package.fixtures';
import {
  INERT_SIMULATION_SOURCES,
  lazyloadInput,
  prepareSimulation,
  type SimulationPackage,
  type SimulationSources
} from './simulation-sources';
import { webSha256HexOfBytes } from '../../utils/web-sha256';

const DATA_URL = 'chrome-extension://id/wp-rocket-simulation/simulation-data.json';
const RUNTIME_URL = 'chrome-extension://id/wp-rocket-simulation/lazyload/17.8.3/lazyload.min.js';
const BYTES = new TextEncoder().encode('/*! lazyload */').buffer;

/** A transport serving `body` with `status`, recording each asked URL. */
function serving(body: ArrayBuffer, status: number, asked: string[]): PackagedBytesFetch {
  return (url) => {
    asked.push(url);
    return Promise.resolve({
      ok: status === 200,
      status,
      arrayBuffer: () => Promise.resolve(body)
    });
  };
}

/** The fixture package pinned to `BYTES`. */
async function pinned() {
  return {
    ...LAZYLOAD_PACKAGE_FIXTURE,
    runtime: { sha256: await webSha256HexOfBytes(BYTES), bytes: BYTES.byteLength }
  };
}

describe('checkPackagedLazyloadRuntime', () => {
  it('reads the runtime beside the data file and accepts the pinned bytes', async () => {
    const asked: string[] = [];
    const deps = {
      fetch: serving(BYTES, 200, asked),
      dataUrl: DATA_URL,
      sha256: webSha256HexOfBytes
    };
    expect(await checkPackagedLazyloadRuntime(deps, await pinned())).toEqual({ ok: true });
    expect(asked).toEqual([RUNTIME_URL]);
  });

  it('names a damaged file hash-mismatch (size or sha256), an unreadable one asset-unreachable', async () => {
    const deps = (body: ArrayBuffer, status = 200) => ({
      fetch: serving(body, status, []),
      dataUrl: DATA_URL,
      sha256: webSha256HexOfBytes
    });
    const lazyload = await pinned();
    const other = new TextEncoder().encode('/*! lazyloaD */').buffer;
    expect(await checkPackagedLazyloadRuntime(deps(other), lazyload)).toMatchObject({
      ok: false,
      cause: 'hash-mismatch'
    });
    const longer = { ...lazyload, runtime: { ...lazyload.runtime, bytes: 99 } };
    expect(await checkPackagedLazyloadRuntime(deps(BYTES), longer)).toMatchObject({
      cause: 'hash-mismatch'
    });
    expect(await checkPackagedLazyloadRuntime(deps(BYTES, 404), lazyload)).toMatchObject({
      cause: 'asset-unreachable',
      detail: 'HTTP 404'
    });
    const throwing = { ...deps(BYTES), fetch: () => Promise.reject(new Error('gone')) };
    expect(await checkPackagedLazyloadRuntime(throwing, lazyload)).toMatchObject({
      cause: 'asset-unreachable'
    });
    const digestFails = { ...deps(BYTES), sha256: () => Promise.reject(new Error('no subtle')) };
    expect(await checkPackagedLazyloadRuntime(digestFails, lazyload)).toMatchObject({
      cause: 'asset-unreachable'
    });
  });
});

describe('createPackagedLazyloadRuntimeSource', () => {
  it('checks a path once (concurrent asks share it), keeps a damaged answer, logs it once', async () => {
    const asked: string[] = [];
    const log = { error: vi.fn() };
    const source = createPackagedLazyloadRuntimeSource({
      fetch: serving(BYTES, 200, asked),
      dataUrl: DATA_URL,
      sha256: webSha256HexOfBytes,
      log
    });
    const sound = await pinned();
    expect(await Promise.all([source(sound), source(sound)])).toEqual([{ ok: true }, { ok: true }]);
    const damaged = { ...sound, runtime: { ...sound.runtime, sha256: 'f'.repeat(64) } };
    expect(await source(damaged)).toEqual({ ok: false, cause: 'hash-mismatch' });
    expect(await source(damaged)).toEqual({ ok: false, cause: 'hash-mismatch' });
    expect(asked).toEqual([RUNTIME_URL, RUNTIME_URL]);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('retries an unreachable file on the next ask, logging the cause once', async () => {
    let status = 503;
    const asked: string[] = [];
    const log = { error: vi.fn() };
    const source = createPackagedLazyloadRuntimeSource({
      fetch: (url) => serving(BYTES, status, asked)(url),
      dataUrl: DATA_URL,
      sha256: webSha256HexOfBytes,
      log
    });
    const sound = await pinned();
    expect(await source(sound)).toEqual({ ok: false, cause: 'asset-unreachable' });
    expect(await source(sound)).toEqual({ ok: false, cause: 'asset-unreachable' });
    status = 200;
    expect(await source(sound)).toEqual({ ok: true });
    expect(asked).toHaveLength(3);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

const DOCUMENT = { documentUrl: 'https://site.test/post/?p=2', tabId: 1 } as InterceptedDocument;

const PACKAGE: SimulationPackage = {
  runtime: 'RocketLazyLoadScripts.run();',
  fallback: 'if(0){}',
  bundledListRows: ['row'],
  bundledDeferLists: { external: [], inline: [] },
  lazyload: LAZYLOAD_PACKAGE_FIXTURE
};

/** Sources serving `PACKAGE`, with the given LazyLoad runtime check. */
function sources(lazyloadRuntime: SimulationSources['lazyloadRuntime']): SimulationSources {
  return {
    ...INERT_SIMULATION_SOURCES,
    runtime: () => Promise.resolve({ ok: true, package: PACKAGE }),
    lazyloadRuntime
  };
}

describe('prepareSimulation — LazyLoad', () => {
  it('adds the LazyLoad input (the document’s URL, the version’s texts) once its runtime checks', async () => {
    const check = vi.fn(() => Promise.resolve({ ok: true } as const));
    const prepared = await prepareSimulation(
      '<html></html>',
      { features: ['lazyload'] },
      DOCUMENT,
      sources(check)
    );
    expect(prepared).toMatchObject({
      ok: true,
      input: { lazyload: lazyloadInput(LAZYLOAD_PACKAGE_FIXTURE, DOCUMENT.documentUrl) }
    });
    expect(check).toHaveBeenCalledWith(LAZYLOAD_PACKAGE_FIXTURE);
  });

  it('marks LazyLoad alone unavailable when the runtime is damaged (the others still run)', async () => {
    const prepared = await prepareSimulation(
      '<html></html>',
      { features: ['lazyload', 'delay_js'] },
      DOCUMENT,
      sources(() => Promise.resolve({ ok: false, cause: 'hash-mismatch' }))
    );
    expect(prepared).toMatchObject({
      ok: true,
      input: {
        features: ['lazyload', 'delay_js'],
        lazyload: lazyloadInput(LAZYLOAD_PACKAGE_FIXTURE, DOCUMENT.documentUrl, 'hash-mismatch')
      }
    });
  });

  it('checks the runtime alongside the list reads, not after them', async () => {
    // The check settles only once the list is asked: awaited before the
    // lists, it would wait out its deadline (fired at once here) instead.
    let release: (() => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<{ readonly ok: true }>((resolve) => {
          release = () => {
            resolve({ ok: true });
          };
        })
    );
    const list: SimulationSources['list'] = (_version, bundledRows) => {
      queueMicrotask(() => release?.());
      return Promise.resolve({
        listRows: bundledRows,
        listSource: 'bundled',
        listMiss: 'never-fetched'
      });
    };
    const immediateDeadline = (run: () => void) => {
      const handle = setTimeout(run, 0);
      return () => {
        clearTimeout(handle);
      };
    };
    const prepared = await prepareSimulation(
      '<html></html>',
      { features: ['lazyload'] },
      DOCUMENT,
      { ...sources(check), list },
      immediateDeadline
    );
    expect(prepared.ok && prepared.input.lazyload?.runtimeUnavailable).toBe(undefined);
    expect(prepared.ok).toBe(true);
  });

  it('never checks the runtime nor adds the input without LazyLoad', async () => {
    const check = vi.fn(() => Promise.resolve({ ok: true } as const));
    const prepared = await prepareSimulation(
      '<html></html>',
      { features: ['delay_js'] },
      DOCUMENT,
      sources(check)
    );
    expect(prepared.ok && prepared.input.lazyload).toBe(undefined);
    expect(check).not.toHaveBeenCalled();
  });

  it('reads the inert runtime check as unreachable', async () => {
    expect(await INERT_SIMULATION_SOURCES.lazyloadRuntime(LAZYLOAD_PACKAGE_FIXTURE)).toEqual({
      ok: false,
      cause: 'asset-unreachable'
    });
  });
});
