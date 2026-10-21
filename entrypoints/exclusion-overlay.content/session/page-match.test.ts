import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExclusionServedDocument } from '../../../lib/messaging/exclusion-session';
import { servedUrl } from '../../../lib/exclusion-session/served-url';
import {
  RECORD_SAME_LOAD_SKEW_MS,
  RECORD_STALE_MS,
  documentDigest,
  matchServedDocument,
  type PageFacts
} from './page-match';

const PAGE = 'https://example.com/shop/item?id=7';
const START = 1_700_000_000_000;
/** When this document's response ended, ms after its navigation start. */
const RESPONSE_END = 200;

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
  return { href: PAGE, documentUrl: PAGE, timeOrigin: START, responseEnd: RESPONSE_END, ...over };
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

  it('tells a previous load of the same URL apart by when the record was made', () => {
    // Changed in audit round 1: one 2 s window used to read a quick
    // unintercepted reload as this page; now the windows are explicit.
    expect(matchServedDocument(served(PAGE, -RECORD_SAME_LOAD_SKEW_MS), facts())).toBe('this-page');
    expect(matchServedDocument(served(PAGE, -(RECORD_SAME_LOAD_SKEW_MS + 1)), facts())).toBe(
      'cant-tell'
    );
    expect(matchServedDocument(served(PAGE, -RECORD_STALE_MS), facts())).toBe('cant-tell');
    expect(matchServedDocument(served(PAGE, -(RECORD_STALE_MS + 1)), facts())).toBe('other-page');
  });

  it("compares the document's own URL only, when known (the current address cannot override it)", () => {
    // The page moved itself (history API) onto the recorded URL: still not that document.
    const moved = facts({ href: 'https://example.com/cart', documentUrl: PAGE });
    expect(matchServedDocument(served('https://example.com/cart'), moved)).toBe('other-page');
  });

  it('differs on the query: the digest covers the whole URL', () => {
    expect(matchServedDocument(served(`${PAGE}&b=1`), facts())).toBe('other-page');
  });
});

describe('a document back from the back/forward cache', () => {
  it('cannot be ruled out by another document’s record (the session went on without it)', () => {
    expect(
      matchServedDocument(served('https://example.com/other'), facts({ restored: true }))
    ).toBe('cant-tell');
    expect(
      matchServedDocument(served(PAGE, -(RECORD_STALE_MS + 1)), facts({ restored: true }))
    ).toBe('cant-tell');
  });

  it('still matches its own record (nothing else was recorded meanwhile)', () => {
    expect(matchServedDocument(served(PAGE), facts({ restored: true }))).toBe('this-page');
  });
});

describe('a record newer than this document’s own response (a later load of the same URL)', () => {
  it('is never this page’s (restored or not), whatever its age sign says', () => {
    // The audit repro: restored, timeOrigin 500 000, record at 1 000 000, same URL.
    const facts500 = facts({ timeOrigin: 500_000, restored: true });
    const later = { ...served(PAGE), receivedAt: 1_000_000 };
    expect(matchServedDocument(later, facts500)).toBe('cant-tell');
    expect(matchServedDocument(later, { ...facts500, restored: undefined })).toBe('cant-tell');
  });

  it('bounds this page’s own record by its response end (+ the clock skew), inclusive', () => {
    const edge = RESPONSE_END + RECORD_SAME_LOAD_SKEW_MS;
    expect(matchServedDocument(served(PAGE, edge), facts())).toBe('this-page');
    expect(matchServedDocument(served(PAGE, edge + 1), facts())).toBe('cant-tell');
    expect(matchServedDocument(served(PAGE, 0), facts())).toBe('this-page');
  });

  it('without a known response end: unbounded for a fresh page, can’t verify for a restored one', () => {
    const far = served(PAGE, 60_000);
    expect(matchServedDocument(far, facts({ responseEnd: null }))).toBe('this-page');
    expect(matchServedDocument(far, facts({ responseEnd: null, restored: true }))).toBe(
      'cant-tell'
    );
  });
});
