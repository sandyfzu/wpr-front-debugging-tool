/**
 * The detection widget's presentation state: one typed mind for what the
 * widget shows, pure over the hub's single-pass data so no render path can
 * contradict it.
 *
 * - `insMood` maps the pass's outcome to the chrome's mood (`ins-*` classes):
 *   green = present + cached, amber = present + uncached, gray = presence
 *   not established, pulse = the pass is still running, red = the pass
 *   failed.
 * - The D-2 mapping folds the report's `FeatureState` into the chip
 *   vocabulary; red is reserved for real failures, so a feature the plugin
 *   had not yet applied reads neutral, never erroring.
 * - The card model (identity, cache chip, grouped rows, footer) is one pure
 *   builder the view renders verbatim; every unsure state explains itself in
 *   its tooltip copy and no chip claims more certainty than the scan has.
 */

import type { FeatureState, PageAnalysisReport } from '../../../lib/detection/describe';
import { describeDetections, formatCacheTimestamp } from '../../../lib/detection/describe';
import type { WprDetections } from '../../../lib/wp-rocket/types';
import { stripGroupedRows } from './strip-items';
import type { StripGroupId, StripItemId } from './strip-items';
import type { StripIconGlyph } from './icons';

/** The widget's five chrome moods (`ins-*`; the KC vocabulary generalized). */
export type InspectorMood = 'green' | 'amber' | 'gray' | 'pulse' | 'red';

/** How far the single pass has gone, per the hub's answer. */
export type InspectorPhase = 'running' | 'ready' | 'failed';

/**
 * The hub read the widget renders: the phase plus the cooled result (ready
 * only). A single object per update keeps the store writes atomic.
 */
export interface StripDataSnapshot {
  phase: InspectorPhase;
  detections: WprDetections | null;
}

/**
 * The chip state vocabulary the card renders (the P0 status pairs the brief
 * distributes; `info` would appear with tools).
 */
export type StripChipState = 'ok' | 'warn' | 'attention' | 'error' | 'neutral';

/** The cache chip, one of the four conversion-table shapes. */
export interface StripCacheChip {
  state: StripChipState;
  /** The chip's short label (`✓ Cached` · `Not cached` · `…` · `—`). */
  text: string;
  /** The cache stamp suffix when a served stamp formatted. */
  stamp: string | null;
}

/** One card row rendered verbatim by the view. */
export interface StripCardRow {
  id: StripItemId;
  /** The full verified feature name (chip text). */
  label: string;
  /** The chip's state, folded from the report's evidence state. */
  chipState: StripChipState;
  /** The evidence count, rendered when the engine measures one. */
  count: number | null;
  /** The count's unit word (rendered after the count). */
  unit: string | null;
  /** The row's full name + one-line why (the chip's title tooltip). */
  tooltip: string;
}

/** One rendered group heading + its rows. */
export interface StripCardGroup {
  id: StripGroupId;
  heading: string;
  icon: StripIconGlyph;
  rows: readonly StripCardRow[];
}

/** What the card renders per phase (the view's whole body contract). */
export interface StripCardModel {
  /** The pass's phase (the header chip and body state lines follow it). */
  phase: InspectorPhase;
  /** The identity text (the card's title and the pill's identity). */
  identity: string;
  /** The header's cache chip (null only while a body copy states the phase). */
  cacheChip: StripCacheChip | null;
  /** The grouped rows (ready phase only). */
  groups: readonly StripCardGroup[];
  /** The body's state copy while the pass is pending or failed. */
  stateCopy: { title: string; hint: string } | null;
  /** The footer stamp (`WPR x · WP y · FDT z`). */
  footer: string;
  /** The full-stamp tooltip copy for the cache chip (title attribute). */
  cacheTooltip: string | null;
}

/** The cache chip's short labels, exactly as the conversion table lists them. */
export const CACHE_CHIP_CACHED_TEXT = '✓ Cached';
export const CACHE_CHIP_NOT_CACHED_TEXT = 'Not cached';
export const CACHE_CHIP_PENDING_TEXT = '…';
export const CACHE_CHIP_IDLE_TEXT = '—';

/** The card's pending body copy (short pass pending; no verdict yet). */
export const CARD_LOADING_TITLE = 'Scanning this page…';

/** The card's failure copy: honest, with the one fix that exists. */
export const CARD_ERROR_TITLE = 'The page scan failed';
export const CARD_ERROR_HINT = 'Reload the page and re-open the report to scan again.';

/**
 * The mood that drives every colored surface, from the pass's outcome.
 *
 * @param snapshot The hub read to render.
 */
export function insMood(snapshot: StripDataSnapshot): InspectorMood {
  if (snapshot.phase === 'running') return 'pulse';
  if (snapshot.phase === 'failed' || snapshot.detections === null) return 'red';
  const { present, cached } = snapshot.detections.wpr;
  if (!present) return 'gray';
  return cached ? 'green' : 'amber';
}

/**
 * The D-2 matrix: the report's evidence states fold into chip states.
 * `collecting` (enabled, not yet applied) is the attention pair — the amber
 * "present but unsure" reading. Both neutral states (not applied / not
 * enabled) stay neutral: a page served before the plugin's work, or a
 * feature with a withheld context, is not an error.
 *
 * @param state The evidence state one report row composed.
 */
export function chipStateForFeature(state: FeatureState): StripChipState {
  switch (state) {
    case 'applied':
      return 'ok';
    case 'collecting':
      return 'attention';
    case 'not enabled':
    case 'not applied':
      return 'neutral';
  }
}

/**
 * The row's tooltip: the full name, the honest state line, and the count's
 * wording. The unsure states explain themselves (what was looked for); no
 * chip state a support engineer cannot resolve on the page is left unspoken.
 *
 * @param label The row's full feature name.
 * @param state The row's evidence state.
 * @param count The row's evidence count, when the engine measures one.
 * @param unit The count's unit word, when there is a count.
 */
function rowTooltip(
  label: string,
  state: FeatureState,
  count: number | null,
  unit: string | null
): string {
  switch (state) {
    case 'applied':
      return count !== null && unit !== null
        ? `${label} — applied on this page: ${String(count)} ${unit}.`
        : `${label} — applied on this page.`;
    case 'collecting':
      return `${label} — the feature is enabled, not yet applied on this page.`;
    case 'not enabled':
      return `${label} — not enabled in the site's current configuration.`;
    case 'not applied':
      return `${label} — nothing matched on this page (the page may predate the plugin's work).`;
  }
}

/**
 * The pill's and the card title's identity text (`WPR <version>` forms).
 *
 * @param snapshot The hub read to render.
 */
export function identityText(snapshot: StripDataSnapshot): string {
  if (snapshot.phase !== 'ready' || snapshot.detections === null) return 'WPR';
  const { present, version } = snapshot.detections.wpr;
  if (!present) return 'WPR not found';
  return version === null ? 'WPR (unknown version)' : `WPR ${version}`;
}

/**
 * The header's cache chip for the current phase and answer.
 *
 * @param snapshot The hub read to render.
 */
function cacheChip(snapshot: StripDataSnapshot): StripCacheChip | null {
  if (snapshot.phase === 'running') {
    return { state: 'neutral', text: CACHE_CHIP_PENDING_TEXT, stamp: null };
  }
  if (snapshot.phase === 'failed' || snapshot.detections === null) {
    return { state: 'neutral', text: CACHE_CHIP_IDLE_TEXT, stamp: null };
  }
  const { present, cached, timeStamp } = snapshot.detections.wpr;
  if (!present) {
    return { state: 'neutral', text: CACHE_CHIP_IDLE_TEXT, stamp: null };
  }
  if (!cached) {
    return { state: 'warn', text: CACHE_CHIP_NOT_CACHED_TEXT, stamp: null };
  }
  return {
    state: 'ok',
    text: CACHE_CHIP_CACHED_TEXT,
    stamp: formatCacheTimestamp(timeStamp)
  };
}

/**
 * The cache chip's tooltip: the one line that explains the chip's state.
 *
 * @param snapshot The hub read to render.
 */
function cacheTooltip(snapshot: StripDataSnapshot): string | null {
  const chip = cacheChip(snapshot);
  if (chip === null) return null;
  if (chip.stamp !== null) return `Cache generated ${chip.stamp}`;
  if (snapshot.phase === 'running') return 'The page scan has not answered yet.';
  if (snapshot.phase === 'failed') return 'The page scan failed — no cache verdict.';
  if (snapshot.detections === null) return 'No page answer yet.';
  const { present, cached } = snapshot.detections.wpr;
  if (!present) return 'WP Rocket did not handle this page.';
  return cached ? 'The page is served from cache.' : 'The page is not served from cache.';
}

/**
 * The footer stamp: the three known versions, muted dashes for unknowns.
 *
 * @param wprVersion WP Rocket's version (null when unknown).
 * @param wpVersion WordPress's version (null when undeclared).
 * @param fdtVersion This extension's manifest version.
 */
export function footerStamp(
  wprVersion: string | null,
  wpVersion: string | null,
  fdtVersion: string
): string {
  return `WPR ${wprVersion ?? '—'} · WP ${wpVersion ?? '—'} · FDT ${fdtVersion}`;
}

/**
 * Build the card model the view renders verbatim.
 *
 * @param input The current snapshot, the WordPress version the pass read,
 *   and this extension's manifest version for the footer.
 * @returns The whole card: identity, cache chip, grouped rows (per the
 *   registry's grouping), state copy (pending/failed) and footer stamp.
 */
export function buildStripCardModel(input: {
  snapshot: StripDataSnapshot;
  wordpressVersion: string | null;
  fdtVersion: string;
}): StripCardModel {
  const { snapshot, wordpressVersion, fdtVersion } = input;

  const wprVersion = snapshot.detections?.wpr.version ?? null;
  const footer = footerStamp(wprVersion, wordpressVersion, fdtVersion);

  // The report is built exactly once per model (the pass's own view model)
  // and handed to the registry's row readers.
  const report: PageAnalysisReport | null =
    snapshot.phase === 'ready' && snapshot.detections !== null
      ? describeDetections(snapshot.detections)
      : null;

  const groups =
    report === null
      ? []
      : stripGroupedRows().map((group) => ({
          id: group.id,
          heading: group.heading,
          icon: group.icon,
          rows: group.rows.map((row) => {
            const reading = row.read(report);
            return {
              id: row.id,
              label: row.label,
              chipState: chipStateForFeature(reading.state),
              count: reading.count,
              unit: row.unit,
              tooltip: rowTooltip(row.label, reading.state, reading.count, row.unit)
            };
          })
        }));

  const stateCopy =
    snapshot.phase === 'running'
      ? { title: CARD_LOADING_TITLE, hint: '' }
      : snapshot.phase === 'failed'
        ? { title: CARD_ERROR_TITLE, hint: CARD_ERROR_HINT }
        : null;

  return {
    phase: snapshot.phase,
    identity: identityText(snapshot),
    cacheChip: cacheChip(snapshot),
    groups,
    stateCopy,
    footer,
    cacheTooltip: cacheTooltip(snapshot)
  };
}

/** The pill's accessible-name stem (the visible text follows it in order). */
export const PILL_LABEL_STEM = 'WP Rocket page analysis: ';

/** The widget's shadow-root host element name (D-6). */
export const INSPECTOR_UI_NAME = 'wpr-fdt-inspector';

/** The report card's in-shadow-root element id (the pill's aria-controls). */
export const INSPECTOR_CARD_ID = `${INSPECTOR_UI_NAME}-card`;

/** The card's accessible name. */
export const CARD_ARIA_LABEL = 'WP Rocket page analysis';
