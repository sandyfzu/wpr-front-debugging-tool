import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../lib/exclusion-builder/set';
import type { ExclusionSessionStatus } from '../../lib/messaging/exclusion-session';
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
        timeOrigin: 0
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

  it('prefers the active session set over the saved draft', async () => {
    const active = {
      ...activeRecord(),
      set: { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['only.png'] } }
    };
    const { controller } = await started(fakePort(active, validSet()).port);
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
    controller.pasteRows('lazyload', id ?? '', 'a.png\nb.png\r\n\nc.png');
    const rows = controller.draft().rows.lazyload;
    expect(rows.map((row) => row.text)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(controller.focusRequest()).toEqual({ lane: 'lazyload', id: rows[2]?.id });
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

  it('marks edits against the active set as dirty', async () => {
    const { controller } = await started(fakePort(activeRecord()).port);
    controller.setDisable('lazyRender', true);
    expect(controller.dirty()).toBe(true);
  });
});

describe('apply / reset / stop', () => {
  it('applies the draft (blank rows dropped) and waits for the reload, then offers a manual one', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller, clock, reload } = await started(port);
    controller.insertRows('delayJs', ['gtag', '  '], null);
    controller.apply();
    expect(controller.state()).toMatchObject({ phase: 'ready', pending: 'apply' });
    await settle();
    expect(port.apply).toHaveBeenCalledWith({
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['gtag'] }
    });
    expect(controller.state()).toEqual({ phase: 'reloading', stalled: false });
    clock.fire(RELOAD_STALL_MS);
    expect(controller.state()).toEqual({ phase: 'reloading', stalled: true });
    controller.reloadPage();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses to ask with invalid rows, focusing the first one', async () => {
    const { port } = fakePort({ state: 'inactive' });
    const { controller } = await started(port);
    const [bad] = controller.insertRows('deferJs', ['('], null);
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
      Array.from({ length: 40 }, () => 'z'.repeat(2000)),
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
    const draft = draftFromSet(
      { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: [' ', 'a', 'b'] } },
      createIdSource()
    );
    const byId = invalidRowsById(draft, [
      { feature: 'defer_all_js', index: 1, row: 'b', reason: 'R' },
      { feature: 'defer_all_js', index: 9, row: '?', reason: 'gone' }
    ]);
    expect([...byId.values()]).toEqual(['R']);
    expect(byId.has(draft.rows.deferJs[2]?.id ?? '')).toBe(true);
  });
});
