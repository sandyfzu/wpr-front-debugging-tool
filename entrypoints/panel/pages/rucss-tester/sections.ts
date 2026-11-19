/**
 * Which settings sections are open, for the panel's lifetime (it survives
 * the tab switch, leaving the route and a data refresh). A section reads the
 * user's own choice first, then the defaults seeded once from the loaded
 * settings, then closed (the request: open) — so typing never folds a
 * section, and a recovery that opens one before the defaults land is kept.
 */
import { createSignal } from 'solid-js';
import type { RucssSettingsSection } from '../../../../lib/rucss-tester/settings-summary';

/** Open per section. */
type OpenMap = Readonly<Partial<Record<RucssSettingsSection, boolean>>>;

/** The sections' open state. */
export interface RucssSectionsState {
  /** Whether a section shows its fields (reactive). */
  readonly isOpen: (section: RucssSettingsSection) => boolean;
  /** The user's (or a recovery's) choice for a section; it wins from then on. */
  readonly setOpen: (section: RucssSettingsSection, open: boolean) => void;
  /** Set the defaults; only the first call counts (later loads never fold a section). */
  readonly seed: (defaults: Readonly<Record<RucssSettingsSection, boolean>>) => void;
}

/**
 * Create the state (call inside a reactive root that outlives the page body).
 *
 * @returns The state.
 */
export function createRucssSectionsState(): RucssSectionsState {
  const [chosen, setChosen] = createSignal<OpenMap>({});
  const [defaults, setDefaults] = createSignal<OpenMap | null>(null);
  return {
    isOpen: (section) => chosen()[section] ?? defaults()?.[section] ?? section === 'request',
    setOpen: (section, open) => {
      setChosen((current) => ({ ...current, [section]: open }));
    },
    seed: (next) => {
      if (defaults() === null) setDefaults(next);
    }
  };
}
