/**
 * The palette module's runtime: binds the lifecycle (`./lifecycle`) to its
 * seams — the gate's watch and boot read, the `openCommandPalette`
 * receiver, the background's view injection, the bridge the injected view
 * attaches through, the executors and the page notices. Every seam is
 * injected, so the whole choreography (boot, open, attach, gate-off
 * teardown, failures) is testable without a browser; `./index` binds the
 * real ones.
 *
 * The gate is armed watch-first (a write landing during the boot read wins;
 * the read result is then dropped), and every effect is guarded: a failing
 * seam is logged and degrades its own step, never the page or the module.
 */
import type { Logger } from '../../../lib/logger';
import { isPaletteCommandId, pageCommand } from '../../../lib/page-commands/commands';
import {
  runPageCommand,
  type PageCommandExecutors,
  type PageCommandPage
} from '../../../lib/page-commands/executors';
import {
  publishPaletteBridge,
  retractPaletteBridge,
  type IsolatedWorld,
  type PaletteBridge,
  type PaletteViewHandle
} from '../../../lib/page-commands/palette-bridge';
import {
  PALETTE_BOOTING,
  holdsView,
  paletteTransition,
  type PaletteEffect,
  type PaletteEvent,
  type PaletteState
} from './lifecycle';
import { GATE_OFF_NOTICE, LOAD_FAILED_NOTICE } from './copy';
import type { NoticeHost } from './notice';

/** The module's seams. */
export interface PaletteModuleDeps {
  /** Follow the validated gate; returns the unwatch. */
  watchGate(onChange: (enabled: boolean) => void): () => void;
  /** Read the validated gate once (rejects on a dead context). */
  readGate(): Promise<boolean>;
  /** Register the `openCommandPalette` receiver; returns its removal. */
  listenForOpen(onOpen: () => void): () => void;
  /** Ask the background to inject the view (resolves once it ran). */
  loadView(): Promise<unknown>;
  /** The bound executors. */
  readonly executors: PageCommandExecutors;
  /** The page a run acts on. */
  page(): PageCommandPage;
  /** The page notices. */
  readonly notices: NoticeHost;
  /** The isolated world's global (where the bridge is published). */
  readonly world: IsolatedWorld;
  /** Whether the content script's context is dead. */
  isInvalid(): boolean;
  /** Run cleanup when the context dies. */
  onInvalidated(cleanup: () => void): void;
  readonly log: Logger;
}

/** The running module (its state is exposed for tests). */
export interface PaletteModule {
  state(): PaletteState;
  /** Feed one event (the open receiver and the chord feed `open`). */
  dispatch(event: PaletteEvent): void;
}

/**
 * Start the module: arm the gate, publish the bridge, register teardown.
 *
 * @param deps The seams.
 */
export function startPaletteModule(deps: PaletteModuleDeps): PaletteModule {
  const { log } = deps;
  let state: PaletteState = PALETTE_BOOTING;
  let removeReceiver: (() => void) | null = null;

  const disarm = (): void => {
    const remove = removeReceiver;
    removeReceiver = null;
    try {
      remove?.();
    } catch (cause) {
      log.warn('Removing the palette receiver failed', cause);
    }
  };

  const runEffect = (effect: PaletteEffect): void => {
    switch (effect.type) {
      case 'arm-receiver':
        if (removeReceiver !== null) return;
        try {
          removeReceiver = deps.listenForOpen(() => {
            dispatch({ type: 'open' });
          });
        } catch (cause) {
          log.error('Registering the palette receiver failed', cause);
        }
        return;
      case 'disarm-receiver':
        disarm();
        return;
      case 'load-view': {
        const { load } = effect;
        deps
          .loadView()
          .catch((cause: unknown) => {
            log.error('Loading the command palette view failed', cause);
          })
          .finally(() => {
            dispatch({ type: 'load-settled', load });
          });
        return;
      }
      case 'open-view':
        try {
          effect.view.open();
        } catch (cause) {
          log.error('Opening the command palette view failed', cause);
          dispatch({ type: 'detach', view: effect.view, reason: 'failed' });
        }
        return;
      case 'dispose-view':
        try {
          effect.view.dispose();
        } catch (cause) {
          log.warn('Removing the command palette view failed', cause);
        }
        return;
      case 'notice':
        deps.notices.show(effect.notice === 'gate-off' ? GATE_OFF_NOTICE : LOAD_FAILED_NOTICE);
        return;
    }
  };

  function dispatch(event: PaletteEvent): void {
    if (deps.isInvalid()) return;
    const transition = paletteTransition(state, event);
    state = transition.state;
    for (const effect of transition.effects) runEffect(effect);
  }

  const run = (id: string): void => {
    if (!isPaletteCommandId(id)) {
      log.warn('Ignored a run of an unknown palette command', { id });
      return;
    }
    // A run racing the gate-off write: the palette is dead, nothing runs.
    if (state.kind === 'off' || state.kind === 'booting') return;
    void runPageCommand(deps.executors, id, deps.page(), (cause) => {
      log.error('A palette command failed', { id, cause });
    }).then((outcome) => {
      if (!outcome.ok) deps.notices.show({ title: pageCommand(id).label, body: outcome.failure });
    });
  };

  const bridge: PaletteBridge = {
    alive: () => !deps.isInvalid(),
    run,
    attach: (view: PaletteViewHandle): boolean => {
      dispatch({ type: 'attach', view });
      return holdsView(state, view);
    },
    detach: (view: PaletteViewHandle, reason: unknown): void => {
      // Two bundles meet here: anything but an explicit failure is an end.
      dispatch({ type: 'detach', view, reason: reason === 'failed' ? 'failed' : 'ended' });
    }
  };

  // Watch first: a write landing during the boot read wins over the read.
  let watched = false;
  let unwatch: (() => void) | null = null;
  try {
    unwatch = deps.watchGate((enabled) => {
      watched = true;
      dispatch({ type: 'gate', enabled });
    });
  } catch (cause) {
    log.error('Watching the on-page UI gate failed', cause);
  }
  deps
    .readGate()
    .then((enabled) => {
      if (!watched) dispatch({ type: 'gate', enabled });
    })
    .catch((cause: unknown) => {
      // The palette stays unarmed until the gate's next write.
      log.warn('Reading the on-page UI gate failed — the palette waits for its next change', cause);
    });

  publishPaletteBridge(deps.world, bridge);

  deps.onInvalidated(() => {
    try {
      unwatch?.();
    } catch (cause) {
      log.warn('Stopping the gate watch failed during teardown', cause);
    }
    disarm();
    if (state.kind === 'ready') runEffect({ type: 'dispose-view', view: state.view });
    state = { kind: 'off' };
    retractPaletteBridge(deps.world, bridge);
  });

  return { state: () => state, dispatch };
}
