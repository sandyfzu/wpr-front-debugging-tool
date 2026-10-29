import { describe, expect, it } from 'vitest';
import type { SupportedWprVersion } from '../wp-rocket/versions';
import { selectWprVersion, wprVersionToken } from './select-version';

/** A served page whose head holds the given tags. */
function page(head: string): string {
  return `<!doctype html><html><head>${head}</head><body><p>x</p></body></html>`;
}

/** WP Rocket's own generator meta (`Meta.php`), with or without a version. */
function wprMeta(version?: string): string {
  const content = version === undefined ? 'WP Rocket' : `WP Rocket ${version}`;
  return `<meta name="generator" content="${content}" data-wpr-features="wpr_delay_js" />`;
}

/** The selected version string and the reported site version. */
function select(html: string): { selected: string; siteVersion?: string } {
  const { selected, siteVersion } = selectWprVersion(html);
  return { selected: selected.version, ...(siteVersion === undefined ? {} : { siteVersion }) };
}

describe('selectWprVersion', () => {
  it('simulates the version the meta names when it is supported', () => {
    expect(select(page(wprMeta('3.24')))).toEqual({ selected: '3.24', siteVersion: '3.24' });
    expect(select(page(wprMeta('3.23.5.1')))).toEqual({
      selected: '3.23.5.1',
      siteVersion: '3.23.5.1'
    });
  });

  it('falls back to the latest stable for an older or unsupported version, naming it', () => {
    expect(select(page(wprMeta('3.22')))).toEqual({ selected: '3.24', siteVersion: '3.22' });
    expect(select(page(wprMeta('3.23.5')))).toEqual({ selected: '3.24', siteVersion: '3.23.5' });
    expect(select(page(wprMeta('3.25')))).toEqual({ selected: '3.24', siteVersion: '3.25' });
  });

  it('falls back to the latest stable without a WP Rocket meta or its version', () => {
    expect(select(page(''))).toEqual({ selected: '3.24' });
    expect(select(page('<meta name="generator" content="WordPress 7.1.3" />'))).toEqual({
      selected: '3.24'
    });
    expect(select(page(wprMeta()))).toEqual({ selected: '3.24' });
    expect(select(page('<meta name="generator" content="WP Rocket abc" />'))).toEqual({
      selected: '3.24'
    });
  });

  it('never reads a malformed token as the supported version it starts with', () => {
    expect(select(page(wprMeta('3.24-beta5')))).toEqual({
      selected: '3.24',
      siteVersion: '3.24-beta5'
    });
    expect(select(page(wprMeta('3.23.5.1.9')))).toEqual({
      selected: '3.24',
      siteVersion: '3.23.5.1.9'
    });
    expect(select(page(wprMeta('3.23.5.1x')))).toEqual({
      selected: '3.24',
      siteVersion: '3.23.5.1x'
    });
  });

  it('simulates the version several WP Rocket metas agree on', () => {
    expect(select(page(wprMeta('3.23.5.1') + wprMeta('3.23.5.1')))).toEqual({
      selected: '3.23.5.1',
      siteVersion: '3.23.5.1'
    });
    expect(select(page(wprMeta('3.22') + wprMeta('3.22')))).toEqual({
      selected: '3.24',
      siteVersion: '3.22'
    });
  });

  it('never lets a version-less WP Rocket meta hide a versioned one', () => {
    expect(select(page(wprMeta() + wprMeta('3.23.5.1')))).toEqual({
      selected: '3.23.5.1',
      siteVersion: '3.23.5.1'
    });
    expect(select(page(wprMeta('3.23.5.1') + wprMeta() + wprMeta('3.23.5.1')))).toEqual({
      selected: '3.23.5.1',
      siteVersion: '3.23.5.1'
    });
    expect(select(page(wprMeta() + wprMeta()))).toEqual({ selected: '3.24' });
  });

  it('falls back to the latest stable when versions disagree, naming the first', () => {
    expect(select(page(wprMeta('3.23.5.1') + wprMeta('3.24')))).toEqual({
      selected: '3.24',
      siteVersion: '3.23.5.1'
    });
    expect(select(page(wprMeta() + wprMeta('3.24-beta5') + wprMeta('3.24')))).toEqual({
      selected: '3.24',
      siteVersion: '3.24-beta5'
    });
    expect(select(page(wprMeta('3.23.5.1') + wprMeta('3.23.5.1') + wprMeta('3.22')))).toEqual({
      selected: '3.24',
      siteVersion: '3.23.5.1'
    });
  });

  it('ignores the WordPress meta beside the WP Rocket one, and text that is not a tag', () => {
    const wordpress = '<meta name="generator" content="WordPress 7.1.3" />';
    expect(select(page(wordpress + wprMeta('3.23.5.1')))).toEqual({
      selected: '3.23.5.1',
      siteVersion: '3.23.5.1'
    });
    const commented = `<!-- ${wprMeta('3.24')} -->${wprMeta('3.23.5.1')}`;
    expect(select(page(commented))).toMatchObject({ selected: '3.23.5.1' });
  });

  it('reads only `<meta name="generator">` (exact name), whatever its other attributes', () => {
    expect(select(page('<meta name="Generator" content="WP Rocket 3.23.5.1" />'))).toEqual({
      selected: '3.24'
    });
    expect(select(page('<meta content="WP Rocket 3.23.5.1" name="generator">'))).toEqual({
      selected: '3.23.5.1',
      siteVersion: '3.23.5.1'
    });
  });

  it('selects from the given registry', () => {
    const row = (version: string, role: SupportedWprVersion['role']): SupportedWprVersion => ({
      version,
      zipSha256: '0'.repeat(64),
      role,
      variants: { deferInlineQuoteDelimiter: '/' }
    });
    const rows = [row('9.0', 'previous-minor'), row('9.1', 'latest-stable')];
    const html = page(wprMeta('9.0'));
    expect(selectWprVersion(html, undefined, rows).selected.version).toBe('9.0');
    expect(selectWprVersion(page(''), undefined, rows).selected.version).toBe('9.1');
  });
});

describe('wprVersionToken', () => {
  it('reads the digits plus any glued tail', () => {
    expect(wprVersionToken('WP Rocket 3.24')).toBe('3.24');
    expect(wprVersionToken('WP Rocket 3.24, other')).toBe('3.24');
    expect(wprVersionToken('WP-Rocket 3.24-beta5 x')).toBe('3.24-beta5');
    expect(wprVersionToken('WP Rocket 3.23.5.1.9')).toBe('3.23.5.1.9');
    expect(wprVersionToken('WP Rocket')).toBeNull();
  });
});
