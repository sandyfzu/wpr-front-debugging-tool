/**
 * Producer-side bounding: every capped list keeps its first `count` entries
 * and every capped string its first `chars` units, exactly at the cap
 * boundaries (cap − 1 and cap untouched, cap + 1 cut); a cut row carries
 * `truncated: true`; an untouched row comes back as the same object; the
 * engine's input is never mutated; and every bounded result passes the
 * receiving guard — the property that keeps the panel out of its
 * contract-failure branch for legitimately large pages.
 */
import { describe, expect, it } from 'vitest';
import type { PreloadedResources, WprDetections } from '../wp-rocket/types';
import {
  PAYLOAD_LIMITS,
  boundPageHeaders,
  boundPreloadedResources,
  boundWprDetections,
  clipString,
  servableWordPressVersion
} from './payload-bounds';
import { parsePageHeaders, parsePreloadedResources, parseWprDetections } from './validate';
import { validDetections } from './validate.fixtures';

/** The populated, guard-genuine detections every case mutates. */
function detections(): WprDetections {
  const parsed = parseWprDetections(validDetections());
  if (parsed === null) throw new Error('validDetections() no longer passes its guard');
  return parsed;
}

/** `n` distinct strings of the given length (distinct so dedupe rules never interfere). */
function strings(n: number, length = 12): string[] {
  return Array.from({ length: n }, (_, i) => `u${String(i)}`.padEnd(length, 'x'));
}

/** One capped list in the detections, how to fill it, and how to read it back. */
interface ListCase {
  readonly name: string;
  readonly cap: number;
  readonly fill: (d: WprDetections, n: number) => WprDetections;
  readonly read: (d: WprDetections) => { length: number; truncated: boolean };
}

const script = {
  inline: false,
  delayed: true,
  deferred: false,
  deferredByWPR: false,
  minifyAttribute: false
};

const LIST_CASES: readonly ListCase[] = [
  {
    name: 'delay_js.scripts',
    cap: PAYLOAD_LIMITS.delayScripts.count,
    fill: (d, n) => ({
      ...d,
      delay_js: {
        ...d.delay_js,
        scripts: Array.from({ length: n }, (_, i) => ({
          ...script,
          src: `/s${String(i)}.js`,
          fdtExcluded: null,
          minifyAttribute: false
        }))
      }
    }),
    read: (d) => ({ length: d.delay_js.scripts.length, truncated: d.delay_js.truncated === true })
  },
  {
    name: 'defer_all_js.scripts',
    cap: PAYLOAD_LIMITS.deferScripts.count,
    fill: (d, n) => ({
      ...d,
      defer_all_js: { present: true, scripts: strings(n), deferredScripts: n }
    }),
    read: (d) => ({
      length: d.defer_all_js.scripts.length,
      truncated: d.defer_all_js.truncated === true
    })
  },
  {
    name: 'lazyload.images',
    cap: PAYLOAD_LIMITS.images.count,
    fill: (d, n) => ({
      ...d,
      lazyload: {
        present: true,
        images: strings(n).map((src) => ({ src, lazyloadDetected: true, excludedReasonsFound: [] }))
      }
    }),
    read: (d) => ({ length: d.lazyload.images.length, truncated: d.lazyload.truncated === true })
  },
  {
    name: 'rocket_above_the_fold_optimization.preloadedImages',
    cap: PAYLOAD_LIMITS.preloadedImages.count,
    fill: (d, n) => ({
      ...d,
      rocket_above_the_fold_optimization: {
        present: true,
        lcpComment: false,
        preloadedImages: strings(n)
      }
    }),
    read: (d) => ({
      length: d.rocket_above_the_fold_optimization.preloadedImages?.length ?? 0,
      truncated: d.rocket_above_the_fold_optimization.truncated === true
    })
  },
  {
    name: 'auto_preload_fonts.fonts',
    cap: PAYLOAD_LIMITS.fonts.count,
    fill: (d, n) => ({ ...d, auto_preload_fonts: { present: true, fonts: strings(n) } }),
    read: (d) => ({
      length: d.auto_preload_fonts.fonts.length,
      truncated: d.auto_preload_fonts.truncated === true
    })
  },
  {
    name: 'preconnect_external_domains.domains',
    cap: PAYLOAD_LIMITS.domains.count,
    fill: (d, n) => ({
      ...d,
      preconnect_external_domains: { present: true, domains: strings(n), preconnectCount: 0 }
    }),
    read: (d) => ({
      length: d.preconnect_external_domains.domains.length,
      truncated: d.preconnect_external_domains.truncated === true
    })
  },
  {
    name: 'dns_prefetch.domains',
    cap: PAYLOAD_LIMITS.domains.count,
    fill: (d, n) => ({
      ...d,
      dns_prefetch: { present: true, domains: strings(n), source: 'meta' }
    }),
    read: (d) => ({
      length: d.dns_prefetch.domains.length,
      truncated: d.dns_prefetch.truncated === true
    })
  }
];

describe('boundWprDetections — list caps at the boundary', () => {
  for (const row of LIST_CASES) {
    for (const delta of [-1, 0, 1]) {
      const n = row.cap + delta;
      it(`${row.name}: ${String(n)} entries (cap ${delta === 0 ? '' : delta < 0 ? '- 1' : '+ 1'})`, () => {
        const input = row.fill(detections(), n);
        const bounded = boundWprDetections(input);
        expect(row.read(bounded)).toEqual({ length: Math.min(n, row.cap), truncated: n > row.cap });
        // The engine result stays whole (same-context readers keep it).
        expect(row.read(input)).toEqual({ length: n, truncated: false });
        // The bounded rows pass the receiving guard, mark carried through.
        const parsed = parseWprDetections(bounded);
        expect(parsed).not.toBeNull();
        if (parsed !== null) expect(row.read(parsed)).toEqual(row.read(bounded));
      });
    }
  }

  it('keeps the first entries, in document order', () => {
    const cap = PAYLOAD_LIMITS.preloadedImages.count;
    const list = strings(cap + 5);
    const bounded = boundWprDetections(LIST_CASES[3]?.fill(detections(), cap + 5) ?? detections());
    expect(bounded.rocket_above_the_fold_optimization.preloadedImages).toEqual(list.slice(0, cap));
  });
});

/** One capped string in the detections. */
interface StringCase {
  readonly name: string;
  readonly cap: number;
  readonly fill: (d: WprDetections, value: string) => WprDetections;
  readonly read: (d: WprDetections) => { value: string | null | undefined; truncated: boolean };
}

const STRING_CASES: readonly StringCase[] = [
  {
    name: 'wpr.version',
    cap: PAYLOAD_LIMITS.versions,
    fill: (d, value) => ({ ...d, wpr: { ...d.wpr, version: value } }),
    read: (d) => ({ value: d.wpr.version, truncated: d.wpr.truncated === true })
  },
  {
    name: 'delay_js.version',
    cap: PAYLOAD_LIMITS.versions,
    fill: (d, value) => ({ ...d, delay_js: { ...d.delay_js, version: value } }),
    read: (d) => ({ value: d.delay_js.version, truncated: d.delay_js.truncated === true })
  },
  {
    name: 'delay_js.scripts[].src',
    cap: PAYLOAD_LIMITS.delayScripts.src,
    fill: (d, value) => ({
      ...d,
      delay_js: { ...d.delay_js, scripts: [{ ...script, src: value, fdtExcluded: null }] }
    }),
    read: (d) => ({ value: d.delay_js.scripts[0]?.src, truncated: d.delay_js.truncated === true })
  },
  {
    name: 'delay_js.scripts[].content',
    cap: PAYLOAD_LIMITS.delayScripts.content,
    fill: (d, value) => ({
      ...d,
      delay_js: {
        ...d.delay_js,
        scripts: [{ ...script, inline: true, content: value, fdtExcluded: null }]
      }
    }),
    read: (d) => ({
      value: d.delay_js.scripts[0]?.content,
      truncated: d.delay_js.truncated === true
    })
  },
  {
    name: 'defer_all_js.scripts[]',
    cap: PAYLOAD_LIMITS.deferScripts.chars,
    fill: (d, value) => ({
      ...d,
      defer_all_js: { present: true, scripts: [value], deferredScripts: 1 }
    }),
    read: (d) => ({
      value: d.defer_all_js.scripts[0],
      truncated: d.defer_all_js.truncated === true
    })
  },
  {
    name: 'lazyload.images[].src',
    cap: PAYLOAD_LIMITS.images.src,
    fill: (d, value) => ({
      ...d,
      lazyload: {
        present: true,
        images: [{ src: value, lazyloadDetected: false, excludedReasonsFound: [] }]
      }
    }),
    read: (d) => ({ value: d.lazyload.images[0]?.src, truncated: d.lazyload.truncated === true })
  },
  {
    name: 'preloadedImages[]',
    cap: PAYLOAD_LIMITS.preloadedImages.chars,
    fill: (d, value) => ({
      ...d,
      rocket_above_the_fold_optimization: {
        present: true,
        lcpComment: false,
        preloadedImages: [value]
      }
    }),
    read: (d) => ({
      value: d.rocket_above_the_fold_optimization.preloadedImages?.[0],
      truncated: d.rocket_above_the_fold_optimization.truncated === true
    })
  },
  {
    name: 'auto_preload_fonts.fonts[]',
    cap: PAYLOAD_LIMITS.fonts.chars,
    fill: (d, value) => ({ ...d, auto_preload_fonts: { present: true, fonts: [value] } }),
    read: (d) => ({
      value: d.auto_preload_fonts.fonts[0],
      truncated: d.auto_preload_fonts.truncated === true
    })
  },
  {
    name: 'preconnect_external_domains.domains[]',
    cap: PAYLOAD_LIMITS.domains.chars,
    fill: (d, value) => ({
      ...d,
      preconnect_external_domains: { present: true, domains: [value], preconnectCount: 0 }
    }),
    read: (d) => ({
      value: d.preconnect_external_domains.domains[0],
      truncated: d.preconnect_external_domains.truncated === true
    })
  },
  {
    name: 'dns_prefetch.domains[]',
    cap: PAYLOAD_LIMITS.domains.chars,
    fill: (d, value) => ({ ...d, dns_prefetch: { present: false, domains: [value] } }),
    read: (d) => ({
      value: d.dns_prefetch.domains[0],
      truncated: d.dns_prefetch.truncated === true
    })
  }
];

describe('boundWprDetections — string caps at the boundary', () => {
  for (const row of STRING_CASES) {
    for (const delta of [-1, 0, 1]) {
      const length = row.cap + delta;
      it(`${row.name}: ${String(length)} chars`, () => {
        const bounded = boundWprDetections(row.fill(detections(), 'v'.repeat(length)));
        expect(row.read(bounded)).toEqual({
          value: 'v'.repeat(Math.min(length, row.cap)),
          truncated: length > row.cap
        });
        expect(parseWprDetections(bounded)).not.toBeNull();
      });
    }
  }
});

describe('boundWprDetections — the original type is dropped past its cap, never clipped', () => {
  const cap = PAYLOAD_LIMITS.delayScripts.originalType;
  const withType = (originalType: string): WprDetections => {
    const d = detections();
    return {
      ...d,
      delay_js: {
        ...d.delay_js,
        scripts: [{ ...script, src: '/a.js', fdtExcluded: null, originalType }]
      }
    };
  };

  for (const delta of [-1, 0]) {
    it(`keeps a ${String(cap + delta)}-char type, row untouched`, () => {
      const input = withType('t'.repeat(cap + delta));
      expect(boundWprDetections(input).delay_js).toBe(input.delay_js);
    });
  }

  it(`drops a ${String(cap + 1)}-char type and marks the row`, () => {
    const input = withType('t'.repeat(cap + 1));
    const bounded = boundWprDetections(input);
    expect(bounded.delay_js.scripts[0]).not.toHaveProperty('originalType');
    expect(bounded.delay_js.scripts[0]?.src).toBe('/a.js');
    expect(bounded.delay_js.truncated).toBe(true);
    // The engine's record is left untouched.
    expect(input.delay_js.scripts[0]?.originalType).toHaveLength(cap + 1);
    expect(parseWprDetections(bounded)).not.toBeNull();
  });
});

describe('boundWprDetections — identity and isolation', () => {
  it('returns every within-cap row as the same object, with no mark', () => {
    const input = detections();
    const bounded = boundWprDetections(input);
    for (const key of Object.keys(input) as (keyof WprDetections)[]) {
      expect(bounded[key]).toBe(input[key]);
    }
    expect(JSON.stringify(bounded)).not.toContain('truncated');
  });

  it('marks only the rows it cut', () => {
    const input = LIST_CASES[3]?.fill(detections(), PAYLOAD_LIMITS.preloadedImages.count + 1);
    if (input === undefined) throw new Error('case table changed');
    const bounded = boundWprDetections(input);
    expect(bounded.rocket_above_the_fold_optimization.truncated).toBe(true);
    expect(bounded.delay_js).toBe(input.delay_js);
    expect(bounded.auto_preload_fonts).toBe(input.auto_preload_fonts);
  });
});

describe('boundPreloadedResources', () => {
  const report = (n: number, href = '/h', type = 'image'): PreloadedResources => ({
    present: true,
    resources: Array.from({ length: n }, () => ({ href, type }))
  });

  for (const delta of [-1, 0, 1]) {
    const n = PAYLOAD_LIMITS.preloaded.count + delta;
    it(`keeps ${String(Math.min(n, PAYLOAD_LIMITS.preloaded.count))} of ${String(n)} rows`, () => {
      const bounded = boundPreloadedResources(report(n));
      expect(bounded.resources).toHaveLength(Math.min(n, PAYLOAD_LIMITS.preloaded.count));
      expect(bounded.truncated === true).toBe(n > PAYLOAD_LIMITS.preloaded.count);
      expect(parsePreloadedResources(bounded)).toEqual(bounded);
    });
  }

  it('clips href and type to their caps and marks the report', () => {
    const caps = PAYLOAD_LIMITS.preloaded;
    const bounded = boundPreloadedResources(
      report(1, 'h'.repeat(caps.href + 1), 't'.repeat(caps.type + 1))
    );
    expect(bounded).toEqual({
      present: true,
      resources: [{ href: 'h'.repeat(caps.href), type: 't'.repeat(caps.type) }],
      truncated: true
    });
    expect(parsePreloadedResources(bounded)).toEqual(bounded);
  });

  it('returns an absent or within-cap report as the same object', () => {
    const absent: PreloadedResources = { present: false };
    expect(boundPreloadedResources(absent)).toBe(absent);
    const within = report(3);
    expect(boundPreloadedResources(within)).toBe(within);
    const hinted: PreloadedResources = {
      present: false,
      hints: [{ rel: 'preconnect', href: 'https://a/', as: '' }]
    };
    expect(boundPreloadedResources(hinted)).toBe(hinted);
  });

  for (const delta of [-1, 0, 1]) {
    const n = PAYLOAD_LIMITS.preloaded.count + delta;
    it(`keeps ${String(Math.min(n, PAYLOAD_LIMITS.preloaded.count))} of ${String(n)} hints, under the hints' own mark`, () => {
      const hinted: PreloadedResources = {
        ...report(1),
        hints: Array.from({ length: n }, () => ({
          rel: 'dns-prefetch' as const,
          href: '/h',
          as: ''
        }))
      };
      const bounded = boundPreloadedResources(hinted);
      expect(bounded.hints).toHaveLength(Math.min(n, PAYLOAD_LIMITS.preloaded.count));
      expect(bounded.hintsTruncated === true).toBe(n > PAYLOAD_LIMITS.preloaded.count);
      // The preload list was not cut: its own mark stays off.
      expect(bounded).not.toHaveProperty('truncated');
      expect(parsePreloadedResources(bounded)).toEqual(bounded);
    });
  }

  it('clips a hint href and as to their caps, keeping its kind and stamp', () => {
    const caps = PAYLOAD_LIMITS.preloaded;
    const bounded = boundPreloadedResources({
      present: false,
      hints: [
        {
          rel: 'preload',
          href: 'h'.repeat(caps.href + 1),
          as: 'a'.repeat(caps.type + 1),
          mark: 'preload'
        }
      ]
    });
    expect(bounded).toEqual({
      present: false,
      hints: [
        { rel: 'preload', href: 'h'.repeat(caps.href), as: 'a'.repeat(caps.type), mark: 'preload' }
      ],
      hintsTruncated: true
    });
    expect(parsePreloadedResources(bounded)).toEqual(bounded);
  });

  it('marks each list on its own when both are cut', () => {
    const caps = PAYLOAD_LIMITS.preloaded;
    const bounded = boundPreloadedResources({
      ...report(caps.count + 1),
      hints: [{ rel: 'preconnect', href: 'h'.repeat(caps.href + 1), as: '' }]
    });
    expect(bounded.truncated).toBe(true);
    expect(bounded.hintsTruncated).toBe(true);
    expect(parsePreloadedResources(bounded)).toEqual(bounded);
  });
});

describe('boundWprDetections — the list-wide inline content budget', () => {
  const { content: perScript, contentTotal } = PAYLOAD_LIMITS.delayScripts;
  const full = Math.floor(contentTotal / perScript);
  const fill = (lengths: number[]): WprDetections => {
    const d = detections();
    return {
      ...d,
      delay_js: {
        ...d.delay_js,
        scripts: lengths.map((length) => ({
          ...script,
          inline: true,
          content: 'c'.repeat(length),
          fdtExcluded: null,
          minifyAttribute: false
        }))
      }
    };
  };
  const contents = (d: WprDetections): number[] =>
    d.delay_js.scripts.map((entry) => entry.content?.length ?? -1);

  it('keeps inline text summing exactly to the budget, unmarked', () => {
    const input = fill(Array.from({ length: full }, () => perScript));
    expect(boundWprDetections(input).delay_js).toBe(input.delay_js);
  });

  it('clips the overflow in document order and empties later scripts, marked', () => {
    const bounded = boundWprDetections(
      fill([...Array.from({ length: full - 1 }, () => perScript), perScript - 10, 30, 5])
    );
    expect(contents(bounded).slice(-3)).toEqual([perScript - 10, 10, 0]);
    expect(bounded.delay_js.truncated).toBe(true);
    expect(parseWprDetections(bounded)).not.toBeNull();
  });
});

describe('boundPageHeaders', () => {
  const caps = PAYLOAD_LIMITS.headers;
  const rows = (n: number): { name: string; value: string }[] =>
    Array.from({ length: n }, (_, i) => ({ name: `x-${String(i)}`, value: 'v' }));

  for (const delta of [-1, 0, 1]) {
    const n = caps.count + delta;
    it(`keeps ${String(Math.min(n, caps.count))} of ${String(n)} rows`, () => {
      const bounded = boundPageHeaders(rows(n));
      expect(bounded.headers).toEqual(rows(n).slice(0, caps.count));
      expect(bounded.truncated === true).toBe(n > caps.count);
      expect(parsePageHeaders(bounded.headers)).toEqual(bounded.headers);
    });
  }

  for (const delta of [-1, 0, 1]) {
    it(`clips a ${String(caps.value + delta)}-char value and a ${String(caps.name + delta)}-char name`, () => {
      const bounded = boundPageHeaders([
        { name: 'n'.repeat(caps.name + delta), value: 'v'.repeat(caps.value + delta) },
        { name: 'x-cache' }
      ]);
      expect(bounded.headers).toEqual([
        {
          name: 'n'.repeat(Math.min(caps.name, caps.name + delta)),
          value: 'v'.repeat(Math.min(caps.value, caps.value + delta))
        },
        { name: 'x-cache' }
      ]);
      expect(bounded.truncated === true).toBe(delta > 0);
      expect(parsePageHeaders(bounded.headers)).not.toBeNull();
    });
  }

  it('returns the rows untouched when within the caps', () => {
    const input = rows(3);
    expect(boundPageHeaders(input)).toEqual({ headers: input });
    expect(boundPageHeaders(input).headers).toBe(input);
  });

  it('never repairs a malformed row: the guard still rejects it', () => {
    const bounded = boundPageHeaders([{ name: 7 as unknown as string, value: 'v' }]);
    expect(parsePageHeaders(bounded.headers)).toBeNull();
  });

  it('keeps withheld rows withheld, clipping only their kept cookie name', () => {
    const bounded = boundPageHeaders([
      { name: 'Authorization', redacted: true },
      { name: 'Set-Cookie', redacted: true, cookieName: 'c'.repeat(caps.value + 1) }
    ]);
    expect(bounded).toEqual({
      headers: [
        { name: 'Authorization', redacted: true },
        { name: 'Set-Cookie', redacted: true, cookieName: 'c'.repeat(caps.value) }
      ],
      truncated: true
    });
    expect(parsePageHeaders(bounded.headers)).toEqual(bounded.headers);
  });
});

describe('clipString', () => {
  it('never ends a clip on half a surrogate pair', () => {
    const tracker = { cut: false };
    // 'a' + '😀' (two UTF-16 units): a 2-unit cap would split the pair.
    expect(clipString('a😀b', 2, tracker)).toBe('a');
    expect(tracker.cut).toBe(true);
  });

  it('keeps a whole pair that fits', () => {
    const tracker = { cut: false };
    expect(clipString('a😀b', 3, tracker)).toBe('a😀');
  });

  it('leaves a within-cap string and the tracker untouched', () => {
    const tracker = { cut: false };
    expect(clipString('abc', 3, tracker)).toBe('abc');
    expect(tracker.cut).toBe(false);
  });
});

describe('servableWordPressVersion', () => {
  it.each([
    ['6.8.1', '6.8.1'],
    ['x'.repeat(PAYLOAD_LIMITS.versions), 'x'.repeat(PAYLOAD_LIMITS.versions)],
    ['x'.repeat(PAYLOAD_LIMITS.versions + 1), null],
    ['', null],
    [null, null]
  ])('%s → %s (over-cap is dropped, never clipped)', (input, expected) => {
    expect(servableWordPressVersion(input)).toBe(expected);
  });
});
