/**
 * The compare overlay's scroll-sync session: the DOM adapters between the
 * two iframe halves and the pure driver (`lib/side-by-side/scroll-sync`).
 *
 * A half reads its same-origin scroll facts (the scrolling element's
 * `scrollTop` against `scrollHeight − clientHeight`) and applies mapped
 * positions instantly. The first refused access — a cross-origin document,
 * the realistic outcome of a site's own redirect chain — flips that side to
 * "blocked" once per session and it scrolls independently; the pair
 * survives.
 *
 * Listener hygiene: a frame's inner window is replaced by every navigation,
 * so each half re-adopts its window on the iframe element's own `load`
 * event (which fires in the host document and survives reloads), and
 * everything this session attaches is removed on stop.
 */

import {
  COMPARE_SIDES,
  createScrollSyncDriver,
  type CompareSide,
  type FrameScrollState,
  type ScrollSyncClock,
  type ScrollSyncDriver,
  type ScrollSyncHalf
} from '../../../lib/side-by-side/scroll-sync';
import type { Logger } from '../../../lib/logger';

/** The session's inputs: the registered frames and the blocked-state reporter. */
export interface ScrollSyncSessionDeps {
  /** The overlay's frames as registered through the component's ref callbacks. */
  frames: () => Partial<Record<CompareSide, HTMLIFrameElement>>;
  /** The first refused access to a half flips this — the overlay renders the per-side marker. */
  onHalfBlocked(side: CompareSide): void;
  /** Degradation diagnostics (a blocked half is logged once, never per scroll). */
  log: Logger;
}

/** A running (or stopped) scroll-sync session over the overlay's halves. */
export interface ScrollSyncSession {
  /** Begin syncing the halves; starting twice is a no-op. */
  start(): void;
  /** Tear the engine down: listeners off, driver disposed, flags reset; stopping twice is a no-op. */
  stop(): void;
}

/** The DOM adapter clock: host-page animation frames schedule bursts and close suppression windows. */
const FRAME_CLOCK: ScrollSyncClock = {
  nextFrame: (callback) => {
    requestAnimationFrame(callback);
  }
};

/**
 * Create the session over the overlay's frames. The session itself is
 * stateful entrypoint wiring (windows, listeners, loaders) — the judgment
 * lives in the driver, which this module drives.
 *
 * @param deps The frames registry accessor and the blocked reporter.
 */
export function createScrollSyncSession(deps: ScrollSyncSessionDeps): ScrollSyncSession {
  let driver: ScrollSyncDriver | null = null;
  /** Per-half listener teardowns; a half re-adopts on reload, replacing its own entry. */
  const detachHalf: Partial<Record<CompareSide, () => void>> = {};
  /** Sides already reported blocked this session (the flip-once rule). */
  const reported: Partial<Record<CompareSide, true>> = {};

  /** Report a refused access once — repeated failures stay silent. */
  const reportBlocked = (side: CompareSide): void => {
    if (reported[side] === true) return;
    reported[side] = true;
    deps.onHalfBlocked(side);
  };

  /** The half's window right now, or null while the frame has none. */
  const windowOf = (side: CompareSide): Window | null => deps.frames()[side]?.contentWindow ?? null;

  /**
   * Read the half's scroll facts. Cross-origin access throws — caught into
   * the blocked flip; a torn read (a document navigating between property
   * reads) is refused as a transient null, never returned as garbage.
   */
  const halfFor = (side: CompareSide): ScrollSyncHalf => ({
    read(): FrameScrollState | null {
      const win = windowOf(side);
      if (win === null) return null;
      try {
        const doc = win.document;
        const scrolling = doc.scrollingElement ?? doc.documentElement;
        const y = scrolling.scrollTop;
        const range = scrolling.scrollHeight - scrolling.clientHeight;
        if (!Number.isFinite(y) || !Number.isFinite(range) || range < 0 || y < 0 || y > range) {
          return null;
        }
        return { y, range };
      } catch {
        reportBlocked(side);
        deps.log.debug(`The ${side} half's document is not accessible; it scrolls independently`);
        return null;
      }
    },
    apply(y: number): void {
      const win = windowOf(side);
      if (win === null) return;
      try {
        // `instant` overrides any page's `scroll-behavior: smooth` — a glide
        // would re-enter the driver through its own suppression window.
        win.scrollTo({ top: y, behavior: 'instant' });
      } catch {
        reportBlocked(side);
      }
    }
  });

  /** The two halves, built once — every read resolves its frame fresh. */
  const halves: Record<CompareSide, ScrollSyncHalf> = {
    cached: halfFor('cached'),
    bypassed: halfFor('bypassed')
  };

  /**
   * Adopt one half: document-level scroll listener on its window plus the
   * iframe element's load re-adoption. The load re-adopt is armed before
   * anything else, so even a frame without a browsing context yet (or whose
   * window was re-created) is adopted when it loads. A cross-origin document
   * refuses even the listener attach — that flip is the degrade state, and
   * the half is done for the session (its re-adopt is torn with it).
   */
  const attachHalf = (side: CompareSide): void => {
    detachHalf[side]?.();
    detachHalf[side] = undefined;
    const frame = deps.frames()[side];
    if (frame === undefined) return;
    const onFrameLoad = (): void => {
      if (driver === null) return; // the session stopped between events
      attachHalf(side);
    };
    frame.addEventListener('load', onFrameLoad);
    detachHalf[side] = () => {
      frame.removeEventListener('load', onFrameLoad);
    };
    const win = frame.contentWindow;
    if (win === null) return; // adopted when the load event fires
    try {
      const frameDocument = win.document;
      const onScroll = (event: Event): void => {
        // Only the frame's own document scroll syncs; inner scrollables are
        // page furniture, not the compared position.
        if (event.target !== frameDocument) return;
        driver?.onScroll(side);
      };
      win.addEventListener('scroll', onScroll, { capture: true, passive: true });
      detachHalf[side] = () => {
        win.removeEventListener('scroll', onScroll, { capture: true });
        frame.removeEventListener('load', onFrameLoad);
      };
    } catch {
      reportBlocked(side);
    }
  };

  return {
    start(): void {
      if (driver !== null) return;
      for (const side of COMPARE_SIDES) reported[side] = undefined;
      driver = createScrollSyncDriver(halves, FRAME_CLOCK);
      for (const side of COMPARE_SIDES) attachHalf(side);
    },
    stop(): void {
      if (driver === null) return;
      driver = null;
      for (const side of COMPARE_SIDES) {
        detachHalf[side]?.();
        detachHalf[side] = undefined;
      }
    }
  };
}
