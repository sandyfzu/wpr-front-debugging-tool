/**
 * The on-page detection widget: the per-origin override steers a
 * default-on gate, the hub's already-cached single pass feeds it, and the
 * Known Conflicts shell carries its motion and focus choreography.
 *
 * Gate: one validated storage item read + armed watch (arm-first, the
 * live-theme lesson — a write landing inside the read window is applied by
 * the watch, and the read result is skipped in its favor). Origins without
 * an explicit entry show the widget by default (the owner's 2026-10-17
 * turn-on: the chip mounts on a fresh install with no opt-in step); a
 * per-origin entry stored by the context menu overrides that default in
 * both directions. A state change mounts or removes the widget on this
 * page with no reload; other origins' entries cannot touch this page. A
 * hidden page costs one invalidated-safe storage read at boot, nothing
 * mounted. The on-page UI gate outranks the opt-in: the widget shows only
 * while both say so (`./visibility`), and a gate write mounts or removes it
 * live like an opt-in write.
 *
 * Data: the widget reads the hub's cached pass result for this page through
 * the hub's same-context reader — a running pass is joined, never
 * re-triggered. The pass's result (detections + the WordPress version) is
 * immutable after the pass, so one read per mount is the widget's whole data
 * work; the presentation state machine (strip-state) renders it.
 *
 * Containment (the owner binding): no part of the chrome may leave the
 * viewport, ever — the drag machine clamps every drag move, and this module
 * re-clamps the RESTING chrome through the containment watcher whenever the
 * viewport changed, the visible box grew or shrank (card open/close, the
 * pass's rows landing), or a drag dropped/canceled. The watcher samples the
 * box until two consecutive reads agree within a wall-clock cap (the
 * choreography's own entrance is timed in ms, so the cap is ms too), and
 * the re-clamp targets the resting layout box — the post-choreography
 * geometry, never an animated pose. A moved re-clamp rides
 * the chrome's re-settle state class (a smooth position leg over the motion
 * tokens; still under reduced motion, where the collapse is the honest
 * instant); a starting drag clears it — direct manipulation never moves
 * through a transition.
 */

import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { WINDOW_FRAMES, contextFrames } from '../../../utils/context-timers';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createLogger } from '../../../lib/logger';
import type { PageDataSnapshot } from '../data-hub';
import { pageDataFor } from '../data-hub';
import {
  effectiveInspectorEnabled,
  parseInspectorOrigins,
  isInspectorOriginEnabled,
  inspectorOriginsStore
} from '../../../lib/storage/inspector-origins';
import { mountShadowUi } from '../../../components/injected-ui/mount';
import { followGatedSurface } from '../../../lib/page-ui/gated-surface';
import { PAGE_UI_GATE_SOURCE } from '../../../lib/page-ui/gate-follower';
import { moveFocus, type FocusChoreographyDeps } from '../ui/focus';
import type { DragBox, DragController, DragMachineDeps } from './drag';
import { createDragController, isPointerInitiatedClick } from './drag';
import { createContainmentWatch, type ContainmentWatch } from './containment';
import type { StripDataSnapshot } from './strip-state';
import { buildStripCardModel, INSPECTOR_UI_NAME, insMood } from './strip-state';
import { InspectorView, type InspectorUiActions } from './ui';
import { widgetVisible } from './visibility';
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
  // Frames and timers that let go of their callbacks (see utils/context-timers).
  const nextFrame = contextFrames(ctx, WINDOW_FRAMES);
  const pageOrigin = window.location.origin;
  const fdtVersion = browser.runtime.getManifest().version;

  const [state, setState] = createStore<InspectorUiState>({
    cardOpen: false,
    snapshot: { phase: 'running', detections: null, cacheState: null },
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
  /** Whether the widget should show now, mirrored for the mount's race re-check. */
  let visibleNow = false;
  /** This origin's effective opt-in; null until its first read or write. */
  let siteEnabled: boolean | null = null;
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
   * The current mount's containment watcher (the re-settle cycle runner) —
   * torn down with the mount like everything above. Null at no-mount.
   */
  let containmentWatch: ContainmentWatch | null = null;
  /**
   * The visible shape the active press grabbed — the CAPTURE site (its
   * pointer capture routes the gesture back through the chrome's bubbling
   * listeners). The live box reads through the seams' own visible-shape
   * reader below, so this hold is capture-only.
   */
  let grabbedShape: HTMLElement | null = null;

  /** The focus choreography rides this context's frames (ui/focus's contract). */
  const focusDeps: FocusChoreographyDeps = {
    requestFrame: (callback) => {
      nextFrame(callback);
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
      // The card grew the chrome's visible box: park it back inside the
      // viewport when it crosses an edge (smoothly — the re-settle leg).
      startContainmentCycle();
    },
    closeCard: () => {
      setState('cardOpen', false);
      // The invoker regains focus (standard popover choreography).
      if (pillElement !== null) moveFocus(pillElement, 'marker', focusDeps);
      startContainmentCycle(); // same beat, the shrinking shape
    }
  };

  /**
   * The visible shape's element: the open card rides the anchored corner
   * and alone defines the box while `ins-open` is on; otherwise the pill.
   * One selection for both the shape reads below (they answer the same
   * shape, live and resting) — null once the element is gone.
   */
  const visibleShape = (): HTMLElement | null => {
    const shape = state.cardOpen ? cardElement : pillElement;
    return shape !== null && shape.isConnected ? shape : null;
  };

  /**
   * The drag machine's seams: the viewport and the VISIBLE shape's box are
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
      // The drag-time live box: the shape's rect, however its choreography
      // presents it mid-flight (the 1:1 drag follow's truth).
      const shape = visibleShape();
      if (shape === null) return null;
      const rect = shape.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    },
    readRestingBox: (): DragBox | null => {
      // The re-clamp's resting box: the shape's LAYOUT box in viewport
      // coordinates, transform-invariant — the pose the choreography ends
      // at, clamped even while an entrance still runs. Both the chrome and
      // the shape must be alive: the geometry derives across them.
      const chrome = chromeElement;
      const shape = visibleShape();
      if (chrome === null || !chrome.isConnected || shape === null) return null;
      // The layout arithmetic assumes the shape hangs off the chrome as
      // its offsetParent (the stylesheet contract: a fixed chrome, two
      // absolute shapes, and no zoom anywhere) — CSSOM-View measures
      // offset* relative to that offsetParent's padding edge and ignoring
      // all transforms, and the chrome carries no border/padding, so its
      // padding edge is exactly its rect origin. Fail closed (null, the
      // machine's no-clamp) on any violation.
      if (shape.offsetParent !== chrome) return null;
      // Sizes from offsetWidth/Height are transform-free by spec; the
      // position adds the transform-free layout offset to the chrome's own
      // rect top-left (which carries the chrome's applied translate) — at
      // rest that is the applied pose's exact top-left, mid-resettle the
      // transition's, which the re-clamp-on-stable-box architecture keeps
      // harmless (the watcher releases only after the box stops moving).
      const chromeRect = chrome.getBoundingClientRect();
      return {
        left: chromeRect.left + shape.offsetLeft,
        top: chromeRect.top + shape.offsetTop,
        width: shape.offsetWidth,
        height: shape.offsetHeight
      };
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
   * The smooth re-settle arm (the owner binding's "re-clamps back inside
   * with a smooth movement"): a moved re-clamp flips the chrome's re-settle
   * state class ON before the position write, so the position leg animates
   * over the motion tokens; the class leaves when that one transition ends
   * (or when the next pointer press takes over — direct manipulation never
   * moves through a transition). Reduced motion collapses the token to an
   * instant snap, which is the shipped correct answer.
   *
   * @param moved Whether the re-clamp actually repositioned the chrome.
   */
  const resettleSmoothly = (moved: boolean): void => {
    const chrome = chromeElement;
    if (chrome === null || !moved) return;
    // Re-arm cleanly over any glue from an interrupted prior re-settle: the
    // class arriving again must be a fresh decision, never a stale rider.
    chrome.classList.remove('ins-resettle');
    chrome.classList.add('ins-resettle');
  };

  /**
   * The re-settle release: run the machine's re-clamp and let a moved
   * result ride the smooth leg.
   */
  const reformContainment = (): void => {
    resettleSmoothly(dragController?.reclamp() ?? false);
  };

  /**
   * The containment triggers, bound once per widget (never per mount): a
   * viewport change (window resize, zoom) and — on the mounts themselves —
   * the box-growth beats (card open/close, data landing) and the drag's
   * settle/cancel. Every trigger routes through the one re-settle cycle;
   * the cycle samples until the chrome stands still and the re-clamp clamps
   * the resting layout box, so mid-choreography triggers (and equality
   * ties) target the choreography's end geometry, not the pose its
   * animation happens to present.
   */
  const startContainmentCycle = (): void => {
    if (containmentWatch !== null) containmentWatch.request();
  };

  /**
   * One trust predicate at the wiring level: every event arm acts on user
   * input only. Script-synthesized gestures (assertions replays, page-probe
   * experiments) must not reach the machine's state arms — the uniform
   * idiom the pointerdown and the pill's click already carry.
   */
  const isTrustedUserEvent = (event: Event): boolean => event.isTrusted;

  /**
   * The current mount's listener scope: aborted when the host leaves the
   * page, so a hidden-then-shown widget (site opt-out, the on-page UI gate)
   * never keeps the removed mount's elements alive through listeners still
   * registered on the context. Null at no-mount.
   */
  let mountScope: AbortController | null = null;

  /**
   * Listen on an element of the current mount until the mount ends or the
   * context dies, whichever comes first (no-op without a mount).
   *
   * @param target The mount's element (or its shadow root).
   * @param type The event type.
   * @param handler The listener.
   */
  const listenWhileMounted = (
    target: EventTarget,
    type: string,
    handler: (event: Event) => void
  ): void => {
    if (mountScope === null) return;
    target.addEventListener(type, handler, {
      signal: AbortSignal.any([ctx.signal, mountScope.signal])
    });
  };

  /**
   * Bind the drag's pointer listeners to the chrome (their element dies with
   * the shadow host; teardown rides the mount's scope): trusted primary
   * presses decide a handle and the capture routes the whole gesture back
   * here by bubbling, so no page-scoped listener ever exists.
   *
   * @param chrome The view's chrome root.
   */
  function bindChromeDrag(chrome: HTMLElement): void {
    listenWhileMounted(chrome, 'pointerdown', (event) => {
      // The listener is typed at the `Event` level for element targets —
      // `instanceof` is the boundary narrowing (the shipped keydown idiom).
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      // Direct manipulation takes over the moment a pointer presses the
      // chrome: an in-flight smooth re-settle ends right here (removal snaps
      // its position leg to the settled value) — a drag is 1:1, never a
      // transitioned follow (SB-D12).
      chrome.classList.remove('ins-resettle');
      // Any press while a drag is live cancels it first: a right-press (the
      // brief's cancel nicety) and a second pointer's press must not be
      // subject to the primary-button guard below — cancel beats grab.
      if (dragController?.isDragging() === true) {
        dragController.cancel();
        startContainmentCycle(); // the restored position may itself need re-clamping
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
    listenWhileMounted(chrome, 'pointermove', (event) => {
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      dragController?.trackMove({
        point: { x: event.clientX, y: event.clientY },
        pointerId: event.pointerId
      });
    });
    listenWhileMounted(chrome, 'pointerup', (event) => {
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      dragController?.settle(event.pointerId);
      // Drop re-settle: the committed position is re-clamped against the
      // live viewport (and moves smoothly when it moved — the owner's
      // "at drop" leg).
      startContainmentCycle();
    });
    listenWhileMounted(chrome, 'pointercancel', (event) => {
      if (!isTrustedUserEvent(event)) return;
      dragController?.cancel();
      startContainmentCycle();
    });
    listenWhileMounted(chrome, 'lostpointercapture', (event) => {
      // Capture loss ENDS the gesture, it does not cancel it: an engine may
      // drop the capture mid-gesture with neither release nor OS cancel (the
      // pointer leaving the window during a quick release does this on
      // macOS trackpads/Magic Mice — verified live in this Chromium with
      // trusted events), and the release event that follows (if any) must
      // not find the drag torn down. Ending by SETTLE keeps the follow's
      // clamped commit — the parked position was fully inside by every
      // move's clamp — while the genuinely canceling paths (Escape,
      // right-press, OS pointercancel, a second pointer's press) restore
      // through their own arms below. The event carries the losing
      // pointer's id, so only the drag's own capture ends the drag (a
      // foreign pointer's loss is a stray release — the machine ignores
      // it). The pointer-id discipline needs the PointerEvent shape.
      if (!(event instanceof PointerEvent) || !isTrustedUserEvent(event)) return;
      dragController?.settle(event.pointerId);
      startContainmentCycle(); // the dropped position is re-clamped like any release
    });
    listenWhileMounted(chrome, 'contextmenu', (event) => {
      // The right-press route (verbatim from this machine): a second button
      // pressed while the left pointer is captured delivers NO pointerdown —
      // the chrome gets `contextmenu` alone. The brief's right-click cancel
      // rides it (no preventDefault: the host keeps its native menu).
      if (!isTrustedUserEvent(event)) return;
      dragController?.cancel();
      startContainmentCycle();
    });
    listenWhileMounted(chrome, 'transitionend', (event) => {
      // The smooth re-settle's end: exactly the CHROME's own position leg
      // (child transitions bubble here and must not clear it). Synthetic
      // events are ignored with the shared trust gate. No transitioncancel
      // arm: the two self-inflicted cancellation orderings (this class's own
      // re-arm, and the pointerdown clear) remove the class themselves, and
      // the cancel event of a replaced transition must not clip the fresh
      // one.
      if (
        !isTrustedUserEvent(event) ||
        !(event instanceof TransitionEvent) ||
        event.target !== chrome ||
        event.propertyName !== 'transform'
      ) {
        return;
      }
      chrome.classList.remove('ins-resettle');
    });
  }

  /**
   * One hub read: join the running pass (or the cached result) and store the
   * answer. Single-flight by the hub's own contract — the widget never
   * re-triggers a pass, it waits for the page's one.
   */
  const refreshData = async (): Promise<void> => {
    setState({
      snapshot: { phase: 'running', detections: null, cacheState: null },
      wordpressVersion: null
    });
    if (reader === null) {
      setState('snapshot', { phase: 'failed', detections: null, cacheState: null });
      return;
    }
    let result: PageDataSnapshot | null;
    try {
      result = await reader();
    } catch (cause) {
      // The read is the hub's own promise; a rejection here is the pass
      // economics' failure mode. Never an unhandled rejection.
      if (ctx.isInvalid) return;
      log.error('Reading the page data for the widget failed', cause);
      setState('snapshot', { phase: 'failed', detections: null, cacheState: null });
      return;
    }
    if (ctx.isInvalid) return;
    if (result === null) {
      setState('snapshot', { phase: 'failed', detections: null, cacheState: null });
      return;
    }
    setState({
      snapshot: {
        phase: 'ready',
        detections: result.data.detections,
        cacheState: result.cacheState
      },
      wordpressVersion: result.data.wordpressVersion
    });
    // The card's rows just landed (its body changes height): the containment
    // re-settle reads the settled box for exactly this growth.
    startContainmentCycle();
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
    // One controller + its containment watcher per mount: a fresh mount
    // starts at the stylesheet anchor, so navigation/reload resets the
    // session-local drag position (P12A.5's no-persistence shape — nothing
    // is stored anywhere).
    dragController = createDragController(dragDeps);
    containmentWatch = createContainmentWatch({
      // Offset through an arrow: the watch's seam never holds the deps
      // object as a receiver (the same unbound-method discipline above).
      readBox: () => dragDeps.readBox(),
      isInvalid: invalidNow,
      // The context's own frame seam: a dead context never delivers the
      // release (and the cycle's liveness read ends it at once anyway).
      nextFrame: (callback) => {
        nextFrame(callback);
      },
      // The settle bound is wall-clock ms (the choreography it waits out is
      // timed in ms), so the seam is the content script's own wall clock.
      now: Date.now,
      reform: reformContainment,
      log
    });
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
        containmentWatch = null;
        mountPending = false;
        return;
      }
      const scope = new AbortController();
      mountScope = scope;
      const created = await createShadowRootUi(ctx, {
        name: INSPECTOR_UI_NAME,
        position: 'inline',
        onMount: (container, shadow) => {
          void mountShadowUi(container, shadow, () => (
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
          scope.abort();
          if (mountScope === scope) mountScope = null;
          disposeRoot?.();
          disposeRoot = null;
          cardElement = null;
          pillElement = null;
          chromeElement = null;
          grabbedShape = null;
          dragController = null;
          containmentWatch?.stop();
          containmentWatch = null;
        }
      });
      if (invalidNow()) {
        // The mount resolved after invalidation: the short-lived host must
        // not outlive it (a dead context never keeps page DOM).
        created.remove();
        return;
      }
      if (!visibleNow) {
        // A hide (site opt-out or the on-page UI gate) won the mount race:
        // remove the host before it ever shows.
        created.remove();
        return;
      }
      shadowUi = created;
      created.mount();
      // Escape closes the card with the focus inside it, or cancels a live
      // drag first (restore the pre-drag position). Key events never reach
      // the host page from this shadow root (the injection isolates them at
      // the root), and the listener lives as long as this mount (and the
      // context).
      listenWhileMounted(created.shadow, 'keydown', (event) => {
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
            startContainmentCycle();
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
      containmentWatch = null;
    } finally {
      mountPending = false;
    }
  };

  /**
   * Show or hide the widget. Same-value calls are skipped outright: a
   * foreign origin's write (or a same-value rewrite) must not re-run the
   * data read, whose only worthwhile input is this origin's entry — the
   * equality is the equivalence. A show re-runs the boot path (fresh data
   * read, fresh mount at the anchor); a hide removes the host.
   *
   * @param visible Whether the widget shows (see {@link widgetVisible}).
   */
  const applyVisible = (visible: boolean): void => {
    if (visible === visibleNow) return;
    visibleNow = visible;
    if (visible) {
      void refreshData();
      void mountIntoShadow();
      return;
    }
    shadowUi?.remove();
    shadowUi = null;
    setState('cardOpen', false);
  };

  /**
   * The viewport-side containment trigger, bound once per widget (never per
   * mount): a window resize or a zoom step re-reads the layout viewport and
   * may strand a parked chrome outside the full-containment bound. The
   * cycle samples the settled box, so a resize burst coalesces into one
   * re-clamp (browser-triggered and trusted; no page writes either way).
   */
  ctx.addEventListener(window, 'resize', () => {
    if (ctx.isInvalid) return;
    startContainmentCycle();
  });

  /**
   * The on-page UI gate outranks the per-site opt-in (`widgetVisible`):
   * while it is off the widget never mounts and a live off-write removes
   * it; turning it back on shows it again per the site's opt-in, which the
   * gate never touches. The widget's boot moment is now (the mount waits
   * for the body itself).
   */
  const pageUi = followGatedSurface(
    {
      source: PAGE_UI_GATE_SOURCE,
      isInvalid: invalidNow,
      onInvalidated: (cleanup) => {
        ctx.onInvalidated(cleanup);
      },
      log
    },
    {
      start: () => {
        applyVisible(widgetVisible(true, siteEnabled));
      },
      stop: () => {
        applyVisible(false);
      }
    }
  );
  pageUi.pageReady();

  /** Record this origin's effective opt-in and re-decide the widget. */
  const applySiteEnabled = (enabled: boolean): void => {
    siteEnabled = enabled;
    applyVisible(widgetVisible(pageUi.running(), siteEnabled));
  };

  /**
   * Arm-first boot: the watch is the opt-in's authority once armed, so the
   * initial read applies only when no write raced it (the live-theme
   * pattern's counter — read-then-arm would drop exactly that write).
   */
  let siteWrites = 0;
  const unwatch = inspectorOriginsStore.watch((raw: unknown) => {
    siteWrites += 1;
    if (ctx.isInvalid) return;
    const parsed = parseInspectorOrigins(raw);
    // One resolution for every opt-in read: no explicit entry here means
    // the global default on; only a stored entry — either polarity —
    // overrides it. Corrupt raw degrades to the same unconfigured shape.
    applySiteEnabled(effectiveInspectorEnabled(parsed ?? {}, pageOrigin));
  });
  ctx.onInvalidated(unwatch);

  void (async () => {
    const seen = siteWrites;
    let answer: boolean;
    try {
      answer = await isInspectorOriginEnabled(pageOrigin);
    } catch (cause) {
      if (ctx.isInvalid) return;
      log.error('Reading the widget opt-in failed — the widget stays hidden', cause);
      answer = false;
    }
    if (ctx.isInvalid) return;
    if (siteWrites === seen) {
      applySiteEnabled(answer);
    }
  })();
}
