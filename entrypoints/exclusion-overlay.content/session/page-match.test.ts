import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExclusionServedDocument } from '../../../lib/messaging/exclusion-session';
import { servedUrl } from '../../../lib/exclusion-session/served-url';
import {
  RECORD_CLOCK_SKEW_MS,
  documentDigest,
  matchServedDocument,
  type PageFacts
} from './page-match';

const PAGE = 'https://example.com/shop/item?id=7';
const START = 1_700_000_000_000;

/** A recorded identity for `url`, received `afterStart` ms after the page's navigation start. */
function served(url: string, afterStart = 40): ExclusionServedDocument {
  const u = new URL(url);
  u.hash = '';
  return {
    urlPath: `${u.origin}${u.pathname}`,
    urlDigest: createHash('sha256').update(u.href, 'utf8').digest('hex'),
    token: 't-1',
    order: 1,
    receivedAt: START + afterStart,
    speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
    copy: true,
    serviceWorkersBypassed: true
  };
}

/** Page facts for an unmoved document. */
function facts(over: Partial<PageFacts> = {}): PageFacts {
  return { href: PAGE, documentUrl: PAGE, timeOrigin: START, ...over };
}

describe('documentDigest', () => {
  it('equals the background record digest for the same URL, fragment ignored', async () => {
    const record = await servedUrl(`${PAGE}#reviews`);
    expect(documentDigest(`${PAGE}#top`)).toBe(record?.urlDigest);
  });

  it('refuses a relative or junk address', () => {
    expect(documentDigest('/shop')).toBeNull();
  });
});

describe('matchServedDocument', () => {
  it('confirms the page the record names', () => {
    expect(matchServedDocument(served(PAGE), facts())).toBe('this-page');
    expect(matchServedDocument(served(PAGE), facts({ href: `${PAGE}#x` }))).toBe('this-page');
  });

  it('names a record for another document as not intercepted', () => {
    expect(matchServedDocument(served('https://example.com/cart'), facts())).toBe('other-page');
  });

  it('still recognizes its document after a history-API address change', () => {
    const moved = facts({ href: 'https://example.com/shop/item?id=8' });
    expect(matchServedDocument(served(PAGE), moved)).toBe('this-page');
  });

  it("can't tell after an address change when the document's own URL is unknown", () => {
    const moved = facts({ href: 'https://example.com/elsewhere', documentUrl: null });
    expect(matchServedDocument(served(PAGE), moved)).toBe('cant-tell');
  });

  it('matches by the current address when the document URL is unknown', () => {
    expect(matchServedDocument(served(PAGE), facts({ documentUrl: null }))).toBe('this-page');
  });

  it("can't tell for a record without identity", () => {
    expect(matchServedDocument(undefined, facts())).toBe('cant-tell');
  });

  it('distrusts a matching record received before this navigation (a previous load)', () => {
    const old = served(PAGE, -(RECORD_CLOCK_SKEW_MS + 1));
    expect(matchServedDocument(old, facts())).toBe('cant-tell');
    const skewed = served(PAGE, -RECORD_CLOCK_SKEW_MS);
    expect(matchServedDocument(skewed, facts())).toBe('this-page');
  });

  it('differs on the query: the digest covers the whole URL', () => {
    expect(matchServedDocument(served(`${PAGE}&b=1`), facts())).toBe('other-page');
  });
});
