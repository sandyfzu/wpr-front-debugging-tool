/**
 * The compare overlay's document-local continuity: whether the previous
 * document of this tab had the overlay open. Host pages that reload
 * themselves (responsive breakpoints are a common source) end our content
 * script with the page; without a record of the open state the reload
 * silently leaves the user on a closed page to re-open from scratch.
 *
 * The flag lives in the tab's `sessionStorage`, valued with the page URL: a
 * same-URL boot (the host's self-reload, a manual refresh) restores the
 * overlay, any other boot (a real navigation to another URL) consumes the
 * flag and opens nothing — a compare session ends with its page, exactly
 * the session exit paths the overlay already guarantees. The strictness is
 * by design: a fragment or query change does not restore (the URL really
 * did change), while `location.reload()` and F5 keep the href and do.
 *
 * The storage is a boundary the host page can also write: a forged flag
 * only equals-or-not against the document's own href — the single effect
 * is the overlay's own open flow on that page, no flow consumes the stored
 * string. The helpers are total: even a broken `sessionStorage` (rare
 * hosts and privacy modes) degrades to "no continuity" rather than
 * throwing into the wiring.
 */

/** The storage seam the helpers use — exactly the `sessionStorage` calls made here. */
export interface OpenStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The window the helpers read the seam through: acquiring
 * `win.sessionStorage` inside the helpers keeps even a throwing property
 * access inside their documented degrade.
 */
export interface OpenStateWindow {
  sessionStorage: OpenStateStorage;
}

/** The overlay's own `sessionStorage` key. */
export const SBS_OPEN_STATE_KEY = 'wpr-fdt-sbs-open';

/**
 * Record that the overlay is open on the given page URL.
 *
 * @param win The tab's window (the storage seam source; degrades to a no-op when broken).
 * @param pageHref The URL of the document the overlay is open on.
 */
export function markOverlayOpen(win: OpenStateWindow, pageHref: string): void {
  try {
    win.sessionStorage.setItem(SBS_OPEN_STATE_KEY, pageHref);
  } catch {
    // Documented degrade: continuity is not maintained this page reload.
  }
}

/**
 * Record that the overlay is closed on this tab (its reload restores nothing).
 *
 * @param win The tab's window (the storage seam source; degrades to a no-op when broken).
 */
export function markOverlayClosed(win: OpenStateWindow): void {
  try {
    win.sessionStorage.removeItem(SBS_OPEN_STATE_KEY);
  } catch {
    // Documented degrade.
  }
}

/**
 * Consume the boot flag and tell whether the overlay was open on this exact
 * URL before the reload. The flag is always cleared here — a matching boot
 * re-opens and the open path writes it again, a mismatching one (a real
 * navigation) must not outlive its page. The consume-once contract also
 * means the restore's own async opening holds no flag: a host reloading
 * itself again mid-open simply ends that continuity window.
 *
 * @param win The tab's window (the storage seam source; degrades to `false` when broken).
 * @param pageHref The URL of the document that just booted.
 */
export function consumeBootOpenState(win: OpenStateWindow, pageHref: string): boolean {
  let saved: string | null;
  try {
    saved = win.sessionStorage.getItem(SBS_OPEN_STATE_KEY);
    win.sessionStorage.removeItem(SBS_OPEN_STATE_KEY);
  } catch {
    return false;
  }
  return saved !== null && saved === pageHref;
}
