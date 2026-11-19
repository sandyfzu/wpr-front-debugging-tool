/**
 * Which settings sections of a tool page are open, for the panel's lifetime
 * (it survives a tab switch, leaving the route and a data refresh). A
 * section reads the user's own choice first, then the defaults seeded once
 * from the loaded settings, then the page's built-in rule — so typing never
 * folds a section, and a recovery that opens one before the defaults land
 * is kept.
 */
import { createSignal } from 'solid-js';

/** The sections' open state. */
export interface SectionsState<Section extends string> {
  /** Whether a section shows its fields (reactive). */
  readonly isOpen: (section: Section) => boolean;
  /** The user's (or a recovery's) choice for a section; it wins from then on. */
  readonly setOpen: (section: Section, open: boolean) => void;
  /** Set the defaults; only the first call counts (later loads never fold a section). */
  readonly seed: (defaults: Readonly<Record<Section, boolean>>) => void;
}

/**
 * Create the state (call inside a reactive root that outlives the page body).
 *
 * @param openBeforeSeed Whether a section is open before the defaults are
 *   seeded (the settings still loading): the page's always-useful sections.
 * @returns The state.
 */
export function createSectionsState<Section extends string>(
  openBeforeSeed: (section: Section) => boolean
): SectionsState<Section> {
  const [chosen, setChosen] = createSignal<ReadonlyMap<Section, boolean>>(new Map());
  const [defaults, setDefaults] = createSignal<ReadonlyMap<Section, boolean> | null>(null);
  return {
    isOpen: (section) =>
      chosen().get(section) ?? defaults()?.get(section) ?? openBeforeSeed(section),
    setOpen: (section, open) => {
      setChosen((current) => new Map(current).set(section, open));
    },
    seed: (next) => {
      if (defaults() !== null) return;
      // The record's own keys are exactly the sections.
      setDefaults(new Map(Object.entries(next) as [Section, boolean][]));
    }
  };
}
