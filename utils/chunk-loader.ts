/**
 * Keeping code out of an extension page's start: a module fetched once per
 * document — early at the first idle moment after boot (bounded), or on
 * first use, whichever comes first — and reused on every later use. A
 * failed fetch is forgotten, so the next use fetches again.
 */

/** Longest wait (ms) for an idle moment before the early fetch runs anyway. */
export const PREFETCH_IDLE_TIMEOUT_MS = 2_000;

/**
 * The production early fetch: the first idle moment after boot (bounded),
 * where the browser has idle callbacks; elsewhere the first use fetches.
 *
 * @param fetch Starts the fetch.
 */
export function prefetchWhenIdle(fetch: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fetch, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
  }
}

/** A module fetched once. */
export interface ChunkLoader<T> {
  /** Start the fetch unless one is in the air or done; resolves with the module's pick. */
  readonly fetch: () => Promise<T>;
  /** The loaded pick, or null before the fetch landed. */
  readonly loaded: () => T | null;
}

/**
 * Create a loader and schedule its early fetch.
 *
 * @param load Imports the module and picks what the caller renders.
 * @param prefetch Schedules the early fetch (`null`: first use only).
 * @returns The loader.
 */
export function createChunkLoader<T>(
  load: () => Promise<T>,
  prefetch: ((fetch: () => void) => void) | null
): ChunkLoader<T> {
  let loading: Promise<T> | null = null;
  let loaded: T | null = null;

  const fetch = (): Promise<T> =>
    (loading ??= load().then(
      (pick) => (loaded = pick),
      (cause: unknown) => {
        // Forget the failure: the next use fetches again.
        loading = null;
        throw cause;
      }
    ));

  prefetch?.(() => {
    // A failed early fetch is not reported here: the next use fetches again and names the failure.
    fetch().catch(() => undefined);
  });

  return { fetch, loaded: () => loaded };
}
