/**
 * The generator meta's feature declaration: `<meta name="generator"
 * content="WP Rocket …" data-wpr-features="wpr_cdn wpr_delay_js …">`, the
 * plugin's own statement of which features ran on this page render (since
 * 3.17.2). Its tokens are the strongest evidence class a feature check has —
 * the plugin declares the feature instead of the check inferring it from
 * markup — so a declared token is authoritative even when no footprint was
 * found, and a missing token refutes the feature (the page was processed by
 * the plugin; the feature is simply not on this render). Trust basis: the
 * attribute's presence alone grants declaration authority — deliberate parity
 * with the behavioral read; a fabricated declaration mis-describes only the
 * page that carries it, the same page-content trust level as every other
 * footprint.
 *
 * Authority is bounded by the tag's presence: when the generator meta does
 * not carry the attribute (older plugin, stripped HTML, white-label), the
 * declaration says nothing and footprint evidence decides as before. The
 * attribute itself is untrusted page data, so the parse is bounded; a
 * boundary-violating attribute degrades the whole declaration (never a
 * partial read), which falls every verdict back to footprint evidence.
 */

import { WPR_FEATURES_ATTRIBUTE, WPR_FEATURES_META_SELECTOR } from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';

/** Every detection row a meta token can decide (all but the identity and beacon rows). */
export type FeatureMetaRow = Exclude<keyof WprDetections, 'wpr' | 'priority_elements_beacon'>;

/**
 * Size caps for the untrusted attribute: real declarations carry ≤ ~20 short
 * tokens. Generous — and a violation degrades the whole declaration rather
 * than trusting a clipped token list (a truncated token could read as a
 * refutation of a feature that is actually on).
 */
const FEATURE_META_LIMITS = {
  /** Tokens per attribute. */
  count: 64,
  /** Characters per token. */
  tokenChars: 128,
  /** Characters of the whole attribute. */
  totalChars: 8_192
} as const;

/**
 * What the parsed declaration holds. `attributePresent` is the authority
 * fact (the tag carries the feature list); `tokens` are the exact
 * whitespace-separated members in document order, meaningful only when the
 * parse survived the caps — a degraded attribute carries no tokens and
 * decides nothing (`degraded` marks it, additive like the truncation mark).
 */
export interface FeatureMetaEvidence {
  /** The generator meta carries the feature-declaration attribute. */
  attributePresent: boolean;
  /** The declared tokens, exact and in document order. Empty unless usable. */
  tokens: readonly string[];
  /** Present (always `true`) only when the attribute violated the caps. */
  degraded?: true;
}

/**
 * Parse the feature declaration off an already-parsed document.
 *
 * The first generator meta carrying the attribute in document order wins (a
 * page has one in practice; a hostile page with several still answers with
 * the first — first match in document order over each reader's own matched
 * set, as the generator-meta readers here all are). The attribute is
 * split on runs of whitespace into exact tokens: no case-folding, no
 * trimming of members — the plugin emits lowercase tokens and a near-miss
 * casing must not read as a declaration.
 *
 * @param document The parsed page document.
 * @returns The declaration, degraded to no-tokens when the attribute exceeds
 *   the caps (the tag itself stays a fact; the token list is never trusted
 *   partially).
 */
export function parseFeatureMeta(document: Document): FeatureMetaEvidence {
  const meta = document.querySelector<HTMLMetaElement>(WPR_FEATURES_META_SELECTOR);
  // Fresh evidence object per call: every attribute-absent ParsedPage embeds
  // it, so a shared constant would alias one mutable object across pages.
  if (meta === null) return { attributePresent: false, tokens: [] };

  // The selector matches only elements carrying the attribute, so the value
  // is always a string; a hypothetical selector regression must fail loud
  // here, never silently read as an empty declaration.
  const raw = meta.getAttribute(WPR_FEATURES_ATTRIBUTE) as string;
  if (raw.length > FEATURE_META_LIMITS.totalChars) {
    return { attributePresent: true, tokens: [], degraded: true };
  }
  const tokens = raw.split(/\s+/).filter((token) => token !== '');
  if (
    tokens.length > FEATURE_META_LIMITS.count ||
    tokens.some((token) => token.length > FEATURE_META_LIMITS.tokenChars)
  ) {
    return { attributePresent: true, tokens: [], degraded: true };
  }
  return { attributePresent: true, tokens };
}

/**
 * What the declaration alone says about one feature token. The per-check
 * evidence rule built on it: `declared` makes the meta the deciding evidence
 * for presence; `refuted` makes it the deciding evidence for absence (the
 * page was plugin-processed and the feature is off — footprint fallback is
 * forbidden here, that is the whole point of the declaration); `absent`
 * leaves the check to its footprint evidence as before. A degraded
 * attribute decides nothing (`absent`), so hostile input can only lose
 * meta authority, never manufacture refutations.
 */
export type MetaFeatureVerdict = 'declared' | 'refuted' | 'absent';

/**
 * Resolve one feature token against a parsed declaration.
 *
 * @param meta The page's parsed declaration.
 * @param token The exact meta token a row maps to (see {@link FEATURE_META_TOKENS}).
 * @returns `declared` when the token is listed, `refuted` when the
 *   declaration is authoritative without it, `absent` when the meta
 *   decides nothing.
 */
export function featureMetaVerdict(meta: FeatureMetaEvidence, token: string): MetaFeatureVerdict {
  if (!meta.attributePresent || meta.degraded === true) return 'absent';
  return meta.tokens.includes(token) ? 'declared' : 'refuted';
}

/**
 * The row↔token registry: each detection row and the exact token the plugin
 * declares for it. Verified token-by-token against the plugin's emitters
 * (each feature's `add_meta_comment` argument prefixed with `wpr_`, plus the
 * option-driven tokens the meta builder appends itself) — these literals are
 * the mapping's witness, so a plugin rename fails loudly here instead of
 * silently mis-detecting. Tokens the plugin emits for rows this port does not
 * carry yet are deliberately absent — `wpr_dns_prefetch`/`wpr_mobile`/
 * `wpr_desktop` come from the meta builder, while `wpr_cache_webp` (WebP
 * add-on) and `wpr_minify_concatenate_js` (JS combine pass) are comment
 * emitters, not builder appends: their rows are their own later work, and
 * mapping them to nothing now would invite a wrong fallback. The registry
 * carries the current emitter vocabulary; historical token spellings across
 * older plugin releases are the later coverage audit's re-verification
 * scope, not a mapping to invent now.
 */
export const FEATURE_META_TOKENS: Readonly<Record<FeatureMetaRow, string>> = {
  remove_unused_css: 'wpr_remove_unused_css',
  async_css: 'wpr_async_css',
  delay_js: 'wpr_delay_js',
  defer_all_js: 'wpr_defer_js',
  lazyload: 'wpr_lazyload_images',
  lazyload_iframes: 'wpr_lazyload_iframes',
  lazyload_css_bg_img: 'wpr_lazyload_css_bg_img',
  rocket_above_the_fold_optimization: 'wpr_oci',
  automatic_lazy_rendering: 'wpr_automatic_lazy_rendering',
  auto_preload_fonts: 'wpr_auto_preload_fonts',
  preconnect_external_domains: 'wpr_preconnect_external_domains',
  minify_css: 'wpr_minify_css',
  minify_js: 'wpr_minify_js',
  preload_links: 'wpr_preload_links',
  rocket_cdn: 'wpr_cdn'
};

/**
 * The row a declared meta token belongs to, or null when the token maps to
 * no row this port carries. The inverse of {@link FEATURE_META_TOKENS} for
 * consumers that walk the declaration (envelope views, registries keyed by
 * token) so the mapping exists in exactly one direction-agnostic place.
 *
 * @param token The exact meta token.
 */
export function featureRowForMetaToken(token: string): FeatureMetaRow | null {
  const row = (Object.keys(FEATURE_META_TOKENS) as FeatureMetaRow[]).find(
    (candidate) => FEATURE_META_TOKENS[candidate] === token
  );
  return row ?? null;
}
