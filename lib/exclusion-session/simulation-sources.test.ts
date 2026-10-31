import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAZYLOAD_PACKAGE_FIXTURE } from './simulation-package.fixtures';
import { MARKER_ID } from '../messaging/exclusion-simulation.fixtures';
import type { InterceptedDocument } from './backend';
import {
  INERT_SIMULATION_SOURCES,
  prepareSimulation,
  SimulationPreparationError,
  simulationMarkerSettler,
  simulationPreparer,
  type SimulationPackage,
  type SimulationSources
} from './simulation-sources';
import { DeadlineExceededError, SIMULATION_SOURCE_TIMEOUTS_MS } from './timeouts';

const SIMULATE = { features: ['delay_js'] } as const;

const DOCUMENT: InterceptedDocument = {
  tabId: 3,
  documentUrl: 'https://site.test/',
  body: new Uint8Array(),
  contentType: 'text/html',
  status: 200,
  method: 'GET'
};

const PACKAGE: SimulationPackage = {
  runtime: 'RocketLazyLoadScripts.run();',
  fallback: 'if(navigator.userAgent.match(/MSIE|Trident/i)){}',
  bundledListRows: ['lazyLoadOptions', 'wpr-beacon'],
  bundledDeferLists: { external: ['jquery'], inline: ['lazyLoadOptions'] },
  lazyload: LAZYLOAD_PACKAGE_FIXTURE
};

/** A page whose head holds `head`. */
function page(head = ''): string {
  return `<!doctype html><html><head>${head}</head><body><script src="/a.js"></script></body></html>`;
}

/** WP Rocket's generator meta naming a version. */
function wprMeta(version: string): string {
  return `<meta name="generator" content="WP Rocket ${version}" />`;
}

/** Sources serving {@link PACKAGE}, recording the versions asked; `overrides` replace any. */
function sources(
  overrides: Partial<SimulationSources> = {},
  asked: string[] = []
): SimulationSources {
  return {
    ...INERT_SIMULATION_SOURCES,
    runtime: (version) => {
      asked.push(version);
      return Promise.resolve({ ok: true, package: PACKAGE });
    },
    ...overrides
  };
}

describe('INERT_SIMULATION_SOURCES', () => {
  it('loads no runtime, uses the bundled list (never fetched), no marker, no CSP', async () => {
    await expect(INERT_SIMULATION_SOURCES.runtime('3.24')).resolves.toEqual({
      ok: false,
      cause: 'asset-unreachable'
    });
    await expect(INERT_SIMULATION_SOURCES.list('3.24', ['a'])).resolves.toEqual({
      listRows: ['a'],
      listSource: 'bundled',
      listMiss: 'never-fetched'
    });
    await expect(INERT_SIMULATION_SOURCES.markerId(DOCUMENT, SIMULATE)).resolves.toBeUndefined();
    expect(INERT_SIMULATION_SOURCES.csp(DOCUMENT, page())).toBeUndefined();
  });

  it('settles no marker (none was drawn)', async () => {
    await expect(
      INERT_SIMULATION_SOURCES.settleMarker(DOCUMENT, MARKER_ID, ['delay_js'])
    ).resolves.toBeUndefined();
  });

  it('makes every simulating document runtime-unavailable', async () => {
    await expect(
      prepareSimulation(page(), SIMULATE, DOCUMENT, INERT_SIMULATION_SOURCES)
    ).resolves.toEqual({ ok: false, cause: 'asset-unreachable' });
  });
});

describe('prepareSimulation', () => {
  it('selects the latest stable without a WP Rocket meta, with the package and bundled list', async () => {
    const asked: string[] = [];
    await expect(
      prepareSimulation(page(), SIMULATE, DOCUMENT, sources({}, asked))
    ).resolves.toEqual({
      ok: true,
      input: {
        features: ['delay_js'],
        wpRocketVersion: '3.24',
        runtime: PACKAGE.runtime,
        fallback: PACKAGE.fallback,
        listRows: PACKAGE.bundledListRows,
        listSource: 'bundled',
        listMiss: 'never-fetched'
      }
    });
    expect(asked).toEqual(['3.24']);
  });

  it('simulates the supported version the page serves, naming it', async () => {
    const asked: string[] = [];
    const prepared = await prepareSimulation(
      page(wprMeta('3.23.5.1')),
      SIMULATE,
      DOCUMENT,
      sources({}, asked)
    );
    expect(prepared).toMatchObject({
      ok: true,
      input: { wpRocketVersion: '3.23.5.1', siteVersion: '3.23.5.1' }
    });
    expect(asked).toEqual(['3.23.5.1']);
  });

  it('falls back to the latest stable for an unsupported served version, still naming it', async () => {
    const prepared = await prepareSimulation(page(wprMeta('3.20')), SIMULATE, DOCUMENT, sources());
    expect(prepared).toMatchObject({
      ok: true,
      input: { wpRocketVersion: '3.24', siteVersion: '3.20' }
    });
  });

  it('omits a served version too long to carry (page-derived: degrade, never fail)', async () => {
    const prepared = await prepareSimulation(
      page(wprMeta(`3.${'1'.repeat(80)}`)),
      SIMULATE,
      DOCUMENT,
      sources()
    );
    expect(prepared.ok).toBe(true);
    if (prepared.ok) expect(prepared.input).not.toHaveProperty('siteVersion');
  });

  it('answers the runtime source’s cause (no list, marker or CSP asked)', async () => {
    const touched: string[] = [];
    const prepared = await prepareSimulation(
      page(),
      SIMULATE,
      DOCUMENT,
      sources({
        runtime: () => Promise.resolve({ ok: false, cause: 'version-missing' }),
        list: () => {
          touched.push('list');
          return INERT_SIMULATION_SOURCES.list('', []);
        },
        markerId: () => {
          touched.push('marker');
          return Promise.resolve(undefined);
        }
      })
    );
    expect(prepared).toEqual({ ok: false, cause: 'version-missing' });
    expect(touched).toEqual([]);
  });

  it('carries the list source’s choice, the marker id and a fitted CSP', async () => {
    const lists: [string, readonly string[]][] = [];
    const prepared = await prepareSimulation(
      page(),
      SIMULATE,
      DOCUMENT,
      sources({
        list: (version, bundled) => {
          lists.push([version, bundled]);
          return Promise.resolve({
            listRows: ['latest-row'],
            listSource: 'latest',
            listFetchedAt: 1_790_000_000_000
          });
        },
        markerId: (document, simulate) =>
          Promise.resolve(document === DOCUMENT && simulate === SIMULATE ? MARKER_ID : undefined),
        csp: () => ({
          browser: 'firefox',
          headers: [{ name: 'Content-Security-Policy', value: "script-src 'self'" }],
          metas: []
        })
      })
    );
    expect(lists).toEqual([['3.24', PACKAGE.bundledListRows]]);
    expect(prepared).toMatchObject({
      ok: true,
      input: {
        listRows: ['latest-row'],
        listSource: 'latest',
        listFetchedAt: 1_790_000_000_000,
        markerId: MARKER_ID,
        csp: {
          browser: 'firefox',
          headers: [{ name: 'Content-Security-Policy', value: "script-src 'self'" }],
          metas: []
        }
      }
    });
  });

  it('carries an unfit CSP as cspUnavailable (never read as "no CSP")', async () => {
    const html = page();
    const prepared = await prepareSimulation(
      html,
      SIMULATE,
      DOCUMENT,
      sources({
        csp: () => ({
          browser: 'chromium',
          headers: [],
          metas: [{ content: 'x', offset: html.length + 1 }]
        })
      })
    );
    expect(prepared).toMatchObject({ ok: true, input: { cspUnavailable: 'unreadable' } });
    if (prepared.ok) expect(prepared.input).not.toHaveProperty('csp');
  });

  it('throws when an own input fails the engine contract (a source bug)', async () => {
    const broken = sources({
      runtime: () => Promise.resolve({ ok: true, package: { ...PACKAGE, runtime: '' } })
    });
    await expect(prepareSimulation(page(), SIMULATE, DOCUMENT, broken)).rejects.toThrow(
      /WP Rocket 3\.24 fails the engine contract/
    );
    await expect(prepareSimulation(page(), SIMULATE, DOCUMENT, broken)).rejects.toBeInstanceOf(
      SimulationPreparationError
    );
    const badMarker = sources({ markerId: () => Promise.resolve('not-hex') });
    await expect(prepareSimulation(page(), SIMULATE, DOCUMENT, badMarker)).rejects.toThrow(
      /engine contract/
    );
  });

  it('wraps a failing source in a SimulationPreparationError carrying the original cause', async () => {
    const failures = [
      new Error('runtime exploded'),
      new Error('list exploded'),
      new Error('marker exploded'),
      new Error('csp exploded')
    ] as const;
    const failing: Partial<SimulationSources>[] = [
      { runtime: () => Promise.reject(failures[0]) },
      { list: () => Promise.reject(failures[1]) },
      { markerId: () => Promise.reject(failures[2]) },
      {
        csp: () => {
          throw failures[3];
        }
      }
    ];
    for (const [index, overrides] of failing.entries()) {
      const error: unknown = await prepareSimulation(
        page(),
        SIMULATE,
        DOCUMENT,
        sources(overrides)
      ).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(SimulationPreparationError);
      expect((error as Error).cause).toBe(failures[index]);
    }
  });
});

describe('simulationPreparer', () => {
  it('binds the spec, document and sources', async () => {
    const asked: string[] = [];
    const prepare = simulationPreparer(SIMULATE, DOCUMENT, sources({}, asked));
    await expect(prepare(page(wprMeta('3.23.5.1')))).resolves.toMatchObject({ ok: true });
    expect(asked).toEqual(['3.23.5.1']);
  });
});

describe('prepareSimulation — source deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A source answer that never settles. */
  const hung = <T>(): Promise<T> => new Promise<T>(() => undefined);

  /** Prepare with `overrides`, letting `ms` pass; the settled result or the rejection. */
  async function preparedAfter(overrides: Partial<SimulationSources>, ms: number) {
    const settled = prepareSimulation(page(), SIMULATE, DOCUMENT, sources(overrides)).catch(
      (cause: unknown) => ({ rejected: cause })
    );
    await vi.advanceTimersByTimeAsync(ms);
    return settled;
  }

  it('reads a hung runtime source as asset-unreachable at its deadline (no later source asked)', async () => {
    const touched: string[] = [];
    const settled = preparedAfter(
      {
        runtime: hung,
        list: () => {
          touched.push('list');
          return INERT_SIMULATION_SOURCES.list('', []);
        }
      },
      SIMULATION_SOURCE_TIMEOUTS_MS.runtime
    );
    await expect(settled).resolves.toEqual({ ok: false, cause: 'asset-unreachable' });
    expect(touched).toEqual([]);
  });

  it('does not end a runtime source before its deadline', async () => {
    let answered = false;
    const prepared = prepareSimulation(page(), SIMULATE, DOCUMENT, sources({ runtime: hung })).then(
      () => {
        answered = true;
      }
    );
    await vi.advanceTimersByTimeAsync(SIMULATION_SOURCE_TIMEOUTS_MS.runtime - 1);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await prepared;
    expect(answered).toBe(true);
  });

  it('falls back to the bundled list (miss unreadable) when the list source hangs', async () => {
    const settled = await preparedAfter({ list: hung }, SIMULATION_SOURCE_TIMEOUTS_MS.list);
    expect(settled).toMatchObject({
      ok: true,
      input: { listRows: PACKAGE.bundledListRows, listSource: 'bundled', listMiss: 'unreadable' }
    });
  });

  it('fails the preparation when the marker id source hangs (never simulated without its id)', async () => {
    const settled = await preparedAfter({ markerId: hung }, SIMULATION_SOURCE_TIMEOUTS_MS.markerId);
    const { rejected } = settled as { rejected: unknown };
    expect(rejected).toBeInstanceOf(SimulationPreparationError);
    expect((rejected as Error).cause).toBeInstanceOf(DeadlineExceededError);
  });

  it('settles a marker through the source, and rejects a hung settler at its deadline as a preparation failure', async () => {
    const asked: unknown[] = [];
    const settle = simulationMarkerSettler(
      DOCUMENT,
      sources({
        settleMarker: (document, markerId, simulated) => {
          asked.push([document, markerId, simulated]);
          return Promise.resolve();
        }
      })
    );
    await expect(settle(MARKER_ID, ['delay_js'])).resolves.toBeUndefined();
    expect(asked).toEqual([[DOCUMENT, MARKER_ID, ['delay_js']]]);
    const stuck = simulationMarkerSettler(DOCUMENT, sources({ settleMarker: hung }))(MARKER_ID, [
      'delay_js'
    ]).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(SIMULATION_SOURCE_TIMEOUTS_MS.settleMarker);
    const rejected = await stuck;
    expect(rejected).toBeInstanceOf(SimulationPreparationError);
    expect((rejected as Error).cause).toBeInstanceOf(DeadlineExceededError);
  });

  it('bounds the whole preparation by the sum of the source deadlines', async () => {
    const limits = SIMULATION_SOURCE_TIMEOUTS_MS;
    // Each source answers just before its own deadline: the preparation still completes.
    const late = <T>(ms: number, value: T) =>
      new Promise<T>((resolve) => {
        setTimeout(() => {
          resolve(value);
        }, ms - 1);
      });
    const settled = await preparedAfter(
      {
        runtime: () => late(limits.runtime, { ok: true, package: PACKAGE }),
        list: (_version, bundled) =>
          late(limits.list, {
            listRows: bundled,
            listSource: 'bundled',
            listMiss: 'never-fetched'
          }),
        markerId: () => late(limits.markerId, undefined)
      },
      limits.runtime + limits.list + limits.markerId
    );
    expect(settled).toMatchObject({ ok: true, input: { listMiss: 'never-fetched' } });
  });
});
