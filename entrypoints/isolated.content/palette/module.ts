/**
 * The palette module's runtime: binds the lifecycle (`./lifecycle`) to its
 * seams — the gate's watch and boot read, the open triggers (the
 * `openCommandPalette` receiver and the keyboard chord), the background's
 * view injection, the bridge the injected view attaches through (it also
 * reads the chord hint there), the executors and the page notices. Every
 * seam is injected, so the whole choreography (boot, open, attach, gate-off
 * teardown, failures) is testable without a browser; `./index` binds the
 * real ones.
 *
 * The gate is followed through the shared follower (`lib/page-ui`):
 * watch-first, so a write landing during the boot read wins and the read
 * result is dropped. Every effect is guarded: a failing
 * seam is logged and degrades its own step, never the page or the module.
 */
import type { Logger } from '../../../lib/logger';
import { followPageUiGate } from '../../../lib/page-ui/gate-follower';
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
  /**
   * Arm the open triggers — the `openCommandPalette` receiver and the
   * keyboard chord; returns their removal. Armed only while the gate is on.
   */
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
  /** The opening chord in the platform's notation, or null while unresolved. */
  chordHint(): string | null;
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
    },
    chordHint: (): string | null => {
      try {
        return deps.chordHint();
      } catch (cause) {
        log.warn('Reading the palette chord hint failed', cause);
        return null;
      }
    }
  };

  // The shared follower: watch first (a write during the boot read wins),
  // a failed read waits for the next write, late deliveries are dropped.
  followPageUiGate(
    {
      source: { watch: (onChange) => deps.watchGate(onChange), read: () => deps.readGate() },
      isInvalid: () => deps.isInvalid(),
      onInvalidated: (cleanup) => {
        deps.onInvalidated(cleanup);
      },
      log
    },
    (enabled) => {
      dispatch({ type: 'gate', enabled });
    }
  );

  publishPaletteBridge(deps.world, bridge);

  deps.onInvalidated(() => {
    disarm();
    if (state.kind === 'ready') runEffect({ type: 'dispose-view', view: state.view });
    state = { kind: 'off' };
    retractPaletteBridge(deps.world, bridge);
  });

  return { state: () => state, dispatch };
}
