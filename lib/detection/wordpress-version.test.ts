/**
 * The WordPress generator-version reader: version from the first generator
 * meta naming WordPress, honest absence otherwise, and the baseline's
 * numeric-tail tolerance preserved.
 */
import { describe, expect, it } from 'vitest';
import { detectWordPressVersion } from './wordpress-version';

/** Parse a snippet the way the processing pass does, then read the version. */
function read(html: string): string | null {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return detectWordPressVersion(document);
}

describe('detectWordPressVersion', () => {
  it('extracts the version from the WordPress generator meta', () => {
    expect(read('<meta name="generator" content="WordPress 6.8.1">')).toBe('6.8.1');
  });

  it('matches the hardened parity extraction: a bare-dot tail abstains, real versions keep their shapes', () => {
    // The digit requirement is the committed robustness deviation: a crafted
    // `WordPress .` captures a bare dot under the raw parity pattern, which
    // renders as a fake "version" — abstention beats data. Real shapes
    // (hyphenated tails truncated at the hyphen, attached numeric tails
    // whole) stay exactly as the baseline read them.
    expect(read('<meta name="generator" content="WordPress .">')).toBeNull();
    expect(read('<meta name="generator" content="WordPress -.5">')).toBeNull();
    expect(read('<meta name="generator" content="WordPress 6.8.1-beta1">')).toBe('6.8.1');
    expect(read('<meta name="generator" content="WordPress 6.8.1beta1">')).toBe('6.8.1beta1');
  });

  it('is case-insensitive on the name', () => {
    expect(read('<meta name="generator" content="wordpress 6.5">')).toBe('6.5');
  });

  it('reads the first WordPress meta when several generator rows exist', () => {
    expect(
      read(
        '<meta name="generator" content="WP Rocket 3.23.5.1"><meta name="generator" content="WordPress 6.8.1">'
      )
    ).toBe('6.8.1');
  });

  it('answers null when no generator meta names WordPress', () => {
    expect(read('<meta name="generator" content="WP Rocket 3.23.5.1">')).toBeNull();
    expect(read('<meta name="generator" content="SiteLock">')).toBeNull();
    expect(read('<p>no metas here</p>')).toBeNull();
  });

  it('answers null when the contents are unusable (no digits, no match)', () => {
    expect(read('<meta name="generator" content="WordPress">')).toBeNull();
    expect(read('<meta name="generator" content="">')).toBeNull();
  });
});
