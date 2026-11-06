/**
 * The first-hidden tracker, for engines without `visibility-state`
 * performance entries (Firefox): records when the page was first hidden,
 * from a `visibilitychange` listener installed at document start — a hide
 * and return before the vitals are read would otherwise go unseen, and LCP
 * and CLS would count entries the visitor never saw. Engines with those
 * entries (Chromium) never install it.
 */

/** The tracker's handle. */
export interface FirstHiddenTracker {
  /**
   * The first-hidden time: `0` when the page was already hidden (and not
   * prerendering) at install, the hiding event's time stamp after a hide,
   * null while never hidden (since install, or since the last restart).
   */
  readonly read: () => number | null;
  /**
   * Forget the hide and track the next one (a back/forward-cache restore
   * starts a new visit). The current visibility is not read: at `pageshow`
   * an engine may still report the restored page as hidden; a page hidden
   * at the vitals read still reads as hidden there.
   */
  readonly restart: () => void;
}

/**
 * Track the first hide.
 *
 * @param doc The page's document.
 * @param signal Removes the listener (the content script's context).
 * @param onError Reports a listener failure (never thrown into the page).
 * @returns The tracker.
 */
export function trackFirstHidden(
  doc: Document,
  signal: AbortSignal,
  onError: (cause: unknown) => void
): FirstHiddenTracker {
  let first: number | null = null;
  // The listener while one is installed (only until the first hide).
  let armed: AbortController | null = null;

  /** Listen for the next hide (no-op while listening, or once the context ended). */
  const arm = (): void => {
    if (armed !== null || signal.aborted) return;
    const stop = new AbortController();
    armed = stop;
    const onChange = (event: Event): void => {
      try {
        if (doc.visibilityState !== 'hidden') return;
        first = event.timeStamp;
        // Only the first hide counts: the listener's work is done.
        stop.abort();
        armed = null;
      } catch (cause) {
        onError(cause);
      }
    };
    const options = {
      capture: true,
      passive: true,
      signal: AbortSignal.any([signal, stop.signal])
    };
    doc.addEventListener('visibilitychange', onChange, options);
  };

  const hiddenAtInstall =
    doc.visibilityState === 'hidden' && (doc as { prerendering?: boolean }).prerendering !== true;
  if (hiddenAtInstall) first = 0;
  else arm();
  return {
    read: () => first,
    restart: () => {
      first = null;
      arm();
    }
  };
}
