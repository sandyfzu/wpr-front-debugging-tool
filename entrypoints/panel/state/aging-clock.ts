/**
 * The panel's aging clock, shared by the shell chrome and the pages that
 * show relative times: the reading (`now`) the ages and staleness read,
 * advanced by a slow tick **only while page data is loaded and the panel
 * document is visible** — no idle work when the panel is hidden or nothing
 * is loaded, and every armed timer unsubscribes on stop (no leaked timers).
 *
 * The clock is an inert factory (no Solid effects inside): its loaded state
 * arrives through an explicit call, so the component wires one effect over
 * the data machine's loaded statuses and cleanup stays one `stop()`.
 */
import { createSignal, type Accessor } from 'solid-js';
import { createLogger } from '../../../lib/logger';

const log = createLogger('panel');

/**
 * The tick cadence while the clock is armed (ms).
 *
 * Ages are bucketed to whole seconds/minutes, so a 30 s cadence keeps every
 * displayed value within half a minute of truth (minute flips land within
 * one tick) at two no-op signal writes per minute; the top bar re-renders its
 * answers per tick — measured, nothing. Visibility pauses keep the
 * hidden panel entirely idle.
 */
export const AGE_TICK_INTERVAL_MS = 30_000;

/** The wall-clock/visibility seams the clock runs against (tests inject doubles). */
export interface AgingClockDeps {
  /** The repeating tick cadence while armed. */
  readonly intervalMs: number;
  /** Run `handler` every `ms`; the returned handle cancels it. */
  readonly schedule: (handler: () => void, ms: number) => () => void;
  /** Whether the panel document is currently visible. */
  readonly isVisible: () => boolean;
  /** Subscribe to visibility changes; the returned handle unsubscribes. */
  readonly onVisibilityChange: (handler: () => void) => () => void;
  /** The wall clock the reading reads. */
  readonly now: () => number;
}

/** What a consumer reads. */
export interface AgingClock {
  /** The clock's reading (wall-clock ms); ticks advance it while armed. */
  readonly now: Accessor<number>;
  /**
   * Arm the tick cadence while page data is loaded (and the document is
   * visible); disarm otherwise — no idle work without data on screen.
   */
  setLoaded(loaded: boolean): void;
  /** Release every timer and subscription the clock armed (idempotent). */
  stop(): void;
}

/**
 * Create the clock. The visibility subscription arms here (control comes
 * only through `setLoaded`), and the initial reading is taken immediately —
 * the component's first render ages against a current clock.
 *
 * @param deps The wall-clock/visibility seams.
 */
export function createAgingClock(deps: AgingClockDeps): AgingClock {
  const [now, setNow] = createSignal(deps.now());

  let loaded = false;
  let stopped = false;
  let cancelTick: (() => void) | null = null;
  let stopVisibility: (() => void) | null = null;

  /** The tick body. The reading write is the only work; a throwing wall clock must never kill the cadence. */
  const tick = (): void => {
    try {
      setNow(deps.now());
    } catch (cause) {
      log.warn('Aging tick failed — the reading keeps its last value', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    }
  };

  /**
   * (Re)arm the cadence to the current arms condition. Starting from a
   * clean timer every time keeps double-arming (a visibility flip and a
   * load flip in the same tick window) impossible.
   */
  const arm = (): void => {
    cancelTick?.();
    cancelTick = null;
    if (stopped || !loaded || !deps.isVisible()) return;
    cancelTick = deps.schedule(tick, deps.intervalMs);
  };

  stopVisibility = deps.onVisibilityChange(() => {
    // Coming back from a hidden stretch: age to the truth immediately
    // instead of up to one cadence late.
    if (loaded && deps.isVisible()) tick();
    arm();
  });

  return {
    now,
    setLoaded(isLoaded) {
      if (stopped || loaded === isLoaded) return;
      loaded = isLoaded;
      if (isLoaded) tick();
      arm();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      cancelTick?.();
      cancelTick = null;
      stopVisibility?.();
      stopVisibility = null;
    }
  };
}

/**
 * The production seams: the document's real visibility state and a real
 * repeating timer. Kept beside the factory so the top bar component stays
 * wiring only.
 *
 * @returns The deps the top bar uses in production.
 */
export function realAgingClockDeps(): AgingClockDeps {
  return {
    intervalMs: AGE_TICK_INTERVAL_MS,
    schedule: (handler, ms) => {
      const id = window.setInterval(handler, ms);
      return () => {
        window.clearInterval(id);
      };
    },
    isVisible: () => !document.hidden,
    onVisibilityChange: (handler) => {
      const listener = (): void => {
        handler();
      };
      document.addEventListener('visibilitychange', listener);
      return () => {
        document.removeEventListener('visibilitychange', listener);
      };
    },
    now: () => Date.now()
  };
}
