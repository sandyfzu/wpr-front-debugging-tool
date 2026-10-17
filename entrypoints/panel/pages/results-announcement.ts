/**
 * The result-count line shared by the panel's filter/list pages (the
 * JavaScript, Lazyload and Preloaded Resources bodies): one text rule and one
 * announce lifecycle for all of them.
 *
 * The text is always the current count ("Showing all 5 images", "Showing 1 of
 * 6 scripts", "No images match", nothing on an empty page), so a screen
 * reader reading the region later never hears a stale number. A data refresh
 * keeps the text true but flips the region to `aria-live="off"` for that
 * update — the refreshed count is never spoken unprompted; a committed
 * filter/query change (the user's action) announces again.
 */
import { createComputed, createMemo, createSignal, on, type Accessor } from 'solid-js';
import type { CountNoun } from '../../../lib/panel/list-behavior';
import { resultsAnnouncement } from '../../../lib/panel/list-behavior';

/** The announcement's two states. */
export interface ResultsAnnouncement {
  /** The always-truthful count sentence (visually hidden; empty on an empty page). */
  readonly text: Accessor<string>;
  /** The live announcement switch the region renders — 'off' while a refresh moves the rows. */
  readonly live: Accessor<'polite' | 'off'>;
}

/** Inputs of {@link createResultsAnnouncement}. */
export interface ResultsAnnouncementSource {
  /** Every row the page owns; a soft refresh swaps the list object (no-op keeps identity). */
  readonly rows: Accessor<readonly unknown[]>;
  /** The rows rendered after chip + query. */
  readonly visible: Accessor<readonly unknown[]>;
  /** The rows' noun. */
  readonly noun: CountNoun;
  /** The committed user-action inputs (chip id, query): a change to any announces. */
  readonly actions: readonly Accessor<unknown>[];
}

/**
 * Create the shared results announcement. Must run inside a Solid owner (a
 * component). One combined `on` effect watches the rows source and the action
 * sources together and decides the quiet switch per flush, so the rule holds
 * whatever the write or declaration order: any action-source change announces,
 * even when a refresh lands in the same flush; only a refresh-only flush mutes
 * the region for its own update. The decision compares element-wise against
 * the previous flush's input, seeded at creation — Solid's `on` defers its
 * first run, so on the first real change it carries no previous input of its
 * own. An identity-stable refresh (the rows memo returning the previous array)
 * or an unchanged action source never wakes the computed at all, so a
 * differing-value write that re-equals upstream never unmutes — or re-mutes
 * — by accident. The `setQuiet` write settles during the same flush as the
 * `text` memo below, so the `aria-live` attribute never renders stale next to
 * fresh text.
 *
 * @param source The page's rows, visible rows, noun and user-action inputs.
 * @returns The text and live switch to render in one `role="status"` region.
 */
export function createResultsAnnouncement(source: ResultsAnnouncementSource): ResultsAnnouncement {
  const [quiet, setQuiet] = createSignal(false);
  // Solid's `on` defers its first run, so the first real flush finds no
  // previous input to compare against: seed the baseline at creation (the
  // deferred run then tracks these same values unchanged).
  let prevInput = [source.rows(), ...source.actions.map((action) => action())];
  createComputed(
    on(
      [source.rows, ...source.actions],
      (input) => {
        // Deterministic per-flush rule, write order irrelevant: an
        // action-source change (indexes > 0 — index 0 is the rows source)
        // announces even when the rows changed in the same flush; only a
        // refresh-only flush mutes.
        setQuiet(!input.some((value, index) => index > 0 && value !== prevInput[index]));
        prevInput = input;
      },
      { defer: true }
    )
  );
  const text = createMemo(() =>
    resultsAnnouncement(source.visible().length, source.rows().length, source.noun)
  );
  const live = createMemo(() => (quiet() ? 'off' : 'polite'));
  return { text, live };
}
