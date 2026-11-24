/**
 * A simulated document carries the exact packaged bytes: the host path
 * (packaged runtime source over the committed data file → preparation →
 * document step) on both engine paths turns each bundled-list table page
 * into the page WP Rocket serves with Delay JS on, its runtime and IE
 * fallback being the real packaged texts (the table's sentinels swapped
 * back for them).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET } from '../exclusion-builder/set';
import { SIMULATION_DATA_PATH } from '../wp-rocket-simulation/simulation-data';
import {
  isDelayOnlyRow,
  parseSimulationTable
} from '../wp-rocket-simulation/simulation-parity-table';
import type { InterceptedDocument } from './backend';
import { rewriteDocument, type DocumentTransformRunner } from './document-transform';
import { runDocumentPipeline } from './document-pipeline';
import { webSha256Hex } from '../../utils/web-sha256';
import { createPackagedRuntimeSource } from './packaged-simulation-data';
import { INERT_SIMULATION_SOURCES, simulationPreparer } from './simulation-sources';
import { type TransformWorkerMessage } from './transform-worker';
import { handleTransformWorkerMessage } from './transform-worker-handler';

const HERE = dirname(fileURLToPath(import.meta.url));

const DATA_TEXT = readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8');

const TABLE = parseSimulationTable(
  JSON.parse(
    readFileSync(join(HERE, '../wp-rocket-simulation/simulation-parity.fixtures.json'), 'utf8')
  )
);

/** The Delay JS rows without Defer JS (Defer JS rows have their own suite). */
const DELAY_ROWS = TABLE.rows.filter(isDelayOnlyRow);

const { sentinels } = TABLE.header.simulation;

/** The real texts, straight from the committed file by the reference pins. */
const REAL = (() => {
  const data = JSON.parse(DATA_TEXT) as { texts: Record<string, string> };
  const runtime = data.texts[TABLE.header.simulation.runtime.sha256];
  const fallback = data.texts[TABLE.header.simulation.ieFallback.sha256];
  if (runtime === undefined || fallback === undefined) throw new Error('pinned texts missing');
  return { runtime, fallback };
})();

/** The table rows simulated with the bundled list and no stored rows. */
const ROWS = DELAY_ROWS.filter(
  (row) => row.list === 'bundled' && row.rows.length === 0 && row.served.includes(sentinels.runtime)
);

const BUDGET_MS = 600_000;

/** The worker engine path: the request crosses the worker's guard as a structured message. */
const viaWorker: DocumentTransformRunner = (request) => {
  const posted: TransformWorkerMessage[] = [];
  handleTransformWorkerMessage(
    structuredClone({ type: 'transform', id: 1, request }),
    (message) => posted.push(message),
    () => 0
  );
  const result = posted.find((message) => message.type === 'result');
  if (result?.type !== 'result') throw new Error('the worker posted no result');
  return Promise.resolve(result.result);
};

const ENGINES: readonly (readonly [string, DocumentTransformRunner])[] = [
  ['in-process', (request) => Promise.resolve(runDocumentPipeline(request, () => 0))],
  ['worker', viaWorker]
];

/** An intercepted UTF-8 document. */
function intercepted(html: string): InterceptedDocument {
  return {
    tabId: 1,
    documentUrl: 'https://site.test/',
    body: new TextEncoder().encode(html),
    contentType: 'text/html; charset=UTF-8',
    status: 200,
    method: 'GET'
  };
}

/** The served page with the real packaged texts in place of the sentinels. */
function servedWithRealTexts(served: string): string {
  return served
    .split(sentinels.runtime)
    .join(REAL.runtime)
    .split(sentinels.ieFallback)
    .join(REAL.fallback);
}

describe('the packaged data through the host', () => {
  it('has bundled-list rows to run', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(2);
  });

  describe.each(ENGINES)('%s engine', (_engine, runner) => {
    it.each(ROWS.map((row) => [row.id, row] as const))('%s', async (_id, row) => {
      const runtime = createPackagedRuntimeSource({
        fetch: () =>
          Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(DATA_TEXT) }),
        url: 'chrome-extension://id/wp-rocket-simulation/simulation-data.json',
        sha256: webSha256Hex,
        log: { error: () => undefined }
      });
      const document = intercepted(row.html);
      const rewrite = await rewriteDocument(
        document,
        EMPTY_EXCLUSION_SET,
        runner,
        BUDGET_MS,
        simulationPreparer({ features: ['delay_js'] }, document, {
          ...INERT_SIMULATION_SOURCES,
          runtime
        })
      );
      expect(rewrite.outcome).toMatchObject({
        outcome: 'rewritten',
        simulation: { feature: 'delay_js', state: 'simulated', listSource: 'bundled' }
      });
      if (rewrite.body === null) throw new Error('nothing served');
      const served = new TextDecoder().decode(rewrite.body);
      // The same document step over the page WP Rocket serves (speculation rules removed alike).
      const real = servedWithRealTexts(row.served);
      const expected = await rewriteDocument(
        intercepted(real),
        EMPTY_EXCLUSION_SET,
        runner,
        BUDGET_MS
      );
      const expectedHtml = expected.body === null ? real : new TextDecoder().decode(expected.body);
      expect(served === expectedHtml, row.id).toBe(true);
      // The exact packaged runtime bytes, once.
      expect(served.split(REAL.runtime)).toHaveLength(2);
      expect(served).not.toContain(sentinels.runtime);
    });
  });
});
