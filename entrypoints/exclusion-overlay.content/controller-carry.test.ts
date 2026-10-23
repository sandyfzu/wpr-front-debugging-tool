/**
 * Every row's own reading is carried by its draft row: once a long paste
 * lands, re-reading every row's problem, committing the unchanged lane on
 * Apply, or typing in one row re-reads nothing else — whatever the bounded
 * memos evicted. And an Apply whose set readings are not done waits for
 * them (read in slices), never reading a long lane in one task.
 */
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DeferJsRows from '../../lib/exclusion-builder/defer-js-rows';
import type * as FieldText from '../../lib/exclusion-builder/field-text';
import type * as Validate from '../../lib/exclusion-builder/validate';
import type { ExclusionSet } from '../../lib/exclusion-builder/set';
import type { ExclusionSessionStatus } from '../../lib/messaging/exclusion-session';
import { createOverlayController, TASK_SLICE_MS, type OverlayController } from './controller';
import { SET_READING_DELAY_MS } from './exclusions/set-readings';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

/**
 * Calls to the per-row readings: the row check (costly), the row's own save
 * (costly), and the stored-form key a check by text starts with.
 */
const reads = { check: 0, save: 0, key: 0 };

vi.mock('../../lib/exclusion-builder/validate', async (original) => {
  const actual = await original<typeof Validate>();
  return {
    ...actual,
    featureRowReading: (...args: Parameters<typeof actual.featureRowReading>) => {
      reads.check++;
      return actual.featureRowReading(...args);
    }
  };
});

/** Set to make a set reading's next step throw. */
const breakReading = { on: false };
/** Set readings started (each one's translation). */
const readingStarts = { count: 0 };

vi.mock('../../lib/exclusion-builder/defer-js-rows', async (original) => {
  const actual = await original<typeof DeferJsRows>();
  return {
    ...actual,
    startDeferRowSet: (...args: Parameters<typeof actual.startDeferRowSet>) => {
      readingStarts.count++;
      const work = actual.startDeferRowSet(...args);
      return {
        step: () => {
          if (breakReading.on) throw new Error('reading broke');
          return work.step();
        },
        result: () => work.result()
      };
    }
  };
});

vi.mock('../../lib/exclusion-builder/field-text', async (original) => {
  const actual = await original<typeof FieldText>();
  return {
    ...actual,
    readRowSave: (...args: Parameters<typeof actual.readRowSave>) => {
      reads.save++;
      return actual.readRowSave(...args);
    },
    storedRowKey: (...args: Parameters<typeof actual.storedRowKey>) => {
      reads.key++;
      return actual.storedRowKey(...args);
    }
  };
});

const reply = <T>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/**
 * A started controller; timers run by hand, the slices' clock moves `step`
 * ms per read.
 *
 * @param step The clock's ms per read.
 */
async function started(step = 1) {
  const timers: { run: () => void; ms: number }[] = [];
  const port = {
    status: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    savedSet: vi.fn(() => reply({ set: null })),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn((set: ExclusionSet) => reply({ outcome: 'saved' as const, set })),
    onStatus: vi.fn(() => () => undefined)
  } satisfies ExclusionSessionPort;
  let now = 0;
  let dispose = (): void => undefined;
  const log = { warn: vi.fn() };
  const controller = createRoot((disposeRoot): OverlayController => {
    dispose = disposeRoot;
    return createOverlayController({
      port,
      pageFacts: () => ({
        href: 'https://example.com/',
        documentUrl: null,
        navigationStart: 0,
        responseEnd: null
      }),
      now: () => 1,
      clock: () => (now += step),
      schedule: (run, ms) => {
        const entry = { run, ms };
        timers.push(entry);
        return () => {
          const at = timers.indexOf(entry);
          if (at !== -1) timers.splice(at, 1);
        };
      },
      reload: vi.fn(),
      log
    });
  });
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  /** Fire the timers armed for `ms` until none is left. */
  const fire = async (ms: number): Promise<number> => {
    let fired = 0;
    for (; fired < 10_000; fired++) {
      const at = timers.findIndex((entry) => entry.ms === ms);
      if (at === -1) break;
      timers.splice(at, 1)[0]?.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return fired;
  };
  return { controller, port, fire, dispose, log };
}

/** `count` distinct Delay JS rows. */
const lines = (count: number): string =>
  Array.from({ length: count }, (_, n) => `/p${String(n)}/[a-z]+\\.js`).join('\n');

beforeEach(() => {
  breakReading.on = false;
  reads.check = 0;
  reads.save = 0;
  reads.key = 0;
});

describe('per-row readings carried by the draft rows', () => {
  it('after a long paste lands, every row’s problem and an Apply read nothing again', async () => {
    const { controller, fire } = await started();
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    const outcome = controller.pasteRows('delayJs', id, lines(200), { start: 0, end: 0 });
    if (outcome.kind !== 'pending') throw new Error('settled at once');
    await fire(0);
    await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
    const rows = controller.draft().rows.delayJs;
    expect(rows).toHaveLength(200);
    reads.check = 0;
    reads.save = 0;
    reads.key = 0;
    expect(rows.every((row) => controller.rowProblem('delayJs', row.id, row.text) === null)).toBe(
      true
    );
    expect(controller.invalidCount()).toBe(0);
    // Apply commits every row: each one's save and check are carried (the
    // caret's row too, read above).
    controller.apply();
    expect(reads).toEqual({ check: 0, save: 0, key: 0 });
  });

  it('typing in one row of a long lane checks that row only', async () => {
    const { controller, fire } = await started();
    controller.insertRows('delayJs', lines(150).split('\n'), null);
    await fire(0);
    const row = controller.draft().rows.delayJs[70];
    reads.check = 0;
    reads.key = 0;
    controller.editRow('delayJs', row?.id ?? '', `${row?.text ?? ''}x`);
    expect(controller.invalidCount()).toBe(0);
    // The edited row alone is read: no other row's text is even keyed.
    expect(reads.check).toBe(1);
    expect(reads.key).toBe(1);
  });
});

describe('an Apply waiting for its set readings', () => {
  /** Defer JS rows the set reading reads one per slice (each clock read is a slice's budget). */
  const slow = TASK_SLICE_MS * 10;

  it('holds the draft, reads the lane in slices, then applies once', async () => {
    const { controller, port, fire } = await started(slow);
    const ids = controller.insertRows('deferJs', lines(40).split('\n'), null);
    controller.editRow('deferJs', ids[3] ?? '', '/edited\\.js');
    controller.apply();
    expect(port.apply).not.toHaveBeenCalled();
    expect(controller.checking()).toBe(true);
    expect(controller.editable()).toBe(false);
    expect(controller.pasting()).toBe(false);
    // Asked meanwhile: queued behind the Apply.
    controller.commitLane('deferJs');
    const slices = await fire(0);
    expect(slices).toBeGreaterThan(30);
    expect(port.apply).toHaveBeenCalledTimes(1);
    expect(controller.checking()).toBe(false);
    expect(controller.lanePage('deferJs')?.page).toBe('on');
  });

  it('reads a long lane in slices after its pause, dropping a reading its rows outran', async () => {
    const { controller, fire } = await started(slow);
    const ids = controller.insertRows('deferJs', lines(40).split('\n'), null);
    await fire(SET_READING_DELAY_MS);
    // One row per slice: the first slice ran, the reading is not done.
    expect(controller.lanePage('deferJs')).toBeNull();
    controller.editRow('deferJs', ids[0] ?? '', '.*');
    // The change cancels the old reading's next slice.
    expect(await fire(0)).toBe(0);
    expect(controller.lanePage('deferJs')).toBeNull();
    await fire(SET_READING_DELAY_MS);
    expect(await fire(0)).toBeGreaterThan(30);
    expect(controller.lanePage('deferJs')?.offRows.map(({ id }) => id)).toEqual([ids[0]]);
  });

  it('a reading that breaks frees the editor, says so, and Apply retries it', async () => {
    const { controller, port, fire, log } = await started(slow);
    const ids = controller.insertRows('deferJs', lines(40).split('\n'), null);
    controller.editRow('deferJs', ids[0] ?? '', '/typed\\.js ');
    controller.apply();
    expect(controller.checking()).toBe(true);
    // Asked meanwhile: the commit runs after the break, the Apply does not.
    controller.commitLane('deferJs');
    breakReading.on = true;
    await fire(0);
    expect(controller.checking()).toBe(false);
    expect(controller.editable()).toBe(true);
    expect(port.apply).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ phase: 'ready', notice: { kind: 'check-failed' } });
    expect(log.warn).toHaveBeenCalledWith(
      'reading the deferJs rows as one set failed',
      expect.any(Error)
    );
    // The queued lane commit ran: the typed row is stored.
    expect(controller.draft().rows.deferJs[0]?.text).toBe('/typed\\.js');
    breakReading.on = false;
    controller.retryFailedAction();
    expect(controller.checking()).toBe(true);
    await fire(0);
    expect(port.apply).toHaveBeenCalledTimes(1);
    expect(controller.checking()).toBe(false);
  });

  it('a reading that breaks with nobody waiting is read again on Apply', async () => {
    const { controller, port, fire } = await started(slow);
    controller.insertRows('deferJs', lines(40).split('\n'), null);
    await fire(SET_READING_DELAY_MS);
    breakReading.on = true;
    await fire(0);
    breakReading.on = false;
    expect(controller.lanePage('deferJs')).toBeNull();
    controller.apply();
    expect(controller.checking()).toBe(true);
    await fire(0);
    expect(port.apply).toHaveBeenCalledTimes(1);
  });

  it('applies at once when one slice reads the lane', async () => {
    const { controller, port } = await started(0);
    controller.insertRows('deferJs', ['a\\.js', 'b\\.js'], null);
    controller.apply();
    expect(controller.checking()).toBe(false);
    expect(port.apply).toHaveBeenCalledTimes(1);
  });

  it('closing meanwhile applies nothing and saves the draft', async () => {
    const { controller, port, fire } = await started(slow);
    controller.insertRows('deferJs', lines(40).split('\n'), null);
    controller.apply();
    expect(controller.checking()).toBe(true);
    // Queued meanwhile: dropped on close (only commits run then).
    controller.stop();
    controller.dispose();
    // The hold ends with the overlay: nothing waits on the readings any more.
    expect(controller.checking()).toBe(false);
    await fire(0);
    await fire(SET_READING_DELAY_MS);
    expect(port.apply).not.toHaveBeenCalled();
    expect(port.stop).not.toHaveBeenCalled();
    expect(port.save).toHaveBeenCalled();
  });

  it('an Apply asked while a reading is in flight waits for that reading, never restarts it', async () => {
    const { controller, port, fire } = await started(slow);
    controller.insertRows('deferJs', lines(40).split('\n'), null);
    await fire(SET_READING_DELAY_MS);
    const before = readingStarts.count;
    controller.apply();
    expect(controller.checking()).toBe(true);
    await fire(0);
    expect(readingStarts.count).toBe(before);
    expect(port.apply).toHaveBeenCalledTimes(1);
  });
});
