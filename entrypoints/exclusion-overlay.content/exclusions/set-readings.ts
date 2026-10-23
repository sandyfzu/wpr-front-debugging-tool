/**
 * The editor's set readings (see `./lane-page`), kept off the keystroke
 * path: a lane's rows are read as one set a short pause after its last
 * change, in time-boxed slices of their own tasks (a set of costly rows
 * takes many), so typing in a long lane never pays for the whole set and
 * no reading blocks the page. A run that finds its lane changed since it
 * was scheduled, or since its last slice, is dropped (the newer change has
 * scheduled its own). `readNow` reads every set-read lane whose reading is
 * not of its current rows right away (`whenSettled` tells when all are) — for the
 * apply gate, which must be exact; a lane's rows are read once per version
 * (an unchanged 500-row lane is never re-read on Apply).
 *
 * Between a change and its reading, the last reading still speaks for the
 * rows it read that are unchanged (same id, same text): their row problems
 * and warnings stay, and its page message stays only while every row it names is
 * unchanged — so nothing blinks while typing elsewhere, and no message ever
 * names a row that changed. Built on Solid signals (inside the caller's
 * reactive root); the timer is injected.
 */
import { createEffect, createMemo, createSignal, on, type Accessor } from 'solid-js';
import { stepFor } from '../../../utils/stepped';
import type { Draft, DraftRow, LaneKey, RowCarry } from './draft';
import { readsAsSet, startLanePage, type LanePage } from './lane-page';

/** How long a lane waits after its last change before it is read as one set. */
export const SET_READING_DELAY_MS = 150;

/** What the set readings need from the editor. */
export interface SetReadingsDeps {
  readonly draft: Accessor<Draft>;
  /** Rows edited since their last commit, by id (read when a reading starts). */
  readonly uncommitted: ReadonlySet<string>;
  /** Per-row readings to reuse (see `RowCarry`). */
  readonly carry?: RowCarry;
  /** One-shot timer; returns its cancel. */
  readonly schedule: (run: () => void, ms: number) => () => void;
  /** Monotonic ms now, for timing the slices. */
  readonly clock: () => number;
  /** How long one slice reads for (at least one row each). */
  readonly sliceMs: number;
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
  /**
   * Start reading every set-read lane not read at its current rows, without
   * the pause: its first slice runs now.
   *
   * @returns Whether every reading is now of its lane's current rows.
   */
  readNow(): boolean;
  /**
   * Tell when every reading is of its lane's current rows (see {@link SetReadings.readNow}).
   *
   * @param done Called once settled (at once when already settled; never after `dispose`).
   */
  whenSettled(done: () => void): void;
  /** Cancel the scheduled runs and the waits (teardown). */
  dispose(): void;
}

/** A reading, with the rows it read. */
interface Reading {
  readonly rows: readonly DraftRow[];
  readonly page: LanePage | null;
}

/**
 * The last reading, restricted to what still holds for the current rows:
 * row problems and warnings of unchanged rows, and the page-off rows only
 * while every one of them is unchanged.
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
  const warnings = new Map([...page.warnings].filter(([id]) => unchanged(id)));
  const offRows = page.offRows.every(({ id }) => unchanged(id))
    ? page.offRows.map((row) => ({ ...row, position: now.get(row.id)?.position ?? row.position }))
    : [];
  return { page: page.page, offRows, problems, warnings };
}

/**
 * Build the set readings.
 *
 * @param deps The editor's draft, its uncommitted rows, the timer, the lanes.
 */
export function createSetReadings(deps: SetReadingsDeps): SetReadings {
  /** Told once every lane's reading is of its current rows (see `whenSettled`). */
  const waiters: (() => void)[] = [];
  /** Each lane's freshness, as its entry is built (a reading may finish while they are). */
  const freshness: (() => boolean)[] = [];
  const settled = (): boolean => freshness.every((fresh) => fresh());
  /** Tell the waiters once settled. */
  const tellIfSettled = (): void => {
    if (!settled()) return;
    for (const done of waiters.splice(0)) done();
  };
  const lanes = deps.lanes.filter(readsAsSet).map((lane) => {
    // Fed by this lane's rows only: an edit elsewhere never re-reads it.
    const rows = createMemo(() => deps.draft().rows[lane]);
    const [reading, setReading] = createSignal<Reading | null>(null);
    const fresh = (): boolean => reading()?.rows === rows();
    // eslint-disable-next-line solid/reactivity -- read by `settled`, itself read in tracked scopes or at once
    freshness.push(fresh);
    /** Cancels the scheduled start or the next slice. */
    let cancel: (() => void) | null = null;
    /** The rows a running reading reads (its slices stop once they changed). */
    let reads: readonly DraftRow[] | null = null;
    const stop = (): void => {
      cancel?.();
      cancel = null;
      reads = null;
    };
    /** Read the current rows, a slice per task. */
    const read = (): void => {
      stop();
      // eslint-disable-next-line solid/reactivity -- a snapshot on purpose: the slices check it against the rows
      const current = rows();
      const work = startLanePage(lane, current, new Set(deps.uncommitted), deps.carry);
      reads = current;
      const slice = (): void => {
        cancel = null;
        // A change since the last slice has scheduled its own reading.
        if (rows() !== current) {
          reads = null;
          return;
        }
        if (!stepFor(() => work.step(), deps.clock, deps.sliceMs)) {
          cancel = deps.schedule(slice, 0);
          return;
        }
        reads = null;
        setReading({ rows: current, page: work.result() });
        tellIfSettled();
      };
      slice();
    };
    createEffect(
      on(rows, (scheduled) => {
        stop();
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
    /** Read now unless the reading is, or is being made, of the current rows. */
    const hurry = (): void => {
      if (fresh() || reads === rows()) return;
      read();
    };
    return { lane, page, hurry, stop };
  });
  const byLane = new Map(lanes.map((entry) => [entry.lane, entry]));
  return {
    page: (lane) => byLane.get(lane)?.page() ?? null,
    settled,
    readNow: () => {
      for (const entry of lanes) entry.hurry();
      return settled();
    },
    whenSettled: (done) => {
      waiters.push(done);
      tellIfSettled();
    },
    dispose: () => {
      waiters.length = 0;
      for (const entry of lanes) entry.stop();
    }
  };
}
