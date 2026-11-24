/**
 * The Lazyload page's image states — the one declaring site of what each
 * state means, read by both the row chips and the facet values (a value
 * selects exactly the rows that show its chip).
 *
 * Row facts only, from the lazyload scan: WP Rocket's lazy attribute on the
 * image, and the local exclusion marker among its exclusion reasons. Who
 * produced a Lazy loaded state (WP Rocket or a verified FDT simulation) is a
 * page fact the view layer reads; it never decides whether the state holds.
 */
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import type { LazyloadImageResource } from './resources-view-model';

/**
 * Whether the local exclusion marker kept the image out of lazyload: the
 * image carries it and is not lazyloaded. On an `<img>` only the Exclusion
 * Builder's image-lazyload restore writes the marker (its other features
 * stamp scripts and lazy-render containers), so it reads as that exclusion.
 *
 * @param row The classified image.
 */
export function isFdtExcludedImage(row: LazyloadImageResource): boolean {
  return !row.lazyloaded && row.excludedReasons.includes(FDT_EXCLUDED_RESOURCE);
}

/** The positive image states, most important first (the chips' order). */
export type LazyloadStateId = 'excluded' | 'lazyloaded';

/** One image state: its id, its one-word label and the rows it holds on. */
export interface LazyloadImageState {
  readonly id: LazyloadStateId;
  readonly label: string;
  readonly holds: (row: LazyloadImageResource) => boolean;
}

/**
 * Every positive state, most important first: the deliberate local
 * exclusion leads, as on the JavaScript page. Not lazy loaded is no state (no
 * chip); its facet value (Not lazy loaded) negates Lazy loaded.
 */
export const LAZYLOAD_IMAGE_STATES: readonly LazyloadImageState[] = [
  { id: 'excluded', label: 'Excluded', holds: isFdtExcludedImage },
  { id: 'lazyloaded', label: 'Lazy loaded', holds: (row) => row.lazyloaded }
];

/**
 * One state's row.
 *
 * @param id The state id.
 * @returns The state's table row.
 * @throws {@link Error} When the table has no such id — a wiring bug.
 */
export function lazyloadImageState(id: LazyloadStateId): LazyloadImageState {
  const state = LAZYLOAD_IMAGE_STATES.find((row) => row.id === id);
  if (state === undefined) throw new Error(`Unknown image state id: "${id}".`);
  return state;
}
