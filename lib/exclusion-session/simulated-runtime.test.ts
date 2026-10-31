/**
 * The runtime-request match (live session, latest simulated document,
 * requested by that document on the session's origin, exact URL as
 * serialized) and its resolution to the verified packaged
 * file — every miss and every unusable source named.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  ActiveExclusionSession,
  ExclusionDocumentOutcome
} from '../messaging/exclusion-session';
import type { LazyloadSimulationReport } from '../messaging/exclusion-simulation';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import { LAZYLOAD_PACKAGE_FIXTURE } from './simulation-package.fixtures';
import { matchSimulatedRuntime, resolveSimulatedRuntime } from './simulated-runtime';
import type { SimulationSources } from './simulation-sources';

const RUNTIME_URL =
  'https://site.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
const FILE = { url: 'chrome-extension://id/x.js', bytes: new Uint8Array([7]) };
/** The simulated page (its recorded origin + path is `https://site.test/blog/post`). */
const PAGE_URL = 'https://site.test/blog/post?utm=1#top';
/** A request for `url` made by {@link PAGE_URL}. */
const request = (url: string, documentUrl = PAGE_URL) => ({ url, documentUrl });
/** The served identity of the recorded page. */
const SERVED = {
  urlPath: 'https://site.test/blog/post',
  urlDigest: 'd'.repeat(64),
  token: 't',
  order: 1,
  receivedAt: 1,
  speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: false },
  copy: true,
  serviceWorkersBypassed: false
};

/** A LazyLoad report, simulated with {@link RUNTIME_URL} unless overridden. */
function report(overrides: Partial<LazyloadSimulationReport> = {}): LazyloadSimulationReport {
  return {
    feature: 'lazyload',
    state: 'simulated',
    wpRocketVersion: '3.24',
    images: 1,
    pictures: 0,
    backgrounds: 0,
    runtimeUrl: RUNTIME_URL,
    ...overrides
  };
}

/** An active session whose latest document is `document`. */
function active(document: ExclusionDocumentOutcome | null): ActiveExclusionSession {
  return {
    state: 'active',
    origin: 'https://site.test',
    set: EMPTY_EXCLUSION_SET,
    startedAt: 1,
    document
  };
}

const SIMULATED = active({
  outcome: 'rewritten',
  reports: [],
  lazyloadSimulation: report(),
  served: SERVED
});

describe('matchSimulatedRuntime', () => {
  it('matches the exact runtime URL of the latest simulated document', () => {
    expect(matchSimulatedRuntime(SIMULATED, request(RUNTIME_URL))).toEqual({
      matched: true,
      version: '3.24'
    });
  });

  it('compares URLs as the browser serializes them', () => {
    const unserialized = RUNTIME_URL.replace('https://site.test', 'HTTPS://SITE.TEST:443');
    expect(matchSimulatedRuntime(SIMULATED, request(unserialized))).toMatchObject({
      matched: true
    });
  });

  it('misses without a live session', () => {
    expect(matchSimulatedRuntime({ state: 'inactive' }, request(RUNTIME_URL))).toEqual({
      matched: false,
      miss: 'no-session'
    });
    expect(
      matchSimulatedRuntime(
        { state: 'unavailable', origin: 'https://site.test', cause: 'detached' } as never,
        request(RUNTIME_URL)
      )
    ).toEqual({ matched: false, miss: 'no-session' });
  });

  it.each([
    ['no document yet', active(null)],
    ['a failed document', active({ outcome: 'failed', reason: 'engine-failed' })],
    ['no LazyLoad report', active({ outcome: 'rewritten', reports: [] })],
    [
      'LazyLoad not simulated',
      active({
        outcome: 'rewritten',
        reports: [],
        lazyloadSimulation: report({ state: 'already-served', runtimeUrl: undefined })
      })
    ]
  ])('misses with %s', (_name, status) => {
    expect(matchSimulatedRuntime(status, request(RUNTIME_URL))).toEqual({
      matched: false,
      miss: 'not-simulated'
    });
  });

  it('misses a request from another origin naming the same runtime URL (the stale record)', () => {
    for (const documentUrl of [
      'https://other.test/blog/post',
      'http://site.test/blog/post',
      'https://site.test:8443/blog/post',
      'not a url'
    ]) {
      expect(matchSimulatedRuntime(SIMULATED, request(RUNTIME_URL, documentUrl))).toEqual({
        matched: false,
        miss: 'other-origin'
      });
    }
  });

  it('misses a same-origin page that is not the recorded document', () => {
    expect(
      matchSimulatedRuntime(SIMULATED, request(RUNTIME_URL, 'https://site.test/blog/other'))
    ).toEqual({ matched: false, miss: 'other-document' });
    const unidentified = active({
      outcome: 'rewritten',
      reports: [],
      lazyloadSimulation: report()
    });
    expect(matchSimulatedRuntime(unidentified, request(RUNTIME_URL))).toEqual({
      matched: false,
      miss: 'other-document'
    });
  });

  it('matches the recorded document whatever its query or fragment now is', () => {
    expect(
      matchSimulatedRuntime(SIMULATED, request(RUNTIME_URL, 'https://site.test/blog/post'))
    ).toMatchObject({ matched: true });
  });

  it('compares a long path as the record cuts it', () => {
    const long = `https://site.test/${'p'.repeat(3000)}`;
    const status = active({
      outcome: 'rewritten',
      reports: [],
      lazyloadSimulation: report(),
      served: { ...SERVED, urlPath: long.slice(0, 2048) }
    });
    expect(matchSimulatedRuntime(status, request(RUNTIME_URL, long))).toMatchObject({
      matched: true
    });
  });

  it('misses any other URL, an unparsable one included', () => {
    for (const url of [`${RUNTIME_URL}?ver=1`, RUNTIME_URL.replace('17.8.3', '17.8.4'), 'nope']) {
      expect(matchSimulatedRuntime(SIMULATED, request(url))).toEqual({
        matched: false,
        miss: 'other-url'
      });
    }
  });
});

/** Sources serving the fixture package and `check` as the runtime check. */
function sources(
  check: Awaited<ReturnType<SimulationSources['lazyloadRuntime']>> = { ok: true, file: FILE }
): Pick<SimulationSources, 'runtime' | 'lazyloadRuntime'> {
  return {
    runtime: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        package: {
          runtime: 'r',
          fallback: 'f',
          bundledListRows: [],
          bundledDeferLists: { external: [], inline: [] },
          lazyload: LAZYLOAD_PACKAGE_FIXTURE
        }
      })
    ),
    lazyloadRuntime: vi.fn(() => Promise.resolve(check))
  };
}

describe('resolveSimulatedRuntime', () => {
  it('answers the version’s verified packaged file', async () => {
    const used = sources();
    const log = { warn: vi.fn() };
    await expect(resolveSimulatedRuntime(SIMULATED, request(RUNTIME_URL), used, log)).resolves.toBe(
      FILE
    );
    expect(used.runtime).toHaveBeenCalledWith('3.24');
    expect(used.lazyloadRuntime).toHaveBeenCalledWith(LAZYLOAD_PACKAGE_FIXTURE);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('answers nothing for a miss, reading no source', async () => {
    const used = sources();
    await expect(
      resolveSimulatedRuntime(SIMULATED, request(`${RUNTIME_URL}x`), used, { warn: vi.fn() })
    ).resolves.toBeNull();
    expect(used.runtime).not.toHaveBeenCalled();
  });

  it('names unusable packaged data', async () => {
    const used = {
      ...sources(),
      runtime: () => Promise.resolve({ ok: false as const, cause: 'version-missing' as const })
    };
    const log = { warn: vi.fn() };
    await expect(
      resolveSimulatedRuntime(SIMULATED, request(RUNTIME_URL), used, log)
    ).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/packaged data unusable/), {
      version: '3.24',
      cause: 'version-missing'
    });
  });

  it('names an unusable packaged runtime', async () => {
    const log = { warn: vi.fn() };
    await expect(
      resolveSimulatedRuntime(
        SIMULATED,
        request(RUNTIME_URL),
        sources({ ok: false, cause: 'hash-mismatch' }),
        log
      )
    ).resolves.toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/packaged runtime unusable/), {
      version: '3.24',
      cause: 'hash-mismatch'
    });
  });
});
