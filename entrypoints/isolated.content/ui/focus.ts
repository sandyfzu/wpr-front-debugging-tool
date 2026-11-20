/**
 * The injected widgets' focus choreography: move focus to the element a
 * shape change just revealed (the report card opening from the marker) or
 * hand it back (the marker returning when the card closes).
 *
 * A single attempt is frame-fragile: the callback runs before the frame's
 * style recalc, so the target's visibility may still resolve as the OLD
 * state at that instant (under reduced motion, where no transition runs,
 * the attempt and the visibility flip land in the same frame — measured:
 * the focus was rejected and evicted shortly after). An attempt
 * verifies its landing and re-arms on the following frame when it didn't
 * (two tries total, both riding the context so invalidation cancels them);
 * never landing is logged, not silent.
 *
 * The frame requests and the invalidation answer are the caller's context
 * (this module has none of its own), so every cancellation in flight rides
 * the same abort signal the widget's other callbacks do.
 */

import type { Logger } from '../../../lib/logger';

/** Which widget shape is gaining focus (the log line's context). */
export type FocusSurface = 'card' | 'marker';

/** The context seams the choreography needs (the real context satisfies it). */
export interface FocusChoreographyDeps {
  /** One context-owned animation-frame request (cancel rides the context). */
  requestFrame(callback: () => void): void;
  /** Whether the owning content-script context is dead. */
  isInvalid(): boolean;
  /** The widget's logger (the not-reaching case must not be silent). */
  log: Logger;
}

/** The friendly name each surface logs with. */
const SURFACE_NAME: Record<FocusSurface, string> = {
  card: 'report card',
  marker: 'marker pill'
};

/**
 * Move focus to a widget element, attempt → verify → re-arm (two attempts).
 *
 * @param element The widget element to focus (marker pill or card root).
 * @param surface Which shape it is.
 * @param deps The context seams (frame, invalidation, log).
 */
export function moveFocus(
  element: HTMLElement,
  surface: FocusSurface,
  deps: FocusChoreographyDeps
): void {
  let attempt = 0;
  const tryOnce = (): void => {
    attempt += 1;
    deps.requestFrame(() => {
      if (deps.isInvalid()) return;
      element.focus({ preventScroll: true });
      // The landing check reads the focus owner of the element's own tree
      // (the shadow root); `in` narrows without asserting the node type.
      const root = element.getRootNode();
      if ('activeElement' in root && root.activeElement === element) return;
      if (attempt < 2) {
        tryOnce();
        return;
      }
      deps.log.debug(`Did not reach the ${SURFACE_NAME[surface]} with focus`);
    });
  };
  tryOnce();
}
