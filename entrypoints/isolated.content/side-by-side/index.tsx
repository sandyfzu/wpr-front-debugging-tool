/**
 * Side-by-Side comparison: the site's cached page next to its cache-bypassed
 * version, opened from the extension's context menu, auto-opened on a
 * PageSpeed Insights page carrying this tool's site param (two pre-launched
 * analyses; the overlay's controls are hidden there — the analyses drive
 * themselves), or restored after a host page reloaded itself on the same
 * URL (responsive hosts do; the open state survives their reload).
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
 * The presentation rides the machine in `lib/side-by-side/presentation-state`:
 * the header switches are the only controls (scroll sync, the mobile
 * comparison and the desktop-width dress), the analysis host never even
 * asks, every session change resolves the set rule before either half
 * reloads, and the halves render as scaled frames measured live by the
 * rescale presenter — the phone's device viewport, or the desktop dress's
 * 1280px-floor content box. Its lifecycle bindings are here; the judgment
 * is the machine's.
 *
 * Firefox asks its data consent before an analysis address leaves the
 * browser (`./performance-consent`): the PageSpeed Insights open goes
 * through the background, and the analysis page loads its comparison frames
 * only once allowed (a notice asks otherwise). The Chromium bundle has none
 * of it (build-time branches).
 *
 * The on-page UI gate outranks every trigger: while it is off nothing opens
 * the overlay (menu, palette, the auto-open, the reload restore — a gate-off
 * boot consumes the restore record without opening); a gate-off write
 * closes an open overlay (scroll restored, simulation retracted, restore
 * record cleared) and removes its host; a gate-on write re-opens it if it
 * was open (or opening) when the gate closed.
 */

import { createSignal, createMemo } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { onMessage, sendMessage } from '../../../lib/messaging/index';
import { createLogger } from '../../../lib/logger';
import {
  getOptions,
  optionsStore,
  FALLBACK,
  type StoredOptions
} from '../../../lib/storage/options';
import { parseDeviceSimState, type DeviceSimState } from '../../../lib/device-simulation/state';
import { COMPARE_SIDES, type CompareSide } from '../../../lib/side-by-side/scroll-sync';
import {
  createPresentationState,
  INITIAL_PRESENTATION_SNAPSHOT,
  type FramePresentation,
  type PresentationSnapshot,
  type PresentationStateIO
} from '../../../lib/side-by-side/presentation-state';
import { isHttpUrl, NEW_TAB_FEATURES } from '../../../utils/urls';
import {
  createShadowSurface,
  type ShadowSurface
} from '../../../components/injected-ui/shadow-surface';
import { followGatedSurface } from '../../../lib/page-ui/gated-surface';
import { pageUiGateDeps } from '../../../lib/page-ui/gate-follower';
import { getOverlayUrls, importedSiteUrl, psiEntryUrl } from './urls';
import type { CompareUrls } from './urls';
import { isPsiHost } from '../../../lib/side-by-side/analysis-host';
import { createScrollSyncSession } from './sync-session';
import { markOverlayClosed, markOverlayOpen } from './session-open';
import { createOpenGuard, createOverlayGate } from './page-ui-gate';
import {
  createFramePresenter,
  engineRescaleFactory,
  framesMayNavigate,
  measureColumnFit,
  type FrameFitRecord
} from './presentation';
import { SideBySideOverlay } from './ui';
import { provideSideBySideTriggers } from '../palette/side-by-side-triggers';
import {
  checkAnalysisConsent,
  openPerformanceWithConsent,
  reloadAfterConsent,
  restoredPageNeedsCheck,
  type PerformanceConsentDeps
} from './performance-consent';
import { pageNoticeHost } from '../palette/notice';
import './side-by-side.css';

const log = createLogger('side-by-side');

/** The shadow-root host tag name handed to WXT (kebab-case, feature-scoped). */
const UI_NAME = 'wpr-fdt-side-by-side';

/** The degraded answer the asks and pushes collapse to: nothing exists here. */
const SIM_UNAVAILABLE: DeviceSimState = { available: false, enabled: false };

/**
 * Wire the compare flow into this content script. Pages that never use it
 * pay only the four message listeners.
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
  /** The presentation machine's facts, mirrored from its notifications. */
  const [sim, setSim] = createSignal<PresentationSnapshot>(INITIAL_PRESENTATION_SNAPSHOT);
  /** The halves' live presentation fit, reported by the rescale presenter. */
  const [simFits, setSimFits] = createSignal<FrameFitRecord>({});
  /** The overlay's URL pair, resolved at first open and never re-resolved. */
  let urls: CompareUrls | null = null;
  /** The overlay's shadow surface; built at first open (see `ensureUi`). */
  let surface: ShadowSurface | null = null;
  /**
   * The view's settled mount: the frame slots register through its render,
   * so every engine start must follow this promise — starting earlier arms
   * nothing (see the open path and the sync session's start contract).
   * Resolves whether the view is actually up: the open path degrades to
   * "nothing shown" instead of showing a dead overlay behind a locked page.
   */
  let viewMounted: Promise<boolean> = Promise.resolve(false);
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

  /**
   * The one serialized write chain for every overlay feature's persisted
   * choice (scroll sync, mobile comparison, desktop width). Read-modify-write
   * over the validated shape, so the other option slots keep their values; a
   * failed write degrades to "not persisted" — the live toggle already
   * applied, and the next open reads the stored value again. Consecutive
   * writes serialize in event order: two rapid switches (or one switch and a
   * toggle of another) write their read-modify-writes one after the other
   * (concurrent writes could otherwise resolve out of storage order and
   * persist a stale intent, which the next open would adopt).
   */
  let sbsPersistTail: Promise<void> = Promise.resolve();
  const persistFeatures = (
    why: string,
    write: (features: StoredOptions['features']) => StoredOptions['features']
  ): Promise<void> => {
    const run = sbsPersistTail.then(async (): Promise<void> => {
      try {
        const current = await getOptions();
        await optionsStore.setValue({
          ...current,
          features: write(current.features)
        });
      } catch (cause) {
        log.warn(
          `Persisting ${why} failed; the choice resets on the next open`,
          cause instanceof Error ? cause.message : cause
        );
      }
    });
    // The contract is resolve-only (every storage failure logs inline); the
    // belt catch keeps a contract violation from escaping unhandled.
    sbsPersistTail = run.catch(() => undefined);
    return run;
  };

  /** The scroll-sync switch's persisted intent. */
  const persistScrollSyncSetting = (next: boolean): Promise<void> =>
    persistFeatures('the scroll-sync setting', (features) => ({
      ...features,
      sbsScrollSync: next
    }));

  /** The mobile-comparison switch's persisted intent. */
  const persistSimSetting = (next: boolean): Promise<void> =>
    persistFeatures('the mobile-comparison setting', (features) => ({
      ...features,
      sbsMobileSim: next
    }));

  /** The desktop-width switch's persisted choice. */
  const persistDesktopSetting = (next: boolean): Promise<void> =>
    persistFeatures('the desktop-width setting', (features) => ({
      ...features,
      sbsDesktopWidth: next
    }));

  /** The presentation machine's browser seams: validated asks, reload, persisted writes. */
  const presentationIo: PresentationStateIO = {
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
    // it propagates; the truthful shapes are the machine's decisions. The
    // reply passes the boundary validator like every other payload: a
    // malformed answer is thrown INTO the machine's failed branch (pinned),
    // never read as truth.
    applyState: async (enabled: boolean): Promise<DeviceSimState> => {
      const answer = parseDeviceSimState(await sendMessage('setDeviceSimulation', { enabled }));
      if (answer === null) {
        throw new Error('the set-device-simulation reply is malformed');
      }
      return answer;
    },
    refreshHalves: (): void => {
      refreshFrames(COMPARE_SIDES);
    },
    // Both never reject: the persist helpers degrade internally, on the
    // shared chain (two switches' writes never interleave).
    persist: (enabled: boolean): Promise<void> => persistSimSetting(enabled),
    persistDesktop: (enabled: boolean): Promise<void> => persistDesktopSetting(enabled),
    log
  };

  /** The machine; every snapshot it announces lands in the `sim` signal — and a presentation change re-measures the fits. */
  let measuredFor: FramePresentation | null = null;
  const simMachine = createPresentationState(presentationIo, (snapshot) => {
    const presentationChanged = snapshot.presentation !== measuredFor;
    measuredFor = snapshot.presentation;
    setSim(snapshot);
    // Only an OPEN overlay re-measures here: the close path already stopped
    // the presenter, and the machine's settling close-convergence (a
    // presentation flip on the ask's answer) must not re-arm its observers
    // against the hidden overlay until the next open (which re-measures
    // unconditionally after its mount).
    if (presentationChanged && isOpen()) presenter.syncNow();
  });

  /** The presentation controller: fits from the columns, live on resize, torn down on close/invaldiation. */
  const presenter = createFramePresenter({
    presentation: () => sim().presentation,
    columns: () => columns,
    // The measure oracle follows the machine's presentation: each dress
    // reports its own flavored fit, so a style render never reads a foreign
    // flavor.
    measure: (column) => measureColumnFit(column, sim().presentation),
    onFit: (side, fit) => {
      setSimFits((current) => ({ ...current, [side]: fit }));
    },
    rescaleFactory: engineRescaleFactory(log),
    log
  });

  /**
   * Whether the halves may load their URLs: in a dressed presentation (phone
   * or desktop) the first navigation waits for both fits (each half loads
   * once, at its rendered size, after the open has established the rule or
   * the dress); the fluid presentation loads immediately.
   */
  const sizeGateOpen = createMemo(() => framesMayNavigate(sim().presentation, simFits()));

  /**
   * The scroll-sync switch: apply live, then persist on the shared chain.
   * The engine starts/stops with the switch — a running overlay follows
   * without a reload.
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
   * The desktop-width switch: the machine owns the dress (layout only, no
   * ask, no reload); the wiring only forwards the event — same
   * never-rejects forwarding as the mobile switch.
   */
  const onToggleDesktop = (next: boolean): void => {
    void simMachine.toggleDesktop(next);
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
   * Reload one side: same-origin frames reload in place (a real reload,
   * with its network and cache semantics, keeping the frame's history);
   * cross-origin frames (the analyses) reject the reload probe, and a frame
   * whose browsing context has not been created yet has nothing to probe —
   * both get their `src` re-assigned, which always re-navigates the frame.
   * The assignment is the deliberate fallback. A frame with no `src` at all
   * (the size gate still closed) skips the fallback: nothing loaded carries
   * a stale identity, and assigning onto the empty attribute would resolve
   * it against the host document (the frame would navigate into the page).
   */
  const reloadFrame = (side: CompareSide): void => {
    const frame = frames[side];
    if (frame === undefined) return;
    if (frame.getAttribute('src') === null) return;
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

  /**
   * Serializes the opens under the gate: a host removal (a gate off, even
   * if it is already back on) makes an open in flight stale — its view is
   * gone.
   */
  const openGuard = createOpenGuard({
    running: () => pageUi.running(),
    isInvalid: () => ctx.isInvalid
  });

  /**
   * Remove the overlay's host (the gate closed): the next open mounts a
   * fresh view, re-measures and loads the halves again; the URL pair and
   * the page's scroll baseline are kept (same page).
   */
  const unmountView = (): void => {
    openGuard.viewRemoved();
    surface?.hide();
    viewMounted = Promise.resolve(false);
    for (const side of COMPARE_SIDES) {
      frames[side] = undefined;
      columns[side] = undefined;
    }
    setSimFits({});
  };

  /**
   * An open the gate closed mid-flight: retract the simulation session it
   * may have established and remove a host it may have created; nothing
   * shows.
   */
  const abandonOpen = async (): Promise<void> => {
    await simMachine.close();
    unmountView();
    log.info('The Side-by-Side open was dropped: on-page UI turned off');
  };

  /** The PageSpeed Insights consent steps' wiring (Firefox only; built per use). */
  const performanceConsentDeps = (): PerformanceConsentDeps => ({
    ask: (next, mode) => sendMessage('askDataConsent', { feature: 'pagespeed', next, mode }),
    notify: (notice) => {
      if (!ctx.isInvalid) pageNoticeHost(ctx, log).show(notice);
    },
    log
  });

  /**
   * Refresh sides ({@link reloadFrame}). Firefox's analysis page checks its
   * consent again first: a grant revoked since the open reloads nothing (a
   * notice asks). Sides with nothing loaded are skipped up front.
   *
   * @param sides The sides to refresh.
   */
  const refreshFrames = (sides: readonly CompareSide[]): void => {
    const loaded = sides.filter((side) => frames[side]?.getAttribute('src') != null);
    if (loaded.length === 0) return;
    const reload = (): void => {
      if (!ctx.isInvalid) for (const side of loaded) reloadFrame(side);
    };
    // Build-time branch: the Chromium bundle reloads directly.
    if (import.meta.env.BROWSER === 'firefox' && isAutoFlowPage()) {
      void reloadAfterConsent(window.location.href, reload, performanceConsentDeps());
      return;
    }
    reload();
  };

  /** The overlay's open again (a consent notice's Try again or a grant). */
  const retryOpenOverlay = (): void => {
    openOverlay().catch((cause: unknown) => {
      log.error('Opening the overlay again failed', cause);
    });
  };

  /** The single open path for both the context menu and the auto-open. */
  const openOverlay = async (): Promise<void> => {
    // The two boot triggers (the carried flow and the reload restore) and
    // the context menu can fire close together: the guard serializes them
    // to exactly one open, and refuses while the gate is off (or unknown).
    const ticket = openGuard.begin(isOpen());
    if (ticket === 'busy') return;
    if (ticket === 'page-ui-off') {
      log.info('Side-by-Side not opened: on-page UI is off on this page');
      return;
    }
    try {
      // Firefox: the analysis frames carry the site's address off-device —
      // they load only once allowed (otherwise a notice asks; nothing loads).
      if (import.meta.env.BROWSER === 'firefox' && isAutoFlowPage()) {
        const allowed = await checkAnalysisConsent(
          window.location.href,
          retryOpenOverlay,
          performanceConsentDeps()
        );
        if (!allowed || ticket.cut()) return;
      }
      // First open: capture the scroll baseline and resolve the URL pair once.
      if (urls === null) {
        overflow.html = document.documentElement.style.overflow;
        overflow.body = document.body.style.overflow;
        urls = getOverlayUrls(new URL(window.location.href));
      }
      // The persisted settings are read at every open (mid-life external
      // changes apply next open). A failed read degrades the sync switch and
      // the mobile target to off — the owner's explicit option (the overlay
      // itself must not dead-end on a broken options store) — while the
      // desktop dress falls to its documented default from the storage
      // module (what the validator's own fallback answer would have been),
      // never a forced-off dress.
      let simTarget = false;
      let desktopTarget = FALLBACK.features.sbsDesktopWidth;
      try {
        const options = await getOptions();
        setSyncOn(options.features.sbsScrollSync);
        simTarget = options.features.sbsMobileSim;
        desktopTarget = options.features.sbsDesktopWidth;
      } catch (cause) {
        setSyncOn(false);
        simTarget = false;
        desktopTarget = FALLBACK.features.sbsDesktopWidth;
        log.error(
          'Reading the stored settings failed; the overlay opens with the sync switch off, the mobile target off and the desktop dress at its default',
          cause instanceof Error ? cause.message : cause
        );
      }
      // The simulation's ask — and any rule transition it commands — settles
      // BEFORE the view can mount: a first open's halves navigate only after
      // the rule exists, exactly the machine's rule-before-refresh ordering.
      if (ticket.cut()) return;
      const psi = isAutoFlowPage();
      await simMachine.open(psi, simTarget, desktopTarget);
      if (ticket.cut()) {
        await abandonOpen();
        return;
      }
      await ensureUi(urls);
      // The engine must not outrun its halves: `registerFrame`'s slots fill
      // during the render that `ensureUi` started but did not await. Starting
      // from an unregistered slot attaches nothing — and the session's start
      // guard would then keep a "running" engine deaf to the halves until a
      // switch cycle re-armed it (the reported default-on regression).
      const mounted = await viewMounted;
      if (ticket.cut()) {
        await abandonOpen();
        return;
      }
      if (!mounted) {
        // A dead view must not become a dead-end: no show (no scroll lock),
        // no continuity record, and a simulation session this open already
        // established is retracted — a rule without its overlay UI would
        // rewrite the tab's document requests invisibly. The half-mounted
        // host leaves the page, so the next open mounts and renders afresh
        // (a surviving mount would keep its dead view forever).
        await simMachine.close();
        surface?.hide();
        log.warn('The overlay view failed to mount — the open degraded, nothing shown');
        return;
      }
      // A world invalidated while its open was in flight must not show: the
      // controls would be dead. Everything this open established follows the
      // invalidation teardown (scroll, engines) and the sweep converges the
      // session rule.
      if (ctx.isInvalid) return;
      // Measure the halves now — the phone styles land with the first paint,
      // the rescale keeps every later window change live, and the size gate
      // (which held the urls during the fit-less phone presentation) releases.
      presenter.syncNow();
      // The analyses drive themselves — no correlated structure to sync there.
      if (syncOn() && !psi) startSync();
      show();
    } finally {
      // The gate closed and is already back on: the dropped open starts
      // afresh (its view was removed with the gate-off).
      if (openGuard.end(ticket)) {
        openOverlay().catch((cause: unknown) => {
          log.error('Re-opening the overlay after the gate came back failed', cause);
        });
      }
    }
  };

  const show = (): void => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    // The open state outlives this document's script only if the document
    // reloads itself on the same URL (a host-responsive reload, a refresh):
    // the next boot then restores the overlay instead of dropping it.
    markOverlayOpen(window, window.location.href);
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
    // The user closed the compare: its reloads restore nothing.
    markOverlayClosed(window);
    setOpen(false);
  };

  /**
   * The overlay's shadow surface for the page's URL pair: built at the first
   * open (a page that never opens the compare pays neither the view nor the
   * stylesheet fetch) and cycled across gate hide → show (one host for the
   * page's life). The iframes stay unsandboxed (no `sandbox`/
   * `credentialless`): the feature compares real pages with their real
   * cookies and requests, so a sandboxed pair would not show what the user
   * is comparing. (Security note: the frames load the user's own session.)
   *
   * @param pair The URL pair (resolved once per page, never re-resolved).
   * @returns The surface.
   */
  const createOverlaySurface = (pair: CompareUrls): ShadowSurface =>
    createShadowSurface({
      create: (hooks) =>
        createShadowRootUi(ctx, {
          name: UI_NAME,
          position: 'inline',
          onMount: hooks.onMount,
          onRemove: hooks.onRemove
        }),
      view: () => (
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
          refresh={(side) => {
            refreshFrames([side]);
          }}
          close={close}
          syncEnabled={syncOn}
          syncBlocked={(side) => syncBlocked()[side] === true}
          onToggleSync={onToggleSync}
          sim={sim}
          simFits={simFits}
          sizeGateOpen={sizeGateOpen}
          onToggleSim={onToggleSim}
          onToggleDesktop={onToggleDesktop}
        />
      ),
      isInvalid: () => ctx.isInvalid,
      onRenderError: (cause) => {
        log.error(
          'Mounting the side-by-side overlay view into the shadow root failed',
          cause instanceof Error ? cause.message : cause
        );
      }
    });

  /**
   * Show the overlay's host (once per open) and expose its render as
   * `viewMounted`: the open path awaits it before starting the sync engine,
   * and a false result keeps the open from showing a dead overlay (the
   * degrade branch there). A gate-off during the first creation refuses the
   * show (the open's own cut check then abandons it).
   */
  const ensureUi = async (pair: CompareUrls): Promise<void> => {
    surface ??= createOverlaySurface(pair);
    try {
      await surface.show(() => pageUi.running());
    } catch (error) {
      log.error(
        'Mounting the side-by-side overlay failed',
        error instanceof Error ? error.message : error
      );
    }
    viewMounted = surface.rendered();
  };

  /**
   * The PageSpeed Insights flow's entry: the analysis tab for this page.
   * On the analysis host itself it is a no-op (analysis flows start from a
   * site, never from PSI). Firefox goes through the background, which asks
   * its data consent first and opens the tab itself (`./performance-consent`).
   */
  const openPerformanceFlow = (): void => {
    if (ctx.isInvalid) return;
    if (isPsiHost(new URL(window.location.href))) return;
    const entryUrl = psiEntryUrl(new URL(window.location.href));
    if (entryUrl === null) return;
    // Build-time branch: the Chromium bundle opens directly, with no consent code.
    if (import.meta.env.BROWSER === 'firefox') {
      void openPerformanceWithConsent(entryUrl, openPerformanceFlow, performanceConsentDeps());
      return;
    }
    window.open(entryUrl, '_blank', NEW_TAB_FEATURES);
  };

  // The menu's receivers and the on-page palette call the same two
  // triggers: one open path per flow, whatever asked for it.
  provideSideBySideTriggers(ctx, { open: openOverlay, openPerformance: openPerformanceFlow });

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
      openPerformanceFlow();
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

  // The gate's start/stop (`./page-ui-gate`): the boot's open trigger (the
  // PageSpeed Insights auto-flow page, the reload restore), the close and
  // host removal on a gate-off, the re-open on a gate-on.
  const overlayGate = createOverlayGate({
    win: window,
    href: () => window.location.href,
    autoFlowPage: isAutoFlowPage,
    isOpen,
    opening: () => openGuard.inFlight(),
    open: openOverlay,
    close,
    unmount: unmountView,
    isInvalid: () => ctx.isInvalid,
    log
  });
  const pageUi = followGatedSurface(pageUiGateDeps(ctx, log), overlayGate);

  /** The boot moment: the restore record is consumed, then the gate decides. */
  const bootReady = (): void => {
    if (ctx.isInvalid) return;
    overlayGate.consumeRestore();
    pageUi.pageReady();
  };
  if (document.readyState === 'loading') {
    ctx.addEventListener(window, 'DOMContentLoaded', bootReady);
  } else {
    bootReady();
  }

  // Firefox: Back to the analysis page from the back/forward cache (e.g.
  // from an unanswered consent page) runs no boot — ask its consent again,
  // so frames or a notice show (build-time branch: not in Chromium).
  if (import.meta.env.BROWSER === 'firefox') {
    // An event listener, not a tracked scope: it reads the open state once per show.
    // eslint-disable-next-line solid/reactivity
    ctx.addEventListener(window, 'pageshow', (event) => {
      const again = restoredPageNeedsCheck({
        persisted: event.persisted,
        autoFlow: isAutoFlowPage(),
        open: isOpen(),
        opening: openGuard.inFlight()
      });
      if (again && !ctx.isInvalid) retryOpenOverlay();
    });
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
