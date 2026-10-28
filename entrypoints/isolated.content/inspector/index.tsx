/**
 * The on-page detection widget: the per-origin override steers a
 * default-on gate, the hub's already-cached single pass feeds it, and the
 * Known Conflicts shell carries its motion and focus choreography.
 *
 * Gate: two validated storage items (the per-origin overrides and the
 * options' global default), each read once + armed watch (arm-first, the
 * live-theme lesson — a write landing inside the read window is applied by
 * the watch, and the read result is skipped in its favor). Origins without
 * an explicit entry follow the default option (on unless the user turned it
 * off); a per-origin entry stored by the context menu or the palette
 * overrides that default in both directions. A state change — either item —
 * mounts or removes the widget on this page with no reload; other origins'
 * entries cannot touch this page. A hidden page costs the boot reads and
 * the two armed watches, nothing mounted and no other listener. The on-page
 * UI gate outranks the opt-in: the widget shows only while both say so
 * (`./visibility`), and a gate write mounts or removes it live like an
 * opt-in write. The card's open state (the collapse) is session-local: a
 * hide closes it and nothing about it is stored.
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
 *
 * Position persistence (`SB-D12`): a settled moved drop stores the chrome's
 * drag translate for this origin in the device-local positions item (one
 * write per drop; cancels never write). The translate is an offset from the
 * bottom-right stylesheet anchor, which both shapes (pill and card) share,
 * so one stored value serves either shape and stays edge-anchored to the
 * default corner when the viewport changes. The page reads it once (first
 * show) and every mount restores it after its first render, before paint
 * when the read already landed, then re-clamps it at once through the drag
 * machine's resting re-clamp — the stored value is a hint the current
 * viewport and shape decide. A failed or corrupt read is the anchor. The
 * page's own drops update the remembered value, so a hide → show re-mounts
 * where the user left it; other tabs pick a drop up at their next load.
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
  effectiveDetectionWidgetEnabled,
  getDetectionWidgetSites,
  detectionWidgetDefaultEnabled,
  detectionWidgetSitesStore,
  parseDetectionWidgetSites,
  type DetectionWidgetSites
} from '../../../lib/storage/detection-widget-sites';
import { getOptions, optionsStore, storedOptionsOrFallback } from '../../../lib/storage/options';
import {
  getDetectionWidgetPosition,
  saveDetectionWidgetPosition,
  type DetectionWidgetPosition
} from '../../../lib/storage/detection-widget-positions';
import {
  createShadowSurface,
  type ShadowMount
} from '../../../components/injected-ui/shadow-surface';
import { followGatedSurface } from '../../../lib/page-ui/gated-surface';
import { pageUiGateDeps } from '../../../lib/page-ui/gate-follower';
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

  /** Whether the widget should show now, mirrored for the mount's race re-check. */
  let visibleNow = false;
  /** This origin's effective opt-in; null until its first read or write. */
  let siteEnabled: boolean | null = null;
  /** Whether the opt-in resolved yet (a read through a call: closures assign it). */
  const siteResolved = (): boolean => siteEnabled !== null;
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
   * a fresh mount starts at the stylesheet anchor until the remembered
   * position restores into it. Null while nothing is mounted.
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

  /**
   * This origin's remembered drag translate: the stored one once the page's
   * read lands, then every drop of this page's own. Null = the anchor.
   */
  let rememberedPosition: DetectionWidgetPosition | null = null;
  /** Whether a drop of this page already set {@link rememberedPosition} (a late read yields). */
  let droppedThisPage = false;
  /** The page's one stored-position read (first show); null until then. */
  let positionRead: Promise<void> | null = null;

  /**
   * Read the stored position once per page. A failure is logged and leaves
   * the anchor (no retry: the next load reads again); a drop that landed
   * while the read was in flight wins over the read.
   */
  const readStoredPosition = (): Promise<void> => {
    positionRead ??= getDetectionWidgetPosition(pageOrigin).then(
      (stored) => {
        if (!droppedThisPage) rememberedPosition = stored;
      },
      (cause: unknown) => {
        if (ctx.isInvalid) return;
        log.warn(
          'Reading the widget\u2019s stored position failed — it rests at its anchor',
          cause
        );
      }
    );
    return positionRead;
  };

  /**
   * Persist a settled drop's translate for this origin (fire-and-forget by
   * design, never unhandled): the chrome already stands there, so a failed
   * write is logged and changes nothing on the page — only the next load
   * starts at the previous stored value.
   *
   * @param position The committed drag translate.
   */
  const persistDrop = (position: DetectionWidgetPosition): void => {
    rememberedPosition = position;
    droppedThisPage = true;
    saveDetectionWidgetPosition(pageOrigin, position).catch((cause: unknown) => {
      if (ctx.isInvalid) return;
      log.warn('Saving the widget\u2019s dragged position failed — kept for this page only', {
        position,
        cause
      });
    });
  };

  /**
   * Settle the drag's own pointer and persist a moved drop (pointerup and
   * the capture-loss ender share it; the machine answers a commit at most
   * once per drag, so the release-then-loss pair writes once).
   *
   * @param pointerId The ending pointer.
   */
  const settleDrag = (pointerId: number): void => {
    const committed = dragController?.settle(pointerId) ?? null;
    if (committed !== null) persistDrop(committed);
  };

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
   * The containment triggers, all per mount: a viewport change (window
   * resize, zoom), the box-growth beats (card open/close, data landing) and
   * the drag's settle/cancel. Every trigger routes through the one re-settle cycle;
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
  let mountSignal: AbortSignal | null = null;

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
    if (mountSignal === null) return;
    target.addEventListener(type, handler, {
      signal: AbortSignal.any([ctx.signal, mountSignal])
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
      settleDrag(event.pointerId);
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
      settleDrag(event.pointerId);
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

  /**
   * A mount's host just landed: one drag controller + containment watcher
   * per mount (a fresh mount starts at the stylesheet anchor; the
   * remembered position restores after the render), and the mount-scoped
   * Escape listener.
   *
   * @param mount The mount's shadow root and listener scope.
   */
  const beginMount = (mount: ShadowMount): void => {
    mountSignal = mount.signal;
    grabbedShape = null;
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
    // The viewport-side containment trigger, live only while mounted (a
    // hidden widget keeps no page listener): a window resize or a zoom step
    // re-reads the layout viewport and may strand a parked chrome outside
    // the full-containment bound. The cycle samples the settled box, so a
    // resize burst coalesces into one re-clamp.
    listenWhileMounted(window, 'resize', () => {
      if (!ctx.isInvalid) startContainmentCycle();
    });
    // Escape closes the card with the focus inside it, or cancels a live
    // drag first (restore the pre-drag position). Key events never reach
    // the host page from this shadow root (the injection isolates them at
    // the root).
    listenWhileMounted(mount.shadow, 'keydown', (event) => {
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
  };

  /** The mount's host left the page: its per-mount state goes with it. */
  const endMount = (): void => {
    mountSignal = null;
    cardElement = null;
    pillElement = null;
    chromeElement = null;
    grabbedShape = null;
    dragController = null;
    containmentWatch?.stop();
    containmentWatch = null;
  };

  /**
   * The widget's shadow UI: created at the first show and cycled across
   * every hide → show (one host for the page's life).
   */
  const surface = createShadowSurface({
    create: (hooks) =>
      createShadowRootUi(ctx, {
        name: INSPECTOR_UI_NAME,
        position: 'inline',
        onMount: hooks.onMount,
        onRemove: hooks.onRemove
      }),
    view: () => (
      <InspectorView model={model} mood={mood} cardOpen={() => state.cardOpen} actions={actions} />
    ),
    isInvalid: invalidNow,
    onMounted: beginMount,
    onRemoved: endMount,
    onRenderError: (cause) => {
      log.error(
        'Mounting the detection widget view into the shadow root failed',
        cause instanceof Error ? cause.message : cause
      );
    }
  });

  /**
   * Restore the remembered position into the mount that just showed: once
   * its view rendered and the page's read settled, apply the translate and
   * re-clamp it synchronously — the resting re-clamp reads layout offsets,
   * which are valid mid-entrance, so the corrected position lands in the
   * same task as the render (no frame at the anchor, no visible snap) when
   * the read already settled.
   *
   * Ordering: the read is issued the moment the widget is decided visible,
   * before the body wait, the shadow host's creation (its stylesheet fetch)
   * and the appearance read the render itself awaits — so it settles first
   * in practice, and the restore then runs in the render's own microtasks.
   * Nothing orders two storage areas' replies, so a read that still loses
   * moves the chrome once, instantly, after the first paint; the render is
   * never held for it (a stored hint must not delay the widget). A later
   * shape change (rows landing, the card opening) re-clamps through the
   * ordinary containment cycle.
   */
  const restoreRememberedPosition = async (): Promise<void> => {
    const controller = dragController;
    const [rendered] = await Promise.all([surface.rendered(), readStoredPosition()]);
    // Removed, failed, or replaced by a newer mount meanwhile: nothing to restore.
    if (!rendered || ctx.isInvalid || controller === null || controller !== dragController) return;
    const position = rememberedPosition;
    if (position === null || !controller.restore(position)) return;
    controller.reclamp();
    startContainmentCycle();
  };

  /** Whether the page's body wait is in flight (one waiter per page). */
  let bodyWait: Promise<void> | null = null;

  /**
   * The page's anchor: the CS boots at document_start, where the body is
   * still null and WXT's inline shadow UI has no anchor to attach to (the
   * audited unmountable-boot — intermittent with boot speed). Waits for it
   * behind the context's own lifecycle (a dead context never resolves).
   */
  const bodyReady = (): Promise<void> => {
    if (bodyOrNull() !== null) return Promise.resolve();
    bodyWait ??= new Promise<void>((resolve) => {
      ctx.addEventListener(document, 'DOMContentLoaded', () => {
        if (!ctx.isInvalid) resolve();
      });
    });
    return bodyWait;
  };

  /**
   * Show the widget unless it is up; visibility and the context are
   * re-checked after the body wait and the first show's host creation (a
   * hide may have won either race).
   */
  const mountIntoShadow = async (): Promise<void> => {
    try {
      // Issued first, ahead of every await the render sits behind (see the restore).
      void readStoredPosition();
      await bodyReady();
      if ((await surface.show(() => visibleNow)) === 'shown') await restoreRememberedPosition();
    } catch (error) {
      log.error(
        'Mounting the detection widget failed',
        error instanceof Error ? error.message : error
      );
    }
  };

  /**
   * Show or hide the widget. Same-value calls are skipped outright: a
   * foreign origin's write (or a same-value rewrite) must not re-run the
   * data read, whose only worthwhile input is this origin's entry — the
   * equality is the equivalence. A show re-runs the boot path (fresh data
   * read, fresh mount restored to the remembered position); a hide removes
   * the host.
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
    surface.hide();
    setState('cardOpen', false);
  };

  /**
   * The on-page UI gate outranks the per-site opt-in (`widgetVisible`):
   * while it is off the widget never mounts and a live off-write removes
   * it; turning it back on shows it again per the site's opt-in, which the
   * gate never touches. The widget's boot moment is now (the mount waits
   * for the body itself).
   */
  const pageUi = followGatedSurface(pageUiGateDeps(ctx, log), {
    start: () => {
      applyVisible(widgetVisible(true, siteEnabled));
    },
    stop: () => {
      applyVisible(false);
    }
  });
  pageUi.pageReady();

  /** Record this origin's effective opt-in and re-decide the widget. */
  const applySiteEnabled = (enabled: boolean): void => {
    siteEnabled = enabled;
    applyVisible(widgetVisible(pageUi.running(), siteEnabled));
  };

  /**
   * The opt-in's two inputs: this origin's override map and the global
   * default option. Each is null until its first read or write; the
   * effective state resolves only once both are known.
   */
  let origins: DetectionWidgetSites | null = null;
  let defaultEnabled: boolean | null = null;

  /** Re-resolve the effective opt-in once both inputs are known. */
  const resolveSiteEnabled = (): void => {
    if (origins === null || defaultEnabled === null) return;
    applySiteEnabled(effectiveDetectionWidgetEnabled(origins, pageOrigin, defaultEnabled));
  };

  /**
   * Arm-first boot: each item's watch is its authority once armed, so a
   * boot read applies only when no write to that item raced it (the
   * live-theme pattern's counter — read-then-arm would drop exactly that
   * write). Options writes that leave the default unchanged (appearance,
   * other flags) re-resolve to the same value, which `applyVisible` skips.
   */
  let originWrites = 0;
  let optionWrites = 0;
  const unwatchOrigins = detectionWidgetSitesStore.watch((raw: unknown) => {
    originWrites += 1;
    if (ctx.isInvalid) return;
    // Corrupt raw degrades to the unconfigured shape: every origin follows the default.
    origins = parseDetectionWidgetSites(raw) ?? {};
    resolveSiteEnabled();
  });
  const unwatchOptions = optionsStore.watch((raw: unknown) => {
    optionWrites += 1;
    if (ctx.isInvalid) return;
    defaultEnabled = detectionWidgetDefaultEnabled(storedOptionsOrFallback(raw));
    resolveSiteEnabled();
  });
  ctx.onInvalidated(() => {
    unwatchOrigins();
    unwatchOptions();
  });

  void (async () => {
    const seenOrigins = originWrites;
    const seenOptions = optionWrites;
    // Each item settles on its own: one failed read never discards the
    // other's good one, so a later write to the failed item alone resolves.
    const [map, options] = await Promise.allSettled([getDetectionWidgetSites(), getOptions()]);
    if (ctx.isInvalid) return;
    if (map.status === 'fulfilled' && originWrites === seenOrigins) origins = map.value;
    if (options.status === 'fulfilled' && optionWrites === seenOptions) {
      defaultEnabled = detectionWidgetDefaultEnabled(options.value);
    }
    resolveSiteEnabled();
    for (const failed of [map, options]) {
      if (failed.status === 'fulfilled') continue;
      log.error(
        'Reading the widget opt-in failed — hidden until that setting is next written',
        failed.reason
      );
    }
    // Unresolved after a failure: hide explicitly until a write delivers the missing input.
    if (!siteResolved()) applySiteEnabled(false);
  })();
}
