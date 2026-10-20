/**
 * The Known Conflicts database's freshness row on the options page: one
 * "last synced" reading over the DB storage's **metadata** (`updatedAt` — the
 * background stamps it after a fully successful fetch; a seeded snapshot has
 * none) and one **Refresh now** control that runs the background's typed
 * refresh request and reports its typed outcome.
 *
 * The background is the only writer of the DB; this row only reads and asks.
 * Its stamp re-renders when storage delivers a change (an hourly or another
 * surface's refresh landing here) and re-ages when the document becomes
 * visible again — no timer, no idle work while hidden (one text line per
 * event, the bar's refreshed-in-place semantics).
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Show } from 'solid-js';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { toast } from '../../components/ui/toast-store';
import { relativeAge } from '../../utils/relative-age';
import { knownConflictsStore, type KnownConflictsMeta } from '../../lib/storage/known-conflicts';
import { sendMessage } from '../../lib/messaging';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import { createLogger } from '../../lib/logger';

const log = createLogger('options');

/** The card's static copy. */
export const KC_CARD_TITLE = 'Known Conflicts database';
export const KC_CARD_DESCRIPTION =
  "The conflict list the tool matches against, synced from WP Rocket's server and checked hourly";
/** The stamp line for the never-stamped reading (a seeded, unstamped snapshot). */
export const KC_NEVER_SYNCED_TEXT = 'Not synced yet — the tool checks hourly.';

/** The outcome toasts' copy, verbatim for the tests. */
export const KC_REFRESH_SUCCESS_TITLE = 'Conflict database refreshed';
export const KC_REFRESH_FAILURE_TITLE = 'Refreshing the conflict database failed';
const KC_REFRESH_NULL_DESCRIPTION = 'The refresh did not complete — try again in a moment.';
const KC_REFRESH_TRANSPORT_DESCRIPTION =
  'The background service did not answer. Reload the page, then try again.';

/** The seams this row reads through (tests inject doubles; the page does not). */
export interface KcFreshnessIO {
  /**
   * The last stamp, validated once: a missing or non-numeric value reads as
   * `undefined` (the never-synced reading), never as a fabricated age.
   */
  readMeta(): Promise<KnownConflictsMeta>;
  /** The stamp's live channel from storage; firing re-reads `readMeta`. */
  watchStamp(onChange: () => void): () => void;
  /** The typed background refresh request (`updateKnownConflictsDb`). */
  refreshNow(): Promise<DbUpdateResult | null>;
  /** The wall clock the relative age reads; injectable for determinism. */
  now(): number;
}

/**
 * The storage-backed seams: the DB item's meta (validated once here — pushed
 * watch values carry the unvalidated shape, so both routes converge on
 * {@link KcFreshnessIO.readMeta}) and the messaging protocol's refresh request.
 */
export function createStorageKcFreshnessIO(): KcFreshnessIO {
  return {
    async readMeta(): Promise<KnownConflictsMeta> {
      const meta = await knownConflictsStore.getMeta();
      // `getMeta`'s fields arrive partially/nullable; the contract's stamp is
      // `number | undefined`, kept intact only when it is a usable number.
      return { updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : undefined };
    },
    watchStamp(onChange) {
      return knownConflictsStore.watchMeta(() => {
        onChange();
      });
    },
    refreshNow: () => sendMessage('updateKnownConflictsDb'),
    now: () => Date.now()
  };
}

export interface KnownConflictsFreshnessProps {
  /** The row's seams (default: storage meta + the messaging request). */
  io?: KcFreshnessIO;
  /** Extra classes on the card, merged last so callers win. */
  class?: string;
}

/**
 * Render the freshness card: the last stamped sync as a relative age (or the
 * never-synced line) plus a keyboard-reachable Refresh now control whose
 * typed outcome lands as a toast and advances the stamp.
 *
 * States (the card's own matrix, all non-dead-ending): reading (skeleton),
 * stamp known, never synced, refresh busy (the control's busy treatment),
 * refresh refused (`null` outcome), refresh transport failure — the last two
 * resolve with an actionable toast and an enabled control.
 *
 * @param props.io The seams (default: the storage/messaging pair).
 * @param props.class Extra classes on the card.
 */
export function KnownConflictsFreshness(props: KnownConflictsFreshnessProps): JSX.Element {
  // The seams resolve once per mounted card (defaults never build at import);
  // stateless factories, so a re-computation is harmless but a copy is honest.
  const io = createMemo(() => props.io ?? createStorageKcFreshnessIO());
  const [stamp, setStamp] = createSignal<number | undefined>(undefined);
  const [reading, setReading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);

  /**
   * The age text's reactivity beyond stamp changes: a screen-visible flip
   * (this page is a browser tab) re-renders the relative reading so a page
   * left open never displays a stale age after the user returns to it.
   */
  const [tick, renderTick] = createSignal(0, { equals: false });
  onMount(() => {
    const listener = (): void => {
      // equals:false keeps the identity write a notification: the age text
      // re-derives (its Date.now() read) without state changes.
      if (document.visibilityState === 'visible') renderTick((current) => current);
    };
    document.addEventListener('visibilitychange', listener);
    onCleanup(() => {
      document.removeEventListener('visibilitychange', listener);
    });

    void refreshStamp();
    const unwatch = io().watchStamp(() => {
      void refreshStamp();
    });
    onCleanup(unwatch);
  });

  /** Re-derive the stamp through the one validating seam read. */
  const refreshStamp = async (): Promise<void> => {
    try {
      const meta = await io().readMeta();
      setStamp(meta.updatedAt);
      setReading(false);
    } catch (cause) {
      // A storage read failure keeps the last value and the row stays
      // operable; the failure is named, never swallowed.
      log.error('Reading the conflicts timestamp failed — the card keeps its last value', cause);
      setReading(false);
    }
  };

  /** A usable stamp (the age's precondition) — undefined means never synced. */
  const stamped = (): number | null => {
    tick(); // The visibility re-age's reactive read.
    const value = stamp();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
  };

  /** The relative age — buckets round down; clock skew clamps to "just now". */
  const ageText = (): string | null => {
    const value = stamped();
    if (value === null) return null;
    return relativeAge(io().now() - value);
  };

  /** The Refresh now control: the typed request; its outcome ⇒ toast + stamp. */
  const refreshNow = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    try {
      const outcome = await io().refreshNow();
      if (outcome === null) {
        // The background answered without a completed run (single-flight busy
        // or a classified failure): an honest refusal, actionable, not a crash.
        log.warn('The conflicts refresh request completed without a run');
        toast.error(KC_REFRESH_FAILURE_TITLE, { description: KC_REFRESH_NULL_DESCRIPTION });
        return;
      }
      setStamp(outcome.updatedAt);
      toast.success(KC_REFRESH_SUCCESS_TITLE);
    } catch (cause) {
      // Transport: no receiver (service worker down / invalidated context).
      log.error('The conflicts refresh request failed', cause);
      toast.error(KC_REFRESH_FAILURE_TITLE, { description: KC_REFRESH_TRANSPORT_DESCRIPTION });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      level={1}
      class={props.class}
      header={
        <div data-fdt="kc-heading" class="flex flex-col gap-0.5">
          <h2 class="text-sm font-medium text-fg-primary">{KC_CARD_TITLE}</h2>
          <p class="text-2xs text-fg-secondary">{KC_CARD_DESCRIPTION}</p>
        </div>
      }
    >
      <div data-fdt="kc-freshness-row" class="flex flex-wrap items-center justify-between gap-2">
        <Show
          when={!reading()}
          fallback={
            <div data-fdt="kc-freshness-loading" class="flex w-full items-center gap-2">
              <Skeleton class="h-4 w-44" />
              <Skeleton class="h-6 w-24" />
            </div>
          }
        >
          <Show
            when={ageText() !== null}
            fallback={
              <p data-fdt="kc-sync-state" class="text-xs text-fg-secondary">
                {KC_NEVER_SYNCED_TEXT}
              </p>
            }
          >
            <p data-fdt="kc-sync-state" class="text-xs text-fg-secondary">
              Updated{' '}
              <span data-fdt="kc-stamp" class="text-fg-primary">
                {ageText()}
              </span>
            </p>
          </Show>
          <Button
            variant="secondary"
            size="sm"
            loading={busy()}
            onClick={() => {
              void refreshNow();
            }}
          >
            Refresh now
          </Button>
        </Show>
      </div>
    </Card>
  );
}
