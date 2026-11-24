/**
 * Known Conflicts on two surfaces' pages: the HelpScout conversation and the
 * WordPress manage-plugins screen. The scanner detects conflicts whose names
 * appear on either; the badge opens the list in a shadow root.
 *
 * Behavior deltas from the shipped baseline, all deliberate:
 * - The HelpScout rescan reads tables from the live DOM (re-serializing and
 *   re-parsing the whole document per debounced tick used to repeat
 *   multi-megabyte work), and the MutationObserver disconnects on
 *   invalidation and whenever the page leaves the mode.
 * - The plugins screen re-scans once late (late-rendered plugin tables were
 *   missed by the single-pass `load` scan), bounded and cleaned up.
 * - The DB loads through storage + one background ask, and scans re-run when
 *   the stored row set changes (updates no longer need a page reload).
 * - List/badge state is class-based (no `transitionend` bookkeeping), the
 *   loading state holds until a usable DB verdict (`dbRowsUsable`) and the
 *   corrected empty state renders only for a settled zero-finding scan on a
 *   served database (`emptyStateVisible`).
 * - The on-page UI gate decides whether any of it runs: the scans start at
 *   the page's first scan moment only while the gate is on; a gate-off
 *   write removes the card and stops the observer and pending rescans, a
 *   gate-on write rescans at once and shows the card again.
 */

import { createStore } from 'solid-js/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  WINDOW_FRAMES,
  WINDOW_TIMERS,
  contextFrames,
  contextScheduler
} from '../../../utils/context-timers';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';
import { findKnownConflicts } from '../../../lib/known-conflicts/match';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { isHttpUrl, NEW_TAB_FEATURES } from '../../../utils/urls';
import { debounce, type DebouncedFunction } from '../../../utils/debounce';
import { createLogger } from '../../../lib/logger';
import { createShadowSurface } from '../../../components/injected-ui/shadow-surface';
import { followGatedSurface } from '../../../lib/page-ui/gated-surface';
import { pageUiGateDeps } from '../../../lib/page-ui/gate-follower';
import { moveFocus, type FocusChoreographyDeps } from '../ui/focus';
import { createConflictsDb } from './conflicts-db';
import { extractScanText, scanModeForUrl } from './extract';
import { createScanFlow } from './scan-flow';
import {
  dbRowsUsable,
  emptyStateVisible,
  mergeFindings,
  pageChurned,
  surfaceChanged
} from './scan-state';
import { KnownConflictsView, type KnownConflictsUiState } from './ui';
import './known-conflicts.css';

const log = createLogger('known-conflicts');

/** Debounce window of the HelpScout rescan (SPA churn → one scan per burst). */
const HS_RESCAN_DEBOUNCE_MS = 500;
/**
 * Delay of the plugins screen's single late re-scan: the table renders
 * server-side but admin scripts can rewrite rows after `load`. One extra
 * bounded pass covers the late shape; nothing polls after it.
 */
const WP_RESCAN_DELAY_MS = 1_000;
/** The shadow-root host tag name handed to WXT (kebab-case, feature-scoped). */
const UI_NAME = 'wpr-fdt-known-conflicts';

/** State before the database resolves: loading badge, no verdict. */
function initialUiState(): KnownConflictsUiState {
  return {
    loading: true,
    scannedEmpty: false,
    findings: [],
    listOpen: false,
    badgeCollapsed: false
  };
}

/**
 * Wire the Known Conflicts feature into this content script. Pages outside
 * the two modes cost nothing beyond the URL check (no storage reads, no UI,
 * no timers).
 *
 * @param ctx The content script's context; everything registers through it.
 */
export function setupKnownConflicts(ctx: ContentScriptContext): void {
  // Frames and timers that let go of their callbacks (see utils/context-timers).
  const nextFrame = contextFrames(ctx, WINDOW_FRAMES);
  const later = contextScheduler(ctx, WINDOW_TIMERS);
  const initialUrl = new URL(window.location.href);
  const initialMode = scanModeForUrl(initialUrl);
  if (initialMode === 'none') return;

  const db = createConflictsDb();
  const [state, setState] = createStore<KnownConflictsUiState>(initialUiState());

  /** Reset to the freshly-navigated widget (the element rebuild's shape). */
  const navigationReset = (): void => {
    setState({ listOpen: false, badgeCollapsed: false, scannedEmpty: false });
  };

  /** Rows accumulated for the current surface (cleared on navigation). */
  let accumulated: readonly KnownConflict[] = [];
  /** Most recent pathname; a change re-baselines the scan state. */
  let currentPathname = initialUrl.pathname;
  /**
   * Whether a usable DB verdict has landed (the scan machine's plain fact,
   * mirrored to the view's `loading` state at the same write sites — the
   * scanner runs imperatively and must never read the reactive store).
   */
  let dbResolved = false;

  let hsObserver: MutationObserver | null = null;
  /** The HelpScout mode's debounced rescan (null in the plugins-screen mode). */
  let rescanDebounced: DebouncedFunction<[]> | null = null;
  /** The card's root element, registered by the view (focus choreography). */
  let panelElement: HTMLElement | null = null;
  /** The marker pill, registered by the view (focus hand-back on close). */
  let badgeElement: HTMLElement | null = null;

  const openFinding = (url: string): void => {
    if (!isHttpUrl(url)) {
      log.warn('Conflict link is not an openable http(s) URL — ignoring it');
      return;
    }
    window.open(url, '_blank', NEW_TAB_FEATURES);
  };

  /** The focus choreography rides this context's frames (ui/focus's contract). */
  const focusDeps: FocusChoreographyDeps = {
    requestFrame: (callback) => {
      nextFrame(callback);
    },
    isInvalid: () => ctx.isInvalid,
    log
  };

  const actions = {
    registerPanel: (element: HTMLElement | null) => {
      panelElement = element;
    },
    registerBadge: (element: HTMLElement | null) => {
      badgeElement = element;
    },
    toggleBadge: () => {
      setState('badgeCollapsed', (collapsed) => !collapsed);
    },
    openList: () => {
      setState({ listOpen: true, badgeCollapsed: false });
      // Focus the card once the class state is on: keyboard users land
      // inside it without a stray page-scroll. Mouse users keep the page
      // unscrolled (preventScroll).
      if (panelElement !== null) moveFocus(panelElement, 'card', focusDeps);
    },
    closeList: () => {
      setState('listOpen', false);
      // The invoker regains focus (standard popover choreography) — the
      // marker pill, where the card opened from.
      if (badgeElement !== null) moveFocus(badgeElement, 'marker', focusDeps);
    },
    openFinding
  };

  /**
   * Load the DB once, then retire the loading badge only for a usable verdict
   * (`dbRowsUsable`): zero rows keep the loading state — an unserved DB is not
   * a scan verdict, so the empty state (which reads "no conflicts") cannot
   * render over a missing database, and a later storage write (the watch)
   * provides what the page then rescans against.
   */
  const bootstrap = async (): Promise<void> => {
    const rows = await db.load();
    if (ctx.isInvalid) return;
    const usable = dbRowsUsable(rows);
    dbResolved = usable;
    setState('loading', !usable);
    log.debug(
      usable
        ? `Conflict database loaded (${String(rows.length)} rows)`
        : 'Conflict database unavailable — keeping the loading state until it arrives'
    );
  };

  /**
   * The card's shadow UI: created at the first show and cycled across gate
   * and navigation hide → show (one host for the page's life).
   */
  const surface = createShadowSurface({
    create: (hooks) =>
      createShadowRootUi(ctx, {
        name: UI_NAME,
        position: 'inline',
        onMount: hooks.onMount,
        onRemove: hooks.onRemove
      }),
    view: () => <KnownConflictsView state={state} actions={actions} />,
    isInvalid: () => ctx.isInvalid,
    onMounted: ({ shadow, signal }) => {
      // Escape closes the card with the focus inside it. Key events never
      // reach the host page from this shadow root (the injection isolates
      // them at the root); the listener lives as long as this mount and
      // the context.
      shadow.addEventListener(
        'keydown',
        (event) => {
          if (!ctx.isInvalid && event instanceof KeyboardEvent && event.key === 'Escape') {
            event.stopPropagation();
            actions.closeList();
          }
        },
        { signal: AbortSignal.any([ctx.signal, signal]) }
      );
    },
    onRemoved: () => {
      panelElement = null;
      badgeElement = null;
    },
    onRenderError: (cause) => {
      log.error(
        'Mounting the Known Conflicts view into the shadow root failed',
        cause instanceof Error ? cause.message : cause
      );
    }
  });

  /**
   * Whether the card may show now: the on-page UI gate is on and the page
   * is still in one of the scan modes (an SPA navigation may have left).
   */
  const showAllowed = (): boolean =>
    pageUi.running() && scanModeForUrl(new URL(window.location.href)) !== 'none';

  /**
   * Show the badge unless it is up; the gate and the scan scope are
   * re-checked after the first show's host creation (a gate-off or a
   * navigation out of scope may have won it).
   */
  const mountIntoShadow = async (): Promise<void> => {
    try {
      await surface.show(showAllowed);
    } catch (error) {
      log.error(
        'Mounting the Known Conflicts badge failed',
        error instanceof Error ? error.message : error
      );
    }
  };

  /** Brief collapsed pass, so the badge re-runs its slide-in transition. */
  const slideBadgeIn = (): void => {
    setState('badgeCollapsed', true);
    nextFrame(() => {
      if (ctx.isInvalid) return;
      setState('badgeCollapsed', false);
    });
  };

  /**
   * One scan pass against the current URL's surface (only ever reached
   * through the flow's gated `scan`). A pathname change re-baselines first:
   * accumulated findings clear (the previous ticket's rows must not bleed
   * into the next one) and the widget resets to its fresh-opened shape;
   * leaving both modes unmounts the UI entirely and disconnects the
   * observer.
   */
  const scanPass = (): void => {
    const url = new URL(window.location.href);
    const pathnameChanged = surfaceChanged(currentPathname, url.pathname);
    currentPathname = url.pathname;
    if (pathnameChanged) {
      accumulated = [];
      navigationReset();
      if (scanModeForUrl(url) === 'none') {
        hsObserver?.disconnect();
        hsObserver = null;
        surface.hide();
        setState({ findings: [], scannedEmpty: false });
        return;
      }
      slideBadgeIn();
    }
    const mode = scanModeForUrl(url);
    if (mode === 'none') return;
    const scanText = extractScanText(mode, document.body);
    const found = scanText === '' ? [] : findKnownConflicts(scanText, db.rows, mode);
    accumulated = mergeFindings(accumulated, found);
    setState({
      findings: accumulated,
      scannedEmpty: emptyStateVisible(accumulated, flow.settled(), !dbResolved)
    });
    if (!surface.isShown()) void mountIntoShadow();
  };

  /** Remove the card (the gate closed) and reset it for the next show. */
  const removeCard = (): void => {
    surface.hide();
    navigationReset();
  };

  const flow = createScanFlow({
    mode: initialMode,
    latePassDelayMs: WP_RESCAN_DELAY_MS,
    running: () => pageUi.running(),
    isInvalid: () => ctx.isInvalid,
    pass: scanPass,
    later,
    observe: () => {
      hsObserver?.observe(document.body, { subtree: true, childList: true });
    },
    disconnect: () => {
      hsObserver?.disconnect();
    },
    rescanSoon: () => {
      rescanDebounced?.();
    },
    cancelRescan: () => {
      rescanDebounced?.cancel();
    },
    removeCard
  });
  const runScan = flow.scan;

  const pageUi = followGatedSurface(pageUiGateDeps(ctx, log), {
    start: flow.start,
    stop: flow.stop
  });

  void bootstrap();

  if (initialMode === 'wp-admin') {
    // The page's first scan moment is `load` (or now, past it).
    if (document.readyState === 'complete') {
      pageUi.pageReady();
    } else {
      ctx.addEventListener(window, 'load', () => {
        if (!ctx.isInvalid) pageUi.pageReady();
      });
    }
  } else {
    // HelpScout is a SPA: rescan on DOM churn and on history-API navigation,
    // both debounced; leaving the mode disconnects the observer. The first
    // pass follows the fully-rendered moment like every scan here.
    const debounced = debounce(() => {
      if (!ctx.isInvalid) runScan();
    }, HS_RESCAN_DEBOUNCE_MS);
    rescanDebounced = debounced;
    hsObserver = new MutationObserver((records) => {
      if (ctx.isInvalid) {
        hsObserver?.disconnect();
        return;
      }
      // The card's own mount/unmount is not page churn.
      if (pageChurned(records, (node) => node.nodeName.toLowerCase() === UI_NAME)) debounced();
    });
    const afterLoad = (): void => {
      if (!ctx.isInvalid) pageUi.pageReady();
    };
    ctx.addEventListener(window, 'load', afterLoad);
    // History-API navigations can change the URL without body-level DOM
    // mutations; URL tracking re-baselines those too (only while scanning).
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      if (!ctx.isInvalid && pageUi.running()) debounced();
    });
    if (document.readyState !== 'loading') afterLoad();
    ctx.onInvalidated(() => {
      // The single leak this mode shipped with: an observer outliving its
      // page state. Disconnect always (cheap); everything registered
      // through ctx cleans itself.
      hsObserver?.disconnect();
      hsObserver = null;
      debounced.cancel();
    });
  }

  // DB updates (the updater's writes, a manual refresh, an options reset)
  // keep the open page live: fresh rows, fresh scan — no page reload.
  const onConflictsDbWrite = (freshRows: readonly KnownConflict[] | null): void => {
    if (ctx.isInvalid || freshRows === null) return;
    // A delivered write is a served DB — even a zero-row one retires the
    // loading state, unlike the bootstrap's zero rows (not served yet); the
    // rescan re-runs the settled gate with the loading state off, so the
    // empty state can legitimately appear from this point on.
    dbResolved = true;
    setState('loading', false);
    runScan();
  };
  ctx.onInvalidated(db.watch(onConflictsDbWrite));
}
