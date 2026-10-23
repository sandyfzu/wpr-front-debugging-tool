import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../lib/exclusion-builder/set';
import {
  EXCLUSION_SET_LIMITS,
  type ExclusionSessionStatus
} from '../../lib/messaging/exclusion-session';
import { activeRecord, validSet } from '../../lib/messaging/exclusion-session.fixtures';
import {
  AUTOSAVE_DELAY_MS,
  PASTE_AT_ONCE,
  TASK_SLICE_MS,
  RELOAD_STALL_MS,
  createOverlayController,
  fitsAtOnce,
  invalidRowsById,
  type OverlayController
} from './controller';
import {
  commitRows,
  createIdSource,
  draftFromSet,
  draftToSet,
  pasteIntoRow
} from './exclusions/draft';
import { SET_READING_DELAY_MS } from './exclusions/set-readings';
import { ROW_REASONS } from '../../lib/exclusion-builder/row-reasons';
import { prevalidateExclusionSet } from '../../lib/exclusion-builder/validate';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

/** A manual timer queue standing in for the context's timers. */
function timers() {
  const queue: { run: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    schedule: (run: () => void, ms: number) => {
      const entry = { run, ms, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    /** Fire every live timer armed for `ms`. */
    fire: (ms: number) => {
      for (const entry of queue.splice(0)) if (!entry.cancelled && entry.ms === ms) entry.run();
    },
    /** Live timers armed for `ms`. */
    pending: (ms: number) => queue.filter((entry) => !entry.cancelled && entry.ms === ms).length
  };
}

/** Resolve after pending microtasks (port answers) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const reply = <T>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A port answering a status and a saved set, with spies for the actions. */
function fakePort(status: ExclusionSessionStatus, saved: ExclusionSet | null = null) {
  let push: ((status: ExclusionSessionStatus) => void) | null = null;
  const port = {
    status: vi.fn(() => reply(status)),
    savedSet: vi.fn(() => reply({ set: saved })),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn(() => reply({ outcome: 'saved' as const })),
    onStatus: vi.fn((listener: (status: ExclusionSessionStatus) => void) => {
      push = listener;
      return () => {
        push = null;
      };
    })
  } satisfies ExclusionSessionPort;
  return { port, push: (next: ExclusionSessionStatus) => push?.(next) };
}

/** A clock that moves `step` ms on every read (slices then commit a fixed count of rows). */
function ticking(step = 1) {
  let now = 0;
  const read = () => (now += step);
  return Object.assign(read, { reads: () => now / step });
}

/**
 * Build a started controller in a reactive root.
 *
 * @param pasteAtOnce The most a paste lands at once (default: the shipped bounds).
 * @param sliceClock The slices' clock (default: 1 ms per read).
 */
async function started(
  port: ExclusionSessionPort,
  pasteAtOnce?: { rows: number; chars: number },
  sliceClock: () => number = ticking()
) {
  const clock = timers();
  const reload = vi.fn();
  const log = { warn: vi.fn() };
  let controller: OverlayController | undefined;
  const dispose = createRoot((disposeRoot) => {
    controller = createOverlayController({
      port,
      pageFacts: () => ({
        href: 'https://example.com/',
        documentUrl: 'https://example.com/',
        navigationStart: 0,
        responseEnd: null
      }),
      now: () => 4242,
      schedule: clock.schedule,
      reload,
      log,
      clock: sliceClock,
      ...(pasteAtOnce === undefined ? {} : { pasteAtOnce })
    });
    return disposeRoot;
  });
  if (controller === undefined) throw new Error('controller not built');
  controller.start();
  await settle();
  return { controller, clock, reload, dispose, log };
}

describe('loading', () => {
  it('starts the draft from the saved set when nothing is applied', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }, validSet()).port);
    expect(controller.state()).toMatchObject({ phase: 'ready', status: { state: 'inactive' } });
    expect(controller.draft().rows.deferJs.map((row) => row.text)).toEqual(['/wp-includes/js/']);
    expect(controller.view()).toEqual({ kind: 'off' });
  });

  it('starts from the active session set when no draft is saved', async () => {
    // Changed in audit round 1: a saved draft that differs from the active
    // set now wins (it holds the edits made since the apply) — pinned below.
    const active = {
      ...activeRecord(),
      set: { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['only.png'] } }
    };
    const { controller } = await started(fakePort(active, null).port);
    expect(controller.draft().rows.lazyload.map((row) => row.text)).toEqual(['only.png']);
    expect(controller.dirty()).toBe(false);
  });

  it('fails the load on either problem and retries on request', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.savedSet.mockResolvedValueOnce({ kind: 'problem', problem: 'timeout' });
    const { controller } = await started(port);
    expect(controller.state()).toEqual({ phase: 'load-failed', problem: 'timeout' });
    controller.retryLoad();
    expect(controller.state()).toEqual({ phase: 'loading' });
    await settle();
    expect(controller.state().phase).toBe('ready');
  });

  it('follows status pushes and stops following on dispose', async () => {
    const fake = fakePort({ state: 'inactive' });
    const { controller } = await started(fake.port);
    fake.push({ state: 'unavailable', cause: 'session-limit', at: 1 });
    expect(controller.view()).toEqual({
      kind: 'unavailable',
      cause: 'session-limit',
      retryable: true
    });
    controller.dispose();
    fake.push({ state: 'inactive' });
    expect(controller.view()?.kind).toBe('unavailable');
  });
});

describe('back/forward cache restore (resync)', () => {
  it('re-reads the status, keeping the draft (pushes went to other documents meanwhile)', async () => {
    const fake = fakePort({ state: 'inactive' }, validSet());
    const { controller } = await started(fake.port);
    controller.editRow('lazyload', controller.draft().rows.lazyload[0]?.id ?? '', 'kept.png');
    const draft = controller.draft();
    fake.port.status.mockResolvedValueOnce({ kind: 'reply', reply: activeRecord() });
    controller.resync();
    await settle();
    expect(controller.state()).toMatchObject({ phase: 'ready', status: { state: 'active' } });
    expect(controller.draft()).toBe(draft);
    expect(fake.port.savedSet).toHaveBeenCalledTimes(1);
  });

  it('defers to the load still in flight (it re-reads once it lands)', async () => {
    const { port } = fakePort({ state: 'inactive' });
    let answer!: (outcome: PortOutcome<ExclusionSessionStatus>) => void;
    port.status.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const clock = timers();
    const controller = createRoot(() =>
      createOverlayController({
        port,
        pageFacts: () => ({
          href: 'https://example.com/',
          documentUrl: null,
          navigationStart: 0,
          responseEnd: null
        }),
        now: () => 1,
        schedule: clock.schedule,
        reload: vi.fn(),
        log: { warn: vi.fn() }
      })
    );
    controller.start();
    controller.resync();
    expect(port.status).toHaveBeenCalledTimes(1);
    answer({ kind: 'reply', reply: { state: 'inactive' } });
    await settle();
    expect(port.status).toHaveBeenCalledTimes(2);
  });
});

describe('editing and autosave', () => {
  it('saves a typing pause once, and nothing when the draft equals the stored set', async () => {
    const { port } = fakePort({ state: 'inactive' }, validSet());
    const { controller, clock } = await started(port);
    const row = controller.draft().rows.deferJs[0];
    controller.editRow('deferJs', row?.id ?? '', '/x/');
    controller.editRow('deferJs', row?.id ?? '', '/xy/');
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(controller.saveState()).toEqual({ kind: 'saved' });
    controller.editRow('deferJs', row?.id ?? '', '/xy/');
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).toHaveBeenCalledTimes(1);
  });

  it('says a draft over the set cap is not kept (it is gone on close), and asks nothing', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    // Each row under the wire's row cap; together over the set's.
    const rows = Array.from({ length: 40 }, (_, n) => `/p${String(n)}/${'a'.repeat(2000)}.js`);
    controller.insertRows('delayJs', rows, null);
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).not.toHaveBeenCalled();
    expect(controller.saveState()).toEqual({ kind: 'not-saved', reason: 'too-large' });
    // Back under the cap: it saves again.
    for (const row of controller.draft().rows.delayJs.slice(5)) {
      controller.removeRow('delayJs', row.id);
    }
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(controller.saveState()).toEqual({ kind: 'saved' });
  });

  it('saves an edit still waiting for its pause when the overlay closes', async () => {
    const { port } = fakePort({ state: 'inactive' }, validSet());
    const { controller, clock, dispose } = await started(port);
    const row = controller.draft().rows.deferJs[0];
    controller.editRow('deferJs', row?.id ?? '', '/kept/');
    expect(clock.pending(AUTOSAVE_DELAY_MS)).toBe(1);
    controller.dispose();
    dispose();
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(port.save).toHaveBeenLastCalledWith(draftToSet(controller.draft()));
    expect(clock.pending(AUTOSAVE_DELAY_MS)).toBe(0);
    // Nothing waiting: closing saves nothing more.
    controller.dispose();
    expect(port.save).toHaveBeenCalledTimes(1);
  });

  it('shows why a save stored nothing', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.save.mockResolvedValueOnce({
      kind: 'reply',
      reply: { outcome: 'not-saved', reason: 'storage-failed' }
    } as never);
    const { controller, clock } = await started(port);
    controller.insertRows('delayJs', ['gtag'], null);
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(controller.saveState()).toEqual({ kind: 'not-saved', reason: 'storage-failed' });
  });

  it('splits a multi-line paste into rows and focuses the last', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [id] = controller.insertRows('lazyload', [''], null);
    expect(
      controller.pasteRows('lazyload', id ?? '', 'a.png\nb.png\r\n\nc.png', {
        start: 0,
        end: 0
      })
    ).toEqual({ kind: 'pasted' });
    const rows = controller.draft().rows.lazyload;
    expect(rows.map((row) => row.text)).toEqual(['a.png', 'b.png', 'c.png']);
    // The caret lands after the pasted text.
    expect(controller.focusRequest()).toEqual({ lane: 'lazyload', id: rows[2]?.id, caret: 5 });
  });

  it('says when the lane cap left pasted lines out, or took none of them', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    // Distinct rows: inserted rows are committed, and a duplicate would leave the lane.
    const filler = Array.from(
      { length: EXCLUSION_SET_LIMITS.rowsPerFeature - 2 },
      (_, index) => `f${String(index)}`
    );
    const [id] = controller.insertRows('lazyload', ['x', ...filler], null);
    expect(controller.pasteRows('lazyload', id ?? '', 'a\nb\nc', { start: 1, end: 1 })).toEqual({
      kind: 'dropped',
      lines: 1
    });
    expect(controller.draft().rows.lazyload).toHaveLength(EXCLUSION_SET_LIMITS.rowsPerFeature);
    const before = controller.draft();
    expect(controller.pasteRows('lazyload', id ?? '', 'p\nq', { start: 0, end: 0 })).toEqual({
      kind: 'lane-full'
    });
    expect(controller.draft()).toBe(before);
    expect(controller.pasteRows('lazyload', 'missing', 'p\nq', { start: 0, end: 0 })).toEqual({
      kind: 'ignored'
    });
  });

  describe('a paste longer than one slice', () => {
    /** Lines over two slices: kept, converted, a duplicate, dropped ones, then the caret's row. */
    const LONG = [
      ...Array.from({ length: PASTE_AT_ONCE.rows * 2 }, (_, index) => `s${String(index)}.js`),
      'a*',
      's0.js',
      '0',
      'last'
    ].join('\n');

    /** Run the paste's slices (each one a 0 ms timer), then the held actions' task the landing schedules. */
    const runSlices = async (clock: ReturnType<typeof timers>): Promise<number> => {
      let slices = 0;
      await settle();
      for (; slices < 100 && clock.pending(0) > 0; slices++) {
        clock.fire(0);
        await settle();
      }
      return slices;
    };

    it('commits in slices, holding edits, then lands exactly as at once', async () => {
      const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
      const [id = ''] = controller.insertRows('delayJs', ['x'], null);
      const before = controller.draft();
      const outcome = controller.pasteRows('delayJs', id, LONG, { start: 0, end: 1 });
      if (outcome.kind !== 'pending') throw new Error(`settled at once: ${outcome.kind}`);
      // Nothing lands, and nothing edits, until the slices ran.
      expect(controller.draft()).toBe(before);
      expect(controller.editable()).toBe(false);
      controller.editRow('delayJs', id, 'typed meanwhile');
      expect(controller.draft()).toBe(before);
      expect(await runSlices(clock)).toBeGreaterThanOrEqual(2);
      await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
      expect(controller.editable()).toBe(true);
      // The same rows, notes and focus as the one-step paste of the same lines.
      const pasted = pasteIntoRow(
        before,
        'delayJs',
        id,
        LONG,
        { start: 0, end: 1 },
        createIdSource()
      );
      const once = commitRows(pasted.draft, 'delayJs', pasted.ids.slice(0, -1));
      const rows = controller.draft().rows.delayJs;
      expect(rows.map((row) => row.text)).toEqual(once.draft.rows.delayJs.map((row) => row.text));
      expect(rows.at(-1)?.text).toBe('last');
      expect(controller.notes().lanes.delayJs.summary).toEqual({
        source: 'paste',
        changed: 1,
        removed: 2
      });
      expect(controller.notes().latest?.source).toBe('paste');
      expect(controller.focusRequest()).toEqual({ lane: 'delayJs', id: rows.at(-1)?.id, caret: 4 });
    });

    it('lands and saves the paste when the overlay closes between slices', async () => {
      const fake = fakePort({ state: 'inactive' });
      const { controller, clock, dispose } = await started(fake.port);
      const [id = ''] = controller.insertRows('delayJs', [''], null);
      const outcome = controller.pasteRows('delayJs', id, LONG, { start: 0, end: 0 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      controller.dispose();
      dispose();
      await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
      expect(clock.pending(0)).toBe(0);
      expect(controller.draft().rows.delayJs.at(-1)?.text).toBe('last');
      // Saved at once: the autosave's pause died with the overlay.
      expect(fake.port.save).toHaveBeenCalledTimes(1);
      expect(fake.port.save).toHaveBeenLastCalledWith(draftToSet(controller.draft()));
    });

    /** What a user can do around a paste, as the overlay asks it of the controller. */
    type Step =
      | { readonly kind: 'paste'; readonly selection: { start: number; end: number } }
      | { readonly kind: 'leave' | 'commit-lane' | 'apply' | 'reset' | 'stop' };

    /**
     * Run the same steps on a controller whose pastes all land at once and
     * on one that slices this paste, and read what each ended with. `leave`
     * leaves the focused row (as Tab or a click elsewhere does): after a
     * one-step paste that is the last pasted row, during a hold the row
     * pasted into. Focus is read apart: a sliced paste left meanwhile asks
     * for none (it stays where the user put it).
     *
     * @param typed The pasted row's text before the paste.
     * @param steps The steps, the paste among them.
     * @param others Rows before the pasted one (inserted, so committed).
     * @param status The session's status.
     */
    const bothPaths = async (
      typed: string,
      steps: readonly Step[],
      others: readonly string[] = [],
      status: ExclusionSessionStatus = { state: 'inactive' },
      text = LONG
    ) => {
      const run = async (atOnce?: { rows: number; chars: number }) => {
        const fake = fakePort(status);
        const { controller, clock } = await started(fake.port, atOnce);
        controller.insertRows('delayJs', [...others, 'x'], null);
        const id = controller.draft().rows.delayJs.at(-1)?.id ?? '';
        controller.editRow('delayJs', id, typed);
        const before = controller.draft();
        const askedBefore = controller.focusRequest();
        let outcome: Promise<unknown> = Promise.resolve(null);
        let held = false;
        let focused = id;
        for (const step of steps) {
          if (step.kind === 'paste') {
            const pasted = controller.pasteRows('delayJs', id, text, step.selection);
            held = pasted.kind === 'pending';
            // A one-step paste moved focus to its last row.
            if (!held) focused = controller.focusRequest()?.id ?? id;
            outcome = pasted.kind === 'pending' ? pasted.done : Promise.resolve(pasted);
          } else if (step.kind === 'leave') controller.commitRow('delayJs', focused);
          else if (step.kind === 'commit-lane') controller.commitLane('delayJs');
          else if (step.kind === 'apply') controller.apply();
          else if (step.kind === 'reset') controller.reset();
          else controller.stop();
        }
        // Nothing lands, and nothing commits, before the slices ran.
        if (held) expect(controller.draft()).toBe(before);
        await runSlices(clock);
        const rows = controller.draft().rows.delayJs;
        const lane = controller.notes().lanes.delayJs;
        const focus = controller.focusRequest();
        return {
          held,
          focusKept: focus === askedBefore,
          focus:
            focus === null
              ? null
              : { at: rows.findIndex((row) => row.id === focus.id), caret: focus.caret },
          result: {
            outcome: await outcome,
            rows: rows.map((row) => row.text),
            summary: lane.summary,
            removed: lane.removed.map((note) => note.diff),
            news: controller.notes().latest?.news ?? null,
            applied: fake.port.apply.mock.calls as unknown[][],
            stopped: fake.port.stop.mock.calls.length,
            phase: controller.state().phase,
            editable: controller.editable(),
            pasting: controller.pasting()
          }
        };
      };
      const once = await run({ rows: Infinity, chars: Infinity });
      const sliced = await run();
      expect(once.held).toBe(false);
      expect(sliced.held).toBe(true);
      expect(sliced.result).toEqual(once.result);
      const left = steps.some((step) => step.kind === 'leave');
      // Left meanwhile: no focus asked after the paste (the row pasted into
      // keeps the request it had); else the same focus as a one-step paste.
      if (left) expect(sliced.focusKept).toBe(true);
      else expect(sliced.focus).toEqual(once.focus);
      return { ...sliced.result, focus: once.focus };
    };

    it('lands on the caret it started from when the row is left meanwhile (Tab, blur)', async () => {
      const result = await bothPaths('  ab', [
        { kind: 'paste', selection: { start: 3, end: 3 } },
        { kind: 'leave' }
      ]);
      expect(result.outcome).toEqual({ kind: 'pasted' });
      expect(result.rows[0]).toBe('as0.js');
      expect(result.rows.at(-1)).toBe('lastb');
      expect(result.focus).toEqual({ at: result.rows.length - 1, caret: 4 });
      expect(result.editable).toBe(true);
      expect(result.pasting).toBe(false);
    });

    it('replaces the selected range it started from when the row is left meanwhile', async () => {
      const result = await bothPaths('  abcd', [
        { kind: 'paste', selection: { start: 3, end: 5 } },
        { kind: 'leave' }
      ]);
      expect(result.rows[0]).toBe('as0.js');
      expect(result.rows.at(-1)).toBe('lastd');
    });

    it.each([
      ['WP Rocket drops it as 0', '0', []],
      ['it is empty', '   ', []],
      ['it copies another row', 'dup.js', ['dup.js']],
      ['its pattern is invalid', '(', []]
    ])(
      'keeps every pasted row when a commit meanwhile would drop the row (%s)',
      async (_reason, typed, others) => {
        const result = await bothPaths(
          typed,
          [
            { kind: 'paste', selection: { start: typed.length, end: typed.length } },
            { kind: 'leave' }
          ],
          others
        );
        expect(result.outcome).toEqual({ kind: 'pasted' });
        // Every pasted line is there: the slices' rows and the caret's row.
        expect(result.rows).toContain(`s${String(PASTE_AT_ONCE.rows * 2 - 1)}.js`);
        expect(result.rows.at(-1)).toBe('last');
      }
    );

    it('lands at its own caret with the trailing text committed when left meanwhile', async () => {
      // The caret row ends in a space: leaving it commits the row the caret
      // landed in, as after a one-step paste.
      const result = await bothPaths('ab ', [
        { kind: 'paste', selection: { start: 1, end: 1 } },
        { kind: 'leave' }
      ]);
      expect(result.rows[0]).toBe('as0.js');
      expect(result.rows.at(-1)).toBe('lastb');
    });

    it('drops Stop asked after Apply meanwhile, as when the paste lands at once', async () => {
      const result = await bothPaths(
        'ab',
        [{ kind: 'paste', selection: { start: 1, end: 1 } }, { kind: 'apply' }, { kind: 'stop' }],
        [],
        activeRecord()
      );
      expect(result.applied).toHaveLength(1);
      expect(result.stopped).toBe(0);
    });

    it('stops after the paste lands when Stop is clicked meanwhile', async () => {
      const result = await bothPaths(
        'ab',
        [{ kind: 'paste', selection: { start: 1, end: 1 } }, { kind: 'stop' }],
        [],
        activeRecord()
      );
      expect(result.stopped).toBe(1);
      expect(result.rows.at(-1)).toBe('lastb');
    });

    it('commits a lane asked meanwhile (copy all) after the paste lands', async () => {
      const result = await bothPaths(' y ', [
        { kind: 'paste', selection: { start: 2, end: 2 } },
        { kind: 'commit-lane' }
      ]);
      expect(result.rows[0]).toBe('ys0.js');
      // The caret's row is committed too: its trailing space is gone.
      expect(result.rows.at(-1)).toBe('last');
    });

    it('applies the landed rows when Apply is clicked meanwhile', async () => {
      const result = await bothPaths('  ab', [
        { kind: 'paste', selection: { start: 3, end: 3 } },
        { kind: 'leave' },
        { kind: 'apply' }
      ]);
      expect(result.applied).toHaveLength(1);
      const [set] = result.applied[0] as [ExclusionSet];
      expect(set.rows.delayJs[0]).toBe('as0.js');
      expect(set.rows.delayJs.at(-1)).toBe('lastb');
    });

    /** Lines that cost the most to check: rows at the wire's row cap, and ones dense in classes. */
    const COSTLY = {
      'wire-cap': (n: number) => `/p${String(n)}/${'a'.repeat(2000)}.js`,
      'class-heavy': (n: number) => `p${String(n)}${'[a-z]'.repeat(399)}`
    } as const;

    it.each(Object.entries(COSTLY))(
      'slices a paste of %s rows by time, landing exactly as at once',
      async (_shape, line) => {
        // Under the row bound, over the character bound: sliced all the same.
        const text = [...Array.from({ length: 40 }, (_, n) => line(n)), line(1), 'last'].join('\n');
        const result = await bothPaths(
          'ab',
          [{ kind: 'paste', selection: { start: 1, end: 1 } }, { kind: 'leave' }],
          [],
          { state: 'inactive' },
          text
        );
        expect(result.outcome).toEqual({ kind: 'pasted' });
        // The duplicate of row 1 is dropped as WP Rocket's save would.
        expect(result.rows).toHaveLength(41);
        expect(result.rows[0]).toBe(`a${line(0)}`);
        expect(result.rows.at(-1)).toBe('lastb');
      }
    );

    it('commits rows for one slice budget per task', async () => {
      // 1 ms per clock read: a slice keeps committing until its budget is spent.
      const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
      const [id = ''] = controller.insertRows('delayJs', ['x'], null);
      const lines = Array.from({ length: 200 }, (_, n) => `t${String(n)}.js`);
      const outcome = controller.pasteRows('delayJs', id, lines.join('\n'), { start: 1, end: 1 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      // 199 rows to commit (the caret's row is not), TASK_SLICE_MS rows a slice.
      const slices = 1 + (await runSlices(clock));
      expect(slices).toBe(Math.ceil(199 / TASK_SLICE_MS));
      await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
    });

    it('commits at least one row a slice however slow the rows are', async () => {
      // Every clock read is a budget and more: one row per slice, never none.
      const slow = ticking(TASK_SLICE_MS * 10);
      const { controller, clock } = await started(
        fakePort({ state: 'inactive' }).port,
        undefined,
        slow
      );
      const [id = ''] = controller.insertRows('delayJs', ['x'], null);
      const lines = Array.from({ length: PASTE_AT_ONCE.rows + 6 }, (_, n) => `u${String(n)}.js`);
      const outcome = controller.pasteRows('delayJs', id, lines.join('\n'), { start: 1, end: 1 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      // One row a slice for the 69 rows to commit, then one reading past the caret's row.
      const slices = 1 + (await runSlices(clock));
      expect(slices).toBe(lines.length);
      await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
      expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual([
        'xu0.js',
        ...lines.slice(1)
      ]);
    });

    it('resets after the paste lands when Reset is clicked meanwhile', async () => {
      const active = {
        ...activeRecord(),
        set: {
          ...EMPTY_EXCLUSION_SET,
          rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['kept.js'] }
        }
      };
      const result = await bothPaths(
        'ab',
        [{ kind: 'paste', selection: { start: 1, end: 1 } }, { kind: 'reset' }],
        [],
        active
      );
      expect(result.rows).toEqual(['kept.js']);
      expect(result.applied).toHaveLength(1);
    });

    it('says it is pasting, taking no edit or second paste until the rows land', async () => {
      const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
      const [id = ''] = controller.insertRows('delayJs', ['x'], null);
      const outcome = controller.pasteRows('delayJs', id, LONG, { start: 1, end: 1 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      expect(controller.pasting()).toBe(true);
      // The lane says so: a second paste's selection would point into rows about to change.
      expect(controller.pasteRows('delayJs', id, 'p\nq', { start: 0, end: 0 })).toEqual({
        kind: 'ignored'
      });
      expect(controller.insertRows('delayJs', ['y'], null)).toEqual([]);
      await runSlices(clock);
      await outcome.done;
      expect(controller.pasting()).toBe(false);
      expect(controller.draft().rows.delayJs.map((row) => row.text)).not.toContain('p');
    });

    it('runs the rest of the held actions when one throws, naming it in the log', async () => {
      const fake = fakePort(activeRecord());
      const { controller, clock, log } = await started(fake.port);
      const [id = ''] = controller.insertRows('delayJs', ['ab'], null);
      fake.port.stop.mockImplementation(() => {
        throw new Error('port gone');
      });
      const outcome = controller.pasteRows('delayJs', id, `${LONG} `, { start: 2, end: 2 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      controller.stop();
      controller.commitLane('delayJs');
      await runSlices(clock);
      await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
      expect(log.warn).toHaveBeenCalledWith('held stop after a paste failed', expect.any(Error));
      // The lane commit after it ran: the caret row is stored trimmed.
      expect(controller.draft().rows.delayJs.at(-1)?.text).toBe('last');
      expect(controller.pasting()).toBe(false);
    });

    it('closing lands the paste and its held commits, applies nothing, and saves', async () => {
      const fake = fakePort({ state: 'inactive' });
      const { controller, clock, dispose } = await started(fake.port);
      const [id = ''] = controller.insertRows('delayJs', ['ab'], null);
      const outcome = controller.pasteRows('delayJs', id, `${LONG} `, { start: 2, end: 2 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      controller.commitRow('delayJs', id);
      controller.apply();
      controller.dispose();
      dispose();
      await expect(outcome.done).resolves.toEqual({ kind: 'pasted' });
      expect(clock.pending(0)).toBe(0);
      // The held leave committed the caret's row: 'last ' stored trimmed.
      expect(controller.draft().rows.delayJs.at(-1)?.text).toBe('last');
      expect(fake.port.apply).not.toHaveBeenCalled();
      expect(fake.port.save).toHaveBeenLastCalledWith(draftToSet(controller.draft()));
    });

    it('closing after the landing, before the held actions ran, runs the commits and saves', async () => {
      const fake = fakePort({ state: 'inactive' });
      const { controller, clock, dispose } = await started(fake.port);
      const [id = ''] = controller.insertRows('delayJs', ['ab'], null);
      const outcome = controller.pasteRows('delayJs', id, `${LONG} `, { start: 2, end: 2 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      controller.commitRow('delayJs', id);
      controller.apply();
      // Every slice, but not the held actions' task.
      while (clock.pending(0) > 0) {
        clock.fire(0);
        await settle();
        if (controller.draft().rows.delayJs.length > 1) break;
      }
      await outcome.done;
      expect(controller.pasting()).toBe(true);
      controller.dispose();
      dispose();
      expect(controller.pasting()).toBe(false);
      expect(controller.draft().rows.delayJs.at(-1)?.text).toBe('last');
      expect(fake.port.apply).not.toHaveBeenCalled();
      expect(fake.port.save).toHaveBeenLastCalledWith(draftToSet(controller.draft()));
    });
  });

  it('adds a candidate once, focusing its row only when asked', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    expect(controller.addCandidate('delayJs', 'gtag', false)).toBe(true);
    expect(controller.focusRequest()).toBeNull();
    expect(controller.addCandidate('delayJs', 'gtag', true)).toBe(false);
    expect(controller.draft().rows.delayJs).toHaveLength(1);
    expect(controller.focusRequest()?.lane).toBe('delayJs');
  });

  it('moves focus to a neighbor when a row is removed', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [first, second] = controller.insertRows('delayJs', ['a', 'b'], null);
    controller.removeRow('delayJs', second ?? '');
    expect(controller.focusRequest()).toEqual({ lane: 'delayJs', id: first });
  });

  it('commits a row trimmed when it is left, and saves the trimmed set', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    const [id] = controller.insertRows('lazyload', [''], null);
    controller.editRow('lazyload', id ?? '', ' logo.png\t');
    expect(controller.draft().rows.lazyload[0]?.text).toBe(' logo.png\t');
    controller.commitRow('lazyload', id ?? '');
    expect(controller.draft().rows.lazyload[0]?.text).toBe('logo.png');
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(port.save).toHaveBeenCalledWith({
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['logo.png'] }
    });
  });

  it('saves the stored form once a row left is committed, and says what changed', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    const [id] = controller.insertRows('lazyload', [''], null);
    controller.editRow('lazyload', id ?? '', ' logo%41.png ');
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(controller.saveState()).toEqual({ kind: 'saved' });
    controller.commitRow('lazyload', id ?? '');
    expect(controller.draft().rows.lazyload[0]?.text).toBe('logo.png');
    expect(controller.notes().latest?.news).toEqual([
      {
        lane: 'lazyload',
        position: 1,
        diff: { state: 'stored-as', stored: 'logo.png', typed: ' logo%41.png ' },
        copyOf: null
      }
    ]);
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(controller.saveState()).toEqual({ kind: 'saved' });
    expect(port.save).toHaveBeenCalledTimes(2);
    expect(port.save).toHaveBeenLastCalledWith({
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['logo.png'] }
    });
    // Committing it again changes nothing: no save, no news.
    controller.commitRow('lazyload', id ?? '');
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).toHaveBeenCalledTimes(2);
  });

  it('removes a committed row WP Rocket drops, keeping its typed text for an undo', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [id] = controller.insertRows('delayJs', [''], null);
    controller.editRow('delayJs', id ?? '', '(');
    expect(controller.rowProblem('delayJs', id ?? '', '(')).toMatch(/^WP Rocket drops this row/);
    controller.commitRow('delayJs', id ?? '');
    expect(controller.draft().rows.delayJs).toEqual([]);
    expect(controller.notes().lanes.delayJs.removed).toMatchObject([
      {
        id,
        index: 0,
        diff: { state: 'dropped', reason: 'invalid-pattern', typed: '(' }
      }
    ]);
  });

  it('stores inserted, pasted and picked rows at once (the row being typed stays as is)', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    expect(controller.insertRows('delayJs', ['a*', 'a.*', '0'], null)).toHaveLength(1);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['a(.*)']);
    const [id] = controller.insertRows('delayJs', [''], null);
    controller.pasteRows('delayJs', id ?? '', 'b*\nc*', { start: 0, end: 0 });
    // `b*` is stored; `c*` holds the caret and stays typed until left.
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual([
      'a(.*)',
      'b(.*)',
      'c*'
    ]);
    expect(controller.addCandidate('delayJs', 'x%41.js', false)).toBe(true);
    expect(controller.draft().rows.delayJs.at(-1)?.text).toBe('x.js');
    expect(controller.notes().latest?.news).toEqual([
      expect.objectContaining({ diff: { state: 'stored-as', stored: 'x.js', typed: 'x%41.js' } })
    ]);
  });

  it('commits every row before an apply, so the set sent is the stored form', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    const [id] = controller.insertRows('delayJs', [''], null);
    controller.editRow('delayJs', id ?? '', ' q* ');
    controller.apply();
    expect(port.apply).toHaveBeenCalledWith({
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['q(.*)'] }
    });
  });

  it('marks edits against the active set as dirty', async () => {
    const { controller } = await started(fakePort(activeRecord()).port);
    controller.setDisable('lazyRender', true);
    expect(controller.dirty()).toBe(true);
  });
});

describe('apply / reset / stop', () => {
  it('applies the draft (blank rows dropped, rows trimmed) and waits for the reload, then offers a manual one', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock, reload } = await started(port);
    // Still being typed (never committed): applied trimmed all the same.
    controller.insertRows('delayJs', [' gtag\t', '  '], null);
    controller.apply();
    expect(controller.state()).toMatchObject({ phase: 'ready', pending: 'apply' });
    await settle();
    expect(port.apply).toHaveBeenCalledWith({
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['gtag'] }
    });
    expect(controller.state()).toEqual({ phase: 'reloading' });
    // Changed in audit round 1: an overdue reload re-reads the status and
    // returns to an editable ready state with a notice (was a locked state).
    port.status.mockResolvedValueOnce({ kind: 'reply', reply: activeRecord() } as never);
    clock.fire(RELOAD_STALL_MS);
    await settle();
    expect(controller.state()).toMatchObject({
      phase: 'ready',
      status: { state: 'active' },
      notice: { kind: 'reload-stalled' }
    });
    controller.reloadPage();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses to ask with invalid rows, focusing the first one', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    // A backtracking risk blocks (K.5c: a row matching everything only warns).
    const [bad] = controller.insertRows('deferJs', ['(a+)+$'], null);
    controller.insertRows('delayJs', ['ok'], null);
    expect(controller.invalidCount()).toBe(1);
    controller.apply();
    expect(port.apply).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ notice: { kind: 'invalid', rows: 1 } });
    expect(controller.focusRequest()).toEqual({ lane: 'deferJs', id: bad });
  });

  it('shows the background reasons on the rows it refused until they change', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.apply.mockResolvedValueOnce({
      kind: 'reply',
      reply: {
        outcome: 'invalid',
        invalid: [{ feature: 'lazyload', index: 0, row: 'x', reason: 'Nope' }]
      }
    } as never);
    const { controller } = await started(port);
    const [blank, real] = controller.insertRows('lazyload', [' ', 'x'], null);
    controller.apply();
    await settle();
    expect(controller.rowProblem('lazyload', real ?? '', 'x')).toBe('Nope');
    expect(controller.rowProblem('lazyload', blank ?? '', ' ')).toBeNull();
    controller.editRow('lazyload', real ?? '', 'y');
    expect(controller.rowProblem('lazyload', real ?? '', 'y')).toBeNull();
  });

  it('turns an unavailable answer into the warning, Retry applying again', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.apply.mockResolvedValueOnce({
      kind: 'reply',
      reply: { outcome: 'unavailable', cause: 'attach-denied' }
    } as never);
    const { controller } = await started(port);
    controller.apply();
    await settle();
    expect(controller.view()).toEqual({
      kind: 'unavailable',
      cause: 'attach-denied',
      retryable: true
    });
    controller.apply();
    await settle();
    expect(port.apply).toHaveBeenCalledTimes(2);
  });

  it('names a failed ask in the notice', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.apply.mockResolvedValueOnce({ kind: 'problem', problem: 'context-invalidated' });
    const { controller } = await started(port);
    controller.apply();
    await settle();
    expect(controller.state()).toMatchObject({
      notice: { kind: 'action-failed', action: 'apply', problem: 'context-invalidated' }
    });
  });

  it('refuses a draft over the wire cap', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    controller.insertRows(
      'lazyload',
      Array.from({ length: 40 }, (_, index) => `${String(index)}${'z'.repeat(2000)}`),
      null
    );
    controller.apply();
    expect(port.apply).not.toHaveBeenCalled();
    expect(controller.state()).toMatchObject({ notice: { kind: 'too-large' } });
  });

  it('resets to the applied set and re-applies it', async () => {
    const { port } = fakePort(activeRecord());
    const { controller } = await started(port);
    controller.insertRows('delayJs', ['extra'], null);
    controller.reset();
    expect(controller.dirty()).toBe(false);
    await settle();
    expect(port.apply).toHaveBeenCalledWith(validSet());
  });

  it('stops and says the page needs a reload to be unmodified', async () => {
    const { port } = fakePort(activeRecord());
    const { controller } = await started(port);
    controller.stop();
    await settle();
    expect(port.stop).toHaveBeenCalledTimes(1);
    expect(controller.state()).toEqual({
      phase: 'ready',
      status: { state: 'inactive' },
      pending: null,
      notice: { kind: 'stopped' }
    });
  });

  it('keeps the stopped notice when the cleared status is pushed before the answer', async () => {
    const fake = fakePort(activeRecord());
    fake.port.stop.mockImplementationOnce(() => {
      fake.push({ state: 'inactive' });
      return reply<ExclusionSessionStatus>({ state: 'inactive' });
    });
    const { controller } = await started(fake.port);
    controller.stop();
    await settle();
    expect(controller.state()).toMatchObject({ notice: { kind: 'stopped' } });
  });

  it('ignores Stop and Reset when nothing is applied', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    controller.stop();
    controller.reset();
    expect(port.stop).not.toHaveBeenCalled();
    expect(port.apply).not.toHaveBeenCalled();
  });
});

describe('fitsAtOnce', () => {
  const rows = [
    { id: 'a', text: 'aaaa' },
    { id: 'b', text: 'bb' },
    { id: 'c', text: 'cccccc' }
  ];

  it('bounds the rows to commit by count and by characters', () => {
    expect(fitsAtOnce(rows, ['a', 'b'], { rows: 2, chars: 6 })).toBe(true);
    expect(fitsAtOnce(rows, ['a', 'b', 'c'], { rows: 2, chars: 100 })).toBe(false);
    expect(fitsAtOnce(rows, ['a', 'b'], { rows: 2, chars: 5 })).toBe(false);
  });

  it('counts only the rows to commit', () => {
    // `c` stays as it is (the caret's row): its characters cost nothing now.
    expect(fitsAtOnce(rows, ['b'], { rows: 1, chars: 2 })).toBe(true);
    expect(fitsAtOnce(rows, [], { rows: 0, chars: 0 })).toBe(true);
  });

  it('keeps the shipped bounds for short pastes of ordinary rows', () => {
    const ordinary = Array.from({ length: 64 }, (_, n) => ({
      id: String(n),
      text: `/wp-content/plugins/p${String(n)}/assets/js/script.min.js`
    }));
    const ids = ordinary.map((row) => row.id);
    expect(fitsAtOnce(ordinary, ids, PASTE_AT_ONCE)).toBe(true);
    expect(fitsAtOnce([...ordinary, { id: 'x', text: 'x' }], [...ids, 'x'], PASTE_AT_ONCE)).toBe(
      false
    );
  });
});

describe('invalidRowsById', () => {
  it('counts non-blank rows only and skips unknown rows', () => {
    // A blank (unfinished) row in the draft, never in the set.
    const draft = {
      ...draftFromSet(EMPTY_EXCLUSION_SET, createIdSource()),
      rows: {
        ...EMPTY_EXCLUSION_SET.rows,
        delayJs: [],
        deferJs: [
          { id: 'r1', text: ' ' },
          { id: 'r2', text: 'a' },
          { id: 'r3', text: 'b' }
        ],
        lazyload: [],
        lazyRender: []
      }
    };
    const byId = invalidRowsById(draft, [
      { feature: 'defer_all_js', index: 1, row: 'b', reason: 'R' },
      { feature: 'defer_all_js', index: 9, row: '?', reason: 'gone' }
    ]);
    expect([...byId.values()]).toEqual(['R']);
    expect(byId.has(draft.rows.deferJs[2]?.id ?? '')).toBe(true);
  });
});

describe('audit round 1', () => {
  it('reopening an active session restores unapplied saved edits instead of discarding them', async () => {
    const edited = { ...validSet(), rows: { ...validSet().rows, lazyload: ['edited.png'] } };
    const { port } = fakePort(activeRecord(), edited);
    const { controller, clock } = await started(port);
    expect(controller.draft().rows.lazyload.map((row) => row.text)).toEqual(['edited.png']);
    expect(controller.dirty()).toBe(true);
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).not.toHaveBeenCalled();
  });

  it('re-reads the status when a push lands while loading', async () => {
    const fake = fakePort({ state: 'inactive' });
    let releaseStatus: (value: PortOutcome<ExclusionSessionStatus>) => void = () => undefined;
    fake.port.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStatus = resolve;
        })
    );
    const clock = timers();
    let controller: OverlayController | undefined;
    createRoot(() => {
      controller = createOverlayController({
        port: fake.port,
        pageFacts: () => ({
          href: 'https://example.com/',
          documentUrl: null,
          navigationStart: 0,
          responseEnd: null
        }),
        now: () => 1,
        schedule: clock.schedule,
        reload: vi.fn(),
        log: { warn: vi.fn() }
      });
    });
    controller?.start();
    fake.push({ state: 'unavailable', cause: 'detached', at: 3 });
    fake.port.status.mockResolvedValueOnce({
      kind: 'reply',
      reply: { state: 'unavailable', cause: 'detached', at: 3 }
    } as never);
    releaseStatus({ kind: 'reply', reply: { state: 'inactive' } });
    await settle();
    await settle();
    expect(controller?.view()).toEqual({ kind: 'unavailable', cause: 'detached', retryable: true });
  });

  it('ignores edits while an action is in flight', async () => {
    const { port } = fakePort({ state: 'inactive' });
    let finish: (value: PortOutcome<never>) => void = () => undefined;
    port.apply.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { controller } = await started(port);
    const [id] = controller.insertRows('delayJs', ['gtag'], null);
    controller.apply();
    controller.editRow('delayJs', id ?? '', 'changed');
    controller.insertRows('delayJs', ['more'], null);
    controller.removeRow('delayJs', id ?? '');
    controller.setDisable('delayJs', true);
    controller.pasteRows('delayJs', id ?? '', 'a\nb', { start: 0, end: 0 });
    expect(controller.addCandidate('delayJs', 'x', false)).toBe(false);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag']);
    expect(controller.draft().disable.delayJs).toBe(false);
    finish({ kind: 'problem', problem: 'timeout' });
  });

  it('trims a row left while an action is in flight (set-neutral, so not held back)', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.apply.mockImplementationOnce(() => new Promise(() => undefined));
    const { controller } = await started(port);
    const [id] = controller.insertRows('delayJs', [' gtag\t'], null);
    controller.apply();
    expect(controller.editable()).toBe(false);
    controller.commitRow('delayJs', id ?? '');
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag']);
    expect(port.save).not.toHaveBeenCalled();
  });

  it('does not ask to save a draft the session cannot carry, and says why', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    controller.insertRows('lazyload', ['x'.repeat(3000)], null);
    clock.fire(AUTOSAVE_DELAY_MS);
    await settle();
    expect(port.save).not.toHaveBeenCalled();
    expect(controller.saveState()).toEqual({ kind: 'not-saved', reason: 'invalid-request' });
  });

  it('clears the fix-rows notice once no row has a problem', async () => {
    const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
    const [bad] = controller.insertRows('deferJs', ['(a+)+$'], null);
    controller.apply();
    expect(controller.state()).toMatchObject({ notice: { kind: 'invalid', rows: 1 } });
    controller.editRow('deferJs', bad ?? '', '\\(');
    // Changed in K.5b rework: judged once the lane's set reading caught up (a
    // Defer row may still be wrong joined with the others).
    expect(controller.state()).toMatchObject({ notice: { kind: 'invalid' } });
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.state()).toMatchObject({ notice: null });
  });

  it('retries the failed action', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.apply.mockResolvedValueOnce({ kind: 'problem', problem: 'timeout' });
    const { controller } = await started(port);
    controller.apply();
    await settle();
    controller.retryFailedAction();
    await settle();
    expect(port.apply).toHaveBeenCalledTimes(2);
    expect(controller.state()).toEqual({ phase: 'reloading' });
  });
});

describe('stored-form notes and undo', () => {
  /** A ready controller with one typed Delay JS row left (committed). */
  async function typedAndLeft(typed: string, before: readonly string[] = []) {
    const { port } = fakePort({ state: 'inactive' });
    const ctx = await started(port);
    ctx.controller.insertRows('delayJs', before, null);
    const [id = ''] = ctx.controller.insertRows('delayJs', [''], null);
    ctx.controller.editRow('delayJs', id, typed);
    const commit = ctx.controller.commitRow('delayJs', id);
    return { ...ctx, port, id, commit };
  }

  const delayNotes = (controller: OverlayController) => controller.notes().lanes.delayJs;

  it('notes a converted row, and Undo puts the typed text back for editing', async () => {
    const { controller, id, commit } = await typedAndLeft('jquery-*.js');
    expect(commit?.diff).toEqual({
      state: 'stored-as',
      stored: 'jquery-(.*).js',
      typed: 'jquery-*.js'
    });
    expect(delayNotes(controller).rows.get(id)).toEqual({ diff: commit?.diff, undoable: true });
    expect(controller.notes().latest).toEqual({
      source: 'row',
      news: [{ lane: 'delayJs', position: 1, diff: commit?.diff, copyOf: null }]
    });
    expect(controller.undoCommit('delayJs', id)).toBe(true);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['jquery-*.js']);
    expect(controller.focusRequest()).toEqual({ lane: 'delayJs', id, caret: 11 });
    expect(delayNotes(controller).rows.has(id)).toBe(false);
    // A second undo of the same note does nothing.
    expect(controller.undoCommit('delayJs', id)).toBe(false);
    // Leaving the row again converts it again, with the same note.
    controller.commitRow('delayJs', id);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['jquery-(.*).js']);
    expect(delayNotes(controller).rows.get(id)?.undoable).toBe(true);
  });

  it('ends the undo with the next edit in the lane, but not with an edit elsewhere', async () => {
    const { controller, id } = await typedAndLeft('a*', ['other']);
    const other = controller.draft().rows.delayJs[0]?.id ?? '';
    const [lazy = ''] = controller.insertRows('lazyload', [''], null);
    controller.editRow('lazyload', lazy, 'x.png');
    controller.setDisable('delayJs', true);
    expect(delayNotes(controller).rows.get(id)?.undoable).toBe(true);
    controller.editRow('delayJs', other, 'other2');
    // The note stays (it is still true), its undo is gone.
    expect(delayNotes(controller).rows.get(id)?.undoable).toBe(false);
    expect(controller.undoCommit('delayJs', id)).toBe(false);
    // Editing the row itself drops its note.
    controller.editRow('delayJs', id, 'b');
    expect(delayNotes(controller).rows.has(id)).toBe(false);
  });

  it('ends the undo on insert, paste, remove and pick in the lane', async () => {
    const keep = (c: OverlayController): string => c.draft().rows.delayJs[0]?.id ?? '';
    const edits: readonly ((controller: OverlayController) => void)[] = [
      (c) => c.insertRows('delayJs', [''], null),
      (c) => {
        c.removeRow('delayJs', keep(c));
      },
      (c) => c.pasteRows('delayJs', keep(c), 'p\nq', { start: 0, end: 0 }),
      (c) => c.addCandidate('delayJs', 'picked.js', false)
    ];
    for (const edit of edits) {
      const { controller, id } = await typedAndLeft('a*', ['keep']);
      edit(controller);
      expect(delayNotes(controller).rows.get(id)?.undoable).toBe(false);
    }
    // Removing an unknown row is no edit: the undo survives it.
    const { controller, id } = await typedAndLeft('a*');
    controller.removeRow('delayJs', 'unknown');
    expect(delayNotes(controller).rows.get(id)?.undoable).toBe(true);
  });

  it('lists a removed duplicate after its anchor, and restores it at its place', async () => {
    const { controller, id } = await typedAndLeft(' gtag ', ['gtag', 'b']);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag', 'b']);
    const anchor = controller.draft().rows.delayJs[1]?.id;
    expect(delayNotes(controller).removed).toEqual([
      {
        id,
        anchor,
        before: [],
        index: 2,
        diff: { state: 'dropped', reason: 'duplicate', typed: ' gtag ' }
      }
    ]);
    expect(controller.notes().latest?.news[0]?.copyOf).toBe(1);
    expect(controller.undoCommit('delayJs', id)).toBe(true);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag', 'b', ' gtag ']);
    expect(controller.focusRequest()).toEqual({ lane: 'delayJs', id, caret: 6 });
    expect(delayNotes(controller).removed).toEqual([]);
  });

  it('refuses an undo while an action is in flight', async () => {
    const { controller, id, port } = await typedAndLeft('a*');
    port.apply.mockReturnValueOnce(new Promise(() => undefined));
    controller.apply();
    expect(controller.editable()).toBe(false);
    expect(controller.undoCommit('delayJs', id)).toBe(false);
  });

  it('notes the rows a paste converts and removes, as one batch', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    controller.pasteRows('delayJs', id, 'a*\nb*\na.*\n0\nlast', { start: 0, end: 0 });
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual([
      'a(.*)',
      'b(.*)',
      'last'
    ]);
    const lane = delayNotes(controller);
    expect(lane.summary).toEqual({ source: 'paste', changed: 2, removed: 2 });
    expect(lane.removed.map((note) => note.diff.typed)).toEqual(['a.*', '0']);
    expect(controller.notes().latest?.source).toBe('paste');
  });

  it('notes the rows a saved typed-row draft converts on restore; a reset clears notes', async () => {
    const saved = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['a*', 'a.*', 'ok'] }
    };
    const active = { ...activeRecord(), set: { ...EMPTY_EXCLUSION_SET } };
    const { controller } = await started(fakePort(active, saved).port);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['a(.*)', 'ok']);
    expect(controller.notes().latest?.source).toBe('restore');
    expect(delayNotes(controller).summary).toEqual({ source: 'restore', changed: 1, removed: 1 });
    controller.reset();
    expect(controller.notes().lanes.delayJs.rows.size).toBe(0);
    expect(controller.notes().lanes.delayJs.removed).toEqual([]);
  });

  it('notes the row an apply commits; a picked duplicate is no news', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    const [id = ''] = controller.insertRows('lazyload', [''], null);
    controller.editRow('lazyload', id, ' logo.png ');
    controller.apply();
    expect(controller.notes().latest?.source).toBe('apply');
    expect(controller.notes().lanes.lazyload.rows.get(id)?.undoable).toBe(true);
    const fresh = await started(fakePort({ state: 'inactive' }).port);
    fresh.controller.addCandidate('lazyload', 'logo.png', false);
    const before = fresh.controller.notes();
    expect(fresh.controller.addCandidate('lazyload', 'logo.png', false)).toBe(false);
    expect(fresh.controller.notes()).toBe(before);
    expect(fresh.controller.notes().lanes.lazyload.removed).toEqual([]);
  });
});

describe('notes outlive commits that change nothing (audit round)', () => {
  /** A ready controller with one typed Delay JS row left (committed). */
  async function typedAndLeft(typed: string, before: readonly string[] = []) {
    const { port } = fakePort({ state: 'inactive' });
    const ctx = await started(port);
    ctx.controller.insertRows('delayJs', before, null);
    const [id = ''] = ctx.controller.insertRows('delayJs', [''], null);
    ctx.controller.editRow('delayJs', id, typed);
    ctx.controller.commitRow('delayJs', id);
    return { ...ctx, id };
  }

  const delay = (controller: OverlayController) => controller.notes().lanes.delayJs;
  const texts = (controller: OverlayController): string[] =>
    controller.draft().rows.delayJs.map((row) => row.text);

  it('keeps note and undo when the row is left again (Shift+Tab, Tab; arrows)', async () => {
    const { controller, id } = await typedAndLeft('a*', ['other']);
    const other = controller.draft().rows.delayJs[0]?.id ?? '';
    for (let pass = 0; pass < 3; pass += 1) {
      controller.commitRow('delayJs', id);
      controller.commitRow('delayJs', other);
    }
    expect(delay(controller).rows.get(id)?.undoable).toBe(true);
    expect(controller.undoCommit('delayJs', id)).toBe(true);
    expect(texts(controller)).toEqual(['other', 'a*']);
  });

  it('keeps every earlier note through an apply', async () => {
    const { controller, id } = await typedAndLeft('a*');
    controller.apply();
    await settle();
    expect(delay(controller).rows.get(id)?.undoable).toBe(true);
  });

  it("keeps the paste target's note when focus moves on to the caret row", async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    controller.pasteRows('delayJs', id, ' a* \nb', { start: 0, end: 0 });
    // The target row blurs as focus moves to the caret row: it commits again.
    controller.commitRow('delayJs', id);
    expect(delay(controller).rows.get(id)?.undoable).toBe(true);
  });

  it('keeps a restored draft’s notes through a focus pass over every row', async () => {
    const saved = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['a*', 'a.*', 'ok'] }
    };
    const { controller } = await started(fakePort({ state: 'inactive' }, saved).port);
    for (const row of controller.draft().rows.delayJs) controller.commitRow('delayJs', row.id);
    const [removed] = delay(controller).removed;
    expect(removed?.diff.typed).toBe('a.*');
    expect(delay(controller).rows.size).toBe(1);
    expect(controller.undoCommit('delayJs', removed?.id ?? '')).toBe(true);
    expect(texts(controller)).toEqual(['a(.*)', 'a.*', 'ok']);
  });

  it('restores removals of different batches in place, in either order', async () => {
    for (const reverse of [false, true]) {
      const { controller } = await started(fakePort({ state: 'inactive' }).port);
      controller.insertRows('delayJs', ['x'], null);
      const [id = ''] = controller.insertRows('delayJs', [''], null);
      controller.insertRows('delayJs', ['tail'], null);
      controller.pasteRows('delayJs', id, 'x\nb\nx', { start: 0, end: 0 });
      controller.commitRow('delayJs', controller.focusRequest()?.id ?? '');
      expect(texts(controller)).toEqual(['x', 'b', 'tail']);
      const removed = delay(controller).removed.map((note) => note.id);
      for (const target of reverse ? [...removed].reverse() : removed)
        expect(controller.undoCommit('delayJs', target)).toBe(true);
      expect(texts(controller)).toEqual(['x', 'x', 'b', 'x', 'tail']);
    }
  });

  it('restores duplicates of rows elsewhere in the lane in place, last first', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    controller.insertRows('delayJs', ['x', 'y'], null);
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    controller.pasteRows('delayJs', id, 'y\nz\nx\nx\nlast', { start: 0, end: 0 });
    expect(texts(controller)).toEqual(['x', 'y', 'z', 'last']);
    for (const note of [...delay(controller).removed].reverse())
      expect(controller.undoCommit('delayJs', note.id)).toBe(true);
    expect(texts(controller)).toEqual(['x', 'y', 'y', 'z', 'x', 'x', 'last']);
  });

  it('gives the same note when a restored row is left unchanged again', async () => {
    const { controller, id } = await typedAndLeft('gtag', ['gtag']);
    const first = delay(controller).removed[0];
    controller.undoCommit('delayJs', id);
    controller.commitRow('delayJs', id);
    expect(delay(controller).removed).toEqual([first]);
  });

  it('notes the edit after an undo, not the undone text', async () => {
    const { controller, id } = await typedAndLeft('a*');
    controller.undoCommit('delayJs', id);
    controller.editRow('delayJs', id, 'a**');
    controller.commitRow('delayJs', id);
    expect(texts(controller)).toEqual(['a(.*)(.*)']);
    expect(delay(controller).rows.get(id)?.diff.typed).toBe('a**');
  });

  it('holds notes in two lanes at once, each undoable', async () => {
    const { controller, id } = await typedAndLeft('a*');
    const [lazy = ''] = controller.insertRows('lazyload', [''], null);
    controller.editRow('lazyload', lazy, ' logo.png ');
    controller.commitRow('lazyload', lazy);
    expect(controller.undoCommit('delayJs', id)).toBe(true);
    expect(controller.undoCommit('lazyload', lazy)).toBe(true);
    expect(texts(controller)).toEqual(['a*']);
    expect(controller.draft().rows.lazyload.map((row) => row.text)).toEqual([' logo.png ']);
  });

  it('notes the latest of rapid edit and leave rounds', async () => {
    const { controller, id } = await typedAndLeft('a*');
    for (let round = 0; round < 50; round += 1) {
      controller.editRow('delayJs', id, `b${String(round)}*`);
      controller.commitRow('delayJs', id);
    }
    expect(delay(controller).rows.get(id)?.diff.typed).toBe('b49*');
    expect(controller.undoCommit('delayJs', id)).toBe(true);
    expect(texts(controller)).toEqual(['b49*']);
  });

  it('lists the duplicates an insert removes, and forgets a row pasted over', async () => {
    const { controller, id } = await typedAndLeft('a*');
    controller.insertRows('delayJs', ['x', 'x', 'y*'], null);
    expect(texts(controller)).toEqual(['a(.*)', 'x', 'y(.*)']);
    expect(delay(controller).removed).toHaveLength(1);
    controller.pasteRows('delayJs', id, 'p\nq', { start: 0, end: 5 });
    expect(delay(controller).rows.has(id)).toBe(false);
  });

  it('clears notes and the latest batch on a reset', async () => {
    const active = {
      ...activeRecord(),
      set: { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['a.png'] } }
    };
    const { controller } = await started(fakePort(active, null).port);
    const [id = ''] = controller.insertRows('delayJs', [''], null);
    controller.editRow('delayJs', id, 'a*');
    controller.commitRow('delayJs', id);
    expect(controller.notes().latest).not.toBeNull();
    controller.reset();
    expect(controller.notes().latest).toBeNull();
    expect(delay(controller).rows.size).toBe(0);
  });
});

describe('commitLane', () => {
  it('commits every row of one lane (before a copy), leaving other lanes typed', async () => {
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [delay = ''] = controller.insertRows('delayJs', [''], null);
    const [lazy = ''] = controller.insertRows('lazyload', [''], null);
    controller.editRow('delayJs', delay, ' a* ');
    controller.editRow('lazyload', lazy, ' b.png ');
    controller.commitLane('delayJs');
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['a(.*)']);
    expect(controller.draft().rows.lazyload.map((row) => row.text)).toEqual([' b.png ']);
    expect(controller.notes().lanes.delayJs.rows.get(delay)?.undoable).toBe(true);
  });
});

describe('set readings on Apply', () => {
  it('reads an unchanged lane once: Apply reuses its reading', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    const rows = Array.from({ length: 500 }, (_, n) => `/wp-content/p${String(n)}/s.min.js`);
    expect(controller.insertRows('deferJs', rows, null)).toHaveLength(500);
    clock.fire(SET_READING_DELAY_MS);
    // 500 rows take several slices (one 0 ms task each).
    for (let n = 0; n < 1000 && clock.pending(0) > 0; n++) clock.fire(0);
    const read = controller.lanePage('deferJs');
    expect(read).not.toBeNull();
    controller.apply();
    expect(port.apply).toHaveBeenCalledTimes(1);
    // The same reading: nothing was read again.
    expect(controller.lanePage('deferJs')).toBe(read);
  });

  it('reads a lane edited since its reading when Apply is clicked', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    const [first = ''] = controller.insertRows('deferJs', ['jquery', 'gtag'], null);
    clock.fire(SET_READING_DELAY_MS);
    const read = controller.lanePage('deferJs');
    controller.editRow('deferJs', first, '.*');
    controller.apply();
    expect(controller.lanePage('deferJs')).not.toBe(read);
    expect(controller.lanePage('deferJs')?.offRows.map((row) => row.stored)).toEqual(['.*']);
  });
});

describe('Defer JS page-wide warning (K.5b; a warning since K.5c)', () => {
  it('warns on rows that turn Defer JS off page-wide, and lets the apply go out', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    // `.*` consumes all of WP Rocket's pre-check subject: Defer JS turns off page-wide.
    const [, all = ''] = controller.insertRows('deferJs', ['jquery', '.*', 'gtag'], null);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')?.offRows).toEqual([
      { id: all, position: 2, stored: '.*' }
    ]);
    expect(controller.rowProblem('deferJs', all, '.*')).toBeNull();
    expect(controller.rowWarning('deferJs', all, '.*')).toEqual({
      reason: ROW_REASONS.joinedPageOff,
      kind: 'applied'
    });
    expect(controller.invalidCount()).toBe(0);
    controller.apply();
    expect(port.apply).toHaveBeenCalledTimes(1);
    expect(draftToSet(controller.draft()).rows.deferJs).toEqual(['jquery', '.*', 'gtag']);
    // The session accepts the same set, warning on the same row.
    const session = prevalidateExclusionSet(draftToSet(controller.draft()));
    expect(session.valid).toBe(true);
    expect(session.warnings.map(({ index, problem }) => [index, problem])).toEqual([
      [1, 'joined-page-off']
    ]);
  });

  it('reads the set itself at apply, before any pause: a warning lets it through, a joined problem blocks', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    const [, unverified = ''] = controller.insertRows('deferJs', ['a\\.js', '\\p{L}\\Qab'], null);
    // No timer fired: the editor has not read the set yet.
    expect(controller.lanePage('deferJs')).toBeNull();
    controller.apply();
    expect(port.apply).toHaveBeenCalledTimes(1);
    expect(controller.rowWarning('deferJs', unverified, '\\p{L}\\Qab')).toEqual({
      reason: ROW_REASONS.joinedPageOff,
      kind: 'applied'
    });
    expect(prevalidateExclusionSet(draftToSet(controller.draft())).valid).toBe(true);
  });

  it('blocks a joined-only problem at once, before any pause', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    const [leak = ''] = controller.insertRows('deferJs', ['(?-i)zzz', 'A.JS'], null);
    expect(controller.lanePage('deferJs')).toBeNull();
    controller.apply();
    expect(port.apply).not.toHaveBeenCalled();
    expect(controller.focusRequest()).toEqual({ lane: 'deferJs', id: leak });
    expect(prevalidateExclusionSet(draftToSet(controller.draft())).valid).toBe(false);
  });

  it('warns on a row matching every script and lets the apply go out (K.5c)', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    const [delay = ''] = controller.insertRows('delayJs', ['(?a)'], null);
    const [defer = ''] = controller.insertRows('deferJs', ['ok', 'zzz|'], null);
    const warning = { reason: ROW_REASONS.matchAll, kind: 'applied' };
    expect(controller.rowWarning('delayJs', delay, '(?a)')).toEqual(warning);
    expect(controller.rowProblem('delayJs', delay, '(?a)')).toBeNull();
    controller.apply();
    expect(port.apply).toHaveBeenCalledTimes(1);
    expect(controller.rowWarning('deferJs', defer, 'zzz|')).toEqual(warning);
  });

  it('keeps a blank row’s warning apart, and drops every warning on a row with a problem', async () => {
    const { port } = fakePort({ state: 'inactive' });
    port.apply.mockResolvedValueOnce({
      kind: 'reply',
      reply: {
        outcome: 'invalid',
        invalid: [{ feature: 'delay_js', index: 0, row: '(?a)', reason: 'Refused' }]
      }
    } as never);
    const { controller } = await started(port);
    const [blank = ''] = controller.insertRows('lazyRender', [''], null);
    controller.editRow('lazyRender', blank, '  ');
    expect(controller.rowWarning('lazyRender', blank, '  ')).toMatchObject({ kind: 'blank' });
    const [refused = ''] = controller.insertRows('delayJs', ['(?a)'], null);
    controller.apply();
    await settle();
    // The background's reason wins: no warning beside it.
    expect(controller.rowProblem('delayJs', refused, '(?a)')).toBe('Refused');
    expect(controller.rowWarning('delayJs', refused, '(?a)')).toBeNull();
  });

  it('marks a joined-only row problem before asking (no page message), focusing the row', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    const [leak = ''] = controller.insertRows('deferJs', ['(?-i)zzz', 'A.JS'], null);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.rowProblem('deferJs', leak, '(?-i)zzz')).toMatch(
      /^Joined with the other Defer JS rows/
    );
    expect(controller.lanePage('deferJs')?.offRows).toEqual([]);
    controller.apply();
    expect(port.apply).not.toHaveBeenCalled();
    expect(controller.focusRequest()).toEqual({ lane: 'deferJs', id: leak });
  });

  it('keeps the last reading for unchanged rows while the next one waits, never for changed ones', async () => {
    const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
    const [first = '', , last = ''] = controller.insertRows(
      'deferJs',
      ["(?'n'a)", 'ok', "(?'n'b)"],
      null
    );
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')?.offRows.map(({ id }) => id)).toEqual([first, last]);
    // An edit elsewhere: the message stays (its rows are unchanged) until the reading.
    controller.insertRows('deferJs', ['x'], null);
    expect(controller.lanePage('deferJs')?.offRows.map(({ id }) => id)).toEqual([first, last]);
    // An edit to a named row: the message leaves at once; the other row keeps its warning.
    controller.editRow('deferJs', last, "(?'n'b");
    expect(controller.lanePage('deferJs')?.offRows).toEqual([]);
    expect(controller.lanePage('deferJs')?.warnings.has(first)).toBe(true);
    expect(controller.lanePage('deferJs')?.warnings.has(last)).toBe(false);
  });

  it('drops a scheduled reading the lane outran, reading once after the last change', async () => {
    const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
    const [row = ''] = controller.insertRows('deferJs', ['.*'], null);
    controller.editRow('deferJs', row, '.*x');
    controller.editRow('deferJs', row, 'jquery');
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')).toEqual({
      page: 'on',
      offRows: [],
      problems: new Map(),
      warnings: new Map()
    });
  });

  it('names the row that stays when a typed copy repeats a row behind the page-off', async () => {
    const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
    const [typed = '', , kept = ''] = controller.insertRows(
      'deferJs',
      ['jquery', 'ok', '.*'],
      null
    );
    // Row 1 retyped as a copy of row 3, still being edited: its commit will drop it.
    controller.editRow('deferJs', typed, '.*');
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')?.offRows.map(({ id }) => id)).toEqual([kept]);
    // Leaving it commits it: it leaves, and the message still names the same row.
    controller.commitRow('deferJs', typed);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.draft().rows.deferJs.map((row) => row.id)).not.toContain(typed);
    expect(controller.lanePage('deferJs')?.offRows.map(({ id }) => id)).toEqual([kept]);
  });

  it('applies a set the session accepts though a row alone would fail (`a\\Qb` + `zz\\E`)', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    controller.insertRows('deferJs', ['a\\Qb', 'zz\\E'], null);
    // Alone, `a\Qb` quotes the joined pattern's closing parenthesis; joined, `\E` ends it.
    expect(controller.invalidCount()).toBe(0);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')?.offRows).toEqual([]);
    expect(controller.invalidCount()).toBe(0);
    expect(prevalidateExclusionSet(draftToSet(controller.draft())).valid).toBe(true);
    controller.apply();
    expect(port.apply).toHaveBeenCalledTimes(1);
  });

  it('lets through an apply right after a fix, before the reading’s pause', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock } = await started(port);
    const [, , named = ''] = controller.insertRows('deferJs', ["(?'n'a)x", 'ok', "(?'n'b)x"], null);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')?.offRows).toHaveLength(2);
    controller.editRow('deferJs', named, 'plainb');
    controller.editRow('deferJs', controller.draft().rows.deferJs[0]?.id ?? '', 'plaina');
    controller.apply();
    expect(controller.invalidCount()).toBe(0);
    expect(port.apply).toHaveBeenCalledTimes(1);
  });

  it('reads no page for lanes whose rows act alone', async () => {
    const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
    controller.insertRows('delayJs', ['.*', '.*x'], null);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('delayJs')).toBeNull();
    expect(controller.lanePage('lazyload')).toBeNull();
    expect(controller.lanePage('deferJs')).toEqual({
      page: 'on',
      offRows: [],
      problems: new Map(),
      warnings: new Map()
    });
  });

  it('re-reads a lane only when its own rows change', async () => {
    const { controller, clock } = await started(fakePort({ state: 'inactive' }).port);
    controller.insertRows('deferJs', ['a'], null);
    clock.fire(SET_READING_DELAY_MS);
    const before = controller.lanePage('deferJs');
    controller.insertRows('delayJs', ['b'], null);
    clock.fire(SET_READING_DELAY_MS);
    expect(controller.lanePage('deferJs')).toBe(before);
  });
});
