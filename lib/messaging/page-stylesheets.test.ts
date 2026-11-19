/**
 * The stylesheet inventory guard: the shared entry fields and bounds plus
 * the three boolean tag facts, exact key set, the shared reply rules.
 */
import { describe, expect, it } from 'vitest';
import { PAGE_STYLE_LIMITS } from './page-styles';
import {
  parsePageStylesheetEntry,
  parsePageStylesheetsReply,
  type PageStylesheetEntry
} from './page-stylesheets';

const LINK: PageStylesheetEntry = {
  kind: 'link',
  id: '',
  className: '',
  href: 'https://example.com/wp-content/cache/min/1/a.css',
  media: '',
  preview: '',
  chars: 0,
  minifyAttribute: true,
  rocketAsync: true,
  hostedFont: false
};

const INLINE: PageStylesheetEntry = {
  ...LINK,
  kind: 'inline',
  id: 'wpr-usedcss',
  href: '',
  preview: '.a{}',
  chars: 4,
  minifyAttribute: false,
  rocketAsync: false
};

/** A well-formed snapshot id. */
const ID = '0123456789abcdef0123456789abcdef';
describe('parsePageStylesheetEntry', () => {
  it('rebuilds a valid entry of either kind', () => {
    expect(parsePageStylesheetEntry(LINK)).toEqual(LINK);
    expect(parsePageStylesheetEntry(INLINE)).toEqual(INLINE);
  });

  it('refuses a missing or non-boolean fact, an extra key and a bad shared field', () => {
    const withoutFact: Record<string, unknown> = { ...LINK };
    delete withoutFact.hostedFont;
    for (const bad of [
      withoutFact,
      { ...LINK, minifyAttribute: 1 },
      { ...LINK, rocketAsync: 'true' },
      { ...LINK, hostedFont: null },
      { ...LINK, extra: true },
      { ...LINK, kind: 'script' },
      { ...LINK, href: 'x'.repeat(PAGE_STYLE_LIMITS.hrefChars + 1) },
      'nope'
    ]) {
      expect(parsePageStylesheetEntry(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('never reads an inherited fact', () => {
    const forged = Object.create({ hostedFont: false }) as Record<string, unknown>;
    Object.assign(forged, { ...LINK });
    delete forged.hostedFont;
    expect(parsePageStylesheetEntry(forged)).toBeNull();
  });
});

describe('parsePageStylesheetsReply', () => {
  it('rebuilds a valid reply, a cut one included', () => {
    expect(parsePageStylesheetsReply({ styles: [LINK, INLINE], total: 2, snapshotId: ID })).toEqual(
      {
        styles: [LINK, INLINE],
        total: 2,
        snapshotId: ID
      }
    );
    expect(parsePageStylesheetsReply({ styles: [LINK], total: 9_000, snapshotId: ID })?.total).toBe(
      9_000
    );
  });

  it('refuses a short total, an over-long list, one bad entry and extra keys', () => {
    expect(
      parsePageStylesheetsReply({ styles: [LINK, INLINE], total: 1, snapshotId: ID })
    ).toBeNull();
    expect(
      parsePageStylesheetsReply({
        styles: Array.from({ length: PAGE_STYLE_LIMITS.count + 1 }, () => LINK),
        total: PAGE_STYLE_LIMITS.count + 1,
        snapshotId: ID
      })
    ).toBeNull();
    expect(
      parsePageStylesheetsReply({
        styles: [LINK, { ...INLINE, rocketAsync: 0 }],
        total: 2,
        snapshotId: ID
      })
    ).toBeNull();
    // A RUCSS-inventory entry (no facts) is not a stylesheet entry.
    const plain: Record<string, unknown> = { ...LINK };
    delete plain.minifyAttribute;
    delete plain.rocketAsync;
    delete plain.hostedFont;
    expect(parsePageStylesheetsReply({ styles: [plain], total: 1, snapshotId: ID })).toBeNull();
    expect(parsePageStylesheetsReply({ styles: [], total: 0, snapshotId: ID, more: 1 })).toBeNull();
    expect(parsePageStylesheetsReply(null)).toBeNull();
  });

  it('requires the snapshot id, in its random-id shape', () => {
    expect(parsePageStylesheetsReply({ styles: [], total: 0 })).toBeNull();
    for (const snapshotId of ['', 'abc', `${ID}0`, 'g'.repeat(32), 7, null]) {
      expect(parsePageStylesheetsReply({ styles: [], total: 0, snapshotId })).toBeNull();
    }
  });
});
