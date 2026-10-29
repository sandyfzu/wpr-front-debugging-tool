/** The simulation's caveats: WP Rocket combined bundles. */
import { describe, expect, it } from 'vitest';
import { scanTags } from '../exclusion-builder/html-scan';
import { delayJsCaveats, isCombinedScriptUrl } from './caveats';

const DIGEST = '0123456789abcdef0123456789abcdef';

describe('isCombinedScriptUrl', () => {
  it.each([
    `https://example.com/wp-content/cache/min/1/${DIGEST}.js`,
    `/wp-content/cache/min/1/${DIGEST}.js?ver=1`,
    `//cdn.example.com/wp-content/cache/min/12/${DIGEST}.js`
  ])('%s is a combined bundle', (src) => {
    expect(isCombinedScriptUrl(src)).toBe(true);
  });

  it.each([
    '/wp-content/cache/min/1/wp-includes/js/jquery/jquery.min.js',
    `/wp-content/plugins/x/${DIGEST}.js`,
    'https://example.com/a.js',
    'http://[bad',
    ''
  ])('%s is not', (src) => {
    expect(isCombinedScriptUrl(src)).toBe(false);
  });
});

describe('delayJsCaveats', () => {
  it('names combined-js once when a script serves a bundle', () => {
    const html = `<script src="/wp-content/cache/min/1/${DIGEST}.js"></script><script src='/wp-content/cache/min/1/${DIGEST}.js'></script>`;
    expect(delayJsCaveats(scanTags(html))).toEqual(['combined-js']);
  });

  it('ignores non-script tags and pages without bundles', () => {
    const html = `<link href="/wp-content/cache/min/1/${DIGEST}.js"><script src="/a.js"></script><script src></script>`;
    expect(delayJsCaveats(scanTags(html))).toEqual([]);
  });
});
