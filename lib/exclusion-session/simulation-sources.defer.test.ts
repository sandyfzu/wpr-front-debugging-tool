/**
 * The Defer JS lists' sources: the choice over the kept record (the
 * document's own Defer JS lists while the copy is trusted, else the
 * bundled ones with the miss), the record-reading source, and the
 * preparation asking it only when Defer JS is simulated, under the list
 * deadline, at once with the Delay JS list.
 */
import { LAZYLOAD_PACKAGE_FIXTURE } from './simulation-package.fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterceptedDocument } from './backend';
import {
  chooseDeferLists,
  createLatestDeferListsSource,
  LATEST_LIST_MAX_AGE_MS
} from './latest-list-source';
import {
  INERT_SIMULATION_SOURCES,
  prepareSimulation,
  type SimulationPackage,
  type SimulationSources
} from './simulation-sources';
import { SIMULATION_SOURCE_TIMEOUTS_MS } from './timeouts';

const BUNDLED = { external: ['bundled.js'], inline: ['bundledInline'] };
const LATEST = { external: ['latest.js'], inline: ['latestInline'] };
const COPY = {
  fetchedAt: 1_790_000_000_000,
  sha256: 'a'.repeat(64),
  rows: ['latest-row'],
  defer: LATEST
};
const NOW = COPY.fetchedAt + 1_000;

describe('chooseDeferLists', () => {
  it('runs the trusted copy’s Defer JS lists, with its fetch time', () => {
    expect(chooseDeferLists({ copy: COPY }, BUNDLED, NOW)).toEqual({
      ...LATEST,
      listSource: 'latest',
      listFetchedAt: COPY.fetchedAt
    });
  });

  it('runs the bundled lists named by the copy’s own Defer JS miss', () => {
    const delayOnly = { fetchedAt: COPY.fetchedAt, sha256: COPY.sha256, rows: COPY.rows };
    expect(
      chooseDeferLists({ copy: { ...delayOnly, deferMiss: 'invalid' } }, BUNDLED, NOW)
    ).toEqual({ ...BUNDLED, listSource: 'bundled', listMiss: 'invalid' });
    expect(
      chooseDeferLists({ copy: { ...delayOnly, deferMiss: 'never-fetched' } }, BUNDLED, NOW)
    ).toEqual({ ...BUNDLED, listSource: 'bundled', listMiss: 'never-fetched' });
    expect(chooseDeferLists({ copy: delayOnly }, BUNDLED, NOW)).toMatchObject({
      listMiss: 'unreadable'
    });
  });

  it('runs the bundled lists as the Delay JS list does without a trusted copy', () => {
    expect(chooseDeferLists({}, BUNDLED, NOW)).toEqual({
      ...BUNDLED,
      listSource: 'bundled',
      listMiss: 'never-fetched'
    });
    expect(chooseDeferLists({ lastMiss: 'timeout' }, BUNDLED, NOW)).toMatchObject({
      listMiss: 'timeout'
    });
    const old = COPY.fetchedAt + LATEST_LIST_MAX_AGE_MS + 1;
    expect(chooseDeferLists({ copy: COPY }, BUNDLED, old)).toMatchObject({ listMiss: 'expired' });
    expect(chooseDeferLists({ copy: COPY }, BUNDLED, COPY.fetchedAt - 1)).toMatchObject({
      listMiss: 'expired'
    });
  });
});

describe('createLatestDeferListsSource', () => {
  it('chooses over the kept record', async () => {
    const source = createLatestDeferListsSource(
      () => Promise.resolve({ copy: COPY }),
      () => NOW,
      { warn: vi.fn() }
    );
    await expect(source('3.24.1', BUNDLED)).resolves.toMatchObject({ listSource: 'latest' });
  });

  it('degrades a failed read to the bundled lists (unreadable), logged, never rejecting', async () => {
    const warn = vi.fn();
    const source = createLatestDeferListsSource(
      () => Promise.reject(new Error('x')),
      () => NOW,
      {
        warn
      }
    );
    await expect(source('3.24.1', BUNDLED)).resolves.toEqual({
      ...BUNDLED,
      listSource: 'bundled',
      listMiss: 'unreadable'
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

const DOCUMENT: InterceptedDocument = {
  tabId: 1,
  frameId: 0,
  url: 'https://example.com/',
  requestId: 'r1'
} as unknown as InterceptedDocument;

const PACKAGE: SimulationPackage = {
  runtime: 'RocketLazyLoadScripts.run();',
  fallback: 'if(0){}',
  bundledListRows: ['delay-row'],
  bundledDeferLists: BUNDLED,
  lazyload: LAZYLOAD_PACKAGE_FIXTURE
};

const PAGE = '<!doctype html><html><head></head><body></body></html>';

/** Sources serving {@link PACKAGE}; `overrides` replace any. */
function sources(overrides: Partial<SimulationSources> = {}): SimulationSources {
  return {
    ...INERT_SIMULATION_SOURCES,
    runtime: () => Promise.resolve({ ok: true, package: PACKAGE }),
    ...overrides
  };
}

describe('prepareSimulation — Defer JS lists', () => {
  it('asks for them only when Defer JS is simulated, with the version’s bundled lists', async () => {
    const asked: unknown[] = [];
    const deferLists: SimulationSources['deferLists'] = (version, bundled) => {
      asked.push([version, bundled]);
      return INERT_SIMULATION_SOURCES.deferLists(version, bundled);
    };
    const both = await prepareSimulation(
      PAGE,
      { features: ['defer_all_js', 'delay_js'] },
      DOCUMENT,
      sources({ deferLists })
    );
    expect(both).toMatchObject({
      ok: true,
      input: { deferLists: { ...BUNDLED, listSource: 'bundled', listMiss: 'never-fetched' } }
    });
    expect(asked).toEqual([['3.24.1', BUNDLED]]);
    const delay = await prepareSimulation(
      PAGE,
      { features: ['delay_js'] },
      DOCUMENT,
      sources({ deferLists })
    );
    expect(delay.ok && 'deferLists' in delay.input).toBe(false);
    expect(asked).toHaveLength(1);
  });

  describe('deadline', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('falls back to the bundled lists (unreadable) when the source hangs, within the list deadline', async () => {
      const settled = prepareSimulation(
        PAGE,
        { features: ['defer_all_js'] },
        DOCUMENT,
        sources({ deferLists: () => new Promise(() => undefined) })
      );
      await vi.advanceTimersByTimeAsync(SIMULATION_SOURCE_TIMEOUTS_MS.list);
      await expect(settled).resolves.toMatchObject({
        ok: true,
        input: { deferLists: { ...BUNDLED, listSource: 'bundled', listMiss: 'unreadable' } }
      });
    });
  });
});
