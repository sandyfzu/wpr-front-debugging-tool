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
 *
 * Rows may not exist when the first gate value arrives: a fresh install, an
 * update adding rows, or a browser that keeps no menus across restarts (a
 * persistent background page) only gets them from the lifecycle recreation,
 * whose event can come after the boot read. Until rows are known to exist in
 * this lifetime, a refused edit is therefore expected: the follower recreates
 * every row in the gate's state instead of warning. Once rows are known, a
 * refused edit is a real degradation and warns.
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
  /** The gate entry's row id: its title is what {@link MenuGateFollower.toggle} reads back. */
  readonly gateRowId: string;
}

/** The follower's surface for the menu runtime. */
export interface MenuGateFollower {
  /**
   * Arm the watch, then read the gate and apply it. Never rejects: a failed
   * watch or read is logged; without a read the rows keep their state until
   * a write arrives.
   */
  start(): Promise<void>;
  /** Queue a recreation of every row in the newest known gate's state. */
  recreate(): void;
  /**
   * Write the opposite of what the rows show — the last gate applied to them,
   * so a click between a gate change and its row edit still does what the
   * clicked title offered; falls back to the newest known gate, then a read.
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
 * one refused row never stops the others.
 *
 * @param deps The injected effects.
 * @param uiEnabled The gate to reflect.
 * @returns The refused edits with their causes (empty when all applied).
 */
async function applyGate(
  deps: MenuGateDeps,
  uiEnabled: boolean
): Promise<{ id: string; cause: unknown }[]> {
  const updates = deps.updatesFor(uiEnabled);
  const results = await Promise.allSettled(
    updates.map((update) => deps.update(update.id, update.props))
  );
  return updates.flatMap((update, index) => {
    const result = results[index];
    return result?.status === 'rejected'
      ? [{ id: update.id, cause: result.reason as unknown }]
      : [];
  });
}

/**
 * Create the follower (inert until {@link MenuGateFollower.start} or a
 * recreation).
 *
 * @param deps The injected effects.
 */
export function createMenuGateFollower(deps: MenuGateDeps): MenuGateFollower {
  // Newest gate value known (watch or boot read); null until one arrives.
  let gate: boolean | null = null;
  // The gate the gate row's title last received (set only once an
  // apply/recreation reached that row).
  let shown: boolean | null = null;
  // Set by the first watch delivery: from then on a boot read is stale.
  let watched = false;
  // Set once a recreation ran or every edit landed: rows exist this lifetime.
  let rowsKnown = false;
  let tail: Promise<void> = Promise.resolve();

  /** Append one operation to the serial queue; its failure is logged, never thrown. */
  const enqueue = (label: string, operation: () => Promise<void>): void => {
    tail = tail.then(operation).catch((cause: unknown) => {
      log.error(`Menu ${label} failed`, cause);
    });
  };

  /** Recreate every row in a gate's state and record what they now show. */
  const recreateIn = async (uiEnabled: boolean): Promise<void> => {
    await deps.recreate(uiEnabled);
    rowsKnown = true;
    shown = uiEnabled;
  };

  /**
   * Reflect a gate value in the rows. Before rows are known to exist, a
   * refused edit means they are absent: recreate them (in the newest gate)
   * in this same queued step instead of warning.
   */
  const reflect = async (uiEnabled: boolean): Promise<void> => {
    const refused = await applyGate(deps, uiEnabled);
    if (refused.length === 0) {
      rowsKnown = true;
      shown = uiEnabled;
      return;
    }
    if (!rowsKnown) {
      log.debug('Menu rows absent — recreating', { ids: refused.map((entry) => entry.id) });
      await recreateIn(gate ?? uiEnabled);
      return;
    }
    // Rows exist but some refused: the gate row shows this value unless its
    // own edit was refused (a click must write what its title still offers).
    if (!refused.some((entry) => entry.id === deps.gateRowId)) shown = uiEnabled;
    for (const entry of refused) log.warn('Menu entry update failed', entry);
  };

  /** Adopt a gate value and queue its reflection in the rows. */
  const adopt = (uiEnabled: boolean): void => {
    gate = uiEnabled;
    enqueue('gate update', () => reflect(uiEnabled));
  };

  return {
    async start(): Promise<void> {
      try {
        deps.watchGate((uiEnabled) => {
          watched = true;
          adopt(uiEnabled);
        });
      } catch (cause) {
        log.error('On-page UI gate unwatched — menu entries follow only the boot read', cause);
      }
      try {
        const uiEnabled = await deps.readGate();
        if (!watched) adopt(uiEnabled);
      } catch (cause) {
        log.error('On-page UI gate unread — menu entries keep their state', cause);
      }
    },
    recreate(): void {
      // Read at run time, not at queue time: the newest gate wins.
      enqueue('recreation', () => recreateIn(gate ?? PAGE_UI_GATE_DEFAULT));
    },
    async toggle(): Promise<boolean> {
      const next = !(shown ?? gate ?? (await deps.readGate()));
      await deps.writeGate(next);
      return next;
    },
    idle: () => tail
  };
}
