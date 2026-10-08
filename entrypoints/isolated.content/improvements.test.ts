/**
 * Derivation of the D-bugger admin-bar link: real subdirectory shapes give a
 * site-prefixed href, anchors that can't help keep parity's root-relative
 * shape, and hostile hrefs can never turn into a script-bearing link.
 */
import { describe, expect, it } from 'vitest';
import { deriveDbuggerHref } from './improvements';

const PARITY_HREF = '/wp-admin/tools.php?page=wprockettoolset';

describe('deriveDbuggerHref', () => {
  it('returns the root-relative link when there is no usable anchor', () => {
    expect(deriveDbuggerHref(null)).toBe(PARITY_HREF);
    expect(deriveDbuggerHref(undefined)).toBe(PARITY_HREF);
    expect(deriveDbuggerHref('')).toBe(PARITY_HREF);
    expect(deriveDbuggerHref('some-page')).toBe(PARITY_HREF);
    expect(deriveDbuggerHref('javascript:alert(1)')).toBe(PARITY_HREF);
  });

  it('returns the root-relative link for page-controlled hostile hrefs', () => {
    // A protocol-relative value is a foreign authority, not a path of this
    // install: it must never become a foreign-origin link.
    expect(deriveDbuggerHref('//evil.com/wp-admin/x')).toBe(PARITY_HREF);
    // The authority check runs after normalization, so padding cannot
    // smuggle it past.
    expect(deriveDbuggerHref('  //evil.com/wp-admin/x')).toBe(PARITY_HREF);
  });

  it('keeps root installs on the parity link', () => {
    expect(deriveDbuggerHref('/wp-admin/admin.php?page=wprocket')).toBe(PARITY_HREF);
    expect(deriveDbuggerHref('/wp-admin/')).toBe(PARITY_HREF);
    expect(deriveDbuggerHref('https://example.com/wp-admin/admin.php?page=rocket')).toBe(
      'https://example.com/wp-admin/tools.php?page=wprockettoolset'
    );
  });

  it('derives the subdirectory base from the anchor\u2019s own path', () => {
    expect(deriveDbuggerHref('/blog/wp-admin/admin.php?page=wprocket')).toBe(
      '/blog/wp-admin/tools.php?page=wprockettoolset'
    );
    expect(deriveDbuggerHref('https://example.com/sites/one/wp-admin/?page=rocket')).toBe(
      'https://example.com/sites/one/wp-admin/tools.php?page=wprockettoolset'
    );
  });

  it('uses only the host-relative or validated-HTTP shapes as input', () => {
    // A bare absolute HTTP(S) anchor always stays its URL.
    expect(deriveDbuggerHref('http://example.com/wp-admin/admin.php?page=x')).toBe(
      'http://example.com/wp-admin/tools.php?page=wprockettoolset'
    );
    // A malformed absolute URL is not derivable — parity link, never a guess.
    expect(deriveDbuggerHref('https://exa mple.com/wp-admin/x')).toBe(PARITY_HREF);
  });

  it('suffixes only the D-bugger path after the derived base (no injection of other values)', () => {
    // Whitespace and odd characters in the source anchor survive into the
    // base only as far as the admin segment boundary — the suffix is ours.
    expect(deriveDbuggerHref('/a?x=<script>/wp-admin/y')).toBe(
      '/a?x=<script>/wp-admin/tools.php?page=wprockettoolset'
    );
  });
});
