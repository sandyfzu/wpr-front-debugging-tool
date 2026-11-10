/**
 * The "applied despite the bypass" warning: on a render whose URL carries WP
 * Rocket's bypass parameter, WP Rocket still runs the optimizations it does
 * not guard (minify, combine, defer, image/iframe lazyload, the CDN rewrite,
 * async CSS) while dropping its generator meta. A feature row proven by its
 * own page footprint on such a render is real — WP Rocket did optimize the
 * page — but it is not what a bypass request asks for, so every surface that
 * lists the feature (the panel card, the on-page strip, the support report)
 * flags it with the copy declared here.
 *
 * A pure modifier on top of the row's verdict: it never changes `present` or
 * `source`, and it reads only facts the row and the captured URL already hold.
 */

import { CACHE_BYPASS_QUERY_PARAM } from '../wp-rocket/constants';
import type { FeatureEvidenceSource, SimulationFact } from '../wp-rocket/types';

/** The detection-row facts the warning reads (every feature row has them). */
export interface BypassAppliedRow {
  readonly present: boolean;
  readonly source?: FeatureEvidenceSource;
  readonly simulation?: SimulationFact;
}

/**
 * Whether the page is a bypass render: its URL carried the bypass parameter
 * and it has no WP Rocket generator meta. WP Rocket never prints the meta on
 * a render it bypassed, so a page that carries one (even one too large to
 * read) was rendered normally — by a cache or edge layer that ignored the
 * query, say — and its footprints are no surprise.
 *
 * @param bypassAttested The captured URL carried the bypass parameter.
 * @param generatorMeta The page carries WP Rocket's generator meta (readable or not).
 * @returns True when footprint-decided rows earn the warning.
 */
export function isBypassRender(bypassAttested: boolean, generatorMeta: boolean): boolean {
  return bypassAttested && !generatorMeta;
}

/**
 * Whether a feature row carries the warning: the page is a bypass render
 * ({@link isBypassRender}),
 * and the row is applied, decided by its footprint (a meta-decided row means
 * WP Rocket served a normal render — the meta never ships on a bypass render)
 * and free of any simulation fact (the extension's own footprints, verified
 * or not, say nothing about what WP Rocket did).
 *
 * @param row The feature's detection row.
 * @param bypassRender The page is a bypass render ({@link isBypassRender}).
 * @returns True when the row shows the warning.
 */
export function isAppliedDespiteBypass(row: BypassAppliedRow, bypassRender: boolean): boolean {
  return bypassRender && row.present && row.source === 'footprint' && row.simulation === undefined;
}

/** The warning's on-screen renderings: the short badge text and the full sentence. */
export interface BypassAppliedCopy {
  /** The badge/chip text (short). */
  readonly chip: string;
  /** The full sentence: card line, strip line, tooltip and report wording. */
  readonly sentence: string;
}

/** The bypass parameter as a reader types it in a URL. */
const BYPASS_QUERY = `?${CACHE_BYPASS_QUERY_PARAM}`;

/** The warning copy — the single declaring site every surface renders from. */
export const BYPASS_APPLIED_COPY: BypassAppliedCopy = {
  chip: `Applied despite ${BYPASS_QUERY}`,
  sentence: `WP Rocket is not expected to optimize a page loaded with ${BYPASS_QUERY}, yet it applied this feature here.`
};
