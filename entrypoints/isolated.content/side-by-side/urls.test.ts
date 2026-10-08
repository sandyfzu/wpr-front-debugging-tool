/**
 * URL derivation for the compare flow: cached/bypassed branches in both
 * directions of `nowprocket`, the PageSpeed analyses round-trip, and the
 * context-menu entry URL.
 */
import { describe, expect, it } from 'vitest';
import {
  getOverlayUrls,
  getPsiUrls,
  getSiteUrls,
  importedSiteUrl,
  isPsiHost,
  psiEntryUrl
} from './urls';

/** The `url` parameter of a PageSpeed analysis URL, decoded. */
function getPsiUrlParam(analysisUrl: string): string | null {
  return new URL(analysisUrl).searchParams.get('url');
}

describe('getSiteUrls', () => {
  it('adds the bypass tag for a page currently served cached', () => {
    const urls = getSiteUrls(new URL('https://example.com/page/?a=b'));
    expect(urls.cached).toBe('https://example.com/page/?a=b');
    expect(urls.bypassed).toBe('https://example.com/page/?a=b&nowprocket=1');
  });

  it('removes the bypass tag for a page that already bypasses', () => {
    const urls = getSiteUrls(new URL('https://example.com/page/?nowprocket=1'));
    expect(urls.cached).toBe('https://example.com/page/');
    expect(urls.bypassed).toBe('https://example.com/page/?nowprocket=1');
  });

  it('does not mutate its argument (calls stay independent)', () => {
    const page = new URL('https://example.com/');
    getSiteUrls(page);
    expect(page.href).toBe('https://example.com/');
  });
});

describe('getPsiUrls', () => {
  it('runs both analyses, cached first', () => {
    const urls = getPsiUrls(new URL('https://example.com/'));
    expect(getPsiUrlParam(urls.cached)).toBe('https://example.com/');
    expect(getPsiUrlParam(urls.bypassed)).toBe('https://example.com/?nowprocket=1');
    expect(urls.cached.startsWith('https://pagespeed.web.dev/analysis?')).toBe(true);
    expect(urls.bypassed.startsWith('https://pagespeed.web.dev/analysis?')).toBe(true);
  });

  it('carries the bypass tag of an already-bypassed page into the right side', () => {
    const urls = getPsiUrls(new URL('https://example.com/?nowprocket=1&a'));
    // The already-bypassed page stays verbatim as the bypassed side (param
    // order included), exactly like the direct-site flow.
    expect(getPsiUrlParam(urls.bypassed)).toBe('https://example.com/?nowprocket=1&a');
    // The cached copy is rebuilt after deleting the tag; URLSearchParams
    // serializes a bare value parameter as `a=` (the same rebuild the
    // shipped flow produced).
    expect(getPsiUrlParam(urls.cached)).toBe('https://example.com/?a=');
  });
});

describe('PSI host handling', () => {
  it('recognizes the analysis host and reads the carried site', () => {
    expect(isPsiHost(new URL('https://pagespeed.web.dev/analysis?url=anything'))).toBe(true);
    expect(isPsiHost(new URL('https://www.web.dev/'))).toBe(false);
    expect(
      importedSiteUrl(new URL('https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2F'))
        ?.href
    ).toBe('https://example.com/');
    // A PSI page without the param (or with a non-URL value) carries nothing.
    expect(importedSiteUrl(new URL('https://pagespeed.web.dev/analysis?url=anything'))).toBeNull();
    expect(importedSiteUrl(new URL('https://pagespeed.web.dev/'))).toBeNull();
  });

  it('overlay URLs come from the site on a PSI page with a carried site', () => {
    const psi = new URL('https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2Fpage');
    const overlay = getOverlayUrls(psi);
    expect(getPsiUrlParam(overlay.cached)).toBe('https://example.com/page');
  });

  it('overlay URLs are the page\u2019s own URLs off the analysis host', () => {
    const site = new URL('https://example.com/?x');
    const overlay = getOverlayUrls(site);
    expect(overlay).toEqual(getSiteUrls(site));
  });

  it('a PSI page without a carried site resolves to the analysis host\u2019s own pair (never null)', () => {
    const page = new URL('https://pagespeed.web.dev/analysis?url=x');
    expect(getOverlayUrls(page)).toEqual(getSiteUrls(page));
  });

  it('invalid carried site URLs fall back to the analysis host\u2019s own pair', () => {
    const page = new URL('https://pagespeed.web.dev/?wpr-sbs=%2Frelative%2Furl');
    expect(getOverlayUrls(page)).toEqual(getSiteUrls(page));
  });
});

describe('psiEntryUrl', () => {
  it('hands the site over cleaned of this tool\u2019s own tags', () => {
    expect(psiEntryUrl(new URL('https://example.com/?nowprocket=1&wpr-sbs=stale'))).toBe(
      'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2F'
    );
    expect(psiEntryUrl(new URL('https://example.com/a?b=1'))).toBe(
      'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1'
    );
  });
});
