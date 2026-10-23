/**
 * A paste whose commit throws, long (sliced) or short (one step): it
 * settles as `failed` (never a rejection, never a throw into the host
 * page's paste event), the editor is as it was and free, the cause is
 * logged, and for a long one only the commits asked meanwhile run (Apply
 * waits for the user to read why); the lane says so as a problem, with the
 * way forward.
 */
import { createRoot } from 'solid-js';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VirtualizerFactory } from '../../components/ui/virtual-list';
import { PASTE_COPY } from './copy';
import { Lane } from './exclusions/lane';
import type * as Draft from './exclusions/draft';
import type { ExclusionSessionStatus } from '../../lib/messaging/exclusion-session';
import { createOverlayController, PASTE_SLICE_ROWS } from './controller';
import type { ExclusionSessionPort, PortOutcome } from './session/port';

/** Where the commit throws (set per test): a slice, a sliced commit's start, a one-step commit. */
const failure = { step: false, start: false, commit: false };

vi.mock('./exclusions/draft', async (original) => {
  const actual = await original<typeof Draft>();
  return {
    ...actual,
    commitRows: (...args: Parameters<typeof actual.commitRows>) => {
      if (failure.commit) throw new Error('commit broke');
      return actual.commitRows(...args);
    },
    startCommit: (...args: Parameters<typeof actual.startCommit>) => {
      if (failure.start) throw new Error('start broke');
      const commit = actual.startCommit(...args);
      return {
        step: (count: number) => {
          if (failure.step) throw new Error('step broke');
          return commit.step(count);
        },
        result: () => commit.result()
      };
    }
  };
});

const reply = <T,>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A ready controller over an idle port, its timers run by hand. */
async function ready() {
  const timers: (() => void)[] = [];
  const port = {
    status: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    savedSet: vi.fn(() => reply({ set: null })),
    apply: vi.fn(() => reply({ outcome: 'applying' as const })),
    stop: vi.fn(() => reply<ExclusionSessionStatus>({ state: 'inactive' })),
    save: vi.fn(() => reply({ outcome: 'saved' as const })),
    onStatus: vi.fn(() => () => undefined)
  } satisfies ExclusionSessionPort;
  const log = { warn: vi.fn() };
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
      schedule: (run) => {
        timers.push(run);
        return () => undefined;
      },
      reload: vi.fn(),
      log
    })
  );
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  /** Run every timer until none is left. */
  const drain = async (): Promise<void> => {
    for (let n = 0; n < 100 && timers.length > 0; n++) {
      timers.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { controller, port, log, drain };
}

const LONG = Array.from({ length: PASTE_SLICE_ROWS * 2 }, (_, n) => `r${String(n)}.js`).join('\n');

describe('a long paste that breaks', () => {
  it.each([
    ['a slice', 'step'],
    ['its start', 'start']
  ] as const)('settles as failed when %s throws, freeing the editor', async (_where, key) => {
    const { controller, port, log, drain } = await ready();
    const [id = ''] = controller.insertRows('delayJs', ['x'], null);
    controller.editRow('delayJs', id, ' ab ');
    const before = controller.draft();
    failure[key] = true;
    try {
      const outcome = controller.pasteRows('delayJs', id, LONG, { start: 1, end: 1 });
      if (outcome.kind !== 'pending') throw new Error('settled at once');
      // Asked meanwhile: the leave runs (a commit), Apply does not.
      controller.commitRow('delayJs', id);
      controller.apply();
      await drain();
      await expect(outcome.done).resolves.toEqual({ kind: 'failed' });
    } finally {
      failure[key] = false;
    }
    expect(controller.pasting()).toBe(false);
    expect(controller.editable()).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      `paste of ${String(PASTE_SLICE_ROWS * 2)} rows into delayJs failed`,
      expect.any(Error)
    );
    // Nothing pasted landed; the row left was committed (trimmed).
    expect(controller.draft()).not.toBe(before);
    expect(controller.draft().rows.delayJs.map((row) => row.text)).toEqual(['ab']);
    expect(port.apply).not.toHaveBeenCalled();
    // The editor takes the next paste.
    const again = controller.pasteRows(
      'delayJs',
      controller.draft().rows.delayJs[0]?.id ?? '',
      LONG,
      { start: 0, end: 0 }
    );
    if (again.kind !== 'pending') throw new Error('settled at once');
    await drain();
    await expect(again.done).resolves.toEqual({ kind: 'pasted' });
  });
});

/** Renders every row (happy-dom has no layout). */
const everyRow: VirtualizerFactory = (options) => ({
  getVirtualItems: () =>
    Array.from({ length: options.count }, (_, index) => ({
      key: options.getItemKey?.(index) ?? index,
      index,
      start: index * 37,
      end: (index + 1) * 37,
      size: 37,
      lane: 0
    })),
  getTotalSize: () => options.count * 37,
  measureElement: () => undefined
});

describe('a short paste that breaks', () => {
  it('settles as failed at once, the draft untouched, nothing thrown', async () => {
    const { controller, log } = await ready();
    const [id = ''] = controller.insertRows('delayJs', ['x'], null);
    const before = controller.draft();
    failure.commit = true;
    try {
      expect(controller.pasteRows('delayJs', id, 'a\nb\nc', { start: 1, end: 1 })).toEqual({
        kind: 'failed'
      });
    } finally {
      failure.commit = false;
    }
    expect(controller.draft()).toBe(before);
    expect(controller.notes().lanes.delayJs.summary).toBeNull();
    expect(controller.editable()).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(
      'paste of 5 characters into delayJs failed',
      expect.any(Error)
    );
    expect(controller.pasteRows('delayJs', id, 'a\nb', { start: 1, end: 1 })).toEqual({
      kind: 'pasted'
    });
  });
});

describe('the lane after a paste broke', () => {
  afterEach(cleanup);

  it.each([
    ['long', 'step'],
    ['short', 'commit']
  ] as const)('says a %s paste was not added and how to go on, announced', async (size, key) => {
    const { controller, drain } = await ready();
    controller.insertRows('delayJs', ['x'], null);
    const announce = vi.fn<(text: string) => void>();
    render(() => (
      <Lane
        lane="delayJs"
        controller={controller}
        report={undefined}
        pageCount={0}
        requestFrame={(run) => {
          run();
        }}
        locked={false}
        announce={announce}
        writeClipboard={() => Promise.resolve('copied')}
        createVirtualizer={everyRow}
      />
    ));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    const text = size === 'long' ? LONG : 'a\nb';
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    failure[key] = true;
    try {
      screen.getByRole('textbox', { name: /row 1$/ }).dispatchEvent(event);
      await drain();
    } finally {
      failure[key] = false;
    }
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByText(PASTE_COPY.failed).closest('p')?.classList).toContain('xo-row-error');
    });
    expect(announce).toHaveBeenCalledWith(PASTE_COPY.failed);
    expect(controller.editable()).toBe(true);
  });
});
