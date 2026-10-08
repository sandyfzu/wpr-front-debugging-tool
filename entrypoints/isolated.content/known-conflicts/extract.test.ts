/**
 * Scan-text extraction + URL mode detection against the committed fixtures —
 * both HelpScout inbox layouts, both WordPress markups — plus the live-DOM
 * equivalence proof: extracting from the live page body and from the
 * serialized document the rescan previously re-parsed must produce identical
 * text for the same fixture.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  extractHelpScoutText,
  extractScanText,
  extractWordPressPluginsText,
  scanModeForUrl
} from './extract';
import { findKnownConflicts } from '../../../lib/known-conflicts/match';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Parse a committed fixture into a document (the "live root" stands in). */
function fixture(name: string): Document {
  const html = readFileSync(join(fixtureDir, name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('scanModeForUrl', () => {
  it('scopes HelpScout by secured conversation hrefs', () => {
    expect(scanModeForUrl(new URL('https://secure.helpscout.net/conversation/12345/6789'))).toBe(
      'helpscout'
    );
    expect(scanModeForUrl(new URL('http://secure.helpscout.net/conversation/12345/'))).toBe('none');
    expect(scanModeForUrl(new URL('https://secure.helpscout.net/agent'))).toBe('none');
    expect(
      scanModeForUrl(new URL('https://evil.test/?url=https://secure.helpscout.net/conversation/x'))
    ).toBe('none');
    expect(scanModeForUrl(new URL('https://example.com/secure.helpscout.net/conversation/1'))).toBe(
      'none'
    );
  });

  it('scopes WordPress by the plugins screen path', () => {
    expect(scanModeForUrl(new URL('https://example.com/wp-admin/plugins.php'))).toBe('wp-admin');
    expect(
      scanModeForUrl(new URL('https://example.com/wp-admin/plugins.php?plugin_status=all'))
    ).toBe('wp-admin');
    expect(scanModeForUrl(new URL('https://sub.example.com/blog/wp-admin/plugins.php'))).toBe(
      'wp-admin'
    );
    expect(scanModeForUrl(new URL('https://example.com/wp-admin/themes.php'))).toBe('none');
  });

  it('checks HelpScout before WordPress (the surfaces can never both apply)', () => {
    expect(
      scanModeForUrl(
        new URL('https://secure.helpscout.net/conversation/1/?x=/wp-admin/plugins.php')
      )
    ).toBe('helpscout');
  });
});

describe('HelpScout extraction', () => {
  it('reads the standard inbox message tables only', () => {
    const text = extractHelpScoutText(fixture('helpscout-standard.html').body);
    expect(text).toContain('C++ Plugin');
    expect(text).toContain('Pre* Party Resource Hints');
    expect(text).toContain('W3 Total Cache');
    expect(text).not.toContain('not scanned');
  });

  it('falls back to the previous-inbox selectors when the current one is absent', () => {
    const text = extractHelpScoutText(fixture('helpscout-previous-inbox.html').body);
    expect(text).toContain('iubenda | Compliance');
    expect(text).toContain('Beaver Builder Plugin (Lite Version)');
    expect(text).toContain('SecuPress');
  });

  it('matches real-shaped database rows over the extracted text (both layouts)', () => {
    // Rows carrying regex metacharacters must match (they are escaped) on the
    // layout that actually mentions them.
    const standard = extractHelpScoutText(fixture('helpscout-standard.html').body);
    expect(
      findKnownConflicts(standard, [{ name: 'C++ Plugin', url: 'https://c' }], 'helpscout')
    ).toHaveLength(1);
    expect(
      findKnownConflicts(
        standard,
        [{ name: 'Pre* Party Resource Hints', url: 'https://p' }],
        'helpscout'
      )
    ).toHaveLength(1);
    const previous = extractHelpScoutText(fixture('helpscout-previous-inbox.html').body);
    expect(
      findKnownConflicts(
        previous,
        [{ name: 'Beaver Builder Plugin (Lite Version)', url: 'https://b' }],
        'helpscout'
      )
    ).toHaveLength(1);
  });

  it('is equivalent live vs. serialized for the same fixture', () => {
    for (const name of ['helpscout-standard.html', 'helpscout-previous-inbox.html']) {
      const html = readFileSync(join(fixtureDir, name), 'utf8');
      const live = extractHelpScoutText(new DOMParser().parseFromString(html, 'text/html').body);
      // The previous rescan serialized the live document and re-parsed it
      // before extracting — prove that path extracts exactly the same text.
      const serialized = new XMLSerializer().serializeToString(
        new DOMParser().parseFromString(html, 'text/html')
      );
      const rescanned = extractHelpScoutText(
        new DOMParser().parseFromString(serialized, 'text/html').body
      );
      expect(rescanned).toBe(live);
    }
  });

  it('returns empty text when neither layout is on the page', () => {
    expect(extractHelpScoutText(fixture('wordpress-plugins-7x-markup.html').body)).toBe('');
  });
});

describe('WordPress plugins extraction', () => {
  it('reads the pre-7.x markup (td cells)', () => {
    const text = extractWordPressPluginsText(fixture('wordpress-plugins-td-markup.html').body);
    expect(text).toContain('WP Rocket');
    expect(text).toContain('W3 Total Cache');
    expect(text).toContain('Speed Booster Pack');
    expect(text).not.toContain('Caching plugin');
  });

  it('reads the 7.x markup (th cells) and only plugin-title cells', () => {
    const text = extractWordPressPluginsText(fixture('wordpress-plugins-7x-markup.html').body);
    expect(text).toContain('W3 Total Cache');
    expect(text).toContain('iubenda | Compliance');
    expect(text).not.toContain('Not a plugin row');
    expect(text).not.toContain('fine');
  });

  it('matches conflicting plugin rows over the extracted text', () => {
    const text = extractWordPressPluginsText(fixture('wordpress-plugins-7x-markup.html').body);
    const matches = findKnownConflicts(
      text,
      [
        { name: 'W3 Total Cache', url: 'https://w3' },
        { name: 'Speed Booster Pack', url: 'https://sbp' }
      ],
      'wp-admin'
    );
    expect(matches.map((row) => row.name)).toEqual(['W3 Total Cache', 'Speed Booster Pack']);
  });

  it('routes both modes through the shared single entry point', () => {
    const hs = fixture('helpscout-standard.html');
    expect(extractScanText('helpscout', hs.body)).toBe(extractHelpScoutText(hs.body));
    const wp = fixture('wordpress-plugins-td-markup.html');
    expect(extractScanText('wp-admin', wp.body)).toBe(extractWordPressPluginsText(wp.body));
  });
});
