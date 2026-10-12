/**
 * Side-by-Side comparison: the site's cached page next to its cache-bypassed
 * version, opened from the extension's context menu or auto-opened on a
 * PageSpeed Insights page carrying this tool's site param (two pre-launched
 * analyses; the overlay's controls are hidden there — the analyses drive
 * themselves).
 *
 * The overlay lives inside a shadow root and is created on first open, so a
 * page that never opens the compare flow pays neither the component cost nor
 * the stylesheet fetch. Closing restores the page's inline `overflow` styles
 * exactly as they were captured at first open (the sticky html+body pair);
 * a re-open shows the previously loaded frames — first open assigns the
 * URLs, later ones only reveal the overlay — never fresh navigations.
 *
 * Scroll sync rides the same lifecycle: the persisted setting is re-read at
 * every open, the header switch applies live (and writes the setting), and
 * the engine tears down on close and invalidation. The engine arms only once
 * the overlay's frames exist — the open awaits the view's mount (the slots
 * register through its render) before starting, and on the analysis host no
 * sync exists at all (the two halves are analyses, not correlated pages).
 *
 * The mobile comparison rides the machine in `lib/side-by-side/mobile-sim`:
 * the header switch is the only control, the analysis host never even asks,
 * every state change resolves the set rule before either half reloads, and
 * the halves render as scaled phone frames measured live by the rescale
 * presenter. Its lifecycle bindings are here; the judgment is the machine's.
 */

import { createSignal, createMemo } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { onMessage, sendMessage } from '../../../lib/messaging/index';
import { createLogger } from '../../../lib/logger';
import { getOptions, optionsStore } from '../../../lib/storage/options';
import { parseDeviceSimState, type DeviceSimState } from '../../../lib/device-simulation/state';
import { COMPARE_SIDES, type CompareSide } from '../../../lib/side-by-side/scroll-sync';
import {
  createMobileSimSession,
  INITIAL_SIM_SNAPSHOT,
  type MobileSimIO,
  type MobileSimSnapshot
} from '../../../lib/side-by-side/mobile-sim';
import { isHttpUrl } from '../../../utils/urls';
import { mountShadowUi } from '../ui/mount';
import { getOverlayUrls, importedSiteUrl, psiEntryUrl } from './urls';
import type { CompareUrls } from './urls';
import { isPsiHost } from '../../../lib/side-by-side/analysis-host';
import { createScrollSyncSession } from './sync-session';
import {
  createFramePresenter,
  engineRescaleFactory,
  framesMayNavigate,
  measureColumnScale,
  type FrameFitRecord
} from './presentation';
import { SideBySideOverlay } from './ui';
import './side-by-side.css';

const log = createLogger('side-by-side');

/** The shadow-root host tag name handed to WXT (kebab-case, feature-scoped). */
const UI_NAME = 'wpr-fdt-side-by-side';

/** The degraded answer the asks and pushes collapse to: nothing exists here. */
const SIM_UNAVAILABLE: DeviceSimState = { available: false, enabled: false };

/**
 * Wire the compare flow into this content script. Pages that never use it
 * register only two message receivers.
 *
 * @param ctx The content script's context; everything registers through it.
 */
export function setupSideBySide(ctx: ContentScriptContext): void {
  /** Whether the overlay currently covers the page (drives its class). */
  const [isOpen, setOpen] = createSignal(false);
  /** Whether scroll sync is on for this overlay (persisted setting, applied live). */
  const [syncOn, setSyncOn] = createSignal(false);
  /** Sides whose document refused access; each renders its per-side marker while sync is on. */
  const [syncBlocked, setSyncBlocked] = createSignal<Partial<Record<CompareSide, true>>>({});
  /** The simulation machine's facts, mirrored from its notifications. */
  const [sim, setSim] = createSignal<MobileSimSnapshot>(INITIAL_SIM_SNAPSHOT);
  /** The halves' live presentation fit, reported by the rescale presenter. */
  const [simFits, setSimFits] = createSignal<FrameFitRecord>({});
  /** The overlay's URL pair, resolved at first open and never re-resolved. */
  let urls: CompareUrls | null = null;
  /** The mounted UI handle; created at first open. */
  let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
  /** The Solid disposer, once the render has completed. */
  let disposeRoot: (() => void) | null = null;
  /**
   * The view's settled mount: the frame slots register through its render,
   * so every engine start must follow this promise — starting earlier arms
   * nothing (see the open path and the sync session's start contract).
   */
  let viewMounted: Promise<void> = Promise.resolve();
  /** Captured inline `overflow` styles of html+body, restored on close. */
  const overflow = { html: '', body: '' };
  /** Frames discovered through the component's ref callbacks. */
  const frames: Partial<Record<CompareSide, HTMLIFrameElement>> = {};
  /** The halves' column elements (the rescale presenter's measure targets). */
  const columns: Partial<Record<CompareSide, HTMLElement>> = {};

  /** The scroll-sync session: DOM halves + driver, built over the frames above. */
  const syncSession = createScrollSyncSession({
    frames: () => frames,
    onHalfBlocked: (side) => {
      setSyncBlocked((current) => ({ ...current, [side]: true }));
    },
    log
  });

  /** Start syncing (fresh probe: markers from the previous run reset). */
  const startSync = (): void => {
    setSyncBlocked({});
    syncSession.start();
  };

  const stopSync = (): void => {
    syncSession.stop();
  };

  /** Persist the mobile switch's intent, read-modify-write like the sync switch's write. */
  const persistSimSetting = async (next: boolean): Promise<void> => {
    try {
      const current = await getOptions();
      await optionsStore.setValue({
        ...current,
        features: { ...current.features, sbsMobileSim: next }
      });
    } catch (cause) {
      log.warn(
        'Persisting the mobile-comparison setting failed; the choice resets on the next open',
        cause instanceof Error ? cause.message : cause
      );
    }
  };

  /** The simulation machine's browser seams: validated asks, reload, persisted write. */
  const simIo: MobileSimIO = {
    readState: async (): Promise<DeviceSimState> => {
      let answer: unknown;
      try {
        answer = await sendMessage('getDeviceSimulation');
      } catch (cause) {
        // An unanswered availability ask (the context dying, an extension
        // reload in flight) is the expected noble no-answer: degrade, never
        // half-render the switch behind a broken ask.
        log.debug('The availability ask found no answer', cause);
        return SIM_UNAVAILABLE;
      }
      const state = parseDeviceSimState(answer);
      if (state === null) {
        log.warn('Malformed availability answer treated as unavailable');
        return SIM_UNAVAILABLE;
      }
      return state;
    },
    // The set ask's rejection IS the machine's unknown-truth degrade branch —
    // it propagates; the truthful shapes are the machine's decisions.
    applyState: (enabled: boolean): Promise<DeviceSimState> =>
      sendMessage('setDeviceSimulation', { enabled }),
    refreshHalves: (): void => {
      for (const side of COMPARE_SIDES) refreshFrame(side);
    },
    // Never rejects: persistSimSetting logs and degrades internally.
    persist: (enabled: boolean): Promise<void> => persistSimSetting(enabled),
    log
  };

  /** The machine; every snapshot it announces lands in the `sim` signal. */
  const simMachine = createMobileSimSession(simIo, (snapshot) => {
    setSim(snapshot);
  });

  /** The presentation controller: fits from the columns, live on resize, torn down on close/invaldiation. */
  const presenter = createFramePresenter({
    presentation: () => sim().presentation,
    columns: () => columns,
    measure: (column) => measureColumnScale(column),
    onFit: (side, fit) => {
      setSimFits((current) => ({ ...current, [side]: fit }));
    },
    rescaleFactory: engineRescaleFactory(log),
    log
  });

  /**
   * Whether the halves may load their URLs: in the phone presentation the
   * first navigation waits for both fits (each half loads once, at the
   * device size, after the rule exists); auto loads immediately.
   */
  const sizeGateOpen = createMemo(() => framesMayNavigate(sim().presentation, simFits()));

  /**
   * Persist the scroll-sync switch choice. Read-modify-write over the
   * validated shape, so the other option slots keep their values; a failed
   * write degrades to "not persisted" — the live toggle already applied, and
   * the next open reads the stored value again. Consecutive writes serialize
   * on a chain: two rapid toggles write their read-modify-writes in toggle
   * order (concurrent writes could otherwise resolve out of storage order
   * and persist the stale intent, which the next open would adopt).
   */
  let sbsPersistTail: Promise<void> = Promise.resolve();
  const persistScrollSyncSetting = async (next: boolean): Promise<void> => {
    const run = sbsPersistTail.then(async (): Promise<void> => {
      try {
        const current = await getOptions();
        await optionsStore.setValue({
          ...current,
          features: { ...current.features, sbsScrollSync: next }
        });
      } catch (cause) {
        log.warn(
          'Persisting the scroll-sync setting failed; the choice resets on the next open',
          cause instanceof Error ? cause.message : cause
        );
      }
    });
    // The contract is resolve-only (every storage failure logs inline); the
    // belt catch keeps a contract violation from escaping unhandled.
    sbsPersistTail = run.catch(() => undefined);
    await run;
  };

  /**
   * The scroll-sync switch: apply live, then persist. The engine
   * starts/stops with the switch — a running overlay follows without a
   * reload.
   */
  const onToggleSync = (next: boolean): void => {
    setSyncOn(next);
    if (next) startSync();
    else stopSync();
    void persistScrollSyncSetting(next);
  };

  /**
   * The mobile-comparison switch: the machine owns the ask/refresh/reconcile
   * sequence; the wiring only forwards the event. The machine's promise
   * never rejects (its chain internalizes every failure), so forwarding is
   * safe.
   */
  const onToggleSim = (next: boolean): void => {
    void simMachine.toggle(next);
  };

  /**
   * The PageSpeed Insights auto-open case: the analysis host with this
   * tool's site param, where the carried URL is a real http(s) URL (anything
   * else is a forged page state, not a flow).
   */
  const isAutoFlowPage = (): boolean => {
    const page = new URL(window.location.href);
    if (!isPsiHost(page)) return false;
    const carried = importedSiteUrl(page);
    return carried !== null && isHttpUrl(carried.href);
  };

  /**
   * Refresh one side: same-origin frames reload in place (a real reload,
   * with its network and cache semantics, keeping the frame's history);
   * cross-origin frames (the analyses) reject the reload probe, and a frame
   * whose browsing context has not been created yet has nothing to probe —
   * both get their `src` re-assigned, which always re-navigates the frame.
   * The assignment is the deliberate fallback, not an accident.
   */
  const refreshFrame = (side: CompareSide): void => {
    const frame = frames[side];
    if (frame === undefined) return;
    const renavigate = (): void => {
      frame.src = frame.src;
    };
    if (frame.contentWindow === null) {
      renavigate();
      return;
    }
    try {
      frame.contentWindow.location.reload();
    } catch {
      renavigate();
    }
  };

  /** The single open path for both the context menu and the auto-open. */
  const openOverlay = async (): Promise<void> => {
    if (isOpen()) return;
    // First open: capture the scroll baseline and resolve the URL pair once.
    if (urls === null) {
      overflow.html = document.documentElement.style.overflow;
      overflow.body = document.body.style.overflow;
      urls = getOverlayUrls(new URL(window.location.href));
    }
    // The persisted settings are read at every open (mid-life external
    // changes apply next open); a failed read degrades both switches to
    // off — the overlay itself must not dead-end on a broken options store.
    let simTarget = false;
    try {
      const options = await getOptions();
      setSyncOn(options.features.sbsScrollSync);
      simTarget = options.features.sbsMobileSim;
    } catch (cause) {
      setSyncOn(false);
      simTarget = false;
      log.error(
        'Reading the stored settings failed; the overlay opens with the switches off',
        cause instanceof Error ? cause.message : cause
      );
    }
    // The simulation's ask — and any rule transition it commands — settles
    // BEFORE the view can mount: a first open's halves navigate only after
    // the rule exists, exactly the machine's rule-before-refresh ordering.
    const psi = isAutoFlowPage();
    await simMachine.open(psi, simTarget);
    await ensureUi(urls);
    // The engine must not outrun its halves: `registerFrame`'s slots fill
    // during the render that `ensureUi` started but did not await. Starting
    // from an unregistered slot attaches nothing — and the session's start
    // guard would then keep a "running" engine deaf to the halves until a
    // switch cycle re-armed it (the reported default-on regression).
    await viewMounted;
    // Measure the halves now — the phone styles land with the first paint,
    // the rescale keeps every later window change live, and the size gate
    // (which held the urls during the fit-less phone presentation) releases.
    presenter.syncNow();
    // The analyses drive themselves — no correlated structure to sync there.
    if (syncOn() && !psi) startSync();
    show();
  };

  const show = (): void => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    setOpen(true);
  };

  const close = (): void => {
    // The engines are the open state's companions: off when the overlay
    // hides, the session's removal ask best-effort and logged inside the
    // machine (never rejects), the rescale released with the view.
    stopSync();
    presenter.stop();
    void simMachine.close();
    document.documentElement.style.overflow = overflow.html;
    document.body.style.overflow = overflow.body;
    setOpen(false);
  };

  /** Mount the overlay (once); shadow-host cleanup is WXT's own. */
  const ensureUi = async (pair: CompareUrls): Promise<void> => {
    if (ui !== null) return;
    try {
      // The iframes stay unsandboxed (no `sandbox`/`credentialless`): the
      // feature compares real pages with their real cookies and requests,
      // so a sandboxed pair would not show what the user is comparing.
      // (Security note: the frames load the user's own session.)
      ui = await createShadowRootUi(ctx, {
        name: UI_NAME,
        position: 'inline',
        isolateEvents: true,
        onMount: (container) => {
          // The mount promise is owned, not fire-and-forget: the open path
          // awaits it before starting the sync engine (the failure branch
          // logs and continues — the overlay's UI failure is its own error).
          viewMounted = mountShadowUi(container, () => (
            <SideBySideOverlay
              urls={() => pair}
              open={isOpen}
              psiMode={isAutoFlowPage}
              registerFrame={(side, frame) => {
                // A null settles a re-render; an undefined slot means "no
                // frame" for the refresh guard.
                frames[side] = frame ?? undefined;
              }}
              registerColumn={(side, column) => {
                columns[side] = column ?? undefined;
              }}
              refresh={refreshFrame}
              close={close}
              syncEnabled={syncOn}
              syncBlocked={(side) => syncBlocked()[side] === true}
              onToggleSync={onToggleSync}
              sim={sim}
              simFits={simFits}
              sizeGateOpen={sizeGateOpen}
              onToggleSim={onToggleSim}
            />
          ))
            .then((dispose) => {
              disposeRoot = dispose;
            })
            .catch((cause: unknown) => {
              log.error(
                'Mounting the side-by-side overlay view into the shadow root failed',
                cause instanceof Error ? cause.message : cause
              );
            });
        },
        onRemove: () => {
          disposeRoot?.();
          disposeRoot = null;
        }
      });
      ui.mount();
    } catch (error) {
      ui = null;
      log.error(
        'Mounting the side-by-side overlay failed',
        error instanceof Error ? error.message : error
      );
    }
  };

  ctx.onInvalidated(
    // Imperative page-lifecycle call — the reactivity lint cannot see that.
    // eslint-disable-next-line solid/reactivity
    onMessage('openSideBySide', async (): Promise<true> => {
      await openOverlay();
      return true;
    })
  );

  ctx.onInvalidated(
    onMessage('openSideBySidePerformance', (): true => {
      if (ctx.isInvalid) return true;
      // On the analysis host itself the entry is a no-op (analysis flows
      // start from a site, never from PSI).
      if (isPsiHost(new URL(window.location.href))) return true;
      const entryUrl = psiEntryUrl(new URL(window.location.href));
      if (entryUrl !== null) window.open(entryUrl, '_blank', 'noopener');
      return true;
    })
  );

  ctx.onInvalidated(
    onMessage('reportDeviceSimulationLiveness', (): true => {
      // The simulated-session sweep's reachability probe: answering proves
      // this tab's isolated world is alive. The dead-world case answers
      // nothing by construction (an extension reload removed the listener
      // with its context — exactly the ghost signal the sweep removes on).
      return true;
    })
  );

  ctx.onInvalidated(
    onMessage('deviceSimulationChanged', ({ data }): true => {
      if (ctx.isInvalid) return true;
      const state = parseDeviceSimState(data);
      if (state === null) {
        log.warn('Malformed simulation state push ignored');
        return true;
      }
      // A settled truthful state from the background (a transition this tab's
      // machinery did not drive): the presentation converges to it, no ask.
      simMachine.pushed(state);
      return true;
    })
  );

  /** The auto-open runs at the fully-rendered moment like the manual one. */
  const psiAutoOpen = (): void => {
    if (ctx.isInvalid || !isAutoFlowPage()) return;
    // Imperative page-lifecycle call (never re-driven by signals) — the
    // reactivity lint cannot see that, hence the local silences below.
    void openOverlay();
  };
  if (document.readyState === 'loading') {
    // eslint-disable-next-line solid/reactivity -- imperative page-lifecycle call
    ctx.addEventListener(window, 'DOMContentLoaded', psiAutoOpen);
  } else {
    // eslint-disable-next-line solid/reactivity -- imperative page-lifecycle call
    psiAutoOpen();
  }

  // An extension reload while the overlay is up must not leave the page
  // scroll-locked and must reset the lifecycle flag; the shadow-host removal
  // is WXT's cleanup. The simulation session needs nothing beyond releasing
  // its observers here: an invalidated world cannot send the removal ask, and
  // the background's boot sweep converges whatever rule this dying world
  // still owns (rules of the family whose isolated world answers nothing go).
  const restoreScrollOnInvalidation = (): void => {
    // The engine goes down with the context, like every other listener.
    syncSession.stop();
    presenter.stop();
    if (isOpen()) {
      document.documentElement.style.overflow = overflow.html;
      document.body.style.overflow = overflow.body;
    }
    setOpen(false);
  };
  // eslint-disable-next-line solid/reactivity -- imperative teardown read
  ctx.onInvalidated(restoreScrollOnInvalidation);
}
