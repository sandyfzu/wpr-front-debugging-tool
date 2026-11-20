import { describe, expect, it } from 'vitest';
import { parseDataConsentAnswer, parseDataConsentAsk, parseDataConsentReply } from './data-consent';

const NEXT = 'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2F';

describe('parseDataConsentAsk', () => {
  it('takes the RUCSS ask with a tab id', () => {
    expect(parseDataConsentAsk({ feature: 'rucss', tabId: 7 })).toEqual({
      feature: 'rucss',
      tabId: 7
    });
  });

  it('takes the PageSpeed ask with a PageSpeed Insights address and a known mode', () => {
    for (const mode of ['open-tab', 'check', 'ask-here'] as const) {
      expect(parseDataConsentAsk({ feature: 'pagespeed', next: NEXT, mode })).toEqual({
        feature: 'pagespeed',
        next: NEXT,
        mode
      });
    }
  });

  it('refuses junk tab ids, foreign addresses, swapped or extra fields', () => {
    for (const data of [
      null,
      'rucss',
      { feature: 'rucss' },
      { feature: 'rucss', tabId: -1 },
      { feature: 'rucss', tabId: '7' },
      { feature: 'rucss', tabId: 7, next: NEXT },
      { feature: 'pagespeed' },
      { feature: 'pagespeed', next: NEXT },
      { feature: 'pagespeed', next: NEXT, mode: 'window' },
      { feature: 'pagespeed', next: NEXT, mode: 'toString' },
      { feature: 'pagespeed', next: 'https://evil.test/', mode: 'open-tab' },
      { feature: 'pagespeed', next: NEXT, mode: 'open-tab', tabId: 1 },
      { feature: 'other', tabId: 1 }
    ]) {
      expect(parseDataConsentAsk(data)).toBeNull();
    }
  });

  it('ignores inherited fields', () => {
    const data: unknown = Object.create({ feature: 'rucss', tabId: 1 });
    expect(parseDataConsentAsk(data)).toBeNull();
  });
});

describe('parseDataConsentReply', () => {
  it('takes the four statuses only', () => {
    for (const status of ['granted', 'asking', 'missing', 'failed'] as const) {
      expect(parseDataConsentReply({ status })).toEqual({ status });
    }
    for (const data of [undefined, {}, { status: 'declined' }, { status: 1 }]) {
      expect(parseDataConsentReply(data)).toBeNull();
    }
  });
});

describe('parseDataConsentAnswer', () => {
  it('takes a known tool and a boolean answer', () => {
    expect(parseDataConsentAnswer({ feature: 'rucss', granted: false })).toEqual({
      feature: 'rucss',
      granted: false
    });
    for (const data of [
      null,
      { feature: 'rucss' },
      { feature: 'rucss', granted: 'yes' },
      { feature: 'x', granted: true }
    ]) {
      expect(parseDataConsentAnswer(data)).toBeNull();
    }
  });
});
