/**
 * Simulation composed with exclusions, against the plugin oracle (the
 * committed simulation parity table: the real WP Rocket Delay JS passes,
 * sentinel runtime + IE fallback), on both engine paths — in-process
 * (`runDocumentPipeline`) and worker (`handleTransformWorkerMessage`, the
 * request crossing the worker's guard as a structured message):
 *
 * - **O1 (exact):** for every row WP Rocket served with no stored rows,
 *   `pipeline(page, {set, simulate})` equals `pipeline(served, set)` byte
 *   for byte, reports included, over a set matrix (no rows, each Delay JS
 *   row set of the table, Defer JS, Lazyload and Automatic Lazy Rendering
 *   rows) — a simulated page behaves under the builder exactly like a real
 *   Delay-on page. Plus the disable arm over the real Delay-on output (the
 *   sentinels are recognized, so it is not vacuous).
 * - **O2 (fidelity bound):** for every row with stored rows R,
 *   `N(pipeline(page, {rows R, simulate}))` equals `N(plugin(page, R))`,
 *   N = parsed node trees without the builder marker meta, the
 *   `data-wpr-fdt-excluded` stamps and a valueless/blank script `type`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pipelineSetProblems } from '../exclusion-builder/pipeline';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import type { DocumentSimulationInput } from '../messaging/exclusion-simulation';
import {
  BUILDER_MARKER_META_NAME,
  FDT_EXCLUDED_RESOURCE,
  SIMULATION_MARKER_META_NAME
} from '../wp-rocket/constants';
import { SIMULATION_DATA_PATH, readSimulationData } from '../wp-rocket-simulation/simulation-data';
import {
  parseSimulationTable,
  type SimulateRow
} from '../wp-rocket-simulation/simulation-parity-table';
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

const DATA = readSimulationData(
  JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
);

/** The data file's bundled list for the table's plugin version. */
function bundledList(): readonly string[] {
  if (!DATA.ok) throw new Error(`simulation data file unreadable: ${DATA.problem}`);
  const version = DATA.data.versions[TABLE.header.plugin];
  const rows =
    version === undefined ? undefined : DATA.data.rowLists[version.delayJsExclusions.sha256];
  if (rows === undefined) throw new Error(`no bundled list for ${TABLE.header.plugin}`);
  return rows;
}

const { sentinels } = TABLE.header.simulation;

/** A budget no table run comes near (budget behavior has its own tests). */
const BUDGET_MS = 600_000;

/** Pages above this size run a reduced set matrix (each run costs tens of ms). */
const LARGE_PAGE_CHARS = 100_000;

/** The simulation input a session would hand the engine for a table row. */
function simulationInput(row: SimulateRow): DocumentSimulationInput {
  return {
    features: ['delay_js'],
    wpRocketVersion: TABLE.header.plugin,
    runtime: sentinels.runtime,
    fallback: sentinels.ieFallback,
    listRows: row.list === 'bundled' ? bundledList() : (row.listRows ?? []),
    listSource: 'bundled',
    listMiss: 'never-fetched'
  };
}

/** A set with these rows (the rest empty). */
function setWith(rows: Partial<ExclusionSet['rows']>): ExclusionSet {
  return { rows: { ...EMPTY_EXCLUSION_SET.rows, ...rows }, disable: EMPTY_EXCLUSION_SET.disable };
}

/** Every Delay JS row set of the table the builder accepts as stored rows. */
const DELAY_ROW_SETS: readonly ExclusionSet[] = TABLE.rows
  .filter((row) => row.rows.length > 0)
  .map((row) => setWith({ delayJs: acceptedRows(row.rows) }));

/**
 * The set matrix O1 runs every case under: no rows, the table's Delay JS
 * row sets, and one row set per other feature.
 */
const SET_MATRIX: readonly ExclusionSet[] = [
  EMPTY_EXCLUSION_SET,
  ...DELAY_ROW_SETS,
  setWith({ deferJs: ['a.js', 'jquery'] }),
  setWith({ lazyload: ['logo', 'hero'] }),
  setWith({ lazyRender: ['footer'] })
];

/** The rows of `rows` the builder accepts (alone), in order. */
function acceptedRows(rows: readonly string[]): string[] {
  return rows.filter((row) => pipelineSetProblems(setWith({ delayJs: [row] })).length === 0);
}

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

/** A completed run's html and exclusion reports (failing the test otherwise). */
function rewritten(result: DocumentTransformResult) {
  if (!result.ok) throw new Error(`run not rewritten: ${JSON.stringify(result.outcome)}`);
  const { simulation, ...rest } = result.outcome;
  return { html: result.html, outcome: rest, simulation };
}

/**
 * Remove exactly the one marker the step wrote (string-exact), failing when
 * the document does not hold exactly one.
 *
 * @param html The simulated document.
 * @param markerId The id the step was given.
 */
function stripSimulationMarker(html: string, markerId: string): string {
  const tag = `<meta name="${SIMULATION_MARKER_META_NAME}" content="v1 delay_js=simulated id=${markerId}">`;
  const at = html.indexOf(tag);
  if (at < 0 || html.indexOf(tag, at + 1) >= 0) throw new Error('not exactly one marker written');
  return html.slice(0, at) + html.slice(at + tag.length);
}

/** The rows WP Rocket served with no stored rows: O1's oracle cases. */
const O1_ROWS = TABLE.rows.filter((row) => row.rows.length === 0);

/** The rows with stored rows: O2's cases. */
const O2_ROWS = TABLE.rows.filter((row) => row.rows.length > 0);

describe('simulation composed with exclusions — the table matrix', () => {
  it('runs every table row in one of the two oracles, over a non-trivial matrix', () => {
    expect(O1_ROWS.length + O2_ROWS.length).toBe(TABLE.rows.length);
    expect(O2_ROWS.length).toBeGreaterThanOrEqual(7);
    // Every matrix set is runnable (no set refused before any step).
    for (const set of SET_MATRIX) expect(pipelineSetProblems(set)).toEqual([]);
    expect(DELAY_ROW_SETS.every((set) => set.rows.delayJs.length > 0)).toBe(true);
  });
});

describe.each(ENGINES)('O1 — %s engine', (_engine, run) => {
  it.each(O1_ROWS.map((row) => [row.id, row] as const))('%s', (_id, row) => {
    const sets =
      row.html.length > LARGE_PAGE_CHARS ? [EMPTY_EXCLUSION_SET, SET_MATRIX[1]] : SET_MATRIX;
    for (const set of sets) {
      if (set === undefined) continue;
      const simulated = rewritten(
        run({ html: row.html, set, budgetMs: BUDGET_MS, simulate: simulationInput(row) })
      );
      const real = rewritten(run({ html: row.served, set, budgetMs: BUDGET_MS }));
      expect(simulated.html === real.html, `${row.id} × ${JSON.stringify(set.rows)}`).toBe(true);
      expect(simulated.outcome).toEqual(real.outcome);
      expect(real.simulation).toBeUndefined();
      expect(simulated.simulation).toMatchObject({ feature: 'delay_js' });
    }
  });

  it('with a marker id: the page minus exactly the marker it wrote is the served page', () => {
    const markerId = '0123456789abcdef0123456789abcdef';
    let marked = 0;
    for (const row of O1_ROWS) {
      for (const set of [EMPTY_EXCLUSION_SET, SET_MATRIX[1]]) {
        if (set === undefined) continue;
        const simulate = { ...simulationInput(row), markerId };
        const simulated = rewritten(run({ html: row.html, set, budgetMs: BUDGET_MS, simulate }));
        const real = rewritten(run({ html: row.served, set, budgetMs: BUDGET_MS }));
        if (simulated.simulation?.state !== 'simulated') {
          expect(simulated.simulation).not.toHaveProperty('markerId');
          expect(simulated.html === real.html, row.id).toBe(true);
          continue;
        }
        expect(simulated.simulation.markerId).toBe(markerId);
        const stripped = stripSimulationMarker(simulated.html, markerId);
        expect(stripped === real.html, `${row.id} × ${JSON.stringify(set.rows)}`).toBe(true);
        marked++;
      }
    }
    expect(marked).toBeGreaterThan(30);
  });

  it('disable arm: the real Delay-on page with Delay JS disabled drops the sentinels', () => {
    const disable: ExclusionSet = {
      ...EMPTY_EXCLUSION_SET,
      disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: true }
    };
    let restored = 0;
    for (const row of O1_ROWS) {
      if (!row.served.includes(sentinels.runtime)) continue;
      const result = rewritten(run({ html: row.served, set: disable, budgetMs: BUDGET_MS }));
      expect(result.html).not.toContain(sentinels.runtime);
      expect(result.html).not.toContain(sentinels.ieFallback);
      restored++;
    }
    expect(restored).toBeGreaterThan(30);
  });
});

/**
 * Normalize a document for O2: parse it, drop the builder marker meta and
 * the exclusion stamps, drop a valueless/blank script `type` (HTML reads it
 * as absent), and serialize the tree with attributes sorted by name.
 *
 * @param html The document.
 */
function normalized(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const meta of doc.querySelectorAll(`meta[name="${BUILDER_MARKER_META_NAME}"]`)) {
    meta.remove();
  }
  for (const element of doc.querySelectorAll(`[${FDT_EXCLUDED_RESOURCE}]`)) {
    element.removeAttribute(FDT_EXCLUDED_RESOURCE);
  }
  for (const script of doc.querySelectorAll('script[type]')) {
    if ((script.getAttribute('type') ?? '').trim() === '') script.removeAttribute('type');
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
  const children = [...node.childNodes].map(serializeNode).join(',');
  return `<${node.localName} ${attributes.join(' ')}>[${children}]`;
}

describe.each(ENGINES)('O2 — %s engine', (_engine, run) => {
  it.each(O2_ROWS.map((row) => [row.id, row] as const))('%s', (_id, row) => {
    // Rows the builder refuses (PCRE rejects them: WP Rocket's `preg_match`
    // fails, matching nothing) never reach a session, so they are left out.
    const set = setWith({ delayJs: acceptedRows(row.rows) });
    const result = rewritten(
      run({ html: row.html, set, budgetMs: BUDGET_MS, simulate: simulationInput(row) })
    );
    expect(normalized(result.html) === normalized(row.served), row.id).toBe(true);
  });
});

describe('O2 is not vacuous', () => {
  it('the normalization keeps what matters and drops only the declared noise', () => {
    expect(normalized('<script src="a.js"></script>')).not.toBe(
      normalized('<script src="b.js"></script>')
    );
    expect(normalized('<script type="" src="a.js"></script>')).toBe(
      normalized(`<script src="a.js" ${FDT_EXCLUDED_RESOURCE}="delay_js"></script>`)
    );
  });

  it('without the stored rows, the simulated pages differ from WP Rocket’s with them', () => {
    const differing = O2_ROWS.filter((row) => {
      const result = rewritten(
        inProcess({
          html: row.html,
          set: EMPTY_EXCLUSION_SET,
          budgetMs: BUDGET_MS,
          simulate: simulationInput(row)
        })
      );
      return normalized(result.html) !== normalized(row.served);
    });
    expect(differing.length).toBe(O2_ROWS.length);
  });
});
