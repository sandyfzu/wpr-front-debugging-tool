/**
 * LazyLoad (images) simulated on one served page, end to end: the pages WP
 * Rocket never lazy loads (AMP; WordPress previews and search; page-builder editors)
 * and pages that already carry its LazyLoad stay as served; otherwise the
 * version's hook texts are placed (`lazyload-hook-texts`, runtime URL from
 * `lazyload-assets-url`) and the buffer pass runs on that page
 * (`lazyload-forward`). Pure: the caller hands the page URL, the version's
 * texts and literals, and the byte measure.
 *
 * The URL skips (preview, search, page-builder editor) are
 * `lazyload-url-skip`'s. WP Rocket's other skips are server state the page
 * cannot show (the `DONOTLAZYLOAD`/`DONOTCACHEPAGE`/`DONOTROCKETOPTIMIZE`
 * constants, REST, admin and feed requests): the `site-filters` caveat.
 */
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { isAmpDocument } from './amp';
import { alreadyServesLazyload } from './already-served';
import { attributeValue } from './generator-meta';
import { lazyloadAssetsUrl } from './lazyload-assets-url';
import type { FeatureBuffer } from './ie-conditionals';
import {
  simulateLazyloadImages,
  type LazyloadForwardReport,
  type LazyloadLiterals,
  type LazyloadPassCounts
} from './lazyload-forward';
import {
  composeLazyloadHookTexts,
  placeLazyloadHookTexts,
  type LazyloadPlacement,
  type LazyloadTextParts
} from './lazyload-hook-texts';
import {
  LAZYLOAD_CAVEATS,
  LAZYLOAD_PAGE_INDEPENDENT_CAVEATS,
  type LazyloadAssetsUrlSource,
  type LazyloadCaveat,
  type LazyloadRuntimeDelivery,
  type SimulationNotApplicableReason,
  type SimulationState,
  type UnreproducedRegex
} from './spec';
import { UTF8_MEASURE, type ByteMeasure } from './utf8';
import { DATA_LAZY_SRC } from '../wp-rocket/constants';
import { LAZY_PLACEHOLDER_PREFIX } from './lazyload-tag';
import { countOccurrences } from '../../utils/text';
import { lazyloadUrlSkip } from './lazyload-url-skip';

/** What the step is given. */
export interface LazyloadSimulationInput {
  /** The served page (LazyLoad off), decoded. */
  readonly html: string;
  /** The document's URL (absolute http(s)). */
  readonly pageUrl: string;
  /** The version's printed texts. */
  readonly texts: LazyloadTextParts;
  /** The version's image exclusion literals. */
  readonly literals: LazyloadLiterals;
  /** Exclusion rows WP Rocket would add to the literals (the session's never: its steps restore them). */
  readonly rows: readonly string[];
  /** Bytes per code unit as served (default UTF-8). */
  readonly measure?: ByteMeasure;
}

/** What a simulated step states beside its counts. */
export interface LazyloadSimulatedPage {
  /** The runtime tag's URL. */
  readonly runtimeUrl: string;
  readonly assetsUrlSource: LazyloadAssetsUrlSource;
  readonly delivery: LazyloadRuntimeDelivery;
  readonly placement: LazyloadPlacement;
  /** The caveats that apply, in vocabulary order. */
  readonly caveats: readonly LazyloadCaveat[];
  /** The pass wrote placeholder images (`data:` URLs a page's CSP may block). */
  readonly placeholders: boolean;
}

/** The step's report. */
export type LazyloadStepReport = LazyloadPassCounts & {
  /** Never `csp-blocked` from {@link simulateLazyload}: the stage's CSP check decides that one. */
  readonly state: SimulationState;
  /** With `not-applicable` (required there). */
  readonly reason?: SimulationNotApplicableReason;
  /** With `beyond-exact-reproduction` (required there). */
  readonly unreproducedRegex?: UnreproducedRegex;
  /** With `simulated` (required there). */
  readonly page?: LazyloadSimulatedPage;
};

/** The step's result: the page, and on `simulated` the page the buffer pass read. */
export interface LazyloadSimulationResult {
  readonly html: string;
  readonly report: LazyloadStepReport;
  /**
   * With `simulated`: the buffer after the pass — started from the served
   * page with the hook texts placed, where later features' passes continue.
   */
  readonly buffer?: FeatureBuffer;
  /** With `simulated`: the two scripts LazyLoad printed (later features must leave them as printed). */
  readonly injectedScripts?: readonly string[];
}

/** No counts (every identity state). */
const NO_COUNTS: LazyloadPassCounts = { images: 0, pictures: 0, backgrounds: 0 };

/** A space-separated attribute value's tokens. */
function tokens(value: string | null): string[] {
  return value?.split(/[\t\n\f\r ]+/) ?? [];
}

/**
 * The caveats a served page shows itself (see `LAZYLOAD_CAVEATS`): core's
 * lazy-loading attributes on an image (`loading="lazy"`, `sizes` starting
 * `auto`), a `wp-smiley` image, an element carrying `data-lazy-src`.
 *
 * @param tags The served page's opening tags.
 */
export function pageLazyloadCaveats(tags: readonly ScannedTag[]): Set<LazyloadCaveat> {
  const found = new Set<LazyloadCaveat>();
  for (const tag of tags) {
    if (tag.attrs.some((attr) => attr.name === DATA_LAZY_SRC)) found.add('foreign-lazy-markup');
    if (tag.name !== 'img') continue;
    const loading = attributeValue(tag, 'loading')?.trim().toLowerCase();
    const sizes = attributeValue(tag, 'sizes')?.trim().toLowerCase();
    if (loading === 'lazy' || /^auto(?:$|[\s,])/.test(sizes ?? '')) found.add('core-lazy-loading');
    if (tokens(attributeValue(tag, 'class')).includes('wp-smiley')) found.add('image-smilies');
  }
  return found;
}

/**
 * Every caveat of a simulated page: the page's own, then every
 * page-independent one, in vocabulary order.
 *
 * @param tags The served page's opening tags.
 */
function simulatedCaveats(tags: readonly ScannedTag[]): LazyloadCaveat[] {
  const found = pageLazyloadCaveats(tags);
  for (const caveat of LAZYLOAD_PAGE_INDEPENDENT_CAVEATS) found.add(caveat);
  return LAZYLOAD_CAVEATS.filter((caveat) => found.has(caveat));
}

/**
 * Simulate WP Rocket's LazyLoad for images on a served page (see the module doc).
 *
 * @param input The page, its URL, the version's texts and literals.
 * @returns The page WP Rocket would serve, the report, and on `simulated`
 *   the buffer after its pass and the printed scripts.
 * @throws {@link TypeError} when `pageUrl` is not an http(s) URL.
 */
export function simulateLazyload(input: LazyloadSimulationInput): LazyloadSimulationResult {
  const tags = scanTags(input.html);
  const identity = (
    state: LazyloadStepReport['state'],
    why: Pick<LazyloadStepReport, 'reason' | 'unreproducedRegex'> = {}
  ): LazyloadSimulationResult => ({ html: input.html, report: { state, ...why, ...NO_COUNTS } });
  if (isAmpDocument(input.html, tags)) return identity('not-applicable', { reason: 'amp' });
  if (alreadyServesLazyload(input.html, tags)) return identity('already-served');
  const skip = lazyloadUrlSkip(input.pageUrl);
  if (skip !== null) return identity('not-applicable', { reason: skip });
  const assets = lazyloadAssetsUrl(input.html, input.pageUrl);
  const texts = composeLazyloadHookTexts(input.texts, assets.url);
  const placed = placeLazyloadHookTexts(input.html, texts);
  if (!placed.ok) return identity('not-applicable', { reason: placed.refused });
  const literals = input.literals;
  const result = simulateLazyloadImages({
    html: placed.html,
    literals,
    rows: input.rows,
    measure: input.measure ?? UTF8_MEASURE
  });
  if (result.report.state !== 'simulated' || result.buffer === undefined) {
    return beyondIdentity(input.html, result.report);
  }
  const { images, pictures, backgrounds } = result.report;
  return {
    html: result.html,
    report: {
      state: 'simulated',
      images,
      pictures,
      backgrounds,
      page: {
        runtimeUrl: texts.runtimeUrl,
        assetsUrlSource: assets.source,
        delivery: 'external',
        placement: placed.placement,
        caveats: simulatedCaveats(tags),
        placeholders:
          countOccurrences(result.html, LAZY_PLACEHOLDER_PREFIX) >
          countOccurrences(input.html, LAZY_PLACEHOLDER_PREFIX)
      }
    },
    buffer: result.buffer,
    injectedScripts: [
      input.texts.optionsScript,
      texts.footer.slice(input.texts.optionsScript.length)
    ]
  };
}

/**
 * The served page, refused at the forward step that could diverge.
 *
 * @param html The served page.
 * @param report The forward report (`not-applicable`).
 */
function beyondIdentity(html: string, report: LazyloadForwardReport): LazyloadSimulationResult {
  return {
    html,
    report: {
      state: 'not-applicable',
      reason: 'beyond-exact-reproduction',
      ...(report.unreproduced === undefined ? {} : { unreproducedRegex: report.unreproduced }),
      ...NO_COUNTS
    }
  };
}
