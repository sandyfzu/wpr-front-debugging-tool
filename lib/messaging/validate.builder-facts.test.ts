/**
 * The additive `builder` field on the four builder rows: payloads without it
 * stay valid, every fact a row's feature can have passes, unknown values and
 * facts the feature cannot have reject, and the bounded producer output
 * always passes.
 */
import { describe, expect, it } from 'vitest';
import { runDetection } from '../detection/run-detection';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';
import { boundWprDetections } from './payload-bounds';
import { BUILDER_MARKER_LIMITS } from '../exclusion-builder/builder-marker';
import { parseFdtDataExplained, parseWprDetections } from './validate';
import { minimalDetections, validDetections, validFdt } from './validate.fixtures';

/** The builder rows and the facts each one's feature can have. */
const ALLOWED: Readonly<Record<string, readonly unknown[]>> = {
  delay_js: [{ off: 'feature' }, { excluded: 1 }, { excluded: 9999 }],
  defer_all_js: [{ off: 'feature' }, { off: 'page' }, { excluded: 42 }],
  automatic_lazy_rendering: [{ off: 'feature' }, { excluded: 3 }],
  lazyload: [{ excluded: 1 }, { excluded: 9999 }]
};

/** A payload whose `row` carries `builder`. */
function withBuilder(
  base: Record<string, unknown>,
  row: string,
  builder: unknown
): Record<string, unknown> {
  return { ...base, [row]: { ...(base[row] as Record<string, unknown>), builder } };
}

describe('the builder field on the builder rows', () => {
  it('keeps payloads without the field valid (old producers)', () => {
    expect(parseWprDetections(minimalDetections())).toEqual(minimalDetections());
    expect(parseWprDetections(validDetections())).toEqual(validDetections());
  });

  it('passes every fact the row’s feature can have, on minimal and populated rows', () => {
    for (const base of [minimalDetections(), validDetections()]) {
      for (const [row, facts] of Object.entries(ALLOWED)) {
        for (const fact of facts) {
          const payload = withBuilder(base, row, fact);
          const parsed = parseWprDetections(payload) as unknown as Record<string, unknown> | null;
          expect(parsed, `${row} ${JSON.stringify(fact)}`).not.toBeNull();
          expect(parsed?.[row], row).toEqual(payload[row]);
        }
      }
    }
  });

  it('rejects facts the row’s feature cannot have', () => {
    const base = minimalDetections();
    const refused: readonly [string, unknown][] = [
      ['lazyload', { off: 'feature' }],
      ['lazyload', { off: 'page' }],
      ['delay_js', { off: 'page' }],
      ['automatic_lazy_rendering', { off: 'page' }]
    ];
    for (const [row, fact] of refused) {
      expect(parseWprDetections(withBuilder(base, row, fact)), row).toBeNull();
    }
  });

  it('rejects unknown and malformed values on every builder row', () => {
    const base = minimalDetections();
    const invalid: readonly unknown[] = [
      null,
      true,
      'off',
      [],
      {},
      { off: 'Feature' },
      { off: 'row' },
      { off: true },
      { excluded: 0 },
      { excluded: -1 },
      { excluded: 1.5 },
      { excluded: '3' },
      { excluded: BUILDER_MARKER_LIMITS.excludedMax + 1 },
      { excluded: Number.POSITIVE_INFINITY },
      { off: 'feature', excluded: 1 },
      { off: 'feature', extra: 1 },
      { disabled: true }
    ];
    for (const row of Object.keys(ALLOWED)) {
      for (const value of invalid) {
        expect(
          parseWprDetections(withBuilder(base, row, value)),
          `${row} ${JSON.stringify(value)}`
        ).toBeNull();
      }
    }
  });

  it('rejects an own builder: undefined (key-count rule, as for source)', () => {
    for (const row of Object.keys(ALLOWED)) {
      expect(parseWprDetections(withBuilder(minimalDetections(), row, undefined)), row).toBeNull();
    }
  });

  it('keeps every other row builder-free', () => {
    const base = minimalDetections();
    for (const row of ['remove_unused_css', 'lazyload_iframes', 'rocket_cdn', 'wpr']) {
      expect(parseWprDetections(withBuilder(base, row, { off: 'feature' })), row).toBeNull();
    }
  });

  it('names the builder field when it rejects', () => {
    const fdt = validFdt();
    const payload = {
      ...fdt,
      wprDetections: withBuilder(fdt['wprDetections'] as Record<string, unknown>, 'delay_js', {
        off: 'nope'
      })
    };
    expect(parseFdtDataExplained(payload)).toEqual({
      ok: false,
      path: 'wprDetections.delay_js.builder'
    });
  });

  it('passes what the engine produces and the producer bounds, field intact', () => {
    const html = `<html><head><meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off defer_all_js=page-off automatic_lazy_rendering=excluded:9999 lazyload=excluded:7"></head><body></body></html>`;
    const bounded = boundWprDetections(runDetection(html).detections);
    const parsed = parseWprDetections(structuredClone(bounded));
    expect(parsed).toEqual(bounded);
    expect(parsed?.delay_js.builder).toEqual({ off: 'feature' });
    expect(parsed?.defer_all_js.builder).toEqual({ off: 'page' });
    expect(parsed?.automatic_lazy_rendering.builder).toEqual({ excluded: 9999 });
    expect(parsed?.lazyload.builder).toEqual({ excluded: 7 });
  });
});
