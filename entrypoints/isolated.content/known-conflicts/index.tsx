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
 */

import { createStore } from 'solid-js/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';
import { findKnownConflicts } from '../../../lib/known-conflicts/match';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { isHttpUrl } from '../../../utils/urls';
import { debounce } from '../../../utils/debounce';
import { createLogger } from '../../../lib/logger';
import { mountShadowUi } from '../ui/mount';
import { moveFocus, type FocusChoreographyDeps } from '../ui/focus';
import { createConflictsDb } from './conflicts-db';
import { extractScanText, scanModeForUrl } from './extract';
import {
  dbRowsUsable,
  emptyStateVisible,
  mergeFindings,
  passSettled,
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
  /** True once the plugins screen's bounded late pass has run. */
  let wpPassesSettled = initialMode === 'helpscout';
  /**
   * Whether a usable DB verdict has landed (the scan machine's plain fact,
   * mirrored to the view's `loading` state at the same write sites — the
   * scanner runs imperatively and must never read the reactive store).
   */
  let dbResolved = false;

  let shadowUi: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
  /** The Solid disposer, once the shadow-root render has completed. */
  let disposeRoot: (() => void) | null = null;
  let hsObserver: MutationObserver | null = null;
  /** The card's root element, registered by the view (focus choreography). */
  let panelElement: HTMLElement | null = null;
  /** The marker pill, registered by the view (focus hand-back on close). */
  let badgeElement: HTMLElement | null = null;

  const openFinding = (url: string): void => {
    if (!isHttpUrl(url)) {
      log.warn('Conflict link is not an openable http(s) URL — ignoring it');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  /** The focus choreography rides this context's frames (ui/focus's contract). */
  const focusDeps: FocusChoreographyDeps = {
    requestFrame: (callback) => {
      ctx.requestAnimationFrame(callback);
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

  /** Mount the badge once; later passes only move reactive state. */
  const mountIntoShadow = async (): Promise<void> => {
    if (shadowUi !== null) return;
    try {
      shadowUi = await createShadowRootUi(ctx, {
        name: UI_NAME,
        position: 'inline',
        isolateEvents: true,
        // The render tree is disposed exactly once (when the shadow host
        // leaves the page) through the onRemove handle; a mount failure is
        // logged, not an unhandled rejection.
        onMount: (container) => {
          void mountShadowUi(container, () => (
            <KnownConflictsView state={state} actions={actions} />
          ))
            .then((dispose) => {
              disposeRoot = dispose;
            })
            .catch((cause: unknown) => {
              log.error(
                'Mounting the Known Conflicts view into the shadow root failed',
                cause instanceof Error ? cause.message : cause
              );
            });
        },
        onRemove: () => {
          disposeRoot?.();
          disposeRoot = null;
          panelElement = null;
          badgeElement = null;
        }
      });
      shadowUi.mount();
      // Escape closes the card with the focus inside it. Key events never
      // reach the host page from this shadow root (the injection isolates
      // them at the root), and the listener rides `ctx` so teardown rides
      // the same abort signal every other callback here does.
      ctx.addEventListener(shadowUi.shadow, 'keydown', (event) => {
        if (!ctx.isInvalid && event instanceof KeyboardEvent && event.key === 'Escape') {
          event.stopPropagation();
          actions.closeList();
        }
      });
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
    ctx.requestAnimationFrame(() => {
      if (ctx.isInvalid) return;
      setState('badgeCollapsed', false);
    });
  };

  /**
   * One scan pass against the current URL's surface. A pathname change
   * re-baselines first: accumulated findings clear (the previous ticket's
   * rows must not bleed into the next one) and the widget resets to its
   * fresh-opened shape; leaving both modes unmounts the UI entirely and
   * disconnects the observer.
   */
  const runScan = (): void => {
    const url = new URL(window.location.href);
    const pathnameChanged = surfaceChanged(currentPathname, url.pathname);
    currentPathname = url.pathname;
    if (pathnameChanged) {
      accumulated = [];
      navigationReset();
      if (scanModeForUrl(url) === 'none') {
        hsObserver?.disconnect();
        hsObserver = null;
        shadowUi?.remove();
        shadowUi = null;
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
      scannedEmpty: emptyStateVisible(accumulated, passSettled(mode, wpPassesSettled), !dbResolved)
    });
    if (shadowUi === null) void mountIntoShadow();
  };

  void bootstrap();

  if (initialMode === 'wp-admin') {
    // Bounded two-pass flow: the `load` pass plus one late pass. The empty
    // state is shown as final only once the late pass has RUN — settling
    // when the pass is scheduled would let a DB write in that window render
    // it before the late pass had its chance.
    const initialWpScan = (): void => {
      if (ctx.isInvalid) return;
      runScan();
      if (wpPassesSettled) return;
      ctx.setTimeout(() => {
        // Invalidation-cancelled: the flow stays unsettled (nothing scans,
        // nothing shows a final verdict).
        if (ctx.isInvalid) return;
        wpPassesSettled = true;
        runScan();
      }, WP_RESCAN_DELAY_MS);
    };
    if (document.readyState === 'complete') {
      initialWpScan();
    } else {
      ctx.addEventListener(window, 'load', () => {
        if (!ctx.isInvalid) initialWpScan();
      });
    }
  } else {
    // HelpScout is a SPA: rescan on DOM churn and on history-API navigation,
    // both debounced; leaving the mode disconnects the observer. The first
    // pass follows the fully-rendered moment like every scan here.
    const rescanDebounced = debounce(() => {
      if (!ctx.isInvalid) runScan();
    }, HS_RESCAN_DEBOUNCE_MS);
    hsObserver = new MutationObserver(() => {
      if (ctx.isInvalid) {
        hsObserver?.disconnect();
        return;
      }
      rescanDebounced();
    });
    const afterLoad = (): void => {
      if (ctx.isInvalid) return;
      hsObserver?.observe(document.body, { subtree: true, childList: true });
      rescanDebounced();
    };
    ctx.addEventListener(window, 'load', afterLoad);
    // History-API navigations can change the URL without body-level DOM
    // mutations; URL tracking re-baselines those too.
    ctx.addEventListener(window, 'wxt:locationchange', () => {
      if (!ctx.isInvalid) rescanDebounced();
    });
    if (document.readyState !== 'loading') afterLoad();
    ctx.onInvalidated(() => {
      // The single leak this mode shipped with: an observer outliving its
      // page state. Disconnect always (cheap); everything registered
      // through ctx cleans itself.
      hsObserver?.disconnect();
      hsObserver = null;
      rescanDebounced.cancel();
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
