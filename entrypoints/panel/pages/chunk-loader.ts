/**
 * The panel's one way to keep code out of its start: the generic once-per-
 * document loader (`utils/chunk-loader`) plus its panel mount. Route pages
 * (`./lazy-page`) and page sections (`./lazy-section`) both load through it,
 * and both mount it the same way ({@link mountChunk}).
 */
import { createSignal, type Accessor } from 'solid-js';
import { createLogger } from '../../../lib/logger';
import type { ChunkLoader } from '../../../utils/chunk-loader';

const log = createLogger('panel');

/** The failed load's remedy: reload the panel document (it re-attaches fresh). */
export function reloadPanelDocument(): void {
  window.location.reload();
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
