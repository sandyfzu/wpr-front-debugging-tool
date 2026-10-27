/**
 * The palette module's choreography over fake seams: watch-first boot
 * (a watch delivery beats a late read), receiver arming, the open → load →
 * attach → open-view path, the view the bridge hands back (refused with no
 * open pending), a failed mount noticed, a stale load's late settle, gate-off
 * teardown (receiver removed, view disposed, notice shown), gate-on
 * re-arming, run validation and failure notices, a failed boot read, and
 * the invalidation cleanup (unwatch, retract, dispose).
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type {
  PageCommandExecutor,
  PageCommandExecutors,
  PageCommandOutcome
} from '../../../lib/page-commands/executors';
import {
  PALETTE_BRIDGE_GLOBAL,
  readPaletteBridge,
  type IsolatedWorld,
  type PaletteBridge,
  type PaletteViewHandle
} from '../../../lib/page-commands/palette-bridge';
import { startPaletteModule, type PaletteModuleDeps } from './module';
import { GATE_OFF_NOTICE, LOAD_FAILED_NOTICE } from './copy';
import type { PageNotice } from './notice';

/** Wait for queued promise callbacks. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const DONE: PageCommandOutcome = { ok: true };

/** One recorded logger level. */
type LogMock = Mock<(message: string, ...details: unknown[]) => void>;

/** A recorded view handle: the handle plus its two recorders. */
function view() {
  const open = vi.fn<() => void>();
  const dispose = vi.fn<() => void>();
  const handle: PaletteViewHandle = {
    open: () => {
      open();
    },
    dispose: () => {
      dispose();
    }
  };
  return { handle, open, dispose };
}

/** The fake seams plus their controls. */
function harness(options: { gate?: boolean | Error; loadAttaches?: boolean } = {}) {
  let gateListener: ((enabled: boolean) => void) | null = null;
  let openListener: (() => void) | null = null;
  const invalidation: Array<() => void> = [];
  let invalid = false;
  const world: IsolatedWorld = {};
  const unwatch = vi.fn();
  const removeReceiver = vi.fn(() => {
    openListener = null;
  });
  const runSideBySide = vi.fn<PageCommandExecutor>(() => Promise.resolve(DONE));
  const executors: PageCommandExecutors = {
    'side-by-side': runSideBySide,
    'psi-side-by-side': () => Promise.resolve(DONE),
    'toggle-detection-widget': () => Promise.resolve(DONE),
    'exclusion-builder': () =>
      Promise.resolve<PageCommandOutcome>({ ok: false, failure: 'This page is not an HTML page.' }),
    'page-ui-gate': () => Promise.resolve(DONE)
  };
  let resolveRead: (enabled: boolean) => void = () => undefined;
  let rejectRead: (cause: Error) => void = () => undefined;
  const read = new Promise<boolean>((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  });
  const loadedView = view();
  const warn: LogMock = vi.fn();
  const error: LogMock = vi.fn();
  const show = vi.fn<(notice: PageNotice) => void>();
  // The injected view attaches synchronously while the script runs.
  const loadView = vi.fn((): Promise<unknown> => {
    if (options.loadAttaches ?? true) readPaletteBridge(world)?.attach(loadedView.handle);
    return Promise.resolve(true);
  });
  const deps: PaletteModuleDeps = {
    watchGate: (listener) => {
      gateListener = listener;
      return unwatch;
    },
    readGate: () => read,
    listenForOpen: (listener) => {
      openListener = listener;
      return removeReceiver;
    },
    loadView: () => loadView(),
    executors,
    page: () => ({ origin: 'https://example.test' }),
    notices: {
      show: (notice) => {
        show(notice);
      }
    },
    world,
    isInvalid: () => invalid,
    onInvalidated: (cleanup) => {
      invalidation.push(cleanup);
    },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, ...details) => {
        warn(message, ...details);
      },
      error: (message, ...details) => {
        error(message, ...details);
      }
    }
  };
  const module = startPaletteModule(deps);
  return {
    module,
    warn,
    error,
    show,
    loadView,
    world,
    runSideBySide,
    loadedView,
    unwatch,
    removeReceiver,
    bridge: (): PaletteBridge => world[PALETTE_BRIDGE_GLOBAL] as PaletteBridge,
    gate: (enabled: boolean) => gateListener?.(enabled),
    open: () => openListener?.(),
    receiverArmed: () => openListener !== null,
    resolveRead,
    rejectRead,
    invalidate: () => {
      invalid = true;
      for (const cleanup of invalidation) cleanup();
    }
  };
}

describe('boot', () => {
  it('arms the receiver once the gate reads on', async () => {
    const h = harness();
    expect(h.receiverArmed()).toBe(false);
    h.resolveRead(true);
    await settle();
    expect(h.receiverArmed()).toBe(true);
    expect(h.module.state().kind).toBe('idle');
  });

  it('stays unarmed and silent when the gate reads off', async () => {
    const h = harness();
    h.resolveRead(false);
    await settle();
    expect(h.receiverArmed()).toBe(false);
    expect(h.show).not.toHaveBeenCalled();
  });

  it('lets a watch delivery during the read win over the read result', async () => {
    const h = harness();
    h.gate(false);
    h.resolveRead(true);
    await settle();
    expect(h.module.state().kind).toBe('off');
    expect(h.receiverArmed()).toBe(false);
  });

  it('logs a failed read and waits for the gate’s next write', async () => {
    const h = harness();
    h.rejectRead(new Error('Extension context invalidated.'));
    await settle();
    expect(h.warn).toHaveBeenCalled();
    expect(h.receiverArmed()).toBe(false);
    h.gate(true);
    expect(h.receiverArmed()).toBe(true);
  });

  it('publishes a live bridge', () => {
    const h = harness();
    expect(readPaletteBridge(h.world)).toBe(h.bridge());
  });
});

describe('opening', () => {
  it('loads the view on the first open and opens the attached view', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.open();
    expect(h.loadView).toHaveBeenCalledTimes(1);
    expect(h.loadedView.open).toHaveBeenCalledTimes(1);
    await settle();
    expect(h.module.state().kind).toBe('ready');
    expect(h.show).not.toHaveBeenCalled();
    // Later opens only re-open the loaded view.
    h.open();
    expect(h.loadView).toHaveBeenCalledTimes(1);
    expect(h.loadedView.open).toHaveBeenCalledTimes(2);
  });

  it('notices a load whose view never attached, then loads again on the next open', async () => {
    const h = harness({ loadAttaches: false });
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    expect(h.show).toHaveBeenCalledWith(LOAD_FAILED_NOTICE);
    expect(h.module.state().kind).toBe('idle');
    h.open();
    expect(h.loadView).toHaveBeenCalledTimes(2);
  });

  it('logs a rejected load and notices it', async () => {
    const h = harness({ loadAttaches: false });
    h.loadView.mockReturnValueOnce(Promise.reject(new Error('cannot access')));
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    expect(h.error).toHaveBeenCalled();
    expect(h.show).toHaveBeenCalledWith(LOAD_FAILED_NOTICE);
  });

  it('drops a view whose open throws and notices the failed open', async () => {
    const h = harness();
    h.loadedView.open.mockImplementation(() => {
      throw new Error('dead view');
    });
    h.resolveRead(true);
    await settle();
    h.open();
    expect(h.error).toHaveBeenCalled();
    await settle();
    expect(h.module.state().kind).toBe('idle');
    expect(h.show).toHaveBeenCalledWith(LOAD_FAILED_NOTICE);
  });

  it('notices a view that attached but could not mount', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    expect(h.loadedView.open).toHaveBeenCalledTimes(1);
    h.bridge().detach(h.loadedView.handle, 'failed');
    expect(h.show).toHaveBeenCalledWith(LOAD_FAILED_NOTICE);
    expect(h.module.state().kind).toBe('idle');
  });

  it('reads any other detach reason from the view as a quiet end', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    h.bridge().detach(h.loadedView.handle, 'bogus' as 'ended');
    expect(h.show).not.toHaveBeenCalled();
    expect(h.module.state().kind).toBe('idle');
  });

  it('refuses a view attaching with no open pending (a misdirected injection)', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    expect(h.bridge().attach(view().handle)).toBe(false);
    expect(h.module.state().kind).toBe('idle');
  });

  it('ignores a stale load’s late settle after a gate off/on, then opens the newer view', async () => {
    const h = harness({ loadAttaches: false });
    const settles: Array<() => void> = [];
    h.loadView.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          settles.push(() => {
            resolve(true);
          });
        })
    );
    h.resolveRead(true);
    await settle();
    h.open();
    h.gate(false);
    h.gate(true);
    h.open();
    expect(h.loadView).toHaveBeenCalledTimes(2);
    // The first load settles late: no failure notice for the pending second.
    settles[0]?.();
    await settle();
    expect(h.show).not.toHaveBeenCalledWith(LOAD_FAILED_NOTICE);
    const newer = view();
    expect(h.bridge().attach(newer.handle)).toBe(true);
    expect(newer.open).toHaveBeenCalledTimes(1);
    settles[1]?.();
    await settle();
    expect(h.module.state().kind).toBe('ready');
    expect(h.show).not.toHaveBeenCalledWith(LOAD_FAILED_NOTICE);
  });

  it('answers the attach with whether the view is held', async () => {
    const h = harness();
    h.resolveRead(false);
    await settle();
    expect(h.bridge().attach(view().handle)).toBe(false);
  });
});

describe('gate-off and gate-on', () => {
  it('removes the receiver, disposes the view and shows the gate-off notice', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    h.gate(false);
    expect(h.removeReceiver).toHaveBeenCalledTimes(1);
    expect(h.loadedView.dispose).toHaveBeenCalledTimes(1);
    expect(h.show).toHaveBeenCalledWith(GATE_OFF_NOTICE);
    expect(h.receiverArmed()).toBe(false);
  });

  it('re-arms on gate-on and loads a fresh view on the next open', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    h.gate(false);
    h.gate(true);
    expect(h.receiverArmed()).toBe(true);
    h.open();
    expect(h.loadView).toHaveBeenCalledTimes(2);
  });

  it('keeps going when the view’s dispose throws', async () => {
    const h = harness();
    h.loadedView.dispose.mockImplementation(() => {
      throw new Error('gone');
    });
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    h.gate(false);
    expect(h.warn).toHaveBeenCalled();
    expect(h.show).toHaveBeenCalledWith(GATE_OFF_NOTICE);
  });
});

describe('running commands', () => {
  it('runs a palette command on the page', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.bridge().run('side-by-side');
    await settle();
    expect(h.runSideBySide).toHaveBeenCalledWith({ origin: 'https://example.test' });
    expect(h.show).not.toHaveBeenCalled();
  });

  it('notices a failed run under the command’s label', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.bridge().run('exclusion-builder');
    await settle();
    expect(h.show).toHaveBeenCalledWith({
      title: 'Exclusion Builder',
      body: 'This page is not an HTML page.'
    });
  });

  it('refuses unknown and menu-only ids', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.bridge().run('open-nowprocket');
    h.bridge().run('rm -rf');
    await settle();
    expect(h.warn).toHaveBeenCalledTimes(2);
  });

  it('runs nothing once the gate is off', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.gate(false);
    h.bridge().run('side-by-side');
    await settle();
    expect(h.runSideBySide).not.toHaveBeenCalled();
  });
});

describe('invalidation', () => {
  it('unwatches, removes the receiver, disposes the view and retracts the bridge', async () => {
    const h = harness();
    h.resolveRead(true);
    await settle();
    h.open();
    await settle();
    h.invalidate();
    expect(h.unwatch).toHaveBeenCalledTimes(1);
    expect(h.removeReceiver).toHaveBeenCalledTimes(1);
    expect(h.loadedView.dispose).toHaveBeenCalledTimes(1);
    expect(PALETTE_BRIDGE_GLOBAL in h.world).toBe(false);
    // A dead module ignores everything after.
    h.gate(true);
    expect(h.module.state().kind).toBe('off');
  });
});
