import { describe, expect, it } from 'vitest';
import {
  buildDataConsentPageUrl,
  DATA_CONSENT_NEXT_MAX_CHARS,
  isPageSpeedNext,
  parseDataConsentPageQuery
} from './consent-page-url';

const PAGE = 'moz-extension://uuid/data-consent.html';
const NEXT = 'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2F';

describe('isPageSpeedNext', () => {
  it('takes https PageSpeed Insights addresses only', () => {
    expect(isPageSpeedNext(NEXT)).toBe(true);
    expect(isPageSpeedNext('http://pagespeed.web.dev/')).toBe(false);
    expect(isPageSpeedNext('https://pagespeed.web.dev.evil.test/')).toBe(false);
    expect(isPageSpeedNext('https://example.com/')).toBe(false);
    expect(isPageSpeedNext('javascript:alert(1)')).toBe(false);
    expect(isPageSpeedNext('not a url')).toBe(false);
  });

  it('refuses an address past the cap', () => {
    const at = `https://pagespeed.web.dev/?q=${'a'.repeat(DATA_CONSENT_NEXT_MAX_CHARS - 30)}`;
    expect(at.length).toBeLessThanOrEqual(DATA_CONSENT_NEXT_MAX_CHARS);
    expect(isPageSpeedNext(at)).toBe(true);
    expect(isPageSpeedNext(`${at}${'a'.repeat(DATA_CONSENT_NEXT_MAX_CHARS)}`)).toBe(false);
  });
});

describe('the consent page address', () => {
  it('round-trips the RUCSS ask (no continue address)', () => {
    const url = buildDataConsentPageUrl(PAGE, { feature: 'rucss', next: null });
    expect(url).toBe(`${PAGE}?feature=rucss`);
    expect(parseDataConsentPageQuery(new URL(url).search)).toEqual({
      feature: 'rucss',
      next: null
    });
  });

  it('round-trips the PageSpeed ask with its continue address', () => {
    const url = buildDataConsentPageUrl(PAGE, { feature: 'pagespeed', next: NEXT });
    expect(parseDataConsentPageQuery(new URL(url).search)).toEqual({
      feature: 'pagespeed',
      next: NEXT
    });
  });

  it('refuses to build a continue address that is not PageSpeed Insights', () => {
    expect(() =>
      buildDataConsentPageUrl(PAGE, { feature: 'pagespeed', next: 'https://evil.test/' })
    ).toThrow('https://evil.test/');
  });

  it('reads no known tool as null and drops a foreign or misplaced continue address', () => {
    expect(parseDataConsentPageQuery('')).toBeNull();
    expect(parseDataConsentPageQuery('?feature=toString')).toBeNull();
    expect(parseDataConsentPageQuery('?feature=pagespeed&next=https%3A%2F%2Fevil.test%2F')).toEqual(
      { feature: 'pagespeed', next: null }
    );
    expect(parseDataConsentPageQuery(`?feature=rucss&next=${encodeURIComponent(NEXT)}`)).toEqual({
      feature: 'rucss',
      next: null
    });
  });
});
