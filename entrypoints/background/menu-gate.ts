/**
 * The context menus' follower of the on-page UI gate: keeps every created
 * menu row's title and enabled state equal to the gate, and owns the gate
 * entry's click (the write in the direction its title offers).
 *
 * Every menu-changing operation (recreation, live gate edits) runs through
 * one serial queue, so the browser receives them in issue order: an edit can
 * never land on rows a later recreation replaces, and the last operation
 * always reflects the newest known gate. The watch is armed before the boot
 * read, and once the watch has delivered a value the (possibly older) read
 * result is dropped — no write is lost between the two. All browser and
 * storage effects are injected, so the ordering is unit-testable.
 */

import { createLogger } from '../../lib/logger';
import { PAGE_UI_GATE_DEFAULT } from '../../lib/storage/page-ui-gate';

const log = createLogger('context-menus');

/** One live edit of a created menu row. */
export interface MenuRowUpdate {
  id: string;
  props: { title?: string; enabled?: boolean };
}

/** The effects the follower drives, injected (browser + storage in production). */
export interface MenuGateDeps {
  /** The gate's boot read (validated; rejects as storage does). */
  readGate(): Promise<boolean>;
  /** Follow gate writes; returns the unsubscribe handle. */
  watchGate(onChange: (enabled: boolean) => void): () => void;
  /** Persist the gate (rejects when the write fails). */
  writeGate(enabled: boolean): Promise<void>;
  /** Clear and recreate every menu row in a gate's state. */
  recreate(uiEnabled: boolean): Promise<void>;
  /** The row edits reflecting a gate value (pure). */
  updatesFor(uiEnabled: boolean): MenuRowUpdate[];
  /** Edit one created row (rejects when the browser refuses, e.g. a missing id). */
  update(id: string, props: MenuRowUpdate['props']): Promise<unknown>;
}

/** The follower's surface for the menu runtime. */
export interface MenuGateFollower {
  /**
   * Arm the watch, then read the gate and apply it. Never rejects: a failed
   * read is logged and the rows keep their state until a write arrives.
   */
  start(): Promise<void>;
  /** Queue a recreation of every row in the newest known gate's state. */
  recreate(): void;
  /**
   * Write the opposite of the gate the rows show (read first when it is
   * still unknown).
   *
   * @returns The written value.
   * @throws When the read or the write rejects — the click logs it.
   */
  toggle(): Promise<boolean>;
  /** Settles once every operation queued so far has run (tests, ordering). */
  idle(): Promise<void>;
}

/**
 * Apply one gate value to the created rows. Each edit settles on its own:
 * one refused row (e.g. a create the browser rejected) never stops the
 * others, and every refusal is logged with its id.
 *
 * @param deps The injected effects.
 * @param uiEnabled The gate to reflect.
 */
async function applyGate(deps: MenuGateDeps, uiEnabled: boolean): Promise<void> {
  const updates = deps.updatesFor(uiEnabled);
  const results = await Promise.allSettled(
    updates.map((update) => deps.update(update.id, update.props))
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const cause: unknown = result.reason;
      log.warn('Menu entry update failed', { id: updates[index]?.id, cause });
    }
  });
}

/**
 * Create the follower (inert until {@link MenuGateFollower.start} or a
 * recreation).
 *
 * @param deps The injected effects.
 */
export function createMenuGateFollower(deps: MenuGateDeps): MenuGateFollower {
  let gate: boolean | null = null;
  // Set by the first watch delivery: from then on a boot read is stale.
  let watched = false;
  let tail: Promise<void> = Promise.resolve();

  /** Append one operation to the serial queue; its failure is logged, never thrown. */
  const enqueue = (label: string, operation: () => Promise<void>): void => {
    tail = tail.then(operation).catch((cause: unknown) => {
      log.error(`Menu ${label} failed`, cause);
    });
  };

  /** Adopt a gate value and queue its reflection in the rows. */
  const adopt = (uiEnabled: boolean): void => {
    gate = uiEnabled;
    enqueue('gate update', () => applyGate(deps, uiEnabled));
  };

  return {
    async start(): Promise<void> {
      deps.watchGate((uiEnabled) => {
        watched = true;
        adopt(uiEnabled);
      });
      try {
        const uiEnabled = await deps.readGate();
        if (!watched) adopt(uiEnabled);
      } catch (cause) {
        log.error('On-page UI gate unread — menu entries keep their state', cause);
      }
    },
    recreate(): void {
      // Read at run time, not at queue time: the newest gate wins.
      enqueue('recreation', () => deps.recreate(gate ?? PAGE_UI_GATE_DEFAULT));
    },
    async toggle(): Promise<boolean> {
      const next = !(gate ?? (await deps.readGate()));
      await deps.writeGate(next);
      return next;
    },
    idle: () => tail
  };
}
