/**
 * LazyLoad (images) simulation composed with the exclusion steps and with
 * Defer JS / Delay JS, over the plugin table's LazyLoad rows, under every
 * supported WP Rocket version and both engine paths (in-process; worker
 * through a structured-cloned request):
 *
 * - Real-page parity: on a row WP Rocket served without stored rows,
 *   simulate → the exclusion steps gives exactly what the exclusion steps
 *   give on WP Rocket's own LazyLoad-on page (html + exclusion reports),
 *   over a set matrix — the hook texts placed and the runtime URL derived
 *   from the page by the session's own rules.
 * - Composed rows: LazyLoad with Defer JS (and Delay JS) gives the plugin's
 *   one-buffer page; where the list in use would defer, wrap or delay a
 *   script LazyLoad prints, LazyLoad is refused by name and the other
 *   features give their own page on the served one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectationsFor } from '../exclusion-builder/parity-version-expectations';
import { pipelineSetProblems } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import type {
  DocumentSimulationInput,
  SimulationLazyloadInput
} from '../messaging/exclusion-simulation';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { simulateDeferJs } from '../wp-rocket-simulation/defer-js-forward';
import { simulateDelayJs } from '../wp-rocket-simulation/delay-js-forward';
import { lazyloadAssetsUrl } from '../wp-rocket-simulation/lazyload-assets-url';
import { SIMULATION_DATA_PATH, readSimulationData } from '../wp-rocket-simulation/simulation-data';
import {
  parseSimulationTable,
  type SimulateRow
} from '../wp-rocket-simulation/simulation-parity-table';
import type { SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import { type DocumentTransformRequest, type DocumentTransformResult } from './document-transform';
import { runDocumentPipeline } from './document-pipeline';
import { packagedVersion } from './packaged-simulation-data';
import { lazyloadInput as packagedLazyloadInput } from './simulation-sources';
import { type TransformWorkerMessage } from './transform-worker';
import { handleTransformWorkerMessage } from './transform-worker-handler';

const HERE = dirname(fileURLToPath(import.meta.url));

const TABLE = parseSimulationTable(
  JSON.parse(
    readFileSync(join(HERE, '../wp-rocket-simulation/simulation-parity.fixtures.json'), 'utf8')
  )
);

const DATA = (() => {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(read.problem);
  return read.data;
})();

const { sentinels } = TABLE.header.simulation;

/** A budget no table run comes near. */
const BUDGET_MS = 600_000;

/** A data-file list by its key. */
function dataRows(key: string): readonly string[] {
  const list = DATA.rowLists[key];
  if (list === undefined) throw new Error(`no row list ${key}`);
  return list;
}

/** A version's data-file entry. */
function entryOf(version: string): NonNullable<(typeof DATA.versions)[string]> {
  const entry = DATA.versions[version];
  if (entry === undefined) throw new Error(`no data for ${version}`);
  return entry;
}

/**
 * The page URL a row's page was served at: its assets URL's origin (the
 * derivation then gives the row's assets URL wherever the page evidences it).
 */
function pageUrlOf(row: SimulateRow): string {
  const assetsUrl = row.lazyload?.assetsUrl;
  if (assetsUrl === undefined) throw new Error(`${row.id} holds no lazyload`);
  return `${new URL(assetsUrl).origin}/`;
}

/** Whether the session's derivation gives the row's own assets URL. */
function derivesAssetsUrl(row: SimulateRow): boolean {
  return lazyloadAssetsUrl(row.html, pageUrlOf(row)).url === row.lazyload?.assetsUrl;
}

/** The LazyLoad engine input for a row under a version. */
function lazyloadInput(row: SimulateRow, version: string): SimulationLazyloadInput {
  const read = packagedVersion(DATA, version);
  if (!read.ok) throw new Error(`no package for ${version}: ${read.cause}`);
  return packagedLazyloadInput(read.package.lazyload, pageUrlOf(row));
}

/** The simulation input a session hands the engine for a row. */
function simulationInput(
  row: SimulateRow,
  version: string,
  features: readonly SimulatedFeatureId[]
): DocumentSimulationInput {
  const entry = entryOf(version);
  const lists = row.defer?.lists;
  return {
    features,
    wpRocketVersion: version,
    runtime: sentinels.runtime,
    fallback: sentinels.ieFallback,
    listRows:
      row.list === 'bundled' ? dataRows(entry.delayJsExclusions.sha256) : (row.listRows ?? []),
    listSource: 'bundled',
    listMiss: 'never-fetched',
    lazyload: lazyloadInput(row, version),
    ...(features.includes('defer_all_js') && lists !== undefined
      ? {
          deferLists: {
            ...(lists === 'bundled'
              ? {
                  external: dataRows(entry.deferJsExternalExclusions.sha256),
                  inline: dataRows(entry.deferJsInlineExclusions.sha256)
                }
              : lists),
            listSource: 'bundled',
            listMiss: 'never-fetched'
          }
        }
      : {})
  };
}

/** A set with these rows (the rest empty). */
function setWith(rows: Partial<ExclusionSet['rows']>): ExclusionSet {
  return { rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows }, disable: EMPTY_EXCLUSION_SET.disable };
}

/** Real-page parity's set matrix: none, LazyLoad rows, and one row set per other feature. */
const SET_MATRIX: readonly ExclusionSet[] = [
  EMPTY_EXCLUSION_SET,
  setWith({ lazyload: ['logo', 'hero'] }),
  setWith({ delayJs: ['gtag'] }),
  setWith({ deferJs: ['a.js'] })
];

/** The in-process engine path. */
function inProcess(request: DocumentTransformRequest): DocumentTransformResult {
  return runDocumentPipeline(request, () => 0);
}

/** The worker engine path: the request crosses the worker's guard, the result its post. */
function viaWorker(request: DocumentTransformRequest): DocumentTransformResult {
  const posted: TransformWorkerMessage[] = [];
  handleTransformWorkerMessage(
    structuredClone({ type: 'transform', id: 1, request }),
    (message) => posted.push(message),
    () => 0
  );
  const result = posted.find((message) => message.type === 'result');
  if (result?.type !== 'result') throw new Error('the worker posted no result');
  return result.result;
}

const ENGINES = [
  ['in-process', inProcess],
  ['worker', viaWorker]
] as const;

/** A completed run's html, exclusion outcome and simulation reports. */
function rewritten(result: DocumentTransformResult) {
  if (!result.ok) throw new Error(`run not rewritten: ${JSON.stringify(result.outcome)}`);
  const { simulation, deferSimulation, lazyloadSimulation, ...rest } = result.outcome;
  return { html: result.html, outcome: rest, simulation, deferSimulation, lazyloadSimulation };
}

/** The LazyLoad-only rows the session reaches (a filter-only row's rows never reach it). */
const LAZYLOAD_ROWS = TABLE.rows.filter(
  (row) => row.feature === 'lazyload' && row.lazyload?.filterOnly !== true
);

/** Rows refused by design (`lazyload-forward.table.test`), with the step. */
const REFUSED: Readonly<Record<string, string>> = {
  'simulate-lazyload-background-values': 'lazyload-entities'
};

/** Rows WP Rocket served without stored rows, whose assets URL the page evidences. */
const O1_ROWS = LAZYLOAD_ROWS.filter(
  (row) => row.lazyload?.rows.length === 0 && derivesAssetsUrl(row)
);

/** Rows composed with Defer JS / Delay JS, by id. */
function row(id: string): SimulateRow {
  const found = TABLE.rows.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no row ${id}`);
  return found;
}

const VERSIONS = SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version, pin] as const);

describe('LazyLoad composition — coverage', () => {
  it('runs every reachable LazyLoad row whose assets URL the page evidences', () => {
    expect(O1_ROWS.length).toBeGreaterThanOrEqual(20);
    // Only the custom-assets-URL rows serve a URL no page evidence names (P-2).
    const underived = TABLE.rows.filter(
      (entry) => entry.lazyload !== undefined && !derivesAssetsUrl(entry)
    );
    expect(underived.map((entry) => entry.id).sort()).toEqual([
      'simulate-lazyload-custom-assets-url',
      'simulate-lazyload-with-delay-custom-url'
    ]);
    for (const set of SET_MATRIX) expect(pipelineSetProblems(set)).toEqual([]);
  });
});

describe.each(VERSIONS)('LazyLoad composition under WP Rocket %s', (version, pin) => {
  describe.each(ENGINES)('%s engine', (_engine, run) => {
    it.each(O1_ROWS.map((entry) => [entry.id, entry] as const))(
      'real-page parity %s',
      (id, entry) => {
        const simulate = simulationInput(entry, version, ['lazyload']);
        const served = expectationsFor(entry, version).served;
        for (const set of SET_MATRIX) {
          const simulated = rewritten(
            run({ html: entry.html, set, budgetMs: BUDGET_MS, simulate })
          );
          const refused = REFUSED[id];
          if (refused !== undefined) {
            expect(simulated.lazyloadSimulation).toMatchObject({
              state: 'not-applicable',
              reason: 'beyond-exact-reproduction',
              unreproducedRegex: refused
            });
            continue;
          }
          const real = rewritten(run({ html: served, set, budgetMs: BUDGET_MS }));
          expect(simulated.html === real.html, `${id} × ${JSON.stringify(set.rows)}`).toBe(true);
          expect(simulated.outcome).toEqual(real.outcome);
          expect(simulated.lazyloadSimulation).toMatchObject({
            feature: 'lazyload',
            state: 'simulated',
            wpRocketVersion: version,
            delivery: 'external'
          });
          for (const key of ['listSource', 'delayed', 'deferred']) {
            expect(simulated.lazyloadSimulation).not.toHaveProperty(key);
          }
        }
      }
    );

    it('with Defer JS (bundled lists): the plugin’s one-buffer page', () => {
      const entry = row('simulate-lazyload-with-defer');
      const simulate = simulationInput(entry, version, ['lazyload', 'defer_all_js']);
      const result = rewritten(
        run({ html: entry.html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
      );
      expect(result.html === expectationsFor(entry, version).served).toBe(true);
      expect(result.lazyloadSimulation?.state).toBe('simulated');
      expect(result.deferSimulation?.state).toBe('simulated');
    });

    it('with Defer JS and Delay JS (bundled lists): the plugin’s one-buffer page', () => {
      const entry = row('simulate-lazyload-with-defer-and-delay');
      const simulate = simulationInput(entry, version, ['lazyload', 'defer_all_js', 'delay_js']);
      const result = rewritten(
        run({ html: entry.html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
      );
      expect(result.html === expectationsFor(entry, version).served).toBe(true);
      expect(result.lazyloadSimulation?.state).toBe('simulated');
      expect(result.deferSimulation?.state).toBe('simulated');
      expect(result.simulation?.state).toBe('simulated');
    });

    it('refuses LazyLoad when Defer JS’s lists would wrap its options script', () => {
      const entry = row('simulate-lazyload-with-defer-unlisted');
      const simulate = simulationInput(entry, version, ['lazyload', 'defer_all_js']);
      const result = rewritten(
        run({ html: entry.html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
      );
      // The plugin's page with both: LazyLoad's options script wrapped (what the refusal avoids).
      expect(expectationsFor(entry, version).served).toContain('DOMContentLoaded');
      expect(result.lazyloadSimulation).toMatchObject({
        state: 'not-applicable',
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: 'lazyload-injected-scripts',
        images: 0
      });
      const deferLists = simulate.deferLists;
      if (deferLists === undefined) throw new Error('no defer lists');
      const deferOnly = simulateDeferJs({
        html: entry.html,
        rows: [],
        lists: { external: deferLists.external, inline: deferLists.inline },
        inlineQuoteDelimiter: pin.variants.deferInlineQuoteDelimiter
      });
      expect(result.html).toBe(deferOnly.html);
      expect(result.deferSimulation?.state).toBe('simulated');
    });

    it('refuses LazyLoad when Delay JS’s list would delay its scripts', () => {
      const entry = row('simulate-lazyload-with-delay-empty-list');
      const simulate = simulationInput(entry, version, ['lazyload', 'delay_js']);
      const result = rewritten(
        run({ html: entry.html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
      );
      expect(result.lazyloadSimulation?.unreproducedRegex).toBe('lazyload-injected-scripts');
      const delayOnly = simulateDelayJs({
        html: entry.html,
        runtime: simulate.runtime,
        ieFallback: simulate.fallback,
        listRows: simulate.listRows,
        rows: [],
        metaCharsetMoveText: pin.variants.metaCharsetMoveText
      });
      expect(result.html).toBe(delayOnly.html);
      expect(result.simulation?.state).toBe('simulated');
    });
  });
});

/*
 * Stored LazyLoad rows act through the exclusion builder's restore, as on a
 * real LazyLoad page (real-page parity runs LazyLoad rows in its set
 * matrix). Against WP Rocket's page served with those rows, the restore's
 * own scope shows: it keeps the restored image's `<noscript>` copy and
 * restores no picture or background image — the builder's limits on any
 * page, not the simulation's.
 */
describe('LazyLoad composition — stored rows', () => {
  const version = SUPPORTED_WPR_VERSIONS[0]?.version ?? '';
  const entry = row('simulate-lazyload-user-rows');

  it('restores the stored rows’ images on the simulated page', () => {
    const set = setWith({ lazyload: [...(entry.lazyload?.rows ?? [])] });
    expect(pipelineSetProblems(set)).toEqual([]);
    const simulate = simulationInput(entry, version, ['lazyload']);
    const result = rewritten(inProcess({ html: entry.html, set, budgetMs: BUDGET_MS, simulate }));
    expect(result.lazyloadSimulation?.state).toBe('simulated');
    // The row's image is restored; an image no row names stays lazy.
    expect(result.html).not.toContain('data-lazy-src="/uploads/keep/a.png"');
    expect(result.html).toMatch(/<img[^>]* src="\/uploads\/keep\/a\.png"/);
    expect(result.html).toContain('data-lazy-src="/c.png"');
  });
});
