/**
 * The on-page detection widget: the per-origin opt-in opens it, the hub's
 * already-cached single pass feeds it, and the Known Conflicts shell carries
 * its motion and focus choreography.
 *
 * Gate: one validated storage item read + armed watch (arm-first, the
 * live-theme lesson — a write landing inside the read window is applied by
 * the watch, and the read result is skipped in its favor). Enabling mounts
 * the widget on this page with no reload; disabling removes the shadow host
 * the same beat; other origins' entries cannot touch this page. A disabled
 * page costs one invalidated-safe storage read at boot, nothing mounted.
 *
 * Data: the widget reads the hub's cached pass result for this page through
 * the hub's same-context reader — a running pass is joined, never
 * re-triggered. The pass's result (detections + the WordPress version) is
 * immutable after the pass, so one read per mount is the widget's whole data
 * work; the presentation state machine (strip-state) renders it.
 */

import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createLogger } from '../../../lib/logger';
import type { PageData } from '../data-hub';
import { pageDataFor } from '../data-hub';
import {
  parseInspectorOrigins,
  isInspectorOriginEnabled,
  inspectorOriginsStore
} from '../../../lib/storage/inspector-origins';
import { mountShadowUi } from '../ui/mount';
import { moveFocus, type FocusChoreographyDeps } from '../ui/focus';
import type { StripDataSnapshot } from './strip-state';
import { buildStripCardModel, INSPECTOR_UI_NAME, insMood } from './strip-state';
import { InspectorView, type InspectorUiActions } from './ui';
import './inspector.css';

const log = createLogger('inspector');

/** The widget's reactive state (the store the view's accessors read). */
interface InspectorUiState {
  /** The report card is open (the pill is away). */
  cardOpen: boolean;
  /** The hub read's phase + detections. */
  snapshot: StripDataSnapshot;
  /** The WordPress version the pass read (the footer stamp's WP slot). */
  wordpressVersion: string | null;
}

/**
 * Wire the detection widget into this content script. A page the widget is
 * disabled on costs the first boot read (and the armed watch), nothing
 * else.
 *
 * @param ctx The content script's context; everything registers through it.
 */
export function setupInspectorWidget(ctx: ContentScriptContext): void {
  const pageOrigin = window.location.origin;
  const fdtVersion = browser.runtime.getManifest().version;

  const [state, setState] = createStore<InspectorUiState>({
    cardOpen: false,
    snapshot: { phase: 'running', detections: null },
    wordpressVersion: null
  });

  /** The card model, rebuilt only when the snapshot or WP version changes. */
  const model = createMemo(() =>
    buildStripCardModel({
      snapshot: state.snapshot,
      wordpressVersion: state.wordpressVersion,
      fdtVersion
    })
  );
  const mood = createMemo(() => insMood(state.snapshot));

  /** The hub's same-context reader (null when the hub's setup failed). */
  const reader = pageDataFor(ctx);
  if (reader === null) {
    // One pass is the widget's whole data source; without the hub there is no
    // honest report — the widget mounts (it is the opt-in's promise) and
    // renders its failure copy from the first read below.
    log.error('The page-data hub is unavailable — the widget cannot report');
  }

  let shadowUi: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
  /** The Solid disposer, once the shadow-root render has completed. */
  let disposeRoot: (() => void) | null = null;
  /** Whether a shadow-root mount is in flight (double-mount + race guard). */
  let mountPending = false;
  /** The gate's current truth, mirrored for the mount's race re-check. */
  let enabledNow = false;
  /** The card's root element, registered by the view (focus choreography). */
  let cardElement: HTMLElement | null = null;
  /** The pill, registered by the view (the focus hand-back on close). */
  let pillElement: HTMLElement | null = null;

  /** The focus choreography rides this context's frames (ui/focus's contract). */
  const focusDeps: FocusChoreographyDeps = {
    requestFrame: (callback) => {
      ctx.requestAnimationFrame(callback);
    },
    isInvalid: () => ctx.isInvalid,
    log
  };

  const actions: InspectorUiActions = {
    registerCard: (element: HTMLElement | null) => {
      cardElement = element;
    },
    registerPill: (element: HTMLElement | null) => {
      pillElement = element;
    },
    openCard: () => {
      setState('cardOpen', true);
      // Focus the card once the class state is on (prevents page scroll on
      // the move — mouse users keep the viewport, keyboard users land in).
      if (cardElement !== null) moveFocus(cardElement, 'card', focusDeps);
    },
    closeCard: () => {
      setState('cardOpen', false);
      // The invoker regains focus (standard popover choreography).
      if (pillElement !== null) moveFocus(pillElement, 'marker', focusDeps);
    }
  };

  /**
   * One hub read: join the running pass (or the cached result) and store the
   * answer. Single-flight by the hub's own contract — the widget never
   * re-triggers a pass, it waits for the page's one.
   */
  const refreshData = async (): Promise<void> => {
    setState({ snapshot: { phase: 'running', detections: null }, wordpressVersion: null });
    if (reader === null) {
      setState('snapshot', { phase: 'failed', detections: null });
      return;
    }
    let result: PageData | null;
    try {
      result = await reader();
    } catch (cause) {
      // The read is the hub's own promise; a rejection here is the pass
      // economics' failure mode. Never an unhandled rejection.
      if (ctx.isInvalid) return;
      log.error('Reading the page data for the widget failed', cause);
      setState('snapshot', { phase: 'failed', detections: null });
      return;
    }
    if (ctx.isInvalid) return;
    if (result === null) {
      setState('snapshot', { phase: 'failed', detections: null });
      return;
    }
    setState({
      snapshot: { phase: 'ready', detections: result.detections },
      wordpressVersion: result.wordpressVersion
    });
  };

  /** Mount the widget once; later enable beats only move reactive state. */
  const mountIntoShadow = async (): Promise<void> => {
    if (shadowUi !== null || mountPending) return;
    mountPending = true;
    try {
      const created = await createShadowRootUi(ctx, {
        name: INSPECTOR_UI_NAME,
        position: 'inline',
        isolateEvents: true,
        onMount: (container) => {
          void mountShadowUi(container, () => (
            <InspectorView
              model={model}
              mood={mood}
              cardOpen={() => state.cardOpen}
              actions={actions}
            />
          ))
            .then((dispose) => {
              disposeRoot = dispose;
            })
            .catch((cause: unknown) => {
              log.error(
                'Mounting the detection widget view into the shadow root failed',
                cause instanceof Error ? cause.message : cause
              );
            });
        },
        onRemove: () => {
          disposeRoot?.();
          disposeRoot = null;
          cardElement = null;
          pillElement = null;
        }
      });
      if (ctx.isInvalid) {
        // The mount resolved after invalidation: the short-lived host must
        // not outlive it (a dead context never keeps page DOM).
        created.remove();
        return;
      }
      if (!enabledNow) {
        // Disable won the mount race: remove the host before it ever shows.
        created.remove();
        return;
      }
      shadowUi = created;
      created.mount();
      // Escape closes the card with the focus inside it. Key events never
      // reach the host page from this shadow root (the injection isolates
      // them at the root), and the listener rides `ctx` so teardown rides
      // the same abort signal every other callback here does.
      ctx.addEventListener(created.shadow, 'keydown', (event) => {
        if (!ctx.isInvalid && event instanceof KeyboardEvent && event.key === 'Escape') {
          event.stopPropagation();
          actions.closeCard();
        }
      });
    } catch (error) {
      log.error(
        'Mounting the detection widget failed',
        error instanceof Error ? error.message : error
      );
      shadowUi = null;
    } finally {
      mountPending = false;
    }
  };

  /**
   * Apply the gate's next value: mount/refresh when enabled, unmount when
   * not. The same-beat contract the theme follow proves: the storage write's
   * watch callback is the enable/disable, so a UI toggle flips the page's
   * widget without a reload.
   *
   * @param enabled The origin's entry.
   */
  const applyGate = (enabled: boolean): void => {
    enabledNow = enabled;
    if (enabled) {
      void refreshData();
      void mountIntoShadow();
      return;
    }
    shadowUi?.remove();
    shadowUi = null;
    setState('cardOpen', false);
  };

  /**
   * Arm-first boot: the watch is the gate's authority once armed, so the
   * initial read applies only when no write raced it (the live-theme
   * pattern's counter — read-then-arm would drop exactly that write).
   */
  let gateWrites = 0;
  const unwatch = inspectorOriginsStore.watch((raw: unknown) => {
    gateWrites += 1;
    if (ctx.isInvalid) return;
    const parsed = parseInspectorOrigins(raw);
    applyGate(parsed?.[pageOrigin]?.enabled === true);
  });
  ctx.onInvalidated(unwatch);

  void (async () => {
    const seen = gateWrites;
    let answer: boolean;
    try {
      answer = await isInspectorOriginEnabled(pageOrigin);
    } catch (cause) {
      if (ctx.isInvalid) return;
      log.error('Reading the widget opt-in failed — the widget stays hidden', cause);
      answer = false;
    }
    if (ctx.isInvalid) return;
    if (gateWrites === seen) {
      applyGate(answer);
    }
  })();
}
