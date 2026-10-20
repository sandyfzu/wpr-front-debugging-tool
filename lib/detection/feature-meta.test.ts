/**
 * The generator meta's feature declaration: bounded parsing (absent tag,
 * attribute-less tag, empty attribute, token members, hostile sizes), the
 * per-feature verdict rule, and the row↔token registry — every token literal
 * pinned against the plugin's emitters, including the tokens that must NOT
 * map to a row yet.
 */
import { describe, expect, it } from 'vitest';
import { FEATURE_META_TOKENS, featureMetaVerdict, featureRowForMetaToken } from './feature-meta';
import { parsePage } from './parse-page';
import type { FeatureMetaEvidence } from './feature-meta';
import { WPR_FEATURES_ATTRIBUTE } from '../wp-rocket/constants';

/** Parse a snippet the way the detection pass does. */
function read(html: string): FeatureMetaEvidence {
  return parsePage(html).featureMeta;
}

/** The real declaration shape the plugin emits (tokens + optional version). */
function metaHtml(features: string, version = '3.23.5.1'): string {
  return `<meta name="generator" content="WP Rocket ${version}" ${WPR_FEATURES_ATTRIBUTE}="${features}">`;
}

describe('parseFeatureMeta', () => {
  it('reads the declared tokens in document order', () => {
    expect(read(metaHtml('wpr_cdn wpr_delay_js wpr_oci'))).toEqual({
      attributePresent: true,
      tokens: ['wpr_cdn', 'wpr_delay_js', 'wpr_oci']
    });
  });

  it('answers no declaration when the generator meta or the attribute is absent', () => {
    expect(read('<p>no metas here</p>')).toEqual({ attributePresent: false, tokens: [] });
    // A WP Rocket tag without the attribute says nothing about features.
    expect(read('<meta name="generator" content="WP Rocket 3.23">')).toEqual({
      attributePresent: false,
      tokens: []
    });
  });

  it('distinguishes a present-empty attribute (declares nothing, but the tag is there)', () => {
    const meta = read(metaHtml(''));
    expect(meta).toEqual({ attributePresent: true, tokens: [] });
    // Every feature is refuted by an explicitly empty declaration.
    expect(featureMetaVerdict(meta, 'wpr_cdn')).toBe('refuted');
  });

  it('splits on any whitespace run and keeps exact tokens (no case-folding)', () => {
    const meta = read(metaHtml('  wpr_cdn\t wpr_delay_js\n  WPR_OCI '));
    expect(meta.tokens).toEqual(['wpr_cdn', 'wpr_delay_js', 'WPR_OCI']);
    // A casing near-miss is not a declaration.
    expect(featureMetaVerdict(meta, 'wpr_oci')).toBe('refuted');
  });

  it('takes the first attribute-bearing generator meta in document order', () => {
    const html = `<meta name="generator" content="WordPress 6.8.1">${metaHtml('wpr_cdn')}`;
    expect(read(html).tokens).toEqual(['wpr_cdn']);
  });

  it('reads the declaration regardless of the version content (digits-free is not tag absence)', () => {
    const meta = read(metaHtml('wpr_cdn', ''));
    expect(meta).toEqual({ attributePresent: true, tokens: ['wpr_cdn'] });
  });

  it('degrades wholesale on an oversized attribute (never a partial token list)', () => {
    const meta = read(metaHtml('wpr_cdn ' + 'x'.repeat(129)));
    expect(meta).toEqual({ attributePresent: true, tokens: [], degraded: true });
    // Degraded authority falls back to footprint evidence, never refutes.
    expect(featureMetaVerdict(meta, 'wpr_cdn')).toBe('absent');
  });

  it('degrades wholesale on too many tokens', () => {
    const tokens = Array.from({ length: 65 }, (_, i) => `wpr_x${String(i)}`).join(' ');
    expect(read(metaHtml(tokens))).toEqual({ attributePresent: true, tokens: [], degraded: true });
  });

  it('accepts a declaration at the cap boundary', () => {
    const tokens = Array.from({ length: 64 }, (_, i) => `wpr_x${String(i)}`).join(' ');
    const meta = read(metaHtml(tokens));
    expect(meta.degraded).toBeUndefined();
    expect(meta.tokens).toHaveLength(64);
  });

  it('accepts an attribute exactly at the totalChars cap and degrades one char past it', () => {
    // 63 tokens of 127 chars + 1 token of 128 chars + 63 separators = 8192.
    const atCap = [...Array.from({ length: 63 }, () => 'a'.repeat(127)), 'b'.repeat(128)].join(' ');
    const edge = read(metaHtml(atCap));
    expect(edge).toEqual({ attributePresent: true, tokens: atCap.split(' ') });
    expect(edge.degraded).toBeUndefined();
    // 8193: the caps violation degrades the whole declaration, never clipped.
    const over = read(metaHtml(`${atCap} `));
    expect(over).toEqual({ attributePresent: true, tokens: [], degraded: true });
    // Degraded authority falls back to footprint evidence, never refutes.
    expect(featureMetaVerdict(over, 'wpr_cdn')).toBe('absent');
  });

  it('retains duplicate tokens as declared (occurrence, not a set)', () => {
    const meta = read(metaHtml('wpr_cdn wpr_cdn'));
    expect(meta).toEqual({ attributePresent: true, tokens: ['wpr_cdn', 'wpr_cdn'] });
    expect(featureMetaVerdict(meta, 'wpr_cdn')).toBe('declared');
  });

  it('does not match the attribute on a non-generator meta', () => {
    expect(
      read('<meta name="description" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_cdn">')
    ).toEqual({ attributePresent: false, tokens: [] });
    // Not even a named meta at all: the selector names the generator tag.
    expect(read('<meta data-wpr-features="wpr_cdn">')).toEqual({
      attributePresent: false,
      tokens: []
    });
  });

  it('is case-sensitive on the name value but folds the attribute name', () => {
    // An uppercase name VALUE is not the generator tag the selector names.
    expect(
      read('<meta name="GENERATOR" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_cdn">')
    ).toEqual({ attributePresent: false, tokens: [] });
    // Attribute NAMES case-fold when HTML parses, so the read still lands.
    const folded = read(metaHtml('wpr_cdn').replace(WPR_FEATURES_ATTRIBUTE, 'data-WPR-FEATURES'));
    expect(folded).toEqual({ attributePresent: true, tokens: ['wpr_cdn'] });
  });

  it('splits on any Unicode whitespace run (NBSP, BOM) but not on zero-width characters', () => {
    const meta = read(metaHtml('wpr_cdn\u00a0wpr_delay_js\ufeffwpr_oci'));
    expect(meta.tokens).toEqual(['wpr_cdn', 'wpr_delay_js', 'wpr_oci']);
    // Zero-width space is not whitespace to the split: it fuses into the
    // token, so the near-miss must NOT read as a declaration of wpr_cdn.
    const zwsp = read(metaHtml('\u200bwpr_cdn'));
    expect(zwsp.tokens).toEqual(['\u200bwpr_cdn']);
    expect(featureMetaVerdict(zwsp, 'wpr_cdn')).toBe('refuted');
  });

  it('reads a whitespace-only attribute as present-empty (the tag declares nothing)', () => {
    const meta = read(metaHtml('   '));
    expect(meta).toEqual({ attributePresent: true, tokens: [] });
    expect(featureMetaVerdict(meta, 'wpr_cdn')).toBe('refuted');
  });

  it('reads a bare valueless attribute as present-empty exactly like an empty value', () => {
    const meta = read('<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features>');
    expect(meta).toEqual({ attributePresent: true, tokens: [] });
    expect(featureMetaVerdict(meta, 'wpr_cdn')).toBe('refuted');
  });

  it('drops the tag when a quote never closes and degrades a giant swallowed raw', () => {
    // Quote stays unterminated at EOF ⇒ eof-in-tag: the pending meta never
    // even emits, so no declaration rests on it (fallback, not degraded).
    const unclosed = '<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="';
    expect(read(unclosed)).toEqual({ attributePresent: false, tokens: [] });
    // The quote closes after a multi-KB swallowed span: the giant raw is the
    // attribute value, and its cap violation degrades the declaration.
    const giant = read(`${unclosed}wpr_cdn${'x'.repeat(9000)}">`);
    expect(giant).toEqual({ attributePresent: true, tokens: [], degraded: true });
    expect(featureMetaVerdict(giant, 'wpr_cdn')).toBe('absent');
  });
});

describe('featureMetaVerdict', () => {
  const declared = parsePage(metaHtml('wpr_cdn wpr_delay_js')).featureMeta;
  const empty = parsePage(metaHtml('')).featureMeta;
  const degraded: FeatureMetaEvidence = { attributePresent: true, tokens: [], degraded: true };
  const absent = parsePage('<p>none</p>').featureMeta;

  it('declares listed tokens', () => {
    expect(featureMetaVerdict(declared, 'wpr_cdn')).toBe('declared');
    expect(featureMetaVerdict(declared, 'wpr_delay_js')).toBe('declared');
  });

  it('refutes unlisted tokens only when the declaration is authoritative', () => {
    expect(featureMetaVerdict(declared, 'wpr_minify_css')).toBe('refuted');
    expect(featureMetaVerdict(empty, 'wpr_minify_css')).toBe('refuted');
  });

  it('answers absent when the meta decides nothing (no attribute, degraded)', () => {
    expect(featureMetaVerdict(absent, 'wpr_cdn')).toBe('absent');
    expect(featureMetaVerdict(degraded, 'wpr_cdn')).toBe('absent');
  });
});

describe('FEATURE_META_TOKENS registry', () => {
  // The independent witness: each row and the exact token the plugin's own
  // emitter declares for it (the emitters' add_meta_comment argument prefixed
  // with wpr_, plus the meta builder's option-driven tokens).
  const EXPECTED: Record<keyof typeof FEATURE_META_TOKENS, string> = {
    remove_unused_css: 'wpr_remove_unused_css',
    async_css: 'wpr_async_css',
    delay_js: 'wpr_delay_js',
    defer_all_js: 'wpr_defer_js',
    lazyload: 'wpr_lazyload_images',
    lazyload_iframes: 'wpr_lazyload_iframes',
    lazyload_css_bg_img: 'wpr_lazyload_css_bg_img',
    self_hosted_fonts: 'wpr_host_fonts_locally',
    image_dimensions: 'wpr_image_dimensions',
    rocket_above_the_fold_optimization: 'wpr_oci',
    automatic_lazy_rendering: 'wpr_automatic_lazy_rendering',
    auto_preload_fonts: 'wpr_auto_preload_fonts',
    preconnect_external_domains: 'wpr_preconnect_external_domains',
    minify_css: 'wpr_minify_css',
    minify_js: 'wpr_minify_js',
    preload_links: 'wpr_preload_links',
    rocket_cdn: 'wpr_cdn'
  };

  it('maps every feature row to its exact emitter token', () => {
    expect(FEATURE_META_TOKENS).toEqual(EXPECTED);
  });

  it('round-trips the inverse lookup', () => {
    for (const [row, token] of Object.entries(EXPECTED)) {
      expect(featureRowForMetaToken(token)).toBe(row);
    }
  });

  it('maps no row to the tokens whose rows are not carried yet', () => {
    expect(featureRowForMetaToken('wpr_dns_prefetch')).toBeNull();
    expect(featureRowForMetaToken('wpr_minify_concatenate_js')).toBeNull();
    expect(featureRowForMetaToken('wpr_cache_webp')).toBeNull();
    expect(featureRowForMetaToken('wpr_mobile')).toBeNull();
    expect(featureRowForMetaToken('wpr_desktop')).toBeNull();
    expect(featureRowForMetaToken('wpr_nonexistent')).toBeNull();
  });
});
