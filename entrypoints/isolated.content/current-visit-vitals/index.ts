/**
 * The current-visit vitals' page module (top frame, from document start):
 * collects this visit's entries and answers the panel's
 * `getCurrentVisitVitals`. Where the engine has no `visibility-state`
 * entries (Firefox), the first-hidden tracker is installed alongside; where
 * it has them (Chromium), it never is. A back/forward-cache restore
 * (`pageshow`, persisted) starts a new visit: entries and the first hide are
 * forgotten. No on-page trigger: the panel is the only way in.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createLogger } from '../../../lib/logger';
import { onMessage } from '../../../lib/messaging';
import { createVitalsCollector, type VitalsObserverClass } from './collector';
import { trackFirstHidden } from './first-hidden-tracker';

const log = createLogger('current-visit-vitals');

/**
 * Wire the module (registry row of the isolated world, at document start).
 * Top frame only: the visit's vitals are the top document's.
 *
 * @param ctx The content script's context; the observer and handler ride its lifetime.
 */
export function setupCurrentVisitVitals(ctx: ContentScriptContext): void {
  if (window !== window.top) return;
  const Observer = (globalThis as { PerformanceObserver?: VitalsObserverClass })
    .PerformanceObserver;
  const onError = (cause: unknown): void => {
    log.warn('Collecting this visit’s vitals failed in part', cause);
  };
  const tracker = Observer?.supportedEntryTypes?.includes('visibility-state')
    ? null
    : trackFirstHidden(document, ctx.signal, onError);
  const Timing = (globalThis as { PerformanceEventTiming?: { prototype: object } })
    .PerformanceEventTiming;
  const collector = createVitalsCollector({
    Observer,
    performance,
    document,
    hasInteractionIds: Timing !== undefined && 'interactionId' in Timing.prototype,
    trackedFirstHidden: tracker === null ? () => null : tracker.read,
    onError
  });
  window.addEventListener(
    'pageshow',
    (event: PageTransitionEvent) => {
      // Guarded: a listener that throws would reach the page's console.
      try {
        if (!event.persisted) return;
        tracker?.restart();
        collector.restart(event.timeStamp);
      } catch (cause) {
        onError(cause);
      }
    },
    { capture: true, passive: true, signal: ctx.signal }
  );
  ctx.onInvalidated(collector.stop);
  ctx.onInvalidated(onMessage('getCurrentVisitVitals', () => collector.read()));
}
