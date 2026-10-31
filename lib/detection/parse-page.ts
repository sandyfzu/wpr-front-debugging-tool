/**
 * Page preparation for the detection engine.
 *
 * Checks share the two element lists (each check reads exactly the
 * attributes it needs from them, but nobody re-queries the document); the
 * parser runs once and nothing else is precomputed — attribute reads stay
 * with the checks that use them, so classification cost matches the
 * reference read pattern minus the repeated document scans. Feature-support
 * comments (`<!-- wpr_… -->`, document-level by emission) are collected in
 * the same pass — corroboration-only evidence several checks read.
 */

import { FEATURE_COMMENT_PATTERN } from '../wp-rocket/constants';
import { parseBuilderMarker } from './builder-fact';
import type { BuilderNote } from '../exclusion-builder/builder-marker';
import { parseFeatureMeta } from './feature-meta';
import type { FeatureMetaEvidence } from './feature-meta';
import { readSimulationMarker, type PageSimulationMarker } from './simulation-fact';

/** Classified page content shared by every detection check. */
export interface ParsedPage {
  document: Document;
  /** All `script` elements, document order. */
  scripts: HTMLScriptElement[];
  /** All `link` elements, document order. */
  links: HTMLLinkElement[];
  /**
   * Feature-comment ids the page carries (`wpr_oci`…), document order. The
   * plugin appends these after `</html>`; matching is corroboration only —
   * the meta generator strips them (and white-label/logged-in pages never
   * get them), so their absence proves nothing.
   */
  comments: string[];
  /**
   * The generator meta's feature declaration (`data-wpr-features`), parsed
   * once here — the meta-authoritative evidence class checks consult before
   * their own footprint reads.
   */
  featureMeta: FeatureMetaEvidence;
  /**
   * The Exclusion Builder's note on this document (what its rewrite turned
   * off or excluded), parsed once here; null when the page carries no valid
   * builder marker.
   */
  builderNote: BuilderNote | null;
  /**
   * The simulation marker on this document (the simulated features and the
   * id to verify — null when its copies disagree), parsed once here; null
   * when the page carries no valid one. Never an authority by itself: only
   * a background-verified id is.
   */
  simulationMarker: PageSimulationMarker | null;
}

/**
 * How many feature comments one parse collects. Real pages carry ≤ a
 * handful; the cap exists so a page padded with comment-shaped payloads
 * cannot grow the collection without bound. Feature comments are tiny, so
 * no per-comment length cap is needed — the pattern itself (an id, ≤ ~40
 * chars) bounds what matches.
 */
const FEATURE_COMMENTS_CAP = 256;

/**
 * Parse a page's HTML once and collect the element lists every check works
 * from (document order in both), plus the feature-comment ids.
 *
 * @param html The page's HTML (e.g. the serialized live document).
 * @returns The parsed document plus the collected lists.
 * @throws {@link TypeError} when `html` is not a string — callers bundle
 *   serialized pages, so that is a broken caller, not bad page input.
 */
export function parsePage(html: string): ParsedPage {
  if (typeof html !== 'string') {
    throw new TypeError(`parsePage expects the page HTML string, received ${typeof html}`);
  }
  const document = new DOMParser().parseFromString(html, 'text/html');

  const comments: string[] = [];
  // A walk with a comment filter (not a querySelector — comments are not
  // elements); the walker stops early once the cap is reached.
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null && comments.length < FEATURE_COMMENTS_CAP;) {
    const data = (node as Comment).data;
    if (FEATURE_COMMENT_PATTERN.test(data)) {
      // The plugin writes `<!-- wpr_oci -->` — the padding spaces are part
      // of the comment data, so the collected id is the trimmed form.
      comments.push(data.trim());
    }
    node = walker.nextNode();
  }

  return {
    document,
    scripts: [...document.querySelectorAll('script')],
    links: [...document.querySelectorAll('link')],
    comments,
    featureMeta: parseFeatureMeta(document),
    builderNote: parseBuilderMarker(document),
    simulationMarker: readSimulationMarker(document)
  };
}
