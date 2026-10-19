/**
 * The shared headers model's tests: the caching-relevant-first grouping over
 * a fixed capture fixture (every row present, in the registry's evidence
 * order), the verdict copy tied to the captured values with its evidence
 * tone, the renderable-empty shape (absent and empty captures), and
 * rows-moved-never-dropped.
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
    expect(model.caching[1]?.hint?.text).toContain('hittable');
  });
});

describe('buildHeadersViewModel — the verdict copy', () => {
  it('a freshness lifetime reads hittable; directives name the miss reason', () => {
    const hittable = buildHeadersViewModel([
      { name: 'cache-control', value: 'public, max-age=300' }
    ]).caching.at(0);
    expect(hittable?.hint?.text).toContain('hittable');
    expect(hittable?.value).toBe('public, max-age=300');
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'no-store' }]).caching[0]?.hint?.text
    ).toContain('no request ever hit a cache');
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'no-cache' }]).caching[0]?.hint?.text
    ).toContain('revalidation');
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'private, max-age=0' }]).caching[0]
        ?.hint?.text
    ).toContain('Zero freshness lifetime');
    // No known directive verdict: the value renders without an invented hint.
    expect(
      buildHeadersViewModel([{ name: 'Cache-Control', value: 'frobnicate' }]).caching[0]?.hint
    ).toBeNull();
  });

  it('a positive age counts as cache-served seconds; silence or zero says nothing', () => {
    expect(buildHeadersViewModel([{ name: 'Age', value: '57' }]).caching[0]?.hint?.text).toContain(
      '57 seconds ago'
    );
    expect(buildHeadersViewModel([{ name: 'Age', value: '1' }]).caching[0]?.hint?.text).toContain(
      '1 second'
    );
    expect(buildHeadersViewModel([{ name: 'Age', value: '0' }]).caching[0]?.hint).toBeNull();
    expect(buildHeadersViewModel([{ name: 'Age' }]).caching[0]?.hint).toBeNull();
  });

  it('the x-cache probes report HIT/MISS; the nearest hop token carries the verdict', () => {
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'MISS' }]).caching[0]?.hint?.text
    ).toContain('(MISS)');
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'hit from cdn-1' }]).caching[0]?.hint?.text
    ).toContain('(HIT)');
    // The nearest hop's token carries the verdict (first comma-splinter).
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'HIT, MISS' }]).caching[0]?.hint?.text
    ).toContain('(HIT)');
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'MISS, HIT' }]).caching[0]?.hint?.text
    ).toContain('(MISS)');
    // Both markers in the FIRST token is ambiguous evidence — no verdict is
    // read from it (the guard needs hit and miss in one token).
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'HIT/MISS' }]).caching[0]?.hint
    ).toBeNull();
    expect(
      buildHeadersViewModel([{ name: 'x-cache-lookup', value: 'HIT/MISS' }]).caching[0]?.hint
    ).toBeNull();
    expect(
      buildHeadersViewModel([{ name: 'x-cache', value: 'frobnicated' }]).caching[0]?.hint
    ).toBeNull();
  });

  it('each probe class names its own cache in its HIT and MISS copy', () => {
    const textOf = (name: string, value: string): string | null =>
      buildHeadersViewModel([{ name, value }]).caching[0]?.hint?.text ?? null;
    // Distinctive fragments of the exact shipped copy, per class and arm.
    expect(textOf('x-cache-lookup', 'HIT')).toContain('The lookup cache found this response');
    expect(textOf('x-cache-lookup', 'MISS')).toContain(
      'The lookup cache had to pass the request on'
    );
    expect(textOf('x-litespeed-cache', 'HIT')).toContain(
      'The LiteSpeed cache served this response'
    );
    expect(textOf('x-litespeed-cache', 'MISS')).toContain(
      'The LiteSpeed cache did not serve this response'
    );
    expect(textOf('x-kinsta-cache', 'HIT')).toContain("Kinsta's cache served this response");
    expect(textOf('x-kinsta-cache', 'MISS')).toContain(
      "Kinsta's cache did not serve this response"
    );
  });

  it('any x-rocket-* row is rocket cache evidence (prefix class)', () => {
    expect(
      buildHeadersViewModel([{ name: 'X-Rocket-HTMLOnly', value: '1' }]).caching[0]
    ).toMatchObject({ name: 'X-Rocket-HTMLOnly', value: '1' });
    expect(
      buildHeadersViewModel([{ name: 'X-Rocket-HTMLOnly', value: '1' }]).caching[0]?.hint?.text
    ).toContain('WP Rocket cache evidence');
  });

  it("Cloudflare's status values carry their own plain copy", () => {
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'DYNAMIC' }]).caching[0]?.hint?.text
    ).toContain('dynamic');
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'HIT' }]).caching[0]?.hint?.text
    ).toContain('(HIT)');
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'BYPASS' }]).caching[0]?.hint?.text
    ).toContain('BYPASS');
    // Any other value takes the default HIT/MISS arm through the shared probe.
    expect(
      buildHeadersViewModel([{ name: 'cf-cache-status', value: 'miss' }]).caching[0]?.hint?.text
    ).toContain('(MISS)');
  });

  it('the proxy hints read as intermediaries (fixed presence copy)', () => {
    expect(
      buildHeadersViewModel([{ name: 'via', value: '1.1 squid-3' }]).caching[0]?.hint?.text
    ).toContain('intermediary');
    expect(
      buildHeadersViewModel([{ name: 'X-Served-By', value: 'edge-04' }]).caching[0]?.hint?.text
    ).toContain('edge cache layer');
  });

  it('a name-only row renders with a null value and never invents a hint', () => {
    expect(buildHeadersViewModel([{ name: 'x-cache' }, { name: 'X-Kinsta-Cache' }])).toEqual({
      caching: [
        { name: 'x-cache', value: null, hint: null, redacted: false },
        { name: 'X-Kinsta-Cache', value: null, hint: null, redacted: false }
      ],
      other: []
    });
  });
});

describe('buildHeadersViewModel — the verdict tones', () => {
  /** One row's hint through the model. */
  function hintOf(row: PageHeaders[number]): { text: string; tone: string } {
    const hint = buildHeadersViewModel([row]).caching[0]?.hint;
    if (hint === undefined || hint === null) throw new Error('the fixture row yielded no hint');
    return hint;
  }

  it('hit evidence reads ok — the cache served the response', () => {
    expect(hintOf({ name: 'cache-control', value: 'max-age=300' }).tone).toBe('ok');
    expect(hintOf({ name: 'Age', value: '57' }).tone).toBe('ok');
    expect(hintOf({ name: 'x-cache', value: 'HIT from cdn-1' }).tone).toBe('ok');
    expect(hintOf({ name: 'X-Rocket-HTML', value: '1' }).tone).toBe('ok');
    expect(hintOf({ name: 'cf-cache-status', value: 'HIT' }).tone).toBe('ok');
    expect(hintOf({ name: 'x-cache-lookup', value: 'HIT' }).tone).toBe('ok');
    expect(hintOf({ name: 'x-litespeed-cache', value: 'hit' }).tone).toBe('ok');
    expect(hintOf({ name: 'x-kinsta-cache', value: 'HIT' }).tone).toBe('ok');
  });

  it('miss evidence reads warn — the attention direction, never an error', () => {
    expect(hintOf({ name: 'cache-control', value: 'no-store' }).tone).toBe('warn');
    expect(hintOf({ name: 'cache-control', value: 'max-age=0' }).tone).toBe('warn');
    expect(hintOf({ name: 'x-cache', value: 'MISS' }).tone).toBe('warn');
    expect(hintOf({ name: 'cf-cache-status', value: 'DYNAMIC' }).tone).toBe('warn');
    expect(hintOf({ name: 'cf-cache-status', value: 'BYPASS' }).tone).toBe('warn');
    // The default arm (any value beyond the named Cloudflare statuses) too.
    expect(hintOf({ name: 'cf-cache-status', value: 'miss' }).tone).toBe('warn');
    expect(hintOf({ name: 'x-cache-lookup', value: 'MISS' }).tone).toBe('warn');
    expect(hintOf({ name: 'x-litespeed-cache', value: 'miss' }).tone).toBe('warn');
    expect(hintOf({ name: 'x-kinsta-cache', value: 'MISS' }).tone).toBe('warn');
  });

  it('neutral facts read info, and an un-hinted row carries no tone at all', () => {
    expect(hintOf({ name: 'cache-control', value: 'no-cache' }).tone).toBe('info');
    expect(hintOf({ name: 'cf-cache-status', value: 'EXPIRED' }).tone).toBe('info');
    expect(hintOf({ name: 'X-Served-By', value: 'edge-04' }).tone).toBe('info');
    expect(hintOf({ name: 'via', value: '1.1 squid-3' }).tone).toBe('info');
    // No verdict, no tone: the two are one null.
    const row = buildHeadersViewModel([
      { name: 'cache-control', value: 'frobnicate' },
      { name: 'Server', value: 'nginx' }
    ]);
    expect(row.caching[0]?.hint).toBeNull();
    expect(row.other[0]?.hint).toBeNull();
  });
});

describe('buildHeadersViewModel — rows withheld at capture', () => {
  it('keeps a withheld row in its group, no value, its kept cookie name apart, never a hint', () => {
    expect(
      buildHeadersViewModel([
        { name: 'X-Rocket-Nonce', redacted: true },
        { name: 'Set-Cookie', redacted: true, cookieName: 'sid' },
        { name: 'x-cache', value: 'HIT' }
      ])
    ).toEqual({
      caching: [
        {
          name: 'x-cache',
          value: 'HIT',
          hint: {
            text: 'The edge/proxy cache reports it served this response from cache (HIT).',
            tone: 'ok'
          },
          redacted: false
        },
        { name: 'X-Rocket-Nonce', value: null, hint: null, redacted: true }
      ],
      other: [{ name: 'Set-Cookie', value: null, hint: null, redacted: true, cookieName: 'sid' }]
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

  it('reads a withheld row clipped at its cookie name as a clipped value', () => {
    const clippedCookie = {
      name: 'Set-Cookie',
      redacted: true,
      cookieName: 'c'.repeat(4096)
    } as const;
    expect(headersTruncationNote([clippedCookie], true)).toBe(
      'Some header values were clipped to 4,096 characters.'
    );
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
