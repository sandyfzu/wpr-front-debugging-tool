/**
 * Main-frame response header capture.
 *
 * A `webRequest.onResponseStarted` listener records each top-level frame's
 * response headers per tab, and the `getPageHeaders` protocol request serves
 * a lookup of the sender's OWN tab (the id travels on the runtime sender —
 * a payload-borne id could be spoofed by any page-attached sender). This is
 * the data source for the panel's Server / Known Platform cards and header
 * pages. Values are redacted at capture: a credential, cookie or token in a
 * response header never reaches the cache, the content script or the panel.
 *
 * Manifest note: `webRequest` listeners only see URLs the manifest grants
 * `host_permissions` for. The manifest single-sources the exact same
 * `http`/`https` all-URL list this listener registers, so capture works on
 * every real navigation — a runtime guarantee the build verifies by sharing
 * one pattern constant between the manifest and this listener.
 *
 * The listener itself is two lines of glue: its body lives in
 * `handleResponseStarted` with the effects injected, so the capture→cache
 * and response→badge steps are directly testable and can never silently
 * disconnect from each other.
 */

import { parsePageHeaders } from '../../lib/messaging/validate';
import { redactPageHeader } from '../../lib/redaction/headers';
import { boundPageHeaders } from '../../lib/messaging/payload-bounds';
import { numericTabId, resolveSenderTabId } from '../../lib/messaging/sender';
import { createLogger } from '../../lib/logger';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { onMessage } from '../../lib/messaging';
import type { PageHeaderCapture, PageHeaders } from '../../lib/wp-rocket/types';
import type { BadgeRuntime } from './badge';
import type { SimMainFrameHook } from './device-simulation';

const log = createLogger('headers');

/**
 * Cached tabs cap: browsers comfortably exceed hundreds of open tabs and an
 * unbounded per-tab map would grow for the service worker's whole life. 100
 * recent tabs keep the hot set (active work + multi-window debugging) while
 * idle tabs age out exactly like the pages they carried.
 */
export const HEADER_CACHE_CAPACITY = 100;

/** A captured header row before validation, as the webRequest event hands it. */
export interface RawResponseHeader {
  name: string;
  value?: string | undefined;
  /** Non-UTF8 responses carry bytes instead of a value; not renderable text. */
  binaryValue?: unknown;
}

/** The capture's storage seam — [`CachedTabHeaders`] is the implementation. */
export interface HeaderCaptureStore {
  /** See `CachedTabHeaders.store` for the contract (reset-on-absent, validated entries). */
  store(tabId: number, headers: readonly RawResponseHeader[] | undefined): boolean;
}

/**
 * The per-tab header cache. Storage and lookup are pure over a least-
 * recently-used Map (insertion order doubles as recency: a `get`/`set`
 * re-inserts, making the entry the last to evict; a `has`-style check never
 * rescues an idle entry) so both behaviors are testable without the
 * `webRequest` event: every entry in is validated, and the cap evicts the
 * OLDEST read — a queried tab is the last candidate for eviction.
 */
export class CachedTabHeaders implements HeaderCaptureStore {
  #cache = new Map<number, PageHeaderCapture>();

  private setFresh(tabId: number, capture: PageHeaderCapture): void {
    this.#cache.delete(tabId);
    this.#cache.set(tabId, capture);
    const over = this.#cache.size - HEADER_CACHE_CAPACITY;
    if (over <= 0) return;
    // One call only crosses the cap by one; delete the single oldest key.
    const oldest = this.#cache.keys().next();
    if (oldest.done !== true) this.#cache.delete(oldest.value);
  }

  /**
   * Store or reset one tab's headers. Every capture starts by clearing the
   * tab: rows failing validation must not silently keep the previous page's
   * headers alive under the new page's tab. Then, in order:
   * 1. **redact** — every row through the rule on its full value
   *    (secret-bearing values withheld, URL values reduced), so the cache
   *    and every surface it serves only ever hold the redacted form;
   * 2. **bound** — rows beyond the cap dropped, long names/values clipped,
   *    the capture marked `truncated` (one large CSP or `Link` header is
   *    page reality and must not erase every other row);
   * 3. **validate** — only malformed shapes reject.
   *
   * @param headers Raw rows as delivered by the event (possibly absent).
   * @returns True when usable rows were stored, false when the tab has none.
   */
  store(tabId: number, headers: readonly RawResponseHeader[] | undefined): boolean {
    this.#cache.delete(tabId);
    if (headers === undefined) return false;
    const redacted = headers.map((row) => {
      const normalized =
        typeof row.value === 'string' ? { name: row.name, value: row.value } : { name: row.name };
      // A malformed name is left for the validator to reject (the rule reads
      // names as strings); every well-formed row is redacted HERE, before it
      // is stored, served or even bounded — the full value is what the rule
      // judges, and no raw secret outlives this call.
      return typeof normalized.name === 'string' ? redactPageHeader(normalized) : normalized;
    });
    const bounded = boundPageHeaders(redacted);
    const validated = parsePageHeaders(bounded.headers);
    if (validated === null) {
      log.warn('Captured headers rejected (malformed rows)', { tabId });
      return false;
    }
    this.setFresh(
      tabId,
      bounded.truncated === true ? { headers: validated, truncated: true } : { headers: validated }
    );
    return true;
  }

  /**
   * Take a tab's stored headers (a read refreshes the tab's recency — a
   * queried tab is the last candidate for eviction, since the read counts as
   * use).
   *
   * @returns The validated capture (rows + truncation mark), or null for
   *   tabs with nothing usable stored.
   */
  takeCapture(tabId: number): PageHeaderCapture | null {
    const stored = this.#cache.get(tabId);
    if (stored === undefined) return null;
    // An empty capture means nothing usable was served; the consumer omits
    // its header-derived cards on null, not on an empty list.
    if (stored.headers.length === 0) return null;
    // A read refreshes the recency (delete + re-append to the end).
    this.#cache.delete(tabId);
    this.#cache.set(tabId, stored);
    return stored;
  }

  /**
   * {@link takeCapture}'s rows alone (same recency effect).
   *
   * @returns The validated rows, or null for tabs with nothing usable stored.
   */
  take(tabId: number): PageHeaders | null {
    return this.takeCapture(tabId)?.headers ?? null;
  }

  /** Drop a tab's rows (a page whose capture failed, or a closed tab). */
  forget(tabId: number): void {
    this.#cache.delete(tabId);
  }
}

/**
 * The response-started event, narrowed to the two facts a capture reads:
 * which tab the main frame belongs to and its (possibly absent) header list.
 */
export interface ResponseStartedEvent {
  /** The tab whose top-level document is loading; -1 and junk ids mean none. */
  tabId: number;
  /**
   * Raw rows as delivered. `undefined` is not an empty capture — it resets
   * the tab, so headers that never arrived can never leave the previous
   * page's rows readable under the new page.
   */
  responseHeaders?: readonly RawResponseHeader[] | undefined;
}

/** The response event's two effects, injectable for the listener-body tests. */
export interface HeaderCaptureDeps {
  /** The per-tab header cache (validation + the LRU cap live inside it). */
  capture: HeaderCaptureStore;
  /** Badge runtime; a main-frame response starts that tab's page lifecycle. */
  badge: Pick<BadgeRuntime, 'navigationStarted' | 'apply'>;
  /**
   * Simulated-device sessions; a main-frame response ends the tab's sim-on
   * session (its rule dies with the page it was scoped to).
   */
  sim: SimMainFrameHook;
}

/**
 * One main-frame response, end to end — the unit the `onResponseStarted`
 * listener runs. Two independent effects, each in its own guard, because
 * they fail differently: a capture that yields nothing (browser-internal
 * headers, a rejected oversize page) must still clear the stale badge, and
 * a broken badge runtime must never cost the page's captured headers.
 * A reference that is not a tab (prerenders, background navigations) is no
 * capture at all — never stored under a junk key, never a badge target.
 *
 * @param event The response-started details, narrowed to what is consumed.
 * @param deps The capture's cache and the badge runtime to notify.
 */
export function handleResponseStarted(event: ResponseStartedEvent, deps: HeaderCaptureDeps): void {
  const tabId = numericTabId(event.tabId);
  if (tabId === null) {
    log.debug('Main-frame response without a usable tab ignored', { tabId: event.tabId });
    return;
  }
  try {
    deps.capture.store(tabId, event.responseHeaders);
  } catch (cause) {
    log.error('Header capture failed', { cause, tabId });
  }
  try {
    // A fresh page load, even before the page answers: the old badge leaves
    // before anything of the new page is rendered.
    void deps.badge.apply(deps.badge.navigationStarted(tabId));
  } catch (cause) {
    log.error('Navigation badge clear failed', { cause, tabId });
  }
  try {
    // The simulated session belongs to the page that is ending: its rule
    // removal rides this response signal (the request itself was already
    // written before the rule could be lifted — recorded in the phase doc).
    void deps.sim.mainFrameNavigation(tabId);
  } catch (cause) {
    log.error('Sim session removal failed', { cause, tabId });
  }
}

/**
 * Register the header-capture runtime. Runs once per service worker start:
 * the response listener delegates to `handleResponseStarted` (its effects
 * are guarded there), the badge runtime is notified on every main-frame
 * response so navigation can clear a stale badge before the page even finishes
 * loading, the simulated-device session drops its tab rule on the same
 * signal, and closed tabs drop both their rows and badge state.
 *
 * @param badge Badge runtime whose per-tab badge a main-frame response clears.
 * @param sim Simulated-device sessions whose tab rule a main-frame response ends.
 */
export function initHeaderCapture(badge: BadgeRuntime, sim: SimMainFrameHook): void {
  const capture = new CachedTabHeaders();

  browser.webRequest.onResponseStarted.addListener(
    (details) => {
      handleResponseStarted(details, { capture, badge, sim });
    },
    { urls: [...URL_PATTERNS], types: ['main_frame'] },
    ['responseHeaders']
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    try {
      capture.forget(tabId);
      badge.tabRemoved(tabId);
    } catch (cause) {
      log.error('Tab cleanup listener failed', { cause, tabId });
    }
  });

  onMessage('getPageHeaders', ({ sender }) => {
    const tabId = resolveSenderTabId(sender);
    if (tabId === null) {
      // No usable tab on the sender: nothing to look up, nothing to serve.
      log.warn('Tabless sender ignored');
      return null;
    }
    const served = capture.takeCapture(tabId);
    if (served !== null) log.debug('Headers served for tab', { tabId });
    return served;
  });
}
