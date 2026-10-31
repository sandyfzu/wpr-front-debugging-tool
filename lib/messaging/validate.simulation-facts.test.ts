/**
 * The additive `simulation` field on the simulated features' rows (Delay JS,
 * Defer JS, LazyLoad): payloads without it stay valid, both facts pass,
 * anything else rejects, a `simulated` row that claims to be served rejects,
 * and the bounded producer output always passes.
 */
import { describe, expect, it } from 'vitest';
import { runDetection } from '../detection/run-detection';
import { SIMULATED_MARKER_ID, withSimulationMarker } from '../detection/simulated-pages.fixtures';
import { writeSimulationMarker } from '../wp-rocket-simulation/marker-write';
import { boundWprDetections } from './payload-bounds';
import { parseFdtDataExplained, parseWprDetections } from './validate';
import { minimalDetections, validDetections, validFdt } from './validate.fixtures';

/** A payload whose `row` carries `fields`. */
function withFields(
  base: Record<string, unknown>,
  row: string,
  fields: Record<string, unknown>
): Record<string, unknown> {
  return { ...base, [row]: { ...(base[row] as Record<string, unknown>), ...fields } };
}

/** The rows a simulation fact annotates (the simulated features). */
const SIMULATED_ROWS = ['delay_js', 'defer_all_js', 'lazyload'] as const;

describe("the simulation field on the simulated features' rows", () => {
  it('keeps payloads without the field valid (old producers)', () => {
    expect(parseWprDetections(minimalDetections())).toEqual(minimalDetections());
    expect(parseWprDetections(validDetections())).toEqual(validDetections());
  });

  it.each(SIMULATED_ROWS)('passes both facts on %s, alone and beside a builder fact', (row) => {
    const base = minimalDetections();
    for (const simulation of ['simulated', 'unverified']) {
      for (const extra of [{}, { builder: { excluded: 2 } }, { source: 'meta' }]) {
        const payload = withFields(base, row, { simulation, ...extra });
        expect(parseWprDetections(payload)?.[row], simulation).toEqual(payload[row]);
      }
    }
  });

  it('keeps a served Delay JS row under an unverified fact', () => {
    // Unverified keeps whatever the page served.
    const served = withFields(validDetections(), 'delay_js', { simulation: 'unverified' });
    expect(parseWprDetections(served)?.delay_js).toEqual(served['delay_js']);
  });

  it('rejects a simulated row that claims to be served', () => {
    const base = minimalDetections();
    for (const claim of [{ present: true }, { version: '2.0.5' }]) {
      const payload = withFields(base, 'delay_js', { simulation: 'simulated', ...claim });
      expect(parseWprDetections(payload), JSON.stringify(claim)).toBeNull();
    }
    for (const row of ['defer_all_js', 'lazyload'] as const) {
      const payload = withFields(base, row, { simulation: 'simulated', present: true });
      expect(parseWprDetections(payload), row).toBeNull();
      // Unverified keeps whatever the page served.
      const served = withFields(base, row, { simulation: 'unverified', present: true });
      expect(parseWprDetections(served)?.[row], row).toEqual(served[row]);
    }
  });

  it.each(SIMULATED_ROWS)('rejects unknown values and an own undefined on %s', (row) => {
    const base = minimalDetections();
    for (const value of [null, true, '', 'Simulated', 'served', 1, {}, [], undefined]) {
      expect(
        parseWprDetections(withFields(base, row, { simulation: value })),
        `${typeof value} ${JSON.stringify(value)}`
      ).toBeNull();
    }
  });

  it('keeps every other row simulation-free', () => {
    const base = minimalDetections();
    for (const row of ['minify_js', 'lazyload_iframes', 'lazyload_css_bg_img', 'wpr']) {
      expect(
        parseWprDetections(withFields(base, row, { simulation: 'unverified' })),
        row
      ).toBeNull();
    }
  });

  it('names the simulation field when it rejects', () => {
    const fdt = validFdt();
    const payload = {
      ...fdt,
      wprDetections: withFields(fdt['wprDetections'] as Record<string, unknown>, 'delay_js', {
        simulation: 'nope'
      })
    };
    expect(parseFdtDataExplained(payload)).toEqual({
      ok: false,
      path: 'wprDetections.delay_js.simulation'
    });
  });

  it('passes what the engine produces and the producer bounds, field intact', () => {
    const html = withSimulationMarker(
      '<html><head></head><body><script type="rocketlazyloadscript" data-rocket-src="/a.js"></script></body></html>'
    );
    const bounded = boundWprDetections(runDetection(html).detections);
    const parsed = parseWprDetections(structuredClone(bounded));
    expect(parsed).toEqual(bounded);
    expect(parsed?.delay_js.simulation).toBe('unverified');
  });

  it('passes the engine output of a page claiming LazyLoad and Defer JS simulated', () => {
    const html = writeSimulationMarker(
      '<html><head></head><body><img src="/a.png" alt=""><script src="/a.js" defer></script></body></html>',
      SIMULATED_MARKER_ID,
      ['lazyload', 'defer_all_js']
    ).html;
    const bounded = boundWprDetections(runDetection(html).detections);
    const parsed = parseWprDetections(structuredClone(bounded));
    expect(parsed).toEqual(bounded);
    expect(parsed?.lazyload.simulation).toBe('unverified');
    expect(parsed?.defer_all_js.simulation).toBe('unverified');
  });
});
