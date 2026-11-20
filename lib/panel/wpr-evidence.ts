/**
 * Why the panel says WP Rocket is on a page: the footprints the detection
 * pass found, read back off the loaded payload (no new capture). A support
 * reader trusts "Detected" more when it names its proof — and a page
 * detected only through its optimizations (a stripped generator tag and
 * signature, e.g. behind a host cache) reads differently from one that
 * declares the plugin.
 *
 * Pure: payload in, words out.
 */
import { joinWords } from '../../utils/text';
import type { FdtData } from '../wp-rocket/types';

/**
 * The panel's word for an absent plugin — the top bar's pill, the overview's
 * WP Rocket tile and the support report all answer it, so they can never disagree.
 */
export const WPR_NOT_DETECTED = 'Not detected';

/**
 * One footprint that proves WP Rocket handled the page, in the order a
 * sentence names them:
 * - `generator-tag`: WP Rocket's generator meta (its version, or its
 *   feature declaration);
 * - `cache-signature`: the cache signature comment after the document;
 * - `optimizations`: neither, yet an optimization only WP Rocket applies
 *   was found (presence inferred from the features themselves).
 */
export type WprEvidence = 'generator-tag' | 'cache-signature' | 'optimizations';

/** Each footprint's words inside the "Detected by …" sentence. */
const EVIDENCE_WORDS: Readonly<Record<WprEvidence, string>> = {
  'generator-tag': 'the generator tag',
  'cache-signature': 'the cache signature',
  optimizations: 'its optimizations on this page'
};

/**
 * The footprints behind the payload's WP Rocket verdict.
 *
 * @param data The loaded page data.
 * @returns The footprints in sentence order; empty when WP Rocket was not
 *   detected; `['optimizations']` alone when presence was only inferred.
 */
export function wprEvidence(data: FdtData): readonly WprEvidence[] {
  const wpr = data.wprDetections.wpr;
  if (!wpr.present) return [];
  const found: WprEvidence[] = [];
  // A version is only ever read off the generator tag; the feature
  // declaration is the same tag's attribute, so both name one footprint.
  if (wpr.version !== null || data.wprGeneratorMeta === true) found.push('generator-tag');
  if (wpr.cacheMarkerFound) found.push('cache-signature');
  return found.length === 0 ? ['optimizations'] : found;
}

/**
 * The sentence that names the footprints.
 *
 * @param evidence The footprints ({@link wprEvidence}).
 * @returns e.g. "Detected by the generator tag and the cache signature", or
 *   null for none (WP Rocket not detected: nothing to name).
 */
export function wprEvidenceSentence(evidence: readonly WprEvidence[]): string | null {
  if (evidence.length === 0) return null;
  return `Detected by ${joinWords(evidence.map((kind) => EVIDENCE_WORDS[kind]))}`;
}
