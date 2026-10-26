/**
 * The builder marker's content grammar: every token, the bounds, the write
 * clamp, and each rejection of the all-or-nothing read.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { BuilderFact, BuilderFactRow } from '../wp-rocket/types';
import {
  BUILDER_MARKER_LIMITS,
  isBuilderFactAllowed,
  parseBuilderNote,
  serializeBuilderNote,
  type BuilderNote
} from './builder-marker';
import type { ExclusionFeatureId } from './set';

describe('builder marker vocabulary', () => {
  it("keys facts by the detection rows' own ids", () => {
    expectTypeOf<ExclusionFeatureId>().toEqualTypeOf<BuilderFactRow>();
  });

  it('pins the bounds', () => {
    expect(BUILDER_MARKER_LIMITS).toEqual({ excludedMax: 9999, tokens: 5, chars: 128 });
  });
});

describe('isBuilderFactAllowed', () => {
  const cases: readonly [ExclusionFeatureId, BuilderFact, boolean][] = [
    ['delay_js', { off: 'feature' }, true],
    ['defer_all_js', { off: 'feature' }, true],
    ['automatic_lazy_rendering', { off: 'feature' }, true],
    // Image Lazyload has no feature-wide toggle.
    ['lazyload', { off: 'feature' }, false],
    // Only Defer JS reads its rows as one page-wide pattern.
    ['defer_all_js', { off: 'page' }, true],
    ['delay_js', { off: 'page' }, false],
    ['automatic_lazy_rendering', { off: 'page' }, false],
    ['lazyload', { off: 'page' }, false],
    ['lazyload', { excluded: 1 }, true],
    ['delay_js', { excluded: 9999 }, true],
    ['delay_js', { excluded: 0 }, false],
    ['delay_js', { excluded: 10_000 }, false],
    ['delay_js', { excluded: 1.5 }, false],
    ['delay_js', { excluded: Number.NaN }, false]
  ];
  for (const [feature, fact, allowed] of cases) {
    it(`${feature} ${JSON.stringify(fact)} → ${String(allowed)}`, () => {
      expect(isBuilderFactAllowed(feature, fact)).toBe(allowed);
    });
  }
});

describe('serializeBuilderNote', () => {
  it('writes every token, in registry order whatever the note order', () => {
    const note: BuilderNote = {
      lazyload: { excluded: 3 },
      automatic_lazy_rendering: { off: 'feature' },
      defer_all_js: { off: 'page' },
      delay_js: { off: 'feature' }
    };
    expect(serializeBuilderNote(note)).toBe(
      'v1 delay_js=off defer_all_js=page-off automatic_lazy_rendering=off lazyload=excluded:3'
    );
  });

  it('writes one token per feature present', () => {
    expect(serializeBuilderNote({ defer_all_js: { off: 'feature' } })).toBe('v1 defer_all_js=off');
    expect(serializeBuilderNote({ automatic_lazy_rendering: { excluded: 12 } })).toBe(
      'v1 automatic_lazy_rendering=excluded:12'
    );
  });

  it('writes nothing for an empty note', () => {
    expect(serializeBuilderNote({})).toBeNull();
  });

  it('clamps a count past 9999 to 9999', () => {
    expect(serializeBuilderNote({ delay_js: { excluded: 123_456 } })).toBe(
      'v1 delay_js=excluded:9999'
    );
  });

  it('stays inside the read bounds at its longest', () => {
    const longest = serializeBuilderNote({
      delay_js: { excluded: 9999 },
      defer_all_js: { excluded: 9999 },
      automatic_lazy_rendering: { excluded: 9999 },
      lazyload: { excluded: 9999 }
    });
    expect(longest).not.toBeNull();
    expect((longest ?? '').length).toBeLessThanOrEqual(BUILDER_MARKER_LIMITS.chars);
    expect((longest ?? '').split(' ')).toHaveLength(BUILDER_MARKER_LIMITS.tokens);
  });

  it('throws on a fact the feature cannot have, naming it', () => {
    expect(() => serializeBuilderNote({ lazyload: { off: 'feature' } })).toThrow(
      /not a valid lazyload fact/
    );
    expect(() => serializeBuilderNote({ delay_js: { off: 'page' } })).toThrow(/delay_js/);
    expect(() => serializeBuilderNote({ delay_js: { excluded: 0 } })).toThrow(RangeError);
  });

  it('round-trips through the parser', () => {
    const notes: BuilderNote[] = [
      { delay_js: { off: 'feature' } },
      { defer_all_js: { off: 'page' }, lazyload: { excluded: 1 } },
      { automatic_lazy_rendering: { excluded: 9999 } }
    ];
    for (const note of notes) {
      expect(parseBuilderNote(serializeBuilderNote(note) ?? '')).toEqual(note);
    }
  });
});

describe('parseBuilderNote', () => {
  it('reads the documented example', () => {
    expect(parseBuilderNote('v1 delay_js=off defer_all_js=page-off lazyload=excluded:3')).toEqual({
      delay_js: { off: 'feature' },
      defer_all_js: { off: 'page' },
      lazyload: { excluded: 3 }
    });
  });

  it('reads every state of every feature', () => {
    expect(parseBuilderNote('v1 delay_js=excluded:2')).toEqual({ delay_js: { excluded: 2 } });
    expect(parseBuilderNote('v1 defer_all_js=off')).toEqual({ defer_all_js: { off: 'feature' } });
    expect(parseBuilderNote('v1 defer_all_js=excluded:9')).toEqual({
      defer_all_js: { excluded: 9 }
    });
    expect(parseBuilderNote('v1 automatic_lazy_rendering=off')).toEqual({
      automatic_lazy_rendering: { off: 'feature' }
    });
    expect(parseBuilderNote('v1 automatic_lazy_rendering=excluded:40')).toEqual({
      automatic_lazy_rendering: { excluded: 40 }
    });
    expect(parseBuilderNote('v1 lazyload=excluded:9999')).toEqual({ lazyload: { excluded: 9999 } });
  });

  const rejected: readonly [string, string][] = [
    ['empty content', ''],
    ['the version alone', 'v1'],
    ['another version', 'v2 delay_js=off'],
    ['an uppercase version', 'V1 delay_js=off'],
    ['no version', 'delay_js=off'],
    ['an unknown feature', 'v1 delay=off'],
    ['an uppercase feature', 'v1 DELAY_JS=off'],
    ['an unknown state', 'v1 delay_js=on'],
    ['an uppercase state', 'v1 delay_js=OFF'],
    ['a state the feature cannot have (no toggle)', 'v1 lazyload=off'],
    ['page-off outside Defer JS', 'v1 delay_js=page-off'],
    ['a repeated feature', 'v1 delay_js=off delay_js=off'],
    ['features out of order', 'v1 defer_all_js=off delay_js=off'],
    ['a zero count', 'v1 lazyload=excluded:0'],
    ['a leading-zero count', 'v1 lazyload=excluded:01'],
    ['a count past 9999', 'v1 lazyload=excluded:10000'],
    ['a signed count', 'v1 lazyload=excluded:+3'],
    ['a decimal count', 'v1 lazyload=excluded:3.0'],
    ['an empty count', 'v1 lazyload=excluded:'],
    ['a missing state', 'v1 delay_js='],
    ['a missing feature', 'v1 =off'],
    ['a bare feature', 'v1 delay_js'],
    ['a double space', 'v1  delay_js=off'],
    ['a leading space', ' v1 delay_js=off'],
    ['a trailing space', 'v1 delay_js=off '],
    ['a tab separator', 'v1\tdelay_js=off'],
    ['a newline separator', 'v1\ndelay_js=off'],
    ['a second equals sign', 'v1 delay_js=off=off'],
    [
      'more tokens than features',
      'v1 delay_js=off defer_all_js=off automatic_lazy_rendering=off lazyload=excluded:1 x=off'
    ],
    ['content past the length cap', `v1 delay_js=off${' '.repeat(BUILDER_MARKER_LIMITS.chars)}`]
  ];
  for (const [label, content] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parseBuilderNote(content)).toBeNull();
    });
  }

  it('rejects an over-long content before splitting it', () => {
    // A hostile megabyte of tokens: refused on length alone.
    expect(parseBuilderNote(`v1 ${'delay_js=off '.repeat(100_000)}`)).toBeNull();
  });
});
