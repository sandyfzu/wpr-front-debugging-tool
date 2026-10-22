/**
 * Keeps an injected UI's input events inside its shadow root, so the host
 * page never sees them. Pages do act on them: WP Rocket's Delay JS runtime
 * listens at the window for a page's first interactions, stops them, loads
 * its delayed scripts and then replays each saved event on its original
 * target — inside our shadow tree too. A click on an injected button would
 * then run twice (a refresh reloading its frame twice, a switch flipping
 * back), and clicking our UI would also start the page's delayed scripts,
 * changing the page under test.
 *
 * The events stop at the shadow root (bubbling phase), so the document and
 * the window never get them. Solid delegates its events to the document by
 * default, which the stopped events no longer reach: the same call
 * delegates them at the shadow root instead. Both halves always go
 * together — delegation at the root without the stop would handle each
 * event twice (root and document).
 */
import { DelegatedEvents, delegateEvents } from 'solid-js/web';

/**
 * Events stopped at the shadow root: every event Solid delegates, plus the
 * other input events pages hook (wheel, key presses, clipboard,
 * composition, cancelled pointers/touches, auxiliary clicks).
 */
export const ISOLATED_UI_EVENTS: readonly string[] = [
  ...DelegatedEvents,
  'keypress',
  'wheel',
  'touchcancel',
  'pointercancel',
  'auxclick',
  'paste',
  'copy',
  'cut',
  'compositionstart',
  'compositionupdate',
  'compositionend'
];

/** Shadow roots already isolated (the call is idempotent). */
const isolatedRoots = new WeakSet<ShadowRoot>();

/** Stops an event at the shadow root: nothing outside the UI sees it. */
function stopAtRoot(event: Event): void {
  event.stopPropagation();
}

/**
 * Isolate a shadow root's input events and delegate Solid's handlers there.
 * Call it before rendering into the root, so the first event is covered.
 * Listeners live as long as the root (they go with it); a second call on
 * the same root does nothing.
 *
 * @param shadow The injected UI's shadow root.
 */
export function isolateUiEvents(shadow: ShadowRoot): void {
  if (isolatedRoots.has(shadow)) return;
  isolatedRoots.add(shadow);
  for (const type of ISOLATED_UI_EVENTS) shadow.addEventListener(type, stopAtRoot);
  // Solid's delegation takes any event target; its type names the document.
  delegateEvents([...DelegatedEvents], shadow as unknown as Document);
}
