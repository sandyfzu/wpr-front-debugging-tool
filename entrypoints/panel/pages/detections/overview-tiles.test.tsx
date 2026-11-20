/**
 * The overview tiles' render states: the score (ring, headline + reason
 * suffixes, counts — zero optimizations included), the WP Rocket tile
 * (version, version-less, neutral absence), the page-cache tile (cached
 * stamp, every explained state with the bar's copy and tone, unknown cache,
 * not applicable, hosting layer, evidence link), the stack tile, the grid
 * cells, the contained failure and the loading shape.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAT_TILE_TONE_CLASSES } from '../../../../components/ui/stat-tile';
import { cacheCopy } from '../../../../lib/detection/cache-context';
import { LIST_JOINER, LIST_JOINER_CONTENT } from '../../../../lib/detection/hud';
import { summarizeFdtData, type DetectionsSummary } from '../../../../lib/panel/detections-summary';
import { WPR_NOT_DETECTED } from '../../../../lib/panel/wpr-evidence';
import type { FdtData, WprDetections } from '../../../../lib/wp-rocket/types';
import { makeFdtData } from '../../state/fixtures';
import {
  CACHE_EVIDENCE_LINK,
  CACHE_NOT_APPLICABLE,
  CACHE_NOT_APPLICABLE_SENTENCE,
  OVERVIEW_GRID,
  OVERVIEW_UNAVAILABLE,
  OverviewSkeleton,
  OverviewTiles,
  SCORE_CELL,
  SCORE_RING_COMPACT_PX,
  SCORE_RING_SIZE,
  SERVER_SILENCE,
  VERSION_NOT_EXPOSED,
  WORDPRESS_UNDECLARED,
  WPR_ABSENT_SENTENCE
} from './overview-tiles';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The page clock (ms). */
const NOW = 1_700_010_000_000;

/** A representable cache stamp (epoch seconds) and its absolute form. */
const STAMP = 1_700_000_000;
const STAMP_TEXT = '2023-11-14 22:13:20 UTC';

/**
 * A payload with plugin-row and payload overrides.
 *
 * @param wpr The plugin row's overrides.
 * @param extra Payload overrides.
 */
function data(wpr: Partial<WprDetections['wpr']>, extra?: Partial<FdtData>): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    wprDetections: { ...base.wprDetections, wpr: { ...base.wprDetections.wpr, ...wpr } },
    ...extra
  });
}

/** A detected plugin with a version (no cache marker). */
const PRESENT = { present: true, version: '3.20.1' } as const;

/**
 * Render the tiles over a payload (summary from the real pass unless given).
 *
 * @param payload The payload.
 * @param counts Optimization-count overrides on the real summary.
 */
function show(payload: FdtData, counts?: Partial<DetectionsSummary['optimizations']>): void {
  const real = summarizeFdtData(payload).summary;
  const summary: DetectionsSummary = {
    ...real,
    optimizations: { ...real.optimizations, ...counts }
  };
  render(() => <OverviewTiles data={payload} summary={summary} now={NOW} />);
}

/**
 * One tile's cell.
 *
 * @param id The tile id.
 * @throws {@link Error} When the tile is not rendered.
 */
function tile(id: 'score' | 'wpr' | 'cache' | 'stack'): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-fdt-overview-tile="${id}"]`);
  if (!found) throw new Error(`no ${id} tile`);
  return found;
}

/**
 * A stat-tile part inside one tile.
 *
 * @param id The tile id.
 * @param part The part's hook suffix.
 */
function part(id: Parameters<typeof tile>[0], part: string): HTMLElement | null {
  return tile(id).querySelector<HTMLElement>(`[data-fdt="stat-tile-${part}"]`);
}

/** A summary fact by its key. */
function fact(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-fdt-summary-fact="${key}"]`);
}

/** The page-cache tile's icon classes. */
function cacheIconClass(): string {
  return part('cache', 'label')?.querySelector('svg')?.getAttribute('class') ?? '';
}

/** The headline's text. */
function headline(): string {
  return document.querySelector('[data-fdt-summary-headline]')?.textContent ?? '';
}

describe('OverviewTiles — score', () => {
  const COUNTS = { active: 3, total: 12, collecting: 2, off: 7 } as const;

  it('reads "N of M optimizations active" with a ring of active then collecting', () => {
    show(data(PRESENT), COUNTS);
    expect(headline()).toBe('3 of 12 optimizations active');
    // The sentence is the tile's name; the label stays in the text, unpainted.
    expect(part('score', 'label')?.className).toBe('sr-only');
    expect(part('score', 'value')?.className).toContain('text-stat');
    const arcs = [...tile('score').querySelectorAll('[data-fdt="score-ring-arc"]')];
    expect(arcs.map((arc) => arc.getAttribute('data-fdt-kind'))).toEqual(['ok', 'warn']);
    expect(
      tile('score').querySelector('[data-fdt="score-ring"]')?.getAttribute('aria-hidden')
    ).toBe('true');
  });

  it('draws the ring 44 px at compact and 52 px from regular up (container tiers)', () => {
    show(data(PRESENT), COUNTS);
    const ring = tile('score').querySelector('[data-fdt="score-ring"]');
    // Intrinsic size = the compact tier's; the classes restate it, then grow it.
    expect(ring?.getAttribute('width')).toBe(String(SCORE_RING_COMPACT_PX));
    expect(SCORE_RING_COMPACT_PX).toBe(44);
    expect(SCORE_RING_SIZE).toBe('size-[44px] @regular:size-[52px]');
    for (const cls of SCORE_RING_SIZE.split(' ')) {
      expect(ring?.getAttribute('class')?.split(' ')).toContain(cls);
    }
  });

  it('counts collecting and off under the sentence, with decorative dots', () => {
    show(data(PRESENT), COUNTS);
    const counts = document.querySelector('[data-fdt-summary-counts]');
    expect(counts?.textContent).toBe('2 collecting7 off');
    expect(counts?.closest('[data-fdt="stat-tile-sub"]')).not.toBeNull();
    for (const dot of counts?.querySelectorAll('span[aria-hidden="true"]') ?? []) {
      expect(dot.textContent).toBe('');
    }
    expect(counts?.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(2);
  });

  it('honestly reads zero optimizations: empty ring track, 0 of 0, zero counts', () => {
    show(data(PRESENT), { active: 0, total: 0, collecting: 0, off: 0 });
    expect(headline()).toBe('0 of 0 optimizations active');
    expect(tile('score').querySelectorAll('[data-fdt="score-ring-arc"]')).toHaveLength(0);
    expect(tile('score').querySelector('[data-fdt="score-ring-track"]')).not.toBeNull();
    expect(document.querySelector('[data-fdt-summary-counts]')?.textContent).toBe(
      '0 collecting0 off'
    );
  });

  it('formats large counts with separators', () => {
    show(data(PRESENT), { active: 1200, total: 2400, collecting: 0, off: 1200 });
    expect(headline()).toBe('1,200 of 2,400 optimizations active');
  });

  it('adds the builder reason suffix only when features are off in this tab', () => {
    show(data(PRESENT), { ...COUNTS, offInTab: 0 });
    expect(document.querySelector('[data-fdt-summary-off]')).toBeNull();
    cleanup();
    show(data(PRESENT), { ...COUNTS, offInTab: 2 });
    // The dot is drawn by CSS (never spoken); assistive tech hears a comma.
    expect(headline()).toBe('3 of 12 optimizations active, 2 off in this tab');
    const suffix = document.querySelector<HTMLElement>('[data-fdt-summary-off]');
    expect(suffix?.textContent).not.toContain('·');
    // One unit (never mid-phrase), its dot in the clipped gutter.
    expect(suffix?.className).toContain('whitespace-nowrap');
    expect(suffix?.className).toContain('before:content-(--fdt-joiner)');
    expect(suffix?.closest('[data-fdt-summary-headline]')?.className).toContain('overflow-hidden');
    expect(LIST_JOINER_CONTENT).toBe(`'${LIST_JOINER.trim()}' / ''`);
    const root = document.querySelector<HTMLElement>('[data-fdt="detections-summary"]');
    expect(root?.style.getPropertyValue('--fdt-joiner')).toBe(LIST_JOINER_CONTENT);
  });

  it('adds the simulation suffixes in order', () => {
    show(data(PRESENT), { ...COUNTS, offInTab: 1, simulated: 2, unverified: 1 });
    expect(headline()).toBe(
      '3 of 12 optimizations active, 1 off in this tab, 2 simulated in this tab, simulation not verified'
    );
    expect(document.querySelectorAll('[data-fdt-summary-simulation]')).toHaveLength(2);
  });
});

describe('OverviewTiles — WP Rocket', () => {
  it('states the version in mono and the footprints in the ok tone', () => {
    show(data({ ...PRESENT, cacheMarkerFound: true }));
    expect(part('wpr', 'label')?.textContent).toBe('WP Rocket');
    expect(part('wpr', 'value')?.textContent).toBe('3.20.1');
    expect(part('wpr', 'value')?.querySelector('.font-mono')?.textContent).toBe('3.20.1');
    expect(part('wpr', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.primary);
    expect(part('wpr', 'sub')?.textContent).toBe(
      'Detected by the generator tag and the cache signature'
    );
    expect(part('wpr', 'sub')?.querySelector('.text-status-ok svg')).not.toBeNull();
    expect(fact('wpr')).toBeNull();
  });

  it('keeps a version-less plugin detected, its value muted', () => {
    show(data({ present: true, cacheMarkerFound: true }));
    expect(part('wpr', 'value')?.textContent).toBe(VERSION_NOT_EXPOSED);
    expect(part('wpr', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.muted);
    expect(part('wpr', 'sub')?.textContent).toBe('Detected by the cache signature');
  });

  it('answers absence in the neutral tone, never as a failure', () => {
    show(data({}));
    expect(part('wpr', 'value')?.textContent).toBe(WPR_NOT_DETECTED);
    expect(part('wpr', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.neutral);
    expect(part('wpr', 'value')?.className).not.toContain('error');
    expect(fact('wpr')?.textContent).toBe(WPR_ABSENT_SENTENCE);
    // The icon keeps the label's muted tone (no accent on an absent plugin).
    expect(part('wpr', 'label')?.querySelector('svg')?.getAttribute('class')).toContain(
      STAT_TILE_TONE_CLASSES.muted
    );
  });

  it('stays true beside a deferral-only page (deferral never proves WP Rocket)', () => {
    const base = makeFdtData().wprDetections;
    const payload = data(
      {},
      {
        wprDetections: {
          ...base,
          defer_all_js: { ...base.defer_all_js, present: true, deferredScripts: 2 }
        }
      }
    );
    show(payload);
    // The deferral card reads Active, the plugin stays absent …
    expect(headline()).toMatch(/^1 of \d+ optimizations active$/);
    expect(part('wpr', 'value')?.textContent).toBe(WPR_NOT_DETECTED);
    // … and the sentence only denies what would prove the plugin.
    expect(fact('wpr')?.textContent).toBe(WPR_ABSENT_SENTENCE);
    expect(WPR_ABSENT_SENTENCE).toContain('unique to WP Rocket');
  });
});

describe('OverviewTiles — page cache', () => {
  it('states a cached page and its generation time as a machine-readable <time>', () => {
    show(data({ ...PRESENT, cacheMarkerFound: true, cached: true, timeStamp: STAMP }));
    expect(part('cache', 'value')?.textContent).toBe(
      cacheCopy({ kind: 'cached', seconds: STAMP, formatted: STAMP_TEXT }).chip
    );
    expect(part('cache', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.ok);
    expect(cacheIconClass()).toContain(STAT_TILE_TONE_CLASSES.ok);
    expect(fact('cache')?.textContent).toBe(`Cache generated ${STAMP_TEXT}`);
    const time = fact('cache')?.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2023-11-14T22:13:20.000Z');
    // Wraps at its spaces: a half-width compact tile is narrower than the stamp.
    expect(time?.className).not.toContain('whitespace-nowrap');
    // … but only between the date and the time, never at the date's hyphens.
    const chunks = [...(time?.querySelectorAll('[data-fdt-stamp-chunk]') ?? [])];
    expect(chunks.map((chunk) => chunk.textContent)).toEqual(STAMP_TEXT.split(/ (.*)/u, 2));
    for (const chunk of chunks) expect(chunk.className).toContain('whitespace-nowrap');
    // A cached value is not a tooltip trigger: the stamp is its proof.
    expect(part('cache', 'value')?.querySelector('[data-fdt="tooltip-trigger"]')).toBeNull();
    expect(document.querySelectorAll('[data-fdt-summary-fact="cache"]')).toHaveLength(1);
  });

  it('omits the stamp fact when cached without a representable stamp', () => {
    show(data({ ...PRESENT, cacheMarkerFound: true, cached: true, timeStamp: null }));
    expect(part('cache', 'value')?.textContent).toBe('✓ Cached');
    expect(fact('cache')).toBeNull();
    expect(part('cache', 'sub')).toBeNull();
  });

  it.each<[string, Partial<WprDetections['wpr']>, Partial<FdtData>, string, 'warn' | 'neutral']>([
    ['signature without stamp', { cacheMarkerFound: true }, {}, 'Cache not proven', 'warn'],
    [
      'host marker, no signature',
      {},
      { pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }] },
      'Possibly cached',
      'warn'
    ],
    ['unknown cache (no headers captured)', {}, {}, 'Cache not detected', 'neutral'],
    [
      'complete capture, no marker',
      {},
      { pageHeaders: [{ name: 'server', value: 'nginx' }] },
      'Cache not detected',
      'neutral'
    ],
    ['bypass request', {}, { bypassAttested: true }, 'Bypass requested', 'neutral']
  ])(
    'explains %s with the shared chip as a tooltip trigger in the bar’s tone',
    (_n, wpr, extra, chip, tone) => {
      show(data({ ...PRESENT, ...wpr }, extra));
      const trigger = fact('cache')?.querySelector<HTMLElement>('[data-fdt="tooltip-trigger"]');
      expect(trigger?.textContent).toBe(chip);
      // A real control: keyboard-focusable, so the explanation is never hover-only.
      expect(trigger?.tagName).toBe('BUTTON');
      expect(fact('cache')?.closest('[data-fdt="stat-tile-value"]')).not.toBeNull();
      expect(part('cache', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES[tone]);
      // The icon: warn keeps the value's tone, neutral the label's muted one.
      const icon = cacheIconClass();
      expect(icon).toContain(STAT_TILE_TONE_CLASSES[tone === 'warn' ? 'warn' : 'muted']);
      expect(icon).not.toContain(STAT_TILE_TONE_CLASSES.ok);
    }
  );

  it('links to the captured headers whenever the cache is a question', () => {
    show(data(PRESENT));
    const link = part('cache', 'link');
    expect(link?.getAttribute('href')).toBe('#/headers-cookies');
    expect(link?.textContent).toBe(CACHE_EVIDENCE_LINK);
  });

  it('names the hosting cache layer when worth naming', () => {
    show(
      data(
        { ...PRESENT, cacheMarkerFound: true },
        { pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }] }
      )
    );
    expect(fact('cache-layer')?.textContent).toBe('Cloudflare cache-layer marker captured');
  });

  it('is not applicable, without a link, when WP Rocket is absent', () => {
    show(data({}));
    expect(part('cache', 'value')?.textContent).toBe(CACHE_NOT_APPLICABLE);
    expect(part('cache', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.muted);
    expect(part('cache', 'sub')?.textContent).toBe(CACHE_NOT_APPLICABLE_SENTENCE);
    expect(part('cache', 'link')).toBeNull();
    expect(fact('cache')).toBeNull();
    expect(fact('cache-layer')).toBeNull();
  });
});

describe('OverviewTiles — stack', () => {
  it('states WordPress, the server answer and the identified platform', () => {
    show(
      data(PRESENT, {
        wordpressVersion: '6.8.1',
        pageHeaders: [
          { name: 'Server', value: 'nginx' },
          { name: 'X-Powered-By', value: 'PHP/8.3.1' },
          { name: 'X-Kinsta-Cache', value: 'HIT' }
        ]
      })
    );
    expect(fact('wordpress')?.textContent).toBe('WordPress 6.8.1');
    expect(fact('wordpress')?.querySelector('.font-mono')?.textContent).toBe('6.8.1');
    expect(part('stack', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.primary);
    expect(document.querySelector('[data-fdt-overview-server]')?.textContent).toBe(
      'nginx · PHP/8.3.1'
    );
    expect(fact('platform')?.textContent).toBe('Kinsta via X-Kinsta-Cache');
  });

  it.each<[string, Partial<FdtData>, string]>([
    ['no headers captured', {}, SERVER_SILENCE.unavailable],
    [
      'headers naming no server',
      { pageHeaders: [{ name: 'vary', value: 'Accept' }] },
      SERVER_SILENCE.unknown
    ]
  ])('says so when %s, and when no WordPress version is declared', (_n, extra, line) => {
    show(data(PRESENT, extra));
    expect(document.querySelector('[data-fdt-overview-server]')?.textContent).toBe(line);
    expect(part('stack', 'value')?.textContent).toBe(WORDPRESS_UNDECLARED);
    expect(part('stack', 'value')?.className).toContain(STAT_TILE_TONE_CLASSES.muted);
    expect(fact('wordpress')).toBeNull();
    expect(fact('platform')).toBeNull();
  });
});

describe('OverviewTiles — grid, refresh, failure', () => {
  it('lays four tiles in the grid, the score spanning both columns at compact', () => {
    show(data(PRESENT));
    const root = document.querySelector<HTMLElement>('[data-fdt="detections-summary"]');
    expect(root?.tagName).toBe('SECTION');
    expect(root?.getAttribute('aria-label')).toBe('Page overview');
    expect(root?.className).toBe(OVERVIEW_GRID);
    expect(OVERVIEW_GRID).toContain('grid-cols-2');
    expect(OVERVIEW_GRID).toContain('@wide:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,1fr))]');
    expect(
      [...(root?.children ?? [])].map((el) => el.getAttribute('data-fdt-overview-tile'))
    ).toEqual(['score', 'wpr', 'cache', 'stack']);
    expect(tile('score').className).toContain(SCORE_CELL);
    expect(SCORE_CELL).toBe('col-span-2 @regular:col-span-1');
    // Every tile shows at every width: at compact the WP Rocket tile is the
    // one place with the full version (no tier hides a cell).
    for (const id of ['wpr', 'cache', 'stack'] as const)
      expect(tile(id).className, id).not.toMatch(/(^|\s|:)hidden\b/);
    // The tiles are never interactive themselves: only the evidence link and the trigger.
    expect(
      [...(root?.querySelectorAll('a, button, [tabindex]') ?? [])].map((el) => el.tagName)
    ).toEqual(['BUTTON', 'A']);
  });

  it('swaps data in place on a refresh (same tile nodes)', async () => {
    const { createSignal } = await import('solid-js');
    const first = data(PRESENT);
    const [payload, setPayload] = createSignal(first);
    render(() => (
      <OverviewTiles data={payload()} summary={summarizeFdtData(payload()).summary} now={NOW} />
    ));
    const before = tile('stack');
    setPayload(data(PRESENT, { wordpressVersion: '6.9' }));
    expect(tile('stack')).toBe(before);
    expect(fact('wordpress')?.textContent).toBe('WordPress 6.9');
  });

  it('contains a failing tile to one named line and logs it once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A non-finite count is a caller bug the ring refuses (RangeError).
    show(data(PRESENT), { active: Number.NaN });
    const fallback = document.querySelector('[data-fdt="detections-overview-error"]');
    expect(fallback?.textContent).toBe(
      `${OVERVIEW_UNAVAILABLE.title}${OVERVIEW_UNAVAILABLE.sentence}`
    );
    expect(document.querySelector('[data-fdt="detections-summary"]')).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('Detections overview crashed');
  });

  it('retries the tiles on new data after a crash, never on a clock tick', async () => {
    const { createSignal } = await import('solid-js');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const payload = data(PRESENT);
    const real = summarizeFdtData(payload).summary;
    const bad: DetectionsSummary = {
      ...real,
      optimizations: { ...real.optimizations, active: Number.NaN }
    };
    const [summary, setSummary] = createSignal(bad);
    const [now, setNow] = createSignal(NOW);
    render(() => <OverviewTiles data={payload} summary={summary()} now={now()} />);
    const fallback = (): Element | null =>
      document.querySelector('[data-fdt="detections-overview-error"]');
    expect(fallback()).not.toBeNull();
    // The clock is not data: still the fallback, no second crash logged.
    setNow(NOW + 60_000);
    await Promise.resolve();
    expect(fallback()).not.toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    // A good refresh brings the tiles back.
    setSummary(real);
    await Promise.resolve();
    expect(fallback()).toBeNull();
    expect(headline()).toMatch(/optimizations active$/);
    // A later bad refresh is contained again (the boundary still guards).
    setSummary({ ...bad });
    await Promise.resolve();
    expect(fallback()).not.toBeNull();
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('OverviewSkeleton', () => {
  it('is shaped like the grid: one placeholder per tile, same cells', () => {
    render(() => <OverviewSkeleton />);
    const root = document.querySelector<HTMLElement>('[data-fdt="detections-overview-skeleton"]');
    expect(root?.className).toBe(OVERVIEW_GRID);
    const placeholders = [
      ...(root?.querySelectorAll<HTMLElement>(':scope > [data-fdt="overview-tile-skeleton"]') ?? [])
    ];
    expect(placeholders).toHaveLength(4);
    // Each tile placeholder is a raised card holding pulsing lines (the tiles' own surface).
    for (const el of placeholders) {
      expect(el.querySelector('[data-fdt="card"]')).not.toBeNull();
      expect(el.querySelectorAll('[data-fdt="skeleton"]').length).toBeGreaterThan(1);
    }
    expect(placeholders[0]?.className).toContain(SCORE_CELL);
    expect(placeholders.slice(1).map((el) => el.className.includes(SCORE_CELL))).toEqual([
      false,
      false,
      false
    ]);
    // No placeholder is tier-hidden: the skeleton holds the shape of every width.
    for (const el of placeholders) expect(el.className).not.toMatch(/(^|\s|:)hidden\b/);
  });
});
