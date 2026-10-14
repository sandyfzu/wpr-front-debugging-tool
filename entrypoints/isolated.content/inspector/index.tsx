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
import type { DragBox, DragController, DragMachineDeps } from './drag';
import { createDragController, isPointerInitiatedClick } from './drag';
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
  /**
   * The chrome, registered by the view (the drag's listener site and the
   * translate writer); nulled with every removal like its siblings.
   */
  let chromeElement: HTMLElement | null = null;
  /**
   * The current mount's drag controller. One controller exists per mount —
   * a fresh mount (gate enable or a reload) starts at the stylesheet anchor,
   * so the drag position resets by construction: session-local, P12A.5's
   * recorded no-persistence shape. Null while nothing is mounted.
   */
  let dragController: DragController | null = null;
  /**
   * Which visible shape the active press grabbed (the drag box's element):
   * the pill path sets the pill, a card handle sets the card. A handler-local
   * read between the grab and the live re-reads — never read at rest.
   */
  let grabbedShape: HTMLElement | null = null;

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
    registerChrome: (element: HTMLElement | null) => {
      chromeElement = element;
      if (element !== null) bindChromeDrag(element);
    },
    openCard: (trigger) => {
      // The suppression answers pointer presses only: a pointer click (press
      // count above zero) that belonged to a moved drag is consumed here; a
      // keyboard activation never reads the pointer path's flag, so a drag
      // whose release click landed consumer-less cannot dead-end the
      // keyboard's Enter (SB-D9's no-dead-ends). One truth lives in the
      // machine: pointer state, pointer consumers — `isPointerInitiatedClick`
      // is the verified `detail === 0` keyboard discriminator.
      if (
        isPointerInitiatedClick(trigger.detail) &&
        dragController?.consumeClickSuppression() === true
      ) {
        return;
      }
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
   * The drag machine's seams: the viewport and the grabbed shape's box are
   * read per call (each move re-clamps against the live truth), and the
   * position writes land as the chrome's drag-translate custom properties —
   * unset values are the stylesheet's bottom-right anchor, so "no translate"
   * is the resting anchor by construction.
   */
  const dragDeps: DragMachineDeps = {
    // The fixed element's containing block IS the layout viewport: its extent
    // is `documentElement.clientWidth/Height` (classic-scrollbar bands
    // excluded — `window.innerWidth` includes them, and reading them would
    // let the clamp accept positions the scrollbar hem keeps mostly
    // invisible). Overlay-scrollbar hosts read the same numbers either way.
    readViewport: () => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight
    }),
    readBox: (): DragBox | null => {
      const shape = grabbedShape;
      if (shape === null || !shape.isConnected) return null;
      const rect = shape.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
    applyPosition: (position) => {
      const chrome = chromeElement;
      if (chrome === null) return;
      if (position === null) {
        chrome.style.removeProperty('--ins-drag-x');
        chrome.style.removeProperty('--ins-drag-y');
        return;
      }
      chrome.style.setProperty('--ins-drag-x', `${String(position.x)}px`);
      chrome.style.setProperty('--ins-drag-y', `${String(position.y)}px`);
    },
    applyDragging: (dragging) => {
      chromeElement?.classList.toggle('ins-dragging', dragging);
    }
  };

  /**
   * One trust predicate at the wiring level: every event arm acts on user
   * input only. Script-synthesized gestures (assertions replays, page-probe
   * experiments) must not reach the machine's state arms — the uniform
   * idiom the pointerdown and the pill's click already carry.
   */
  const isTrustedUserEvent = (event: Event): boolean => event.isTrusted;

  /**
   * Bind the drag's pointer listeners to the chrome (their element dies with
   * the shadow host; teardown also rides the context): trusted primary
   * presses decide a handle and the capture routes the whole gesture back
   * here by bubbling, so no page-scoped listener ever exists.
   *
   * @param chrome The view's chrome root.
   */
  function bindChromeDrag(chrome: HTMLElement): void {
    ctx.addEventListener(chrome, 'pointerdown', (event) => {
      // WXT's ctx overload stays at the `Event` level for element targets —
      // `instanceof` is the boundary narrowing (the shipped keydown idiom).
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      // Any press while a drag is live cancels it first: a right-press (the
      // brief's cancel nicety) and a second pointer's press must not be
      // subject to the primary-button guard below — cancel beats grab.
      if (dragController?.isDragging() === true) {
        dragController.cancel();
        return;
      }
      if (event.button !== 0) return; // A wrong button never grabs the chrome.
      const target = event.target;
      if (!(target instanceof Element)) return;
      const fromPill = target.closest('.ins-pill');
      const fromHandle = target.closest('.ins-card-head') ?? target.closest('.ins-card-foot');
      if (fromPill === null && fromHandle === null) return;
      // The close control (any button inside a handle region) never grabs.
      if (fromPill === null && target.closest('button') !== null) return;
      // The grabbed shape is both the capture site and the live box: capturing
      // IT (not the chrome) keeps the release's click on the pill (the spec
      // retargets captured clicks), where the moved-drag suppression decides;
      // its moves bubble on through the chrome's listeners below either way.
      grabbedShape = fromPill instanceof HTMLElement ? fromPill : cardElement;
      const shape = grabbedShape;
      if (shape === null) return;
      try {
        // Capture first: if the pointer died between events, nothing grabs.
        shape.setPointerCapture(event.pointerId);
      } catch (cause) {
        log.debug(
          'Pointer capture refused — the grab aborted',
          cause instanceof Error ? cause.message : cause
        );
        return;
      }
      dragController?.beginGrab({
        point: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId
      });
    });
    ctx.addEventListener(chrome, 'pointermove', (event) => {
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      dragController?.trackMove({
        point: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId
      });
    });
    ctx.addEventListener(chrome, 'pointerup', (event) => {
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      dragController?.settle(event.pointerId);
    });
    ctx.addEventListener(chrome, 'pointercancel', (event) => {
      if (!isTrustedUserEvent(event)) return;
      dragController?.cancel();
    });
    ctx.addEventListener(chrome, 'lostpointercapture', (event) => {
      // A capture lost outside the release path (element detached, pointer
      // gone) is pointercancel-shaped: restore the pre-drag position.
      if (!isTrustedUserEvent(event)) return;
      dragController?.cancel();
    });
    ctx.addEventListener(chrome, 'contextmenu', (event) => {
      // The right-press route (verbatim from this machine): a second button
      // pressed while the left pointer is captured delivers NO pointerdown —
      // the chrome gets `contextmenu` alone. The brief's right-click cancel
      // rides it (no preventDefault: the host keeps its native menu).
      if (!isTrustedUserEvent(event)) return;
      dragController?.cancel();
    });
  }

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

  /**
   * The context's liveness as a fresh read per call: it is a getter over
   * mutable state that flips during the awaited windows below, so a static
   * read would lie about the race this code exists for.
   */
  const invalidNow = (): boolean => ctx.isInvalid;

  /**
   * `document.body` as the platform can actually serve it during this boot:
   * lib.dom@5.9 types `Document.body` non-nullable, but a `document_start`
   * content script observes `null` until the document builds.
   */
  const bodyOrNull = (): HTMLElement | null => document.body;

  /** Mount the widget once; later enable beats only move reactive state. */
  const mountIntoShadow = async (): Promise<void> => {
    if (shadowUi !== null || mountPending) return;
    mountPending = true;
    // One controller per mount: a fresh mount starts at the stylesheet
    // anchor, so navigation/reload resets the session-local drag position
    // (P12A.5's no-persistence shape — nothing is stored anywhere).
    dragController = createDragController(dragDeps);
    grabbedShape = null;
    try {
      // The page's anchor must exist first: the CS boots at document_start,
      // where the body is still null and WXT's inline shadow UI has no
      // anchor to attach to (the audited unmountable-boot — intermittent with
      // boot speed). Wait for it behind the context's own lifecycle.
      if (bodyOrNull() === null) {
        await new Promise<void>((resolve) => {
          ctx.addEventListener(document, 'DOMContentLoaded', () => {
            if (!ctx.isInvalid) resolve();
          });
        });
      }
      if (invalidNow()) {
        // A page whose world ended before its body settled: nothing mounts.
        dragController = null;
        mountPending = false;
        return;
      }
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
          chromeElement = null;
          grabbedShape = null;
          dragController = null;
        }
      });
      if (invalidNow()) {
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
      // Escape closes the card with the focus inside it, or cancels a live
      // drag first (restore the pre-drag position). Key events never reach
      // the host page from this shadow root (the injection isolates them at
      // the root), and the listener rides `ctx` so teardown rides the same
      // abort signal every other callback here does.
      ctx.addEventListener(created.shadow, 'keydown', (event) => {
        // The same trust gate: a synthetic Escape must not close or cancel a
        // mounted widget's state (real key input is always trusted here).
        if (
          isTrustedUserEvent(event) &&
          event instanceof KeyboardEvent &&
          event.key === 'Escape' &&
          !ctx.isInvalid
        ) {
          event.stopPropagation();
          if (dragController?.isDragging() === true) {
            dragController.cancel();
            return;
          }
          actions.closeCard();
        }
      });
    } catch (error) {
      log.error(
        'Mounting the detection widget failed',
        error instanceof Error ? error.message : error
      );
      shadowUi = null;
      dragController = null;
    } finally {
      mountPending = false;
    }
  };

  /**
   * Apply the gate's next value. Same-value writes are skipped outright:
   * a foreign origin's write (or a same-value rewrite) must not re-run the
   * data read, whose only worthwhile input is this origin's entry — the
   * equality is the equivalence.
   *
   * @param enabled The origin's entry.
   */
  const applyGate = (enabled: boolean): void => {
    if (enabled === enabledNow) return;
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
