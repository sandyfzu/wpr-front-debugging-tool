/**
 * Defer JS simulation composed with the exclusion steps, over the plugin
 * table's Defer JS rows, under every supported WP Rocket version and both
 * engine paths (in-process; worker through a structured-cloned request):
 *
 * - Real-page parity: on a row WP Rocket served without stored rows, simulate → the
 *   exclusion steps gives exactly what the exclusion steps give on WP
 *   Rocket's own Defer-on page (html + exclusion reports), over a set matrix.
 * - Stored-rows parity: on a row with stored Defer JS rows, simulate (rows never applied)
 *   → those rows as exclusions equals WP Rocket's page with them, after
 *   the declared normalization (builder marker + exclusion stamps dropped).
 * - Both features: the pipeline gives the page of the one-buffer reference
 *   transform (Defer JS passes inside Delay JS's one IE extraction, whose
 *   output the plugin table pins — IE conditionals holding `$` and `\`
 *   included), Defer JS's page alone when Delay JS does not simulate — on
 *   every table row and on generated pages.
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
  SimulationDeferLists
} from '../messaging/exclusion-simulation';
import {
  BUILDER_MARKER_META_NAME,
  FDT_EXCLUDED_RESOURCE,
  SIMULATION_MARKER_META_NAME
} from '../wp-rocket/constants';
import { SUPPORTED_WPR_VERSIONS, type SupportedWprVersion } from '../wp-rocket/versions';
import { simulateDeferJs } from '../wp-rocket-simulation/defer-js-forward';
import { simulateDelayJs } from '../wp-rocket-simulation/delay-js-forward';
import { SIMULATION_DATA_PATH, readSimulationData } from '../wp-rocket-simulation/simulation-data';
import {
  parseSimulationTable,
  type SimulateRow
} from '../wp-rocket-simulation/simulation-parity-table';
import type { SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import {
  runDocumentPipeline,
  type DocumentTransformRequest,
  type DocumentTransformResult
} from './document-transform';
import { handleTransformWorkerMessage, type TransformWorkerMessage } from './transform-worker';

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

/** The Defer JS-only rows the session can reach (a builder-refused row never does). */
const DEFER_ROWS = TABLE.rows.filter(
  (row) => row.feature === 'defer_all_js' && row.defer?.filterOnly !== true
);

/** The Delay JS rows with Defer JS on in the same buffer. */
const COMPOSED_ROWS = TABLE.rows.filter(
  (row) => row.feature === 'delay_js' && row.defer !== undefined
);

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

/** A row's Defer JS lists under a version, as a session hands them to the engine. */
function deferLists(row: SimulateRow, version: string): SimulationDeferLists {
  const lists = row.defer?.lists;
  if (lists === undefined) throw new Error(`${row.id} holds no defer`);
  const entry = entryOf(version);
  return {
    ...(lists === 'bundled'
      ? {
          external: dataRows(entry.deferJsExternalExclusions.sha256),
          inline: dataRows(entry.deferJsInlineExclusions.sha256)
        }
      : lists),
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

/** The simulation input a session hands the engine for a row. */
function simulationInput(
  row: SimulateRow,
  version: string,
  features: readonly SimulatedFeatureId[]
): DocumentSimulationInput {
  return {
    features,
    wpRocketVersion: version,
    runtime: sentinels.runtime,
    fallback: sentinels.ieFallback,
    listRows:
      row.list === 'bundled'
        ? dataRows(entryOf(version).delayJsExclusions.sha256)
        : (row.listRows ?? []),
    listSource: 'bundled',
    listMiss: 'never-fetched',
    deferLists: deferLists(row, version)
  };
}

/** A set with these rows (the rest empty). */
function setWith(rows: Partial<ExclusionSet['rows']>): ExclusionSet {
  return { rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows }, disable: EMPTY_EXCLUSION_SET.disable };
}

/** Real-page parity's set matrix: none, Defer JS rows, and one row set per other feature. */
const SET_MATRIX: readonly ExclusionSet[] = [
  EMPTY_EXCLUSION_SET,
  setWith({ deferJs: ['a.js', 'jquery'] }),
  setWith({ delayJs: ['gtag'] }),
  setWith({ lazyload: ['logo'] })
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
  const { simulation, deferSimulation, ...rest } = result.outcome;
  return { html: result.html, outcome: rest, simulation, deferSimulation };
}

/** Normalize for stored-rows parity: drop the builder marker and the exclusion stamps, sort attributes. */
function normalized(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const meta of doc.querySelectorAll(`meta[name="${BUILDER_MARKER_META_NAME}"]`)) {
    meta.remove();
  }
  for (const element of doc.querySelectorAll(`[${FDT_EXCLUDED_RESOURCE}]`)) {
    element.removeAttribute(FDT_EXCLUDED_RESOURCE);
  }
  return serializeNode(doc.documentElement);
}

/** A node as text: element names, attributes as a sorted map, text and comments exact. */
function serializeNode(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return `#text(${JSON.stringify(node.textContent)})`;
  if (node.nodeType === node.COMMENT_NODE) return `#comment(${JSON.stringify(node.textContent)})`;
  if (!(node instanceof Element)) return `#node(${String(node.nodeType)})`;
  const attributes = [...node.attributes]
    .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
    .sort();
  return `<${node.localName} ${attributes.join(' ')}>[${[...node.childNodes].map(serializeNode).join(',')}]`;
}

/** Rows WP Rocket served without stored rows (real-page parity), and with them (stored-rows parity). */
const O1_ROWS = DEFER_ROWS.filter((row) => row.defer?.rows.length === 0);
const O2_ROWS = DEFER_ROWS.filter((row) => (row.defer?.rows.length ?? 0) > 0);

const VERSIONS = SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version, pin] as const);

describe('Defer JS composition — coverage', () => {
  it('runs every reachable Defer JS row in one of the oracles', () => {
    expect(O1_ROWS.length).toBeGreaterThanOrEqual(14);
    expect(O2_ROWS.length).toBeGreaterThanOrEqual(3);
    expect(COMPOSED_ROWS.length).toBeGreaterThanOrEqual(2);
    for (const set of SET_MATRIX) expect(pipelineSetProblems(set)).toEqual([]);
  });
});

describe.each(VERSIONS)('Defer JS composition under WP Rocket %s', (version) => {
  describe.each(ENGINES)('%s engine', (_engine, run) => {
    it.each(O1_ROWS.map((row) => [row.id, row] as const))('real-page parity %s', (_id, row) => {
      const served = expectationsFor(row, version).served;
      for (const set of SET_MATRIX) {
        const simulate = simulationInput(row, version, ['defer_all_js']);
        const simulated = rewritten(run({ html: row.html, set, budgetMs: BUDGET_MS, simulate }));
        const real = rewritten(run({ html: served, set, budgetMs: BUDGET_MS }));
        expect(simulated.html === real.html, `${row.id} × ${JSON.stringify(set.rows)}`).toBe(true);
        expect(simulated.outcome).toEqual(real.outcome);
        expect(simulated.simulation).toBeUndefined();
        expect(simulated.deferSimulation).toMatchObject({
          feature: 'defer_all_js',
          wpRocketVersion: version
        });
        for (const key of ['delayed', 'runtimeInjected', 'cspLimits', 'cspUnavailable']) {
          expect(simulated.deferSimulation).not.toHaveProperty(key);
        }
      }
    });

    it.each(O2_ROWS.map((row) => [row.id, row] as const))('stored-rows parity %s', (_id, row) => {
      const set = setWith({ deferJs: [...(row.defer?.rows ?? [])] });
      expect(pipelineSetProblems(set)).toEqual([]);
      const simulate = simulationInput(row, version, ['defer_all_js']);
      const result = rewritten(run({ html: row.html, set, budgetMs: BUDGET_MS, simulate }));
      const served = expectationsFor(row, version).served;
      expect(normalized(result.html) === normalized(served), row.id).toBe(true);
    });

    it.each(COMPOSED_ROWS.map((row) => [row.id, row] as const))(
      'both features, parity %s',
      (_id, row) => {
        const set = setWith({ delayJs: [...(row.rows ?? [])] });
        const simulate = simulationInput(row, version, ['defer_all_js', 'delay_js']);
        const result = rewritten(run({ html: row.html, set, budgetMs: BUDGET_MS, simulate }));
        const served = expectationsFor(row, version).served;
        expect(normalized(result.html) === normalized(served), row.id).toBe(true);
        expect(result.simulation).toMatchObject({ feature: 'delay_js', state: 'simulated' });
        expect(result.deferSimulation?.feature).toBe('defer_all_js');
      }
    );
  });
});

describe('Defer JS composition — stored-rows parity is not vacuous', () => {
  it('without the stored rows, the simulated pages differ from WP Rocket’s with them', () => {
    const version = SUPPORTED_WPR_VERSIONS[0]?.version ?? '';
    for (const row of O2_ROWS) {
      const simulate = simulationInput(row, version, ['defer_all_js']);
      const result = rewritten(
        inProcess({ html: row.html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
      );
      const served = expectationsFor(row, version).served;
      expect(normalized(result.html) === normalized(served), row.id).toBe(false);
    }
  });
});

/**
 * The one-buffer reference: Delay JS with Defer JS's passes inside its IE
 * extraction (the order the plugin table pins); Defer JS's page alone when
 * that run does not simulate.
 */
function oneBuffer(html: string, simulate: DocumentSimulationInput, pin: SupportedWprVersion) {
  const lists = simulate.deferLists;
  if (lists === undefined) throw new Error('no defer lists');
  const defer = {
    rows: [],
    lists: { external: lists.external, inline: lists.inline },
    inlineQuoteDelimiter: pin.variants.deferInlineQuoteDelimiter
  };
  const both = simulateDelayJs({
    html,
    runtime: simulate.runtime,
    ieFallback: simulate.fallback,
    listRows: simulate.listRows,
    rows: [],
    defer
  });
  return both.report.state === 'simulated' ? both : simulateDeferJs({ html, ...defer });
}

/** A deterministic generator (mulberry32). */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Markup atoms both features read: scripts in every shape, IE conditionals, comments, masks. */
const ATOMS = [
  '<script src="/a.js"></script>',
  '<script src="https://x.test/jquery.min.js?ver=3"></script>',
  "<script src='/b.js' async></script>",
  '<script src="/c.js" defer></script>',
  '<script type="text/javascript" src="/d.js" id="d"></script>',
  '<script>jQuery(function(){ go(); });</script>',
  '<script>$(document).ready(x);</script>',
  '<script type="application/ld+json">{"a":"jQuery"}</script>',
  '<script>var lazyLoadOptions = {};</script>',
  '<script>window.dataLayer = [];</script>',
  '<script id="gtag" src="https://www.googletagmanager.com/gtag/js?id=G"></script>',
  '<!--[if lt IE 9]><script src="/ie.js"></script><![endif]-->',
  '<!-- <script src="/commented.js"></script> -->',
  '<xmp><script src="/xmp.js"></script></xmp>',
  '<svg><script>jQuery(1)</script></svg>',
  '<meta charset="utf-8">',
  '<p>text é</p>',
  '<div onclick="go()">x</div>',
  // IE conditionals holding replacement metacharacters: set aside once per buffer, never re-read.
  '<!--[if IE]><script>var a="$1 $0 ${1} $$";</script><![endif]-->',
  '<!--[if IE]><script src="/ie$1.js"></script><script>jQuery("\\\\d \\1 \\0")</script><![endif]-->',
  '<!--[if lt IE 9]><p>\\1 \\0 $2 $&</p><![endif]-->',
  '<!--[if IE]><script>"\\/"; jQuery(1)</script><![endif]-->'
];

/** A random page: `<head>` and `<body>` filled with atoms. */
function randomPage(next: () => number): string {
  const pick = (count: number): string =>
    Array.from({ length: count }, () => ATOMS[Math.floor(next() * ATOMS.length)] ?? '').join('\n');
  const head = pick(Math.floor(next() * 6));
  const body = pick(Math.floor(next() * 10));
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

describe.each(VERSIONS)(
  'both features = the one-buffer reference under WP Rocket %s',
  (version, pin) => {
    const reference = TABLE.rows.find((row) => row.id === 'simulate-defer-bundled-hits');
    if (reference === undefined) throw new Error('no bundled-lists row');
    const simulate = simulationInput(reference, version, ['defer_all_js', 'delay_js']);

    it('on every table row with Defer JS', () => {
      for (const row of [...DEFER_ROWS, ...COMPOSED_ROWS]) {
        const result = rewritten(
          inProcess({ html: row.html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
        );
        const expected = oneBuffer(row.html, simulate, pin);
        expect(result.html === expected.html, row.id).toBe(true);
      }
    });

    it('on 600 generated pages', () => {
      const next = generator(0x5eed + version.length);
      let deferred = 0;
      for (let page = 0; page < 600; page++) {
        const html = randomPage(next);
        const result = rewritten(
          inProcess({ html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
        );
        const expected = oneBuffer(html, simulate, pin);
        expect(result.html === expected.html, html).toBe(true);
        if ((result.deferSimulation?.deferred ?? 0) > 0) deferred++;
      }
      expect(deferred).toBeGreaterThan(300);
    });

    it('sets IE conditionals aside once: Defer JS’s page then Delay JS alone would differ', () => {
      const html =
        '<html><head></head><body><script src="/a.js"></script>' +
        '<!--[if IE]><script>var a="$1 \\\\d";</script><![endif]--></body></html>';
      const result = rewritten(
        inProcess({ html, set: EMPTY_EXCLUSION_SET, budgetMs: BUDGET_MS, simulate })
      );
      expect(result.html).toBe(oneBuffer(html, simulate, pin).html);
      expect(result.html).toContain('<!--[if IE]><script>var a="$1 \\\\d";</script><![endif]-->');
      const deferred = simulateDeferJs({
        html,
        rows: [],
        lists: { external: [], inline: [] },
        inlineQuoteDelimiter: pin.variants.deferInlineQuoteDelimiter
      }).html;
      const twoBuffers = simulateDelayJs({
        html: deferred,
        runtime: simulate.runtime,
        ieFallback: simulate.fallback,
        listRows: simulate.listRows,
        rows: []
      }).html;
      expect(twoBuffers).not.toBe(result.html);
    });

    it('writes one marker naming both features, in registry order', () => {
      const markerId = '0123456789abcdef0123456789abcdef';
      const html = '<html><head><script src="/a.js"></script></head><body></body></html>';
      const result = rewritten(
        inProcess({
          html,
          set: EMPTY_EXCLUSION_SET,
          budgetMs: BUDGET_MS,
          simulate: { ...simulate, markerId }
        })
      );
      expect(result.html).toContain(
        `<meta name="${SIMULATION_MARKER_META_NAME}" content="v1 defer_all_js=simulated delay_js=simulated id=${markerId}">`
      );
      expect(result.simulation?.markerId).toBe(markerId);
      expect(result.deferSimulation?.markerId).toBe(markerId);
    });
  }
);
