/**
 * The panel's one way to keep code out of its start: a module fetched once
 * per panel document — early at the first idle moment after boot (bounded),
 * or on first use, whichever comes first — and reused on every later use.
 * A failed fetch is forgotten, so the next use fetches again. Route pages
 * (`./lazy-page`) and page sections (`./lazy-section`) both load through it,
 * and both mount it the same way ({@link mountChunk}).
 */
import { createSignal, type Accessor } from 'solid-js';
import { createLogger } from '../../../lib/logger';

const log = createLogger('panel');

/** Longest wait (ms) for an idle moment before the early fetch runs anyway. */
export const PREFETCH_IDLE_TIMEOUT_MS = 2_000;

/** The failed load's remedy: reload the panel document (it re-attaches fresh). */
export function reloadPanelDocument(): void {
  window.location.reload();
}

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

/** What a lazy page or section needs besides its loader (tests inject doubles). */
export interface LazyChunkOptions {
  /** The failed state's recovery (production: reload the panel document). */
  readonly reloadPanel?: () => void;
  /**
   * Schedules the early fetch (production: the panel's first idle moment;
   * `null`: fetch on the first use only).
   */
  readonly prefetch?: ((fetch: () => void) => void) | null;
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

/** One mount's view of a chunk. */
export interface ChunkMount<T> {
  /** The loaded pick, or null while loading or after a failure. */
  readonly body: Accessor<T | null>;
  /** The fetch failed (logged); the mount shows its remedy. */
  readonly failed: Accessor<boolean>;
}

/** How a mount reports and shows its chunk. */
export interface MountChunkOptions<T> {
  /** The failure's log line (the cause is appended). */
  readonly failureMessage: string;
  /**
   * Runs when the fetch lands, with the step that shows the pick — so the
   * caller can act around it (default: just show it).
   */
  readonly onLoad?: (pick: T, show: () => void) => void;
}

/**
 * Mount a chunk (call in a component body): an already loaded pick shows at
 * once; otherwise the fetch runs, then shows the pick or the logged failure.
 *
 * @param chunk The chunk's loader.
 * @param options See {@link MountChunkOptions}.
 * @returns The mount's state.
 */
export function mountChunk<T>(chunk: ChunkLoader<T>, options: MountChunkOptions<T>): ChunkMount<T> {
  const [body, setBody] = createSignal<T | null>(chunk.loaded());
  const [failed, setFailed] = createSignal(false);
  if (chunk.loaded() === null) {
    chunk.fetch().then(
      (pick) => {
        const show = (): void => {
          setBody(() => pick);
        };
        if (options.onLoad === undefined) show();
        else options.onLoad(pick, show);
      },
      (cause: unknown) => {
        log.error(options.failureMessage, cause instanceof Error ? cause.message : cause);
        setFailed(true);
      }
    );
  }
  return { body, failed };
}
