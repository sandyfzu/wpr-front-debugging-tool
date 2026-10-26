/**
 * The page scan never offers the Exclusion Builder's own document marker as
 * page content to exclude: it is no lane's candidate, whatever it says.
 */
import { describe, expect, it } from 'vitest';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import { createElementKeys, PICKABLE_SELECTOR, scanPage } from './page-scan';

/** A document with `head` and `body` markup. */
function documentOf(head: string, body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
    'text/html'
  );
}

const MARKER = `<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off lazyload=excluded:1">`;

describe('the builder marker is never page content', () => {
  it('is not matched by the pickable selector', () => {
    const doc = documentOf(MARKER, '');
    const marker = doc.querySelector(`meta[name="${BUILDER_MARKER_META_NAME}"]`);
    expect(marker).not.toBeNull();
    expect(marker?.matches(PICKABLE_SELECTOR)).toBe(false);
  });

  it('yields no candidate, beside candidates the scan does find', () => {
    const lazy = '<img src="ph.gif" data-lazy-src="real.jpg" alt="x">';
    const scanned = scanPage(documentOf(MARKER, lazy), 'https://example.com/', createElementKeys());
    expect(scanned.length).toBeGreaterThan(0);
    expect(scanned.every((candidate) => candidate.element.localName === 'img')).toBe(true);
    expect(scanPage(documentOf(MARKER, ''), 'https://example.com/', createElementKeys())).toEqual(
      []
    );
  });
});
