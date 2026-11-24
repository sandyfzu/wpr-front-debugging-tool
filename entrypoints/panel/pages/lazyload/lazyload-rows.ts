/**
 * Pure presentation rules for the Lazyload page: the state chips and their
 * sources, the row views (name, URL preview, chips — built once per row,
 * never in the renderer) and the content key a row keeps across refreshes,
 * the detail's facts and the exclusion-reason split (the tool's own
 * exclusion marker is a chip, apart from the page's reasons), and the
 * summary notes.
 */
import { LAZYLOAD_IMAGE_STATES, type LazyloadStateId } from '../../../../lib/panel/lazyload-states';
import { liftFacets, type FacetSet } from '../../../../lib/panel/resource-facets';
import {
  LAZYLOAD_PAGE_FACETS,
  lazyloadImageSearchField,
  type LazyloadFacetId,
  type LazyloadImageResource
} from '../../../../lib/panel/resources-view-model';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import type { SimulationFact, WprDetections } from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import { simulationModifierCopy } from '../../../../lib/detection/hud';
import type { DetailFact } from '../resource-list/detail-section';
import { listCapped, resourceName, urlPreview } from '../resource-list/resource-list-view';
import {
  CALM_VISIBLE_STATE_CHIPS,
  UNVERIFIED_SIMULATION_SUFFIX,
  simulatableSource,
  splitStateChips,
  type StateChip,
  type StateChipSplit
} from '../resource-list/state-chips';
import type { StateSource } from '../resource-list/state-sources';

/**
 * The sources an image row's chips can show (the page's legend): WP Rocket,
 * its simulation, or the page's own lazy markup for Lazy loaded; the FDT for
 * Excluded.
 */
export const LAZYLOAD_CHIP_SOURCES = [
  'wp-rocket',
  'simulated',
  'excluded',
  'page'
] as const satisfies readonly StateSource[];

/** The page facts that decide who produced a Lazy loaded state. */
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

/** Title of a Lazy loaded chip whose lazy markup no detected runtime vouches for. */
export const PAGE_LAZY_MARKUP_TITLE = "Lazy markup on the page (WP Rocket's LazyLoad not detected)";

/**
 * Who produced a Lazy loaded state. The lazy attribute alone proves nothing
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
  return simulatableSource(facts.simulation, 'Lazy loaded', getRealOptionName('lazyload'));
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
 * The state chips of one image row, in the shared state table's order; Not
 * lazyloaded is no chip (its facet value keeps it).
 *
 * @param row The image row.
 * @param table The fact set's chips.
 * @returns Every chip the row shows (the detail lists them all).
 */
export function lazyloadStateChips(
  row: LazyloadImageResource,
  table: LazyloadChipTable
): StateChip[] {
  return LAZYLOAD_IMAGE_STATES.filter((state) => state.holds(row)).map((state) => table[state.id]);
}

/** One rendered row: the classified image plus what its renderer reads, built once. */
export interface LazyloadRowView {
  /** The classified image (its `id` is its capture position at build time only). */
  readonly row: LazyloadImageResource;
  /** The content key: the same image keeps it across refreshes (see {@link lazyloadRowKeys}). */
  readonly key: string;
  /** The row's name: the image's file name, or {@link NO_IMAGE_URL_NAME}. */
  readonly name: string;
  /** The URL without its scheme (undefined without a URL). */
  readonly preview: string | undefined;
  /** The capture cut the URL at its length cap. */
  readonly clipped: boolean;
  /** Every state chip (the detail lists them all). */
  readonly chips: readonly StateChip[];
  /** The row's chips: at most two, then "+N". */
  readonly rowChips: StateChipSplit;
}

/** An image whose capture holds no URL (its row name). */
export const NO_IMAGE_URL_NAME = 'No URL captured';

/** Separates a key's fields (never part of a captured URL's text). */
const KEY_FIELD = '\u0001';

/**
 * The content key of every row: the image's URL plus its occurrence among
 * images with the same URL — never its position, so an image added above
 * shifts nothing (the selection and the open detail follow the image).
 *
 * @param rows The classified images, in list order.
 * @returns One unique key per row, same order.
 */
export function lazyloadRowKeys(rows: readonly LazyloadImageResource[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const occurrence = seen.get(row.src) ?? 0;
    seen.set(row.src, occurrence + 1);
    return `${row.src}${KEY_FIELD}${String(occurrence)}`;
  });
}

/**
 * Build the row views (keys, names, previews and chips once per row).
 *
 * @param rows The classified images, in list order.
 * @param table The fact set's chips.
 * @param clipped Whether the capture cut a given URL at its length cap.
 * @returns One view per row, same order.
 */
export function lazyloadRowViews(
  rows: readonly LazyloadImageResource[],
  table: LazyloadChipTable,
  clipped: (src: string) => boolean
): LazyloadRowView[] {
  const keys = lazyloadRowKeys(rows);
  return rows.map((row, index) => {
    const chips = lazyloadStateChips(row, table);
    return {
      row,
      key: keys[index] ?? '',
      name: resourceName(row.src) || NO_IMAGE_URL_NAME,
      preview: row.src === '' ? undefined : urlPreview(row.src),
      clipped: clipped(row.src),
      chips,
      rowChips: splitStateChips(chips, CALM_VISIBLE_STATE_CHIPS)
    };
  });
}

/** The page's facets over row views (the row facets, lifted). */
export const LAZYLOAD_VIEW_FACETS: FacetSet<LazyloadRowView, LazyloadFacetId> = liftFacets(
  LAZYLOAD_PAGE_FACETS,
  (view: LazyloadRowView) => view.row
);

/**
 * A view's searched field: the image URL.
 *
 * @param view The row view.
 */
export function lazyloadSearchField(view: LazyloadRowView): string {
  return lazyloadImageSearchField(view.row);
}

/** The detail's caps kind label. */
export const IMAGE_KIND = 'Image';

/**
 * The facts the detail lists for an image (what the capture records).
 *
 * @param row The image row.
 * @returns The facts, in reading order.
 */
export function lazyloadFacts(row: LazyloadImageResource): DetailFact[] {
  return [{ label: 'Lazy loaded', value: row.lazyloaded ? 'Yes' : 'No', mono: false }];
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
 * What the detail's reasons section shows for an image:
 * - `reasons` — the page's own reasons it escapes lazyload;
 * - `none-found` — skipped while lazyload runs, with no reason found;
 * - `off` — not lazyloaded, but lazyload does not run on the page: no
 *   exclusion applies (said, so the missing section never reads as "none");
 * - `hidden` — nothing to say: a lazyloaded image, or one whose only reason
 *   is the tool's marker (its Excluded chip says it; "No reasons found"
 *   would contradict it).
 */
export type LazyloadReasonsView =
  | { readonly kind: 'reasons'; readonly reasons: readonly string[] }
  | { readonly kind: 'none-found' | 'off' | 'hidden' };

/**
 * Decide the detail's reasons section: exclusion evidence is meaningful
 * only while lazyload runs on the page, for an image it skipped.
 *
 * @param row The image row.
 * @param running Whether image lazyload runs on the page (WP Rocket's or a verified simulation's).
 * @returns The section's view.
 */
export function lazyloadReasonsView(
  row: LazyloadImageResource,
  running: boolean
): LazyloadReasonsView {
  if (row.lazyloaded) return { kind: 'hidden' };
  if (!running) return { kind: 'off' };
  const split = exclusionReasons(row);
  if (split.reasons.length > 0) return { kind: 'reasons', reasons: split.reasons };
  return { kind: split.excludedByTool ? 'hidden' : 'none-found' };
}

/**
 * Whether two classified images carry the same data (position ignored):
 * URL, state and reasons in order.
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
 * Whether two views of one key show the same thing: the same image data,
 * the clip mark and chips that read the same — so a changed fact set
 * re-renders only the rows whose chips it changed (the rest keep their
 * element and focus). The name and preview derive from the URL.
 *
 * @param a The previous view.
 * @param b The fresh view.
 */
export function sameImageRowView(a: LazyloadRowView, b: LazyloadRowView): boolean {
  return (
    sameImageRow(a.row, b.row) &&
    a.clipped === b.clipped &&
    a.chips.length === b.chips.length &&
    a.chips.every((chip, index) => sameChip(chip, b.chips[index]))
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
