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

import {
  FEATURE_META_LIMITS,
  FEATURE_META_OMISSION_GUARDS,
  FEATURE_META_TOKENS,
  WPR_FEATURES_ATTRIBUTE,
  WPR_FEATURES_META_SELECTOR
} from '../wp-rocket/constants';
import type { FeatureMetaRow, WprDetections } from '../wp-rocket/types';

export type { FeatureMetaRow };

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
 * for presence; `refuted` makes it the deciding evidence that the applied
 * marker is absent on this render. The declaration is assembled from feature
 * comments the plugin emits only after a feature applies, so a refuted token
 * is not an option-state claim — an enabled feature can be collecting with
 * no applied marker yet (footprint fallback is still forbidden here, that is
 * the whole point of the declaration); `absent` leaves the check to its
 * footprint evidence as before. A degraded attribute decides nothing
 * (`absent`), so hostile input can only lose meta authority, never
 * manufacture refutations.
 */
export type MetaFeatureVerdict = 'declared' | 'refuted' | 'absent';

/**
 * Resolve one row's tokens against a parsed declaration.
 *
 * @param meta The page's parsed declaration.
 * @param tokens The exact meta tokens a row maps to (see {@link FEATURE_META_TOKENS});
 *   any one listed declares the row.
 * @returns `declared` when any token is listed, `refuted` when the
 *   declaration is authoritative without them, `absent` when the meta
 *   decides nothing.
 */
export function featureMetaVerdict(
  meta: FeatureMetaEvidence,
  tokens: readonly string[]
): MetaFeatureVerdict {
  if (!meta.attributePresent || meta.degraded === true) return 'absent';
  return tokens.some((token) => meta.tokens.includes(token)) ? 'declared' : 'refuted';
}

/**
 * Resolve one row against a parsed declaration, honouring the row's omission
 * guard ({@link FEATURE_META_OMISSION_GUARDS}): a missing token while the
 * guard row's token is declared decides nothing (`absent`), since the plugin
 * omits the token on such renders even when the feature applies.
 *
 * @param meta The page's parsed declaration.
 * @param row The detection row.
 * @returns The row's verdict, as {@link featureMetaVerdict} with the guard applied.
 */
export function rowMetaVerdict(meta: FeatureMetaEvidence, row: FeatureMetaRow): MetaFeatureVerdict {
  const verdict = featureMetaVerdict(meta, FEATURE_META_TOKENS[row]);
  const guard = FEATURE_META_OMISSION_GUARDS[row];
  if (verdict !== 'refuted' || guard === undefined) return verdict;
  return featureMetaVerdict(meta, FEATURE_META_TOKENS[guard]) === 'declared' ? 'absent' : verdict;
}

/**
 * Whether a completed pass left the row undecided through its omission guard
 * (the guard row declared by the meta, the row itself not decided) — the
 * presentation's read of {@link rowMetaVerdict}'s `absent`, so the why can
 * name the omission instead of a missing declaration.
 *
 * @param detections The pass after the meta's authority.
 * @param row The detection row.
 */
export function metaOmissionLeftOpen(detections: WprDetections, row: FeatureMetaRow): boolean {
  const guard = FEATURE_META_OMISSION_GUARDS[row];
  if (guard === undefined) return false;
  const guardEntry = detections[guard];
  return guardEntry.present && guardEntry.source === 'meta' && detections[row].source === undefined;
}

/** Re-export the data registry so feature-meta consumers keep one import path. */
export { FEATURE_META_TOKENS };

/**
 * The row a declared meta token belongs to, or null when the token maps to
 * no row this port carries. The inverse of {@link FEATURE_META_TOKENS} for
 * consumers that walk the declaration (envelope views, registries keyed by
 * token) so the mapping exists in exactly one direction-agnostic place.
 *
 * @param token The exact meta token.
 */
export function featureRowForMetaToken(token: string): FeatureMetaRow | null {
  const row = (Object.keys(FEATURE_META_TOKENS) as FeatureMetaRow[]).find((candidate) =>
    FEATURE_META_TOKENS[candidate].includes(token)
  );
  return row ?? null;
}

/**
 * Apply the declaration's authority to a completed footprint pass: rewrite
 * each row's `present` when the meta decided it, and stamp `source` on every
 * row that has deciding evidence. Inventory fields stay untouched — a
 * declared feature keeps whatever markup the pass observed (a declared Delay
 * JS with no script list is valid evidence, not a missing payload), and a
 * refuted feature's leftover markup remains visible as inventory without
 * asserting the verdict.
 *
 * The row's derived flags follow the verdict where they mean "applied":
 * `lazyload_iframes.replaceImage` can only be true on an applied feature.
 *
 * @param detections The completed footprint pass (mutated in place).
 * @param meta The page's parsed declaration.
 */
export function applyFeatureMetaAuthority(
  detections: WprDetections,
  meta: FeatureMetaEvidence
): void {
  // The generator tag itself is a plugin fingerprint: even a declaration with
  // no feature tokens proves WP Rocket handled the render. This never invents
  // a version (that still comes from the content's digits only).
  if (meta.attributePresent) detections.wpr.present = true;

  for (const row of Object.keys(FEATURE_META_TOKENS) as FeatureMetaRow[]) {
    const verdict = rowMetaVerdict(meta, row);
    const entry: { present: boolean; source?: 'meta' | 'footprint' } = detections[row];
    if (verdict === 'declared') {
      entry.present = true;
      entry.source = 'meta';
    } else if (verdict === 'refuted') {
      entry.present = false;
      entry.source = 'meta';
    } else if (entry.present) {
      entry.source = 'footprint';
    } else {
      delete entry.source;
    }
  }

  // Presence-derived flag: a refuted feature cannot have applied markup.
  if (!detections.lazyload_iframes.present) detections.lazyload_iframes.replaceImage = false;
}
