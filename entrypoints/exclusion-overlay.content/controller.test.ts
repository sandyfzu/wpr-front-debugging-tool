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
  RELOAD_STALL_MS,
  createOverlayController,
  invalidRowsById,
  type OverlayController
} from './controller';
import { draftFromSet, createIdSource } from './exclusions/draft';
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
    }
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

/** Build a started controller in a reactive root. */
async function started(port: ExclusionSessionPort) {
  const clock = timers();
  const reload = vi.fn();
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
      log: { warn: vi.fn() }
    });
    return disposeRoot;
  });
  if (controller === undefined) throw new Error('controller not built');
  controller.start();
  await settle();
  return { controller, clock, reload, dispose };
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
    expect(controller.commits()).toEqual([
      {
        lane: 'lazyload',
        id,
        index: 0,
        diff: { state: 'stored-as', stored: 'logo.png', typed: ' logo%41.png ' }
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
    expect(controller.commits()).toMatchObject([
      {
        lane: 'delayJs',
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
    expect(controller.commits()).toEqual([
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
    const [bad] = controller.insertRows('deferJs', ['(?a)'], null);
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
    const { controller } = await started(fakePort({ state: 'inactive' }).port);
    const [bad] = controller.insertRows('deferJs', ['(?a)'], null);
    controller.apply();
    expect(controller.state()).toMatchObject({ notice: { kind: 'invalid', rows: 1 } });
    controller.editRow('deferJs', bad ?? '', '\\(');
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

  it('lists a removed duplicate with the row it copies, and restores it at its place', async () => {
    const { controller, id } = await typedAndLeft(' gtag ', ['gtag', 'b']);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['gtag', 'b']);
    expect(delayNotes(controller).removed).toEqual([
      {
        id,
        index: 2,
        batch: expect.any(Number) as number,
        diff: { state: 'dropped', reason: 'duplicate', typed: ' gtag ' },
        copyOf: 1
      }
    ]);
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
    const before = fresh.controller.commits();
    expect(fresh.controller.addCandidate('lazyload', 'logo.png', false)).toBe(false);
    expect(fresh.controller.commits()).toBe(before);
    expect(fresh.controller.notes().lanes.lazyload.removed).toEqual([]);
  });
});
