/**
 * The editor's set readings (see `./lane-page`), kept off the keystroke
 * path: a lane's rows are read as one set a short pause after its last
 * change, in their own task, so typing in a long lane never pays for the
 * whole set. A run that finds its lane changed since it was scheduled is
 * dropped (the newer change has scheduled its own). `readNow` reads every
 * set-read lane at once — for the apply gate, which must be exact.
 *
 * Between a change and its reading, the last reading still speaks for the
 * rows it read that are unchanged (same id, same text): their row problems
 * stay, and its page message stays only while every row it names is
 * unchanged — so nothing blinks while typing elsewhere, and no message ever
 * names a row that changed. Built on Solid signals (inside the caller's
 * reactive root); the timer is injected.
 */
import { createEffect, createMemo, createSignal, on, type Accessor } from 'solid-js';
import type { Draft, DraftRow, LaneKey } from './draft';
import { lanePage, readsAsSet, type LanePage } from './lane-page';

/** How long a lane waits after its last change before it is read as one set. */
export const SET_READING_DELAY_MS = 150;

/** What the set readings need from the editor. */
export interface SetReadingsDeps {
  readonly draft: Accessor<Draft>;
  /** Rows edited since their last commit, by id (read when a reading runs). */
  readonly uncommitted: ReadonlySet<string>;
  /** One-shot timer; returns its cancel. */
  readonly schedule: (run: () => void, ms: number) => () => void;
  /** The lanes to read (in display order). */
  readonly lanes: readonly LaneKey[];
}

/** The editor's set readings. */
export interface SetReadings {
  /**
   * A lane's set reading as the editor shows it (see the module doc);
   * `null` for a lane whose rows act alone, or before its first reading.
   */
  page(lane: LaneKey): LanePage | null;
  /** Whether every set-read lane's reading is of its current rows. */
  readonly settled: Accessor<boolean>;
  /** Read every set-read lane now (cancelling the scheduled runs). */
  readNow(): void;
  /** Cancel the scheduled runs (teardown). */
  dispose(): void;
}

/** A reading, with the rows it read. */
interface Reading {
  readonly rows: readonly DraftRow[];
  readonly page: LanePage | null;
}

/**
 * The last reading, restricted to what still holds for the current rows:
 * row problems of unchanged rows, and the page-off rows only while every one
 * of them is unchanged.
 *
 * @param reading The last reading.
 * @param rows The lane's current rows.
 */
function stillTrue(reading: Reading, rows: readonly DraftRow[]): LanePage | null {
  const page = reading.page;
  if (page === null) return null;
  const now = new Map(rows.map((row, index) => [row.id, { text: row.text, position: index + 1 }]));
  const before = new Map(reading.rows.map((row) => [row.id, row.text]));
  const unchanged = (id: string): boolean => before.has(id) && now.get(id)?.text === before.get(id);
  const problems = new Map([...page.problems].filter(([id]) => unchanged(id)));
  const offRows = page.offRows.every(({ id }) => unchanged(id))
    ? page.offRows.map((row) => ({ ...row, position: now.get(row.id)?.position ?? row.position }))
    : [];
  return { page: page.page, offRows, problems };
}

/**
 * Build the set readings.
 *
 * @param deps The editor's draft, its uncommitted rows, the timer, the lanes.
 */
export function createSetReadings(deps: SetReadingsDeps): SetReadings {
  const lanes = deps.lanes.filter(readsAsSet).map((lane) => {
    // Fed by this lane's rows only: an edit elsewhere never re-reads it.
    const rows = createMemo(() => deps.draft().rows[lane]);
    const [reading, setReading] = createSignal<Reading | null>(null);
    let cancel: (() => void) | null = null;
    const read = (): void => {
      cancel?.();
      cancel = null;
      const current = rows();
      setReading({ rows: current, page: lanePage(lane, current, deps.uncommitted) });
    };
    createEffect(
      on(rows, (scheduled) => {
        cancel?.();
        // eslint-disable-next-line solid/reactivity -- a timer callback: reads the rows untracked, when it fires
        cancel = deps.schedule(() => {
          cancel = null;
          // A change since it was scheduled has scheduled its own run.
          if (rows() === scheduled) read();
        }, SET_READING_DELAY_MS);
      })
    );
    const page = createMemo((): LanePage | null => {
      const last = reading();
      if (last === null) return null;
      return last.rows === rows() ? last.page : stillTrue(last, rows());
    });
    const fresh = (): boolean => reading()?.rows === rows();
    return {
      lane,
      page,
      fresh,
      read,
      dispose: () => {
        cancel?.();
      }
    };
  });
  const byLane = new Map(lanes.map((entry) => [entry.lane, entry]));
  return {
    page: (lane) => byLane.get(lane)?.page() ?? null,
    settled: () => lanes.every((entry) => entry.fresh()),
    readNow: () => {
      for (const entry of lanes) entry.read();
    },
    dispose: () => {
      for (const entry of lanes) entry.dispose();
    }
  };
}
