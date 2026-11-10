/**
 * Who put a resource hint on the page, as far as the page proves it — pure,
 * over the captured hint and the page's detection rows.
 *
 * A hint reads WP Rocket only when it carries one of the plugin's stamps
 * (the engine records a stamp only on the `rel` its emitter writes). A stamp
 * names a feature only where the proof is sufficient: `data-rocket-preload`
 * is one shared helper's mark for several features, so a preload names one
 * only when its `as` type plus that feature's detected row single it out.
 * A plain hint is unattributed — never claimed for WP Rocket, nor denied:
 * WordPress core, the theme or any plugin may have printed it.
 */

import {
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRELOAD_FONTS
} from '../detection/labels';
import { RESOURCE_HINT_RELS } from '../wp-rocket/constants';
import type { ResourceHint, ResourceHintMark, WprDetections } from '../wp-rocket/types';

/** A hint's attribution: WP Rocket (with the feature when proven), or none. */
export type HintAttribution =
  | { readonly by: 'wp-rocket'; readonly mark: ResourceHintMark; readonly feature: string | null }
  | { readonly by: 'page' };

/** The one unattributed value (shared: no allocation per plain hint). */
export const UNATTRIBUTED: HintAttribution = { by: 'page' };

/**
 * The preload emitters a type + row can single out. Optimize Critical Images
 * is the only `as="image"` emitter. Preload fonts is named on `as="font"`
 * whenever its row is detected: wherever it applies it switches Remove
 * Unused CSS's font preloads off. Those are opt-in (off unless a site filter
 * enables them), so a font preload without the Preload fonts row names no
 * feature, RUCSS included. Google Fonts' `as="style"` preload has no row.
 */
const PRELOAD_FEATURE_PROOFS: readonly {
  readonly as: string;
  readonly feature: string;
  readonly proven: (detections: WprDetections) => boolean;
}[] = [
  {
    as: 'image',
    feature: LABEL_OPTIMIZE_CRITICAL_IMAGES,
    proven: (detections) => detections.rocket_above_the_fold_optimization.present
  },
  {
    as: 'font',
    feature: LABEL_PRELOAD_FONTS,
    proven: (detections) => detections.auto_preload_fonts.present
  }
];

/**
 * The feature each stamp can name. Preconnect to External Domains is the
 * only writer of its two stamps; Load CSS asynchronously is named only with
 * its row detected (the stamp alone does not decide that row either).
 */
const MARK_FEATURES: Readonly<
  Record<ResourceHintMark, (hint: ResourceHint, detections: WprDetections) => string | null>
> = {
  preload: (hint, detections) =>
    PRELOAD_FEATURE_PROOFS.find((proof) => proof.as === hint.as && proof.proven(detections))
      ?.feature ?? null,
  async: (_hint, detections) =>
    detections.async_css.present ? LABEL_LOAD_CSS_ASYNCHRONOUSLY : null,
  preconnect: () => LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  prefetch: () => LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS
};

/**
 * Attribute one hint.
 *
 * @param hint The captured hint.
 * @param detections The page's detection rows (feature proof).
 * @returns WP Rocket with its feature (or `null` when unproven), or {@link UNATTRIBUTED}.
 */
export function hintAttribution(hint: ResourceHint, detections: WprDetections): HintAttribution {
  if (hint.mark === undefined) return UNATTRIBUTED;
  return { by: 'wp-rocket', mark: hint.mark, feature: MARK_FEATURES[hint.mark](hint, detections) };
}

/** Preload `as` types in group order; any other type follows them, a missing one comes last. */
const PRELOAD_AS_ORDER: readonly string[] = ['image', 'font', 'style', 'script', 'fetch'];

/**
 * A hint's place in the inventory, smaller first: WP Rocket's hints before
 * unattributed ones (kept apart), then by kind ({@link RESOURCE_HINT_RELS}
 * order), preloads by `as` type. Equal ranks keep document order (the sort
 * is stable).
 *
 * @param hint The hint.
 * @param attribution Its attribution.
 */
export function hintRank(hint: ResourceHint, attribution: HintAttribution): number {
  const byPage = attribution.by === 'page' ? 1 : 0;
  const kind = RESOURCE_HINT_RELS.indexOf(hint.rel);
  const known = PRELOAD_AS_ORDER.indexOf(hint.as);
  let type = 0;
  if (hint.rel === 'preload') {
    if (known >= 0) type = known;
    else type = hint.as === '' ? PRELOAD_AS_ORDER.length + 1 : PRELOAD_AS_ORDER.length;
  }
  return (byPage * RESOURCE_HINT_RELS.length + kind) * (PRELOAD_AS_ORDER.length + 2) + type;
}
