/**
 * Pure presentation rules for the Lazyload page: the state chips and their
 * sources, the exclusion-reason split (the tool's own exclusion marker is a
 * chip, apart from the page's reasons), row identity across refreshes, the
 * summary notes and the row's seed height.
 */
import { LAZYLOAD_IMAGE_STATES, type LazyloadStateId } from '../../../../lib/panel/lazyload-states';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import type { SimulationFact, WprDetections } from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import { simulationModifierCopy } from '../../../../lib/detection/hud';
import { listCapped } from '../resource-list/resource-list-view';
import {
  UNVERIFIED_SIMULATION_SUFFIX,
  simulatableSource,
  splitStateChips,
  type StateChip,
  type StateChipSplit
} from '../resource-list/state-chips';
import type { StateSource } from '../resource-list/state-sources';

/**
 * The sources an image row's chips can show (the page's legend): WP Rocket,
 * its simulation, or the page's own lazy markup for Lazyloaded; the FDT for
 * Excluded.
 */
export const LAZYLOAD_CHIP_SOURCES = [
  'wp-rocket',
  'simulated',
  'excluded',
  'page'
] as const satisfies readonly StateSource[];

/** The page facts that decide who produced a Lazyloaded state. */
export interface LazyloadChipFacts {
  /** WP Rocket's LazyLoad is detected (its script and its options on the page). */
  readonly present: boolean;
  /** The page's LazyLoad simulation fact (`null`: no marker). */
  readonly simulation: SimulationFact | null;
}

/** No detection loaded: no runtime, no marker. */
export const NO_LAZYLOAD_CHIP_FACTS: LazyloadChipFacts = { present: false, simulation: null };

/**
 * Read the chip facts off the LazyLoad detection row.
 *
 * @param lazyload The detection row, or `null` while no data is mounted.
 */
export function lazyloadChipFacts(lazyload: WprDetections['lazyload'] | null): LazyloadChipFacts {
  if (lazyload === null) return NO_LAZYLOAD_CHIP_FACTS;
  return { present: lazyload.present, simulation: lazyload.simulation ?? null };
}

/**
 * Whether two fact sets agree (an unchanged set keeps every row view).
 *
 * @param a One fact set.
 * @param b The other.
 */
export function sameLazyloadChipFacts(a: LazyloadChipFacts, b: LazyloadChipFacts): boolean {
  return a.present === b.present && a.simulation === b.simulation;
}

/** Title of a Lazyloaded chip whose lazy markup no detected runtime vouches for. */
export const PAGE_LAZY_MARKUP_TITLE = "Lazy markup on the page (WP Rocket's LazyLoad not detected)";

/**
 * Who produced a Lazyloaded state. The lazy attribute alone proves nothing
 * about its author (other lazy-load plugins and themes write it too), so
 * only a detected runtime attributes it: a verified simulation's, else WP
 * Rocket's (flagged under an unverified marker); without one it is the
 * page's own markup.
 *
 * @param facts The page facts.
 */
function lazyloadedDisplay(facts: LazyloadChipFacts): Pick<StateChip, 'source' | 'title'> {
  if (facts.simulation !== 'simulated' && !facts.present) {
    // An unverified marker vouches for nothing, but the hover still says it is there.
    const flag = facts.simulation === 'unverified' ? UNVERIFIED_SIMULATION_SUFFIX : '';
    return { source: 'page', title: `${PAGE_LAZY_MARKUP_TITLE}${flag}` };
  }
  return simulatableSource(facts.simulation, 'Lazyloaded', getRealOptionName('lazyload'));
}

/** Per state: its chip under one fact set (built once per fact set, shared by every row). */
export type LazyloadChipTable = Readonly<Record<LazyloadStateId, StateChip>>;

/**
 * Build every state's chip for a fact set. Excluded is the FDT's whatever
 * the facts (the marker is the Exclusion Builder's own).
 *
 * @param facts The page facts.
 * @returns One chip per state id.
 */
export function lazyloadChipTable(facts: LazyloadChipFacts): LazyloadChipTable {
  const display: Record<LazyloadStateId, Pick<StateChip, 'source' | 'title'>> = {
    excluded: {
      source: 'excluded',
      title: `Excluded by FDT from ${getRealOptionName('lazyload')}`
    },
    lazyloaded: lazyloadedDisplay(facts)
  };
  const table = {} as Record<LazyloadStateId, StateChip>;
  for (const state of LAZYLOAD_IMAGE_STATES) {
    table[state.id] = { id: state.id, label: state.label, ...display[state.id] };
  }
  return table;
}

/**
 * The state chips of one image row, split for rendering: the shared state
 * table's order; Not lazyloaded is no chip (its filter keeps it).
 *
 * @param row The image row.
 * @param table The fact set's chips.
 * @returns The split chips.
 */
export function lazyloadChipSplit(
  row: LazyloadImageResource,
  table: LazyloadChipTable
): StateChipSplit {
  return splitStateChips(
    LAZYLOAD_IMAGE_STATES.filter((state) => state.holds(row)).map((state) => table[state.id])
  );
}

/** One rendered row: the classified image plus its chips, derived once per row view. */
export interface LazyloadRowView extends LazyloadImageResource {
  /** The row's state chips, split for rendering. */
  readonly chips: StateChipSplit;
}

/**
 * Build a row view.
 *
 * @param row The classified image.
 * @param table The fact set's chips.
 */
export function lazyloadRowView(
  row: LazyloadImageResource,
  table: LazyloadChipTable
): LazyloadRowView {
  return { ...row, chips: lazyloadChipSplit(row, table) };
}

/** A non-lazyloaded row's reasons, split for display. */
export interface ExclusionReasons {
  /** The image carries the tool's own exclusion marker. */
  readonly excludedByTool: boolean;
  /** The page's other reasons, in the exclusion list's order. */
  readonly reasons: readonly string[];
}

/**
 * Split a row's exclusion reasons: the tool's own marker is pulled out (the
 * row shows it as its Excluded chip) and the rest keep their order. Every
 * page reason stays visible — the marker never hides them.
 *
 * @param row The image row.
 * @returns The marker flag and the remaining reasons.
 */
export function exclusionReasons(row: LazyloadImageResource): ExclusionReasons {
  return {
    excludedByTool: row.excludedReasons.includes(FDT_EXCLUDED_RESOURCE),
    reasons: row.excludedReasons.filter((reason) => reason !== FDT_EXCLUDED_RESOURCE)
  };
}

/**
 * Whether the row shows its reasons line: exclusion evidence is meaningful
 * only while lazyload runs on the page, for an image it skipped — and not
 * when the tool's marker is the only reason (the Excluded chip says it; "No
 * reasons found" would contradict it).
 *
 * @param row The image row.
 * @param featurePresent Whether image lazyload runs on the page.
 * @returns Whether to render the row's reasons line, including the empty fallback.
 */
export function showLazyloadReasons(row: LazyloadImageResource, featurePresent: boolean): boolean {
  if (!featurePresent || row.lazyloaded) return false;
  const split = exclusionReasons(row);
  return !split.excludedByTool || split.reasons.length > 0;
}

/** Seed height of a row without reasons (name line + URL line), in px. */
export const LAZYLOAD_ROW_ESTIMATE = 55;

/** Seed height of a row with its reasons line, in px (measurement refines wraps). */
export const LAZYLOAD_ROW_WITH_REASONS_ESTIMATE = 79;

/**
 * Seed the virtual list with the same visibility rule as the reasons line.
 *
 * @param row The image row.
 * @param featurePresent Whether image lazyload was detected on the page.
 * @returns The estimate in px.
 */
export function lazyloadRowEstimate(row: LazyloadImageResource, featurePresent: boolean): number {
  return showLazyloadReasons(row, featurePresent)
    ? LAZYLOAD_ROW_WITH_REASONS_ESTIMATE
    : LAZYLOAD_ROW_ESTIMATE;
}

/**
 * Whether two image rows with the same id show the same thing (the refresh
 * reuse test): URL, state and reasons in order.
 *
 * @param a The previous row.
 * @param b The fresh row.
 * @returns `true` when nothing visible differs.
 */
export function sameImageRow(a: LazyloadImageResource, b: LazyloadImageResource): boolean {
  return (
    a.src === b.src &&
    a.lazyloaded === b.lazyloaded &&
    a.excludedReasons.length === b.excludedReasons.length &&
    a.excludedReasons.every((reason, index) => reason === b.excludedReasons[index])
  );
}

/**
 * Whether two chips read the same (words, source and hover text).
 *
 * @param a One chip.
 * @param b The other.
 */
function sameChip(a: StateChip, b: StateChip | undefined): boolean {
  return (
    b !== undefined &&
    a.id === b.id &&
    a.label === b.label &&
    a.source === b.source &&
    a.title === b.title
  );
}

/**
 * Whether two row views show the same thing: the same image data and chips
 * that read the same — so a changed fact set re-renders only the rows whose
 * chips it changed (the rest keep their element and focus).
 *
 * @param a The previous view.
 * @param b The fresh view.
 */
export function sameImageRowView(a: LazyloadRowView, b: LazyloadRowView): boolean {
  return (
    sameImageRow(a, b) &&
    // The "+N" title names every hidden chip with its source.
    (a.chips.overflow?.title ?? null) === (b.chips.overflow?.title ?? null) &&
    a.chips.visible.length === b.chips.visible.length &&
    a.chips.visible.every((chip, index) => sameChip(chip, b.chips.visible[index]))
  );
}

/** The note for lazy markup on a page where WP Rocket's LazyLoad reads not detected. */
export const LAZY_MARKUP_NOTE =
  "Some images carry lazy-load markup, but WP Rocket's LazyLoad was not detected on this page.";

/**
 * The summary strip's caveats:
 * - the capture capped the image list (counts then cover the kept rows only);
 * - a verified simulation runs LazyLoad here: said who did it (the
 *   extension, never the site);
 * - else, images carry lazy markup while WP Rocket's LazyLoad reads not
 *   detected (no script + options, or refuted by the meta) — the badge's "not
 *   detected" would otherwise read as a contradiction; the markup alone names
 *   no author.
 *
 * @param lazyload The payload's lazyload detection.
 * @returns The notes, in display order (often none).
 */
export function lazyloadNotes(lazyload: WprDetections['lazyload']): string[] {
  const notes: string[] = [];
  const cap = PAYLOAD_LIMITS.images.count;
  if (listCapped(lazyload.truncated, lazyload.images.length, cap)) {
    notes.push(
      `The list was capped at the first ${formatCount(cap)} images; counts cover these rows.`
    );
  }
  if (lazyload.simulation === 'simulated') {
    notes.push(simulationModifierCopy('simulated').sentence);
  } else if (!lazyload.present && lazyload.images.some((image) => image.lazyloadDetected)) {
    notes.push(LAZY_MARKUP_NOTE);
  }
  return notes;
}
