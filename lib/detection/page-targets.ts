/**
 * Page targets of the meta-declared rows whose own record cannot show them
 * (bare booleans; image lazyload's list, blind to the backgrounds and native
 * lazy images the option also covers): whether the page holds what the
 * declared feature acts on. WP Rocket declares these features on renders
 * where they changed nothing (every candidate excluded, none on the page, or
 * the option alone writes the token), and the meta step overwrites the row's
 * `present`, so this separate fact is what lets a surface say "declared, but
 * nothing here" instead of "applied on this page". Never the
 * check's own footprint verdict where that verdict reads option markup
 * (the iframe lazyload options blob, the background container styles), which
 * WP Rocket writes with or without targets.
 */

import {
  LAZYLOAD_BG_PAIRS_PATTERN,
  LAZYLOAD_IFRAME_TARGETS_SELECTOR,
  LAZYLOAD_IMAGE_TARGETS_SELECTOR,
  NATIVE_LAZY_IMAGE_CANDIDATE_SELECTOR,
  NATIVE_LAZY_LOADING_VALUE
} from '../wp-rocket/constants';
import type { PageTargetsRow, WprDetections } from '../wp-rocket/types';
import { hasSelfHostedFontLink } from './detect-optimizations';
import { hasMinifyFootprint, type MinifyRow } from './minify-footprint';
import type { ParsedPage } from './parse-page';
import { insideNoscript } from './stylesheet-links';

/**
 * Whether any of the row's tags is minified by either arm (the cache URL or
 * the stamp): under a declaration WP Rocket is proven, so the stamp alone
 * names a file it minified.
 *
 * @param page The parsed page.
 * @param row The minify row.
 */
function hasMinifiedTag(page: ParsedPage, row: MinifyRow): boolean {
  return hasMinifyFootprint(page, row, 'url') || hasMinifyFootprint(page, row, 'attribute');
}

/**
 * Whether any element matching the selector sits outside `<noscript>`: a
 * raw-HTML parse exposes fallback content as elements (a live capture keeps
 * it as text), and WP Rocket's own fallback holds the original, un-rewritten
 * tag — never a target.
 *
 * @param page The parsed page.
 * @param selector The candidates.
 * @param accept An extra test per candidate (default: every one).
 */
function hasTargetOutsideNoscript(
  page: ParsedPage,
  selector: string,
  accept: (element: Element) => boolean = () => true
): boolean {
  for (const element of page.document.querySelectorAll(selector)) {
    if (accept(element) && !insideNoscript(element)) return true;
  }
  return false;
}

/**
 * Whether an image is natively lazy: the enumerated `loading` keyword, any
 * case (trimmed too — generous on purpose, since a match only withholds).
 *
 * @param image An `<img loading>` element.
 */
function isNativeLazy(image: Element): boolean {
  return image.getAttribute('loading')?.trim().toLowerCase() === NATIVE_LAZY_LOADING_VALUE;
}

/** Per row: whether the page holds the feature's targets (registry, no branching). */
const PAGE_TARGET_PROBES: Readonly<Record<PageTargetsRow, (page: ParsedPage) => boolean>> = {
  minify_css: (page) => hasMinifiedTag(page, 'minify_css'),
  minify_js: (page) => hasMinifiedTag(page, 'minify_js'),
  self_hosted_fonts: hasSelfHostedFontLink,
  lazyload: (page) =>
    hasTargetOutsideNoscript(page, LAZYLOAD_IMAGE_TARGETS_SELECTOR) ||
    hasTargetOutsideNoscript(page, NATIVE_LAZY_IMAGE_CANDIDATE_SELECTOR, isNativeLazy),
  lazyload_iframes: (page) => hasTargetOutsideNoscript(page, LAZYLOAD_IFRAME_TARGETS_SELECTOR),
  lazyload_css_bg_img: (page) =>
    page.scripts.some((script) => LAZYLOAD_BG_PAIRS_PATTERN.test(script.textContent))
};

/**
 * The rows whose targets Remove Unused CSS strips from the page it applies
 * to (every stylesheet link, self-hosted font links included): their
 * absence there proves nothing, so the fact stays unset.
 */
const REMOVED_BY_UNUSED_CSS: ReadonlySet<PageTargetsRow> = new Set([
  'minify_css',
  'self_hosted_fonts'
]);

/**
 * Stamp `targets` on every meta-declared targets row (after the meta's
 * authority; a row the meta did not declare never carries the field, nor
 * one whose targets Remove Unused CSS removed).
 *
 * @param detections The pass after the meta's authority (mutated in place).
 * @param page The parsed page.
 */
export function applyPageTargets(detections: WprDetections, page: ParsedPage): void {
  const unusedCssApplied = detections.remove_unused_css.present;
  for (const row of Object.keys(PAGE_TARGET_PROBES) as PageTargetsRow[]) {
    const entry = detections[row];
    if (!entry.present || entry.source !== 'meta') continue;
    if (unusedCssApplied && REMOVED_BY_UNUSED_CSS.has(row)) continue;
    entry.targets = PAGE_TARGET_PROBES[row](page);
  }
}
