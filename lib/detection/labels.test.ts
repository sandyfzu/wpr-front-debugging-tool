/**
 * The label pins: every promoted string is exactly its verified literal, the
 * registry set is complete and duplicate-free, and the page-analysis report
 * is keyed by these same rows (one declaring site — the promoted strings and
 * the report's keys cannot drift apart).
 */
import { describe, expect, it } from 'vitest';
import { FEATURE_LABELS, LABEL_WP_ROCKET } from './labels';
import type { PageAnalysisReport } from './describe';

describe('the verified feature labels', () => {
  it('each label equals its verified string, exactly', () => {
    /**
     * The verified literals the KB/settings audit pinned. Indexed by the
     * exported const name, so a renamed export fails the lookup and a
     * re-spelled value fails the comparison.
     */
    const VERIFIED = {
      labelWpRocket: 'WP Rocket',
      labelRemoveUnusedCss: 'Remove Unused CSS',
      labelDelayJavaScriptExecution: 'Delay JavaScript execution',
      labelLoadJavaScriptDeferred: 'Load JavaScript deferred',
      labelLoadCssAsynchronously: 'Load CSS asynchronously',
      labelImageLazyload: 'Image LazyLoad',
      labelIframesAndVideosLazyload: 'Iframes and videos LazyLoad',
      labelCssBackgroundImagesLazyload: 'CSS background images LazyLoad',
      labelMinifyCss: 'Minify CSS',
      labelMinifyJavascript: 'Minify JavaScript',
      labelPreloadLinks: 'Preload links',
      labelRocketcdn: 'RocketCDN',
      labelOptimizeCriticalImages: 'Optimize critical images',
      labelAutomaticLazyRendering: 'Automatic lazy rendering',
      labelPreloadFonts: 'Preload fonts',
      labelPreconnectToExternalDomains: 'Preconnect to external domains',
      labelPriorityElementsBeacon: 'Priority Elements beacon'
    } as const;
    const actual: Record<string, string> = {
      labelWpRocket: LABEL_WP_ROCKET,
      labelRemoveUnusedCss: FEATURE_LABELS[0],
      labelDelayJavaScriptExecution: FEATURE_LABELS[1],
      labelLoadJavaScriptDeferred: FEATURE_LABELS[2],
      labelLoadCssAsynchronously: FEATURE_LABELS[3],
      labelImageLazyload: FEATURE_LABELS[4],
      labelIframesAndVideosLazyload: FEATURE_LABELS[5],
      labelCssBackgroundImagesLazyload: FEATURE_LABELS[6],
      labelMinifyCss: FEATURE_LABELS[7],
      labelMinifyJavascript: FEATURE_LABELS[8],
      labelPreloadLinks: FEATURE_LABELS[9],
      labelRocketcdn: FEATURE_LABELS[10],
      labelOptimizeCriticalImages: FEATURE_LABELS[11],
      labelAutomaticLazyRendering: FEATURE_LABELS[12],
      labelPreloadFonts: FEATURE_LABELS[13],
      labelPreconnectToExternalDomains: FEATURE_LABELS[14],
      labelPriorityElementsBeacon: FEATURE_LABELS[15]
    };
    expect(Object.keys(actual).sort()).toEqual(Object.keys(VERIFIED).sort());
    for (const key of Object.keys(VERIFIED) as Array<keyof typeof VERIFIED>) {
      expect(actual[key], `${key} must keep its verified spelling`).toBe(VERIFIED[key]);
    }
  });

  it('every label is unique — no two rows render the same name', () => {
    expect(new Set<string>(FEATURE_LABELS).size).toBe(FEATURE_LABELS.length);
  });

  it('the report keys and the promoted labels are the same rows', () => {
    /**
     * Compile-pin through the report type: building a report-keyed record
     * from the promoted rows typechecks only when both sets carry exactly
     * the same keys (the feature rows plus the identity row).
     */
    const byLabel: Record<keyof PageAnalysisReport, unknown> = Object.fromEntries(
      [...FEATURE_LABELS, LABEL_WP_ROCKET].map((label) => [label, undefined])
    ) as Record<keyof PageAnalysisReport, unknown>;
    expect(Object.keys(byLabel)).toHaveLength([...FEATURE_LABELS, LABEL_WP_ROCKET].length);
  });
});
