/**
 * The recovery verdict is the copy payload's input, so every class is pinned
 * against real captures: the live docker pair (original ↔ served), the real
 * remote-mirror shapes, and the combined bundle captured on the docker site.
 * The untouched lane is the safety net — anything the URL cannot honestly
 * vouch for must land there, never in a fabricated original.
 */
import { describe, expect, it } from 'vitest';
import { isCombinedBundle, recoverOriginalScript } from './minify-url-recovery';

describe('recoverOriginalScript — per-file minified (live docker capture pair)', () => {
  it('recovers the original path from the served minified URL', () => {
    expect(
      recoverOriginalScript(
        'http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792430636'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'wp-content/mu-plugins/assets/fdt-delayed-definer.js',
      hostKnown: 'site'
    });
  });

  it('recovers the sibling fixture scripts (same live page)', () => {
    for (const name of ['fdt-delayed-reference', 'fdt-delayed-lifecycle']) {
      expect(
        recoverOriginalScript(
          `http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/mu-plugins/assets/${name}.js?ver=1792430636`
        )
      ).toEqual({
        kind: 'original',
        originalPath: `wp-content/mu-plugins/assets/${name}.js`,
        hostKnown: 'site'
      });
    }
  });
});

describe('recoverOriginalScript — remote mirrors (real fixture captures)', () => {
  it('classifies the klaviyo mirror host-unknown, path mirrored', () => {
    expect(
      recoverOriginalScript(
        'https://wp-rocket.me/wp-content/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=1791299187'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'onsite/js/PD7as8/klaviyo.js',
      hostKnown: 'unknown'
    });
  });

  it('classifies the trustpilot bootstrap mirror host-unknown', () => {
    expect(
      recoverOriginalScript(
        'https://wp-rocket.me/wp-content/cache/min/1/bootstrap/v5/tp.widget.bootstrap.min.js?ver=1791299187'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'bootstrap/v5/tp.widget.bootstrap.min.js',
      hostKnown: 'unknown'
    });
  });

  it('classifies cache/min without a wp-content prefix host-unknown', () => {
    expect(recoverOriginalScript('https://x.example.com/cache/min/1/onsite/js/a.js')).toEqual({
      kind: 'original',
      originalPath: 'onsite/js/a.js',
      hostKnown: 'unknown'
    });
  });
});

describe('recoverOriginalScript — shape edges', () => {
  it('accepts multisite site-ids other than 1', () => {
    expect(
      recoverOriginalScript(
        'https://h.example.com/wp-content/cache/min/23/wp-includes/js/x.js?ver=1'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'wp-includes/js/x.js',
      hostKnown: 'site'
    });
  });

  it('ignores the host of a CDN-fronted minified URL', () => {
    expect(
      recoverOriginalScript(
        'https://cdn.example.net/wp-content/cache/min/1/wp-content/themes/t/x.js?ver=2'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'wp-content/themes/t/x.js',
      hostKnown: 'site'
    });
  });

  it('preserves percent runs inside the remainder (never decoded)', () => {
    expect(
      recoverOriginalScript(
        'https://shop.example.com/wp-content/cache/min/1/wp-content/plugins/a%2Bb/x%2520.js?ver=1'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'wp-content/plugins/a%2Bb/x%2520.js',
      hostKnown: 'site'
    });
  });

  it('accepts an uppercase .js suffix', () => {
    expect(
      recoverOriginalScript('https://h.example.com/wp-content/cache/min/1/wp-content/x/y.JS')
    ).toEqual({
      kind: 'original',
      originalPath: 'wp-content/x/y.JS',
      hostKnown: 'site'
    });
  });

  it('strips the first occurrence only (a remainder containing the shape survives intact)', () => {
    expect(recoverOriginalScript('https://h.example.com/cache/min/1/a/cache/min/2/b.js')).toEqual({
      kind: 'original',
      originalPath: 'a/cache/min/2/b.js',
      hostKnown: 'unknown'
    });
  });

  it('recovers the double-cache cache/busting remainder', () => {
    expect(
      recoverOriginalScript(
        'https://h.example.com/wp-content/cache/min/1/wp-content/cache/busting/1/tracking/x.js?ver=3'
      )
    ).toEqual({
      kind: 'original',
      originalPath: 'wp-content/cache/busting/1/tracking/x.js',
      hostKnown: 'site'
    });
  });
});

describe('recoverOriginalScript — combined bundle (live docker capture)', () => {
  it('classifies the bare md5 filename as combined', () => {
    expect(
      recoverOriginalScript(
        'http://127.0.0.1:8493/wp-content/cache/min/1/cdb2e71f9f3da2a001630dcca225acbf.js'
      )
    ).toEqual({
      kind: 'combined'
    });
  });
});

describe('recoverOriginalScript — untouched negatives', () => {
  it('leaves the .min.js files Minify skips untouched (same live page)', () => {
    expect(
      recoverOriginalScript(
        'http://127.0.0.1:8493/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js'
      )
    ).toEqual({ kind: 'untouched' });
    expect(
      recoverOriginalScript(
        'http://127.0.0.1:8493/wp-includes/js/dist/script-modules/block-library/navigation/view.min.js?ver=1bf28ded04f9f188bdcb'
      )
    ).toEqual({ kind: 'untouched' });
  });

  it('rejects a non-numeric site-id', () => {
    expect(
      recoverOriginalScript('https://h.example.com/wp-content/cache/min/site/wp-content/x.js')
    ).toEqual({
      kind: 'untouched'
    });
  });

  it('rejects non-JS paths — including a .js hiding in the query', () => {
    expect(recoverOriginalScript('https://h.example.com/wp-content/cache/min/1/style.css')).toEqual(
      { kind: 'untouched' }
    );
    expect(
      recoverOriginalScript('https://h.example.com/wp-content/cache/min/1/style.css?x=a.js')
    ).toEqual({
      kind: 'untouched'
    });
  });

  it('rejects non-http(s) and unparseable input', () => {
    expect(recoverOriginalScript('javascript:alert(1)')).toEqual({ kind: 'untouched' });
    expect(recoverOriginalScript('data:text/plain,x.js')).toEqual({ kind: 'untouched' });
    // Protocol-relative strings carry no scheme — nothing to vouch for.
    expect(recoverOriginalScript('//static.klaviyo.com/onsite/js/PD7as8/klaviyo.js')).toEqual({
      kind: 'untouched'
    });
    expect(recoverOriginalScript('not a url')).toEqual({ kind: 'untouched' });
    expect(recoverOriginalScript('')).toEqual({ kind: 'untouched' });
  });
});

describe('isCombinedBundle — the bundle shape only', () => {
  it('answers true for the digest bundle (live Combine arm capture, query tolerated)', () => {
    const bundle =
      'http://127.0.0.1:8493/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js';
    expect(isCombinedBundle(bundle)).toBe(true);
    expect(isCombinedBundle(`${bundle}?ver=1`)).toBe(true);
    expect(isCombinedBundle(bundle.replace('5c03bce6', '5C03BCE6'))).toBe(true);
  });

  it.each([
    [
      'a per-file minified original',
      'http://127.0.0.1:8493/wp-content/cache/min/1/wp-content/x.js'
    ],
    [
      'a digest outside the minify cache',
      'https://h.example.com/assets/5c03bce63bb3260466706a046cb00086.js'
    ],
    [
      'a 31-digit name',
      'https://h.example.com/wp-content/cache/min/1/5c03bce63bb3260466706a046cb0008.js'
    ],
    [
      'a non-hex digit',
      'https://h.example.com/wp-content/cache/min/1/5c03bce63bb3260466706a046cb0008g.js'
    ],
    [
      'a digest stylesheet',
      'https://h.example.com/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.css'
    ],
    [
      'a non-http scheme',
      'data:text/plain,/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js'
    ],
    ['unparseable input', 'not a url'],
    ['an empty string', '']
  ])('answers false for %s', (_name, url) => {
    expect(isCombinedBundle(url)).toBe(false);
  });
});
