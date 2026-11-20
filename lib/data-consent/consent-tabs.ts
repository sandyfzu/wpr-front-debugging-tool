/**
 * The consent tabs the background showed, one per tool at most: a second
 * ask for the same tool goes to the tab already showing (never a second
 * one), and a tab that leaves the consent page unanswered — closed, or
 * navigated away — tells the waiting tool (it then shows "not allowed"
 * instead of waiting on a tab that is gone). Pure bookkeeping: the
 * background feeds it tab events.
 */
import type { DataConsentFeature } from './consent';

/**
 * Where a consent page shows: `own-tab` — a tab the background opened for
 * it (reused by the tool's next ask); `asking-tab` — the asking page's own
 * tab (the analysis page's Allow…), never handed to another ask: that
 * would reload the user's page with someone else's flow.
 */
export type ConsentTabPlace = 'own-tab' | 'asking-tab';

/** One shown consent tab. */
export interface ConsentTabEntry {
  readonly tabId: number;
  /** The user answered on it (a decline keeps the tab: it offers Ask again). */
  readonly answered: boolean;
}

/** The registry. */
export interface ConsentTabs {
  /** The tool's own consent tab (`own-tab`) a new ask may reuse, or null. */
  entryFor(feature: DataConsentFeature): ConsentTabEntry | null;
  /**
   * A tab (re)loaded a tool's consent page: tracked, unanswered. An
   * `own-tab` one is the tool's one reusable tab (it replaces an older one).
   */
  shown(feature: DataConsentFeature, tabId: number, place: ConsentTabPlace): void;
  /**
   * The user answered on a tab. A grant forgets it (the page leaves: it
   * closes or goes on to the analysis); a decline only marks it.
   */
  answered(tabId: number, granted: boolean): void;
  /**
   * A tab no longer shows the consent page (closed or navigated away).
   *
   * @returns The tool to tell "not allowed" when the tab left unanswered, or null.
   */
  left(tabId: number): DataConsentFeature | null;
}

/** A tracked tab. */
interface TrackedTab {
  readonly feature: DataConsentFeature;
  readonly place: ConsentTabPlace;
  readonly answered: boolean;
}

/** Create an empty registry. */
export function createConsentTabs(): ConsentTabs {
  // Keyed by tab: a tab shows one tool's page at a time.
  const tabs = new Map<number, TrackedTab>();

  /**
   * The tool's reusable tab.
   *
   * @param feature The tool.
   * @returns Its tab id and record, or null.
   */
  const ownTabOf = (feature: DataConsentFeature): [number, TrackedTab] | null => {
    for (const entry of tabs) {
      if (entry[1].feature === feature && entry[1].place === 'own-tab') return entry;
    }
    return null;
  };

  return {
    entryFor: (feature) => {
      const own = ownTabOf(feature);
      return own === null ? null : { tabId: own[0], answered: own[1].answered };
    },
    shown: (feature, tabId, place) => {
      const older = place === 'own-tab' ? ownTabOf(feature) : null;
      if (older !== null) tabs.delete(older[0]);
      tabs.set(tabId, { feature, place, answered: false });
    },
    answered: (tabId, granted) => {
      const tab = tabs.get(tabId);
      if (tab === undefined) return;
      if (granted) tabs.delete(tabId);
      else tabs.set(tabId, { ...tab, answered: true });
    },
    left: (tabId) => {
      const tab = tabs.get(tabId);
      if (tab === undefined) return null;
      tabs.delete(tabId);
      return tab.answered ? null : tab.feature;
    }
  };
}
