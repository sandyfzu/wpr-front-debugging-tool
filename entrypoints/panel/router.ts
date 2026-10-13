/**
 * The panel's hash router — the ~30-line navigation core the alt-router rule
 * (no router dependency) owns: one signal of the current route plus a
 * navigate action, driven by `window.location.hash`.
 *
 * Hash navigation keeps the platform's session history for free (browser
 * back/forward, restored tab, deep links surviving the panel iframe's
 * reloads — the devtools window re-attaches them), and plain
 * `<a href="#/…">` anchors remain real links.
 */
import { createSignal, type Accessor } from 'solid-js';
import { DEFAULT_ROUTE, isRouteId, type RouteId } from './routes';

/** A panel hash: `#/<route-id>`. */
const HASH_PREFIX = '#/';

/**
 * Parse one raw location hash into a route id.
 *
 * An empty or unknown hash resolves `null` — the caller decides the default
 * (this shell always falls back to `detections`); a foreign hash is never
 * turned into a route.
 *
 * @param hash The raw hash as location carries it (`''`, `#/detections`, …).
 * @returns The route id, or null when the hash names no known route.
 */
export function parseHashRoute(hash: string): RouteId | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const id = hash.slice(HASH_PREFIX.length);
  return isRouteId(id) ? id : null;
}

/** The subset of `window` the router touches (tests hand a location stub). */
export interface HashRouterHost {
  readonly location: Pick<Location, 'hash'>;
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

export interface HashRouter {
  /** The current route — the mounted page's id, never a foreign value. */
  readonly route: Accessor<RouteId>;
  /** Walk to a route by writing the hash (history entry included). */
  readonly navigate: (to: RouteId) => void;
  /** Stop following `hashchange` (the shell wires it into its unload). */
  readonly stop: () => void;
}

/**
 * Create the router over one host window.
 *
 * The current location is read at creation (`app.html#/lazyload` opens on
 * Lazyload), and every `hashchange` re-parses it — an unknown hash degrades
 * to the default route but the hash itself is never rewritten, so no
 * surprise history entries are manufactured for the user.
 *
 * @param host The window-like host (the real `window` by default).
 */
export function createHashRoute(host: HashRouterHost = window): HashRouter {
  const [route, setRoute] = createSignal<RouteId>(
    parseHashRoute(host.location.hash) ?? DEFAULT_ROUTE
  );
  const onHashChange = (): void => {
    setRoute(parseHashRoute(host.location.hash) ?? DEFAULT_ROUTE);
  };
  host.addEventListener('hashchange', onHashChange);
  return {
    route,
    navigate: (to) => {
      host.location.hash = HASH_PREFIX + to;
    },
    stop: () => {
      host.removeEventListener('hashchange', onHashChange);
    }
  };
}
