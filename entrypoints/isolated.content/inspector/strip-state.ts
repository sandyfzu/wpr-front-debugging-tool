/**
 * The detection widget's presentation state: one typed mind for what the
 * widget shows, pure over the hub's single-pass data so no render path can
 * contradict it.
 *
 * - `insMood` maps the pass's outcome to the chrome's mood (`ins-*` classes):
 *   green = present + cached, amber = present + uncached, gray = presence
 *   not established, pulse = the pass is still running, red = the pass
 *   failed.
 * - The D-2 mapping folds the HUD verdict (the report's state, plus the
 *   honest `unknown`) into the chip vocabulary; red is reserved for real
 *   failures, so a feature the plugin had not yet applied reads neutral,
 *   never erroring.
 * - Rows come from the HUD registry (`lib/detection/hud`): the chip shows the
 *   plugin's compact wording, the tooltip the full name, state, evidence
 *   source and why — the same names and readings the panel cards and the
 *   support report carry.
 * - The Exclusion Builder's facts (the marker its rewrite left in the
 *   displayed document) ride in-band: a per-row modifier and the tab-level
 *   "rewrote this page" line, from the panel's shared copy and its one
 *   "off in this tab" rule — gone once a reload serves an unmarked page.
 *   A simulation fact rides the same way (its own row modifier; a verified
 *   one also joins the tab-level line and leads the pill's glyph).
 * - A RUCSS test applied on the page rides beside them: its own tab-level
 *   line and pill glyph (next to the builder's when both apply), gone with
 *   the reload that restores the page's styles.
 * - The card model (identity, cache chip, grouped rows, footer) is one pure
 *   builder the view renders verbatim; every unsure state explains itself in
 *   its tooltip copy and no chip claims more certainty than the scan has.
 */

import type { PageAnalysisReport } from '../../../lib/detection/describe';
import { describeDetections } from '../../../lib/detection/describe';
import {
  BYPASS_APPLIED_COPY,
  isAppliedDespiteBypass,
  isBypassRender
} from '../../../lib/detection/bypass-applied';
import { cacheCopy } from '../../../lib/detection/cache-context';
import type { CacheState } from '../../../lib/detection/cache-context';
import {
  builderBadgeKind,
  builderModifierCopy,
  builderPageKind,
  simulationModifierCopy,
  builderTabLine,
  builderTurnsOff,
  hudGroupedFeatures,
  hudStateLine,
  readHudFeature,
  SOURCE_COPY,
  type BuilderTabLine,
  type HudFeature,
  type HudGroupId,
  type HudReading,
  type HudVerdict,
  type PageChangeKind
} from '../../../lib/detection/hud';
import type { BuilderFact, SimulationFact } from '../../../lib/wp-rocket/types';
import { RUCSS_TEST_MODE_LINE } from '../../../lib/rucss-tester/test-mode';
import { countNoun } from '../../../utils/format-count';
import type { FeatureMetaRow, WprDetections } from '../../../lib/wp-rocket/types';
import type { PageDataSnapshot } from '../data-hub';
import { GROUP_ICONS, type StripIconGlyph, type StripModifierKind } from './icons';

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
  /** The hub's explicit cache answer (null while running/failed). */
  cacheState: CacheState | null;
  /**
   * The page is a bypass render ({@link isBypassRender}; absent: it is not,
   * or no answer yet). Apart from `cacheState`, whose stamp and signature
   * arms hide the bypass request.
   */
  bypassRender?: boolean;
}

/**
 * The ready snapshot of one hub read: the pass's rows and cache answer, plus
 * the bypass-render fact composed from the read's URL attestation and the
 * page's generator meta.
 *
 * @param read The hub's same-context answer.
 * @returns The snapshot the card model renders.
 */
export function readySnapshot(read: PageDataSnapshot): StripDataSnapshot {
  return {
    phase: 'ready',
    detections: read.data.detections,
    cacheState: read.cacheState,
    bypassRender: isBypassRender(read.bypassAttested, read.data.wprGeneratorMeta)
  };
}

/**
 * The chip state vocabulary the card renders (the shared status pairs;
 * `info` would appear with tools).
 */
export type StripChipState = 'ok' | 'warn' | 'attention' | 'error' | 'neutral';

/** The cache chip: one of the five explicit cache states. */
export interface StripCacheChip {
  state: StripChipState;
  /** The chip's short label (`✓ Cached` · `Cache not proven` · `Possibly cached` · `Cache not detected` · `Bypass requested` · `…` · `—`). */
  text: string;
  /** The cache stamp suffix when a served stamp formatted. */
  stamp: string | null;
}

/** One card row rendered verbatim by the view. */
export interface StripCardRow {
  /** The feature's detection row (stable identity, never rendered). */
  id: FeatureMetaRow;
  /** The plugin's compact wording (chip text; the full name heads the tooltip). */
  label: string;
  /** The chip's state, folded from the report's evidence state. */
  chipState: StripChipState;
  /** The evidence count, rendered when the engine measures one. */
  count: number | null;
  /** The count's unit word (rendered after the count). */
  unit: string | null;
  /** The row's full name + state line + evidence source (the chip's title tooltip). */
  tooltip: string;
  /** The Exclusion Builder's modifier on this feature in this tab, or null. */
  modifier: StripRowModifier | null;
  /** The simulation modifier (simulated, or marker not verified), or null. */
  simulation: StripRowModifier | null;
  /** The "applied despite ?nowprocket" warning, or null. */
  bypass: StripRowModifier | null;
}

/**
 * One row's in-tab modifier (Exclusion Builder or simulation): the badge
 * (icon kind + short text, the at-a-glance cue) and the full sentence the
 * row shows as visible text — the panel card's words, from the one shared copy.
 */
export interface StripRowModifier {
  kind: StripModifierKind;
  chip: string;
  sentence: string;
}

/** One rendered group heading + its rows. */
export interface StripCardGroup {
  id: HudGroupId;
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
  /**
   * The tab-level "Exclusion Builder rewrote this page" line (ready phase
   * only), or null when the displayed document states no builder fact.
   */
  builderLine: BuilderTabLine | null;
  /**
   * The closed pill's glyph kind ({@link builderPageKind}): present
   * exactly when {@link StripCardModel.builderLine} is, null otherwise.
   */
  builderPill: PageChangeKind | null;
  /**
   * The tab-level "RUCSS test applied" line while a test's CSS is on the
   * page (any phase: the test is the page's live state, not the pass's),
   * null otherwise. Its pill glyph shows exactly when this line does.
   */
  rucssTestLine: string | null;
  /** The body's state copy while the pass is pending or failed. */
  stateCopy: { title: string; hint: string } | null;
  /** The footer stamp (`WPR x · WP y · FDT z`). */
  footer: string;
  /** The full-stamp tooltip copy for the cache chip (title attribute). */
  cacheTooltip: string | null;
}

/** The cache chip's phase placeholders (the state labels live in `cache-context`). */
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
  const { present } = snapshot.detections.wpr;
  if (!present) return 'gray';
  return snapshot.cacheState?.kind === 'cached' ? 'green' : 'amber';
}

/**
 * The D-2 matrix: the HUD verdicts fold into chip states. `collecting`
 * (enabled, not yet applied) and `unknown` (undecided, absence unprovable)
 * are the attention pair — the amber "present but unsure" reading. Both
 * neutral states (not applied / not enabled) stay neutral: a page served
 * before the plugin's work, or a feature with a withheld context, is not an
 * error.
 *
 * @param verdict The verdict one HUD reading composed.
 */
export function chipStateForFeature(verdict: HudVerdict): StripChipState {
  switch (verdict) {
    case 'applied':
      return 'ok';
    case 'collecting':
    case 'unknown':
      return 'attention';
    case 'not enabled':
    case 'not applied':
      return 'neutral';
  }
}

/**
 * The row's tooltip: the full name, the honest state line (the unsure
 * verdicts explain themselves — what was looked for) and the evidence class
 * that decided it, when one did.
 *
 * @param feature The HUD row.
 * @param reading The row's reading.
 */
function rowTooltip(feature: HudFeature, reading: HudReading): string {
  const line = `${feature.label} — ${hudStateLine(feature, reading)}`;
  return reading.source === null ? line : `${line} ${SOURCE_COPY[reading.source].tooltip}`;
}

/**
 * A row's Exclusion Builder modifier from the shared copy (the panel card's
 * badge words and sentence).
 *
 * @param feature The HUD row.
 * @param fact The fact the displayed document's builder marker states.
 */
export function stripRowModifier(feature: HudFeature, fact: BuilderFact): StripRowModifier {
  const copy = builderModifierCopy(feature, fact);
  return { kind: builderBadgeKind(fact), chip: copy.chip, sentence: copy.sentence };
}

/**
 * A row's simulation modifier from the shared copy (the panel card's
 * simulation badge words and sentence).
 *
 * @param fact The row's simulation fact.
 */
export function stripSimulationModifier(fact: SimulationFact): StripRowModifier {
  const copy = simulationModifierCopy(fact);
  return { kind: fact, chip: copy.chip, sentence: copy.sentence };
}

/** The bypass warning as a row modifier (the panel card's warning words and sentence). */
export const STRIP_BYPASS_MODIFIER: StripRowModifier = {
  kind: 'bypass-applied',
  chip: BYPASS_APPLIED_COPY.chip,
  sentence: BYPASS_APPLIED_COPY.sentence
};

/**
 * One card row from a feature's reading. The chip keeps the served verdict
 * (the builder fact is a modifier on top, never a verdict flip); a feature
 * the builder turned off in this tab drops its count, which measures the
 * rewritten page ("0 scripts") and would contradict the served chip — the
 * modifier replaces it, as in the state line.
 *
 * @param feature The HUD row.
 * @param reading The row's reading.
 * @param bypassApplied The row earns the bypass warning ({@link isAppliedDespiteBypass}).
 */
export function stripRow(
  feature: HudFeature,
  reading: HudReading,
  bypassApplied = false
): StripCardRow {
  const count = builderTurnsOff(reading.builder) ? null : reading.count;
  return {
    id: feature.row,
    label: feature.shortLabel,
    chipState: chipStateForFeature(reading.verdict),
    count,
    // The noun form for this count (singular for one).
    unit: feature.unit === null || count === null ? null : countNoun(count, feature.unit),
    tooltip: rowTooltip(feature, reading),
    modifier: reading.builder === undefined ? null : stripRowModifier(feature, reading.builder),
    simulation:
      reading.simulation === undefined ? null : stripSimulationModifier(reading.simulation),
    bypass: bypassApplied ? STRIP_BYPASS_MODIFIER : null
  };
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
  if (snapshot.phase === 'failed' || snapshot.detections === null || snapshot.cacheState === null) {
    return { state: 'neutral', text: CACHE_CHIP_IDLE_TEXT, stamp: null };
  }
  if (!snapshot.detections.wpr.present) {
    return { state: 'neutral', text: CACHE_CHIP_IDLE_TEXT, stamp: null };
  }
  const copy = cacheCopy(snapshot.cacheState);
  // Neutral for both no-verdict arms: a bypass request is the visit's own
  // intent, not evidence of a problem (warn is for conflicting evidence:
  // signature without stamp, host marker without signature).
  const state: StripChipState =
    snapshot.cacheState.kind === 'cached'
      ? 'ok'
      : snapshot.cacheState.kind === 'not-detected' ||
          snapshot.cacheState.kind === 'bypass-requested'
        ? 'neutral'
        : 'warn';
  return {
    state,
    text: copy.chip,
    stamp: snapshot.cacheState.kind === 'cached' ? snapshot.cacheState.formatted : null
  };
}

/**
 * The cache chip's tooltip: the one line that explains the chip's state.
 *
 * @param snapshot The hub read to render.
 */
function cacheTooltip(snapshot: StripDataSnapshot): string | null {
  if (snapshot.phase === 'running') return 'The page scan has not answered yet.';
  if (snapshot.phase === 'failed') return 'The page scan failed — no cache verdict.';
  if (snapshot.detections === null) return 'No page answer yet.';
  if (snapshot.cacheState === null) return 'No page answer yet.';
  if (!snapshot.detections.wpr.present) return 'WP Rocket did not handle this page.';
  return cacheCopy(snapshot.cacheState).tooltip;
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
 *   HUD registry's grouping), state copy (pending/failed) and footer stamp.
 */
export function buildStripCardModel(input: {
  snapshot: StripDataSnapshot;
  wordpressVersion: string | null;
  fdtVersion: string;
  /** RUCSS tests applied on this page (absent: none). */
  rucssTestRuns?: number;
}): StripCardModel {
  const { snapshot, wordpressVersion, fdtVersion } = input;

  const wprVersion = snapshot.detections?.wpr.version ?? null;
  const footer = footerStamp(wprVersion, wordpressVersion, fdtVersion);

  // The report is built exactly once per model (the pass's own view model)
  // and handed to the registry's row readers.
  const report: PageAnalysisReport | null =
    snapshot.phase === 'ready' && snapshot.detections !== null
      ? describeDetections(snapshot.detections, snapshot.cacheState ?? undefined)
      : null;

  const detections = snapshot.detections;
  const bypassRender = snapshot.bypassRender === true;
  const groups =
    report === null || detections === null
      ? []
      : hudGroupedFeatures().map((group) => ({
          id: group.id,
          heading: group.heading,
          icon: GROUP_ICONS[group.id],
          rows: group.features.map((feature) =>
            stripRow(
              feature,
              readHudFeature(feature, report, detections),
              isAppliedDespiteBypass(detections[feature.row], bypassRender)
            )
          )
        }));

  // The builder line and the pill hint read the same in-band facts, only
  // over a ready answer (a pending or failed pass states nothing).
  const rewritten = report !== null && detections !== null;

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
    builderLine: rewritten ? builderTabLine(detections) : null,
    builderPill: rewritten ? builderPageKind(detections) : null,
    rucssTestLine: (input.rucssTestRuns ?? 0) > 0 ? RUCSS_TEST_MODE_LINE : null,
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

/**
 * The tab-level builder line's in-shadow-root element id: the card dialog's
 * description, so opening the card (pointer or keyboard) announces it.
 */
export const INSPECTOR_BUILDER_LINE_ID = `${INSPECTOR_UI_NAME}-builder`;

/** The tab-level RUCSS test line's element id (also part of the card dialog's description). */
export const INSPECTOR_RUCSS_LINE_ID = `${INSPECTOR_UI_NAME}-rucss`;

/** The card's accessible name. */
export const CARD_ARIA_LABEL = 'WP Rocket page analysis';
