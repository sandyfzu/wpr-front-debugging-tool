/**
 * The on-page detection widget's row registry (provisional): the single
 * rendering source for the report card's grouped feature rows until the
 * detection registry's HUD facet lands — that landing replaces this file
 * entirely (the facet becomes the declaring site; the strip re-points; these
 * rows die). Until then, adding a row is one entry here, never a render
 * branch.
 *
 * Every row is built on the verified label consts and the page-analysis
 * report's own composed states — the widget never invents a name or a state
 * outside what the pass answered.
 */

import type { FeatureState, PageAnalysisReport } from '../../../lib/detection/describe';
import type { FeatureLabel } from '../../../lib/detection/labels';
import {
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  LABEL_MINIFY_CSS,
  LABEL_MINIFY_JAVASCRIPT,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRELOAD_FONTS,
  LABEL_PRELOAD_LINKS,
  LABEL_REMOVE_UNUSED_CSS,
  LABEL_ROCKETCDN
} from '../../../lib/detection/labels';
import type { LABEL_PRIORITY_ELEMENTS_BEACON } from '../../../lib/detection/labels';
import type { StripIconGlyph } from './icons';
import {
  CDN_GROUP_ICON,
  FEATURES_GROUP_ICON,
  FILE_OPTIMIZATION_GROUP_ICON,
  MEDIA_GROUP_ICON,
  PRELOAD_GROUP_ICON
} from './icons';

/**
 * The row groups (the study's set). The cache group's facts render in the
 * card's header row (identity + cache chip — the conversion table's
 * assignment), so no body row declares it today; the id stays in the
 * vocabulary for the facet's full set. The tools group lands with the tool
 * phases.
 */
export type StripGroupId = 'cache' | 'file-optimization' | 'media' | 'preload' | 'cdn' | 'features';

/**
 * The groups the card renders a body section for, in render order. The view
 * renders only groups that own at least one row.
 */
export const STRIP_GROUPS: readonly {
  id: Exclude<StripGroupId, 'cache'>;
  heading: string;
  icon: StripIconGlyph;
}[] = [
  { id: 'file-optimization', heading: 'File Optimization', icon: FILE_OPTIMIZATION_GROUP_ICON },
  { id: 'media', heading: 'Media', icon: MEDIA_GROUP_ICON },
  { id: 'preload', heading: 'Preload', icon: PRELOAD_GROUP_ICON },
  { id: 'cdn', heading: 'CDN', icon: CDN_GROUP_ICON },
  { id: 'features', heading: 'Features', icon: FEATURES_GROUP_ICON }
];

/** The report rows the card can render (the identity + beacon rows stay out). */
export type StripFeatureLabel = Exclude<FeatureLabel, typeof LABEL_PRIORITY_ELEMENTS_BEACON>;

/** Stable code identifier of one card row (never rendered — the label is). */
export type StripItemId =
  | 'rucss'
  | 'delay-js'
  | 'defer-js'
  | 'async-css'
  | 'minify-css'
  | 'minify-js'
  | 'lazyload'
  | 'lazyload-iframes'
  | 'lazyload-css-bg-img'
  | 'preload-links'
  | 'rocketcdn'
  | 'critical-images'
  | 'lazy-rendering'
  | 'preload-fonts'
  | 'preconnect-domains';

/**
 * One row's composed reading: the report's state plus the feature's
 * evidence count when the engine measures one (the card renders the count
 * beside the label).
 */
export interface StripItemReading {
  state: FeatureState;
  count: number | null;
}

/** One card row: label, group, and the reading it answers with. */
export interface StripItemRow {
  id: StripItemId;
  /** The verified full feature name (the chip text and the tooltip's head). */
  label: StripFeatureLabel;
  group: Exclude<StripGroupId, 'cache'>;
  /** The count's unit word when the engine measures one, else null. */
  unit: string | null;
  /** The row's answer for one processed page. */
  read(report: PageAnalysisReport): StripItemReading;
}

/**
 * The registry, in engine order (the report's declaring order): each row's
 * `read` is a small literal-keyed selector over the verified view model, so
 * the strip's states, counts and labels are exactly what the report carries.
 */
export const STRIP_ITEMS: readonly StripItemRow[] = [
  {
    id: 'rucss',
    label: LABEL_REMOVE_UNUSED_CSS,
    group: 'file-optimization',
    unit: null,
    read: (report) => ({ state: report[LABEL_REMOVE_UNUSED_CSS].state, count: null })
  },
  {
    id: 'delay-js',
    label: LABEL_DELAY_JAVASCRIPT_EXECUTION,
    group: 'file-optimization',
    unit: 'scripts',
    read: (report) => ({
      state: report[LABEL_DELAY_JAVASCRIPT_EXECUTION].state,
      count: report[LABEL_DELAY_JAVASCRIPT_EXECUTION]['delayed scripts']
    })
  },
  {
    id: 'defer-js',
    label: LABEL_LOAD_JAVASCRIPT_DEFERRED,
    group: 'file-optimization',
    unit: 'scripts',
    read: (report) => ({
      state: report[LABEL_LOAD_JAVASCRIPT_DEFERRED].state,
      count: report[LABEL_LOAD_JAVASCRIPT_DEFERRED]['deferred scripts']
    })
  },
  {
    id: 'async-css',
    label: LABEL_LOAD_CSS_ASYNCHRONOUSLY,
    group: 'file-optimization',
    unit: null,
    read: (report) => ({ state: report[LABEL_LOAD_CSS_ASYNCHRONOUSLY].state, count: null })
  },
  {
    id: 'minify-css',
    label: LABEL_MINIFY_CSS,
    group: 'file-optimization',
    unit: null,
    read: (report) => ({ state: report[LABEL_MINIFY_CSS].state, count: null })
  },
  {
    id: 'minify-js',
    label: LABEL_MINIFY_JAVASCRIPT,
    group: 'file-optimization',
    unit: null,
    read: (report) => ({ state: report[LABEL_MINIFY_JAVASCRIPT].state, count: null })
  },
  {
    id: 'lazyload',
    label: LABEL_IMAGE_LAZYLOAD,
    group: 'media',
    unit: 'images',
    read: (report) => ({
      state: report[LABEL_IMAGE_LAZYLOAD].state,
      count: report[LABEL_IMAGE_LAZYLOAD]['lazy-loaded images']
    })
  },
  {
    id: 'lazyload-iframes',
    label: LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
    group: 'media',
    unit: null,
    read: (report) => ({ state: report[LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD].state, count: null })
  },
  {
    id: 'lazyload-css-bg-img',
    label: LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
    group: 'media',
    unit: null,
    read: (report) => ({ state: report[LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD].state, count: null })
  },
  {
    id: 'preload-links',
    label: LABEL_PRELOAD_LINKS,
    group: 'preload',
    unit: null,
    read: (report) => ({ state: report[LABEL_PRELOAD_LINKS].state, count: null })
  },
  {
    id: 'rocketcdn',
    label: LABEL_ROCKETCDN,
    group: 'cdn',
    unit: null,
    read: (report) => ({ state: report[LABEL_ROCKETCDN].state, count: null })
  },
  {
    id: 'critical-images',
    label: LABEL_OPTIMIZE_CRITICAL_IMAGES,
    group: 'features',
    unit: 'images',
    read: (report) => ({
      state: report[LABEL_OPTIMIZE_CRITICAL_IMAGES].state,
      count: report[LABEL_OPTIMIZE_CRITICAL_IMAGES]['preloaded images']
    })
  },
  {
    id: 'lazy-rendering',
    label: LABEL_AUTOMATIC_LAZY_RENDERING,
    group: 'features',
    unit: 'elements',
    read: (report) => ({
      state: report[LABEL_AUTOMATIC_LAZY_RENDERING].state,
      count: report[LABEL_AUTOMATIC_LAZY_RENDERING]['converted elements']
    })
  },
  {
    id: 'preload-fonts',
    label: LABEL_PRELOAD_FONTS,
    group: 'features',
    unit: 'fonts',
    read: (report) => ({
      state: report[LABEL_PRELOAD_FONTS].state,
      count: report[LABEL_PRELOAD_FONTS]['preloaded fonts']
    })
  },
  {
    id: 'preconnect-domains',
    label: LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
    group: 'features',
    unit: 'domains',
    read: (report) => ({
      state: report[LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS].state,
      count: report[LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS]['domains hinted']
    })
  }
];

/**
 * The grouped rendering model: only groups owning at least one registered
 * row, in render order, each with its rows in registry order. Pure over the
 * registry so the view has no grouping logic to re-derive (and tests pin
 * the grouping exactly once).
 */
export function stripGroupedRows(): Array<{
  id: StripGroupId;
  heading: string;
  icon: StripIconGlyph;
  rows: readonly StripItemRow[];
}> {
  return STRIP_GROUPS.map((group) => ({
    id: group.id,
    heading: group.heading,
    icon: group.icon,
    rows: STRIP_ITEMS.filter((item) => item.group === group.id)
  })).filter((group) => group.rows.length > 0);
}
