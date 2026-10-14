/**
 * The shared headers model's tests: the caching-relevant-first grouping over
 * a fixed capture fixture (every row present, in the registry's evidence
 * order), the verdict copy tied to the captured values, the renderable-empty
 * shape (absent and empty captures), and rows-moved-never-dropped.
 */
import { describe, expect, it } from 'vitest';
import { buildHeadersViewModel, headersTruncationNote } from './headers-view-model';
import type { PageHeaders } from '../wp-rocket/types';

/**
 * A captured main-frame response with one row per class plus junk the model
 * must not drop: the evidence order and the group split are pinned below.
 */
const CAPTURE: PageHeaders = [
  { name: 'Content-Type', value: 'text/html; charset=UTF-8' },
  { name: 'X-Kinsta-Cache', value: 'MISS' },
  { name: 'X-Cache', value: 'HIT from cdn-1' },
  { name: 'Age', value: '57' },
  { name: 'cache-control', value: 'public, max-age=300' },
  { name: 'X-Rocket-Purge', value: 'hmm-robots' },
  { name: 'Server', value: 'nginx' }
];

describe('buildHeadersViewModel — the caching-first grouping', () => {
  it('puts the caching-relevant rows first, in evidence order', () => {
    const model = buildHeadersViewModel(CAPTURE);
    expect(model.caching.map((row) => row.name)).toEqual([
      'cache-control',
      'Age',
      'X-Cache',
      'X-Rocket-Purge',
      'X-Kinsta-Cache'
    ]);
  });

  it('moves the remaining rows after the caching group, capture order kept', () => {
    const model = buildHeadersViewModel(CAPTURE);
    expect(model.other.map((row) => row.name)).toEqual(['Content-Type', 'Server']);
  });

  it('the whole capture is present (moved, never dropped)', () => {
    const model = buildHeadersViewModel(CAPTURE);
    expect([...model.caching, ...model.other]).toHaveLength(CAPTURE.length);
  });

  it('same-name rows keep their capture order inside their bucket', () => {
    const model = buildHeadersViewModel([
      { name: 'Set-Cookie', value: 'a=1' },
      { name: 'Cache-Control', value: 'no-store' },
      { name: 'Set-Cookie', value: 'b=2' },
      { name: 'Cache-Control', value: 'max-age=10, must-revalidate' }
    ]);
    expect(model.caching.map((row) => row.name)).toEqual(['Cache-Control', 'Cache-Control']);
    expect(model.caching[0]?.value).toBe('no-store');
    expect(model.caching[1]?.hint).toContain('hittable');
  });
});

describe('buildHeadersViewModel — the verdict copy', () => {
  it('a freshness lifetime reads hittable; directives name the miss reason', () => {
    const hittable = buildHeadersViewModel([
      { name: 'cache-control', value: 'public, max-age=300' }
    ]).caching.at(0);
    expect(hittable?.hint).toContain('hittable');
    expect(hittable?.value).toBe('public, max-age=300');
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'no-store' }]).caching[0]?.hint
    ).toContain('no request ever hit a cache');
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'no-cache' }]).caching[0]?.hint
    ).toContain('revalidation');
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'private, max-age=0' }]).caching[0]
        ?.hint
    ).toContain('Zero freshness lifetime');
    // No known directive verdict: the value renders without an invented hint.
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'frobnicate' }]).caching[0]?.hint
    ).toBeNull();
  });

  it('a positive age counts as cache-served seconds; silence or zero says nothing', () => {
    expect(buildHeadersViewModel([{ name: 'Age', value: '57' }]).caching[0]?.hint).toContain(
      '57 seconds ago'
    );
    expect(buildHeadersViewModel([{ name: 'Age', value: '1' }]).caching[0]?.hint).toContain(
      '1 second'
    );
    expect(buildHeadersViewModel([{ name: 'Age', value: '0' }]).caching[0]?.hint).toBeNull();
    expect(buildHeadersViewModel([{ name: 'Age' }]).caching[0]?.hint).toBeNull();
  });

  it('the x-cache probes report HIT/MISS; mixed tokens stay un-hinted', () => {
    expect(buildHeadersViewModel([{ name: 'x-cache', value: 'MISS' }]).caching[0]?.hint).toContain(
      '(MISS)'
    );
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'hit from cdn-1' }]).caching[0]?.hint
    ).toContain('(HIT)');
    // The nearest hop's token carries the verdict (first comma-splinter).
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'HIT, MISS' }]).caching[0]?.hint
    ).toContain('(HIT)');
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'MISS, HIT' }]).caching[0]?.hint
    ).toContain('(MISS)');
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'frobnicated' }]).caching[0]?.hint
    ).toBeNull();
  });

  it('any x-rocket-* row is rocket cache evidence (prefix class)', () => {
    expect(
      buildHeadersViewModel([{ name: 'X-Rocket-HTMLOnly', value: '1' }]).caching[0]
    ).toMatchObject({ name: 'X-Rocket-HTMLOnly', value: '1' });
    expect(
      buildHeadersViewModel([{ name: 'X-Rocket-HTMLOnly', value: '1' }]).caching[0]?.hint
    ).toContain('WP Rocket cache evidence');
  });

  it("Cloudflare's status values carry their own plain copy", () => {
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'DYNAMIC' }]).caching[0]?.hint
    ).toContain('dynamic');
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'HIT' }]).caching[0]?.hint
    ).toContain('(HIT)');
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'BYPASS' }]).caching[0]?.hint
    ).toContain('BYPASS');
  });

  it('the proxy hints read as intermediaries (fixed presence copy)', () => {
    expect(
      buildHeadersViewModel([{ name: 'via', value: '1.1 squid-3' }]).caching[0]?.hint
    ).toContain('intermediary');
    expect(
      buildHeadersViewModel([{ name: 'X-Served-By', value: 'edge-04' }]).caching[0]?.hint
    ).toContain('edge cache layer');
  });

  it('a name-only row renders with a null value and never invents a hint', () => {
    expect(buildHeadersViewModel([{ name: 'x-cache' }, { name: 'X-Kinsta-Cache' }])).toEqual({
      caching: [
        { name: 'x-cache', value: null, hint: null },
        { name: 'X-Kinsta-Cache', value: null, hint: null }
      ],
      other: []
    });
  });
});

describe('buildHeadersViewModel — the empty shapes', () => {
  it('a null capture resolves to the renderable-empty shape', () => {
    expect(buildHeadersViewModel(null)).toEqual({ caching: [], other: [] });
  });

  it('an empty capture resolves to the renderable-empty shape', () => {
    expect(buildHeadersViewModel([])).toEqual({ caching: [], other: [] });
  });
});

describe('headersTruncationNote', () => {
  const rows = (n: number): PageHeaders =>
    Array.from({ length: n }, (_, i) => ({ name: `x-${String(i)}`, value: 'v' }));
  const clippedValue = { name: 'content-security-policy', value: 'x'.repeat(4096) };

  it('says nothing for a complete capture', () => {
    expect(headersTruncationNote(rows(300), undefined)).toBeNull();
    expect(headersTruncationNote(rows(3), false)).toBeNull();
  });

  it('names each cause the rows show', () => {
    expect(headersTruncationNote([clippedValue], true)).toBe(
      'Some header values were clipped to 4,096 characters.'
    );
    expect(headersTruncationNote(rows(256), true)).toBe('The list was capped at 256 headers.');
    expect(headersTruncationNote([...rows(255), clippedValue], true)).toBe(
      'Some header values were clipped to 4,096 characters; the list was capped at 256 headers.'
    );
    expect(headersTruncationNote([{ name: 'n'.repeat(512) }], true)).toBe(
      'Some header names were clipped to 512 characters.'
    );
  });

  it('falls back to a generic line when the rows explain nothing', () => {
    expect(headersTruncationNote(rows(3), true)).toBe('Some headers were clipped.');
  });
});
