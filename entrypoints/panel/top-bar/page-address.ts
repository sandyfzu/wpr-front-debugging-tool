/**
 * The inspected page's address for the top bar: which page the data
 * describes, read through DevTools on every data settle (a navigation or a
 * refresh lands a new settle), shown as a short label with the full URL on
 * hover.
 *
 * Best-effort like every DevTools read: no API, a failure or a non-http(s)
 * answer leaves the address empty and the bar simply omits it — the
 * answers never wait for it.
 */
import { createEffect, createSignal, on, type Accessor } from 'solid-js';
import { parseHttpUrl } from '../../../utils/urls';
import { createLogger } from '../../../lib/logger';
import type { DataState } from '../state/fdt-state-machine';

const log = createLogger('panel');

/**
 * The short form of an http(s) URL: host, then path and query when the path
 * is not the root (the scheme and the fragment add nothing to "which page").
 *
 * @param url The page URL.
 * @returns The label, or null when the URL is not absolute http(s).
 */
export function pageAddressLabel(url: string): string | null {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return null;
  const path = parsed.pathname === '/' && parsed.search === '' ? '' : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}`;
}

/** The address the bar shows: the full URL and its short label. */
export interface PageAddress {
  /** The full URL (the hover title). */
  readonly url: string;
  /** The short label (the visible text). */
  readonly label: string;
}

/** One {@link addressAction} decision. */
export type AddressAction =
  | { readonly kind: 'read'; readonly stamp: number }
  | { readonly kind: 'keep' }
  | { readonly kind: 'clear' };

/**
 * What the data state means for the address: `read` = a new settle to read
 * the address for (its stamp), `keep` = a flight in the air (the shown
 * address still describes the shown data), `clear` = no data is shown.
 *
 * @param state The panel's data state.
 * @returns The decision.
 */
export function addressAction(state: DataState): AddressAction {
  switch (state.status) {
    case 'ready':
      return { kind: 'read', stamp: state.fetchedAt };
    case 'idle':
    case 'fetching':
    case 'refreshing':
      return { kind: 'keep' };
    case 'error':
    case 'unavailable':
      return { kind: 'clear' };
  }
}

/**
 * Follow the inspected page's address. Each new settle starts one read; an
 * answer that lands after a newer settle (or after the data went away) is
 * dropped, so the bar never shows a previous page's address.
 *
 * @param state The panel's data state.
 * @param read Reads the inspected page URL (null when unknown); a rejection
 *   is logged and leaves the address empty.
 * @returns The current address, or null while unknown.
 */
export function createPageAddress(
  state: Accessor<DataState>,
  read: () => Promise<string | null>
): Accessor<PageAddress | null> {
  const [address, setAddress] = createSignal<PageAddress | null>(null);
  /** Bumped per read and per clear: only the latest generation may write. */
  let generation = 0;
  /** The settle last read; a flight since then (`keep`) forces the next read. */
  let readStamp: number | null = null;
  createEffect(
    on(
      () => addressAction(state()),
      (action) => {
        if (action.kind === 'keep') {
          readStamp = null;
          return;
        }
        if (action.kind === 'clear') {
          generation += 1;
          readStamp = null;
          setAddress(null);
          return;
        }
        // Pushes re-run the effect with the same settle: one read per settle.
        if (action.stamp === readStamp) return;
        readStamp = action.stamp;
        generation += 1;
        const mine = generation;
        read().then(
          (url) => {
            if (mine !== generation) return;
            const label = url === null ? null : pageAddressLabel(url);
            setAddress(url === null || label === null ? null : { url, label });
          },
          (cause: unknown) => {
            // The reader's contract is "never rejects"; a broken one only
            // costs the address, never the bar.
            log.warn('Reading the inspected page address failed; the top bar omits it', {
              cause: cause instanceof Error ? { message: cause.message } : cause
            });
            if (mine === generation) setAddress(null);
          }
        );
      }
    )
  );
  return address;
}
