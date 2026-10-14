/**
 * The cooperative definition search: the same per-word test as the shared
 * engine, run source by source with the main thread handed back between
 * slices, so a page with megabytes of scripts never freezes the panel.
 *
 * Long sources are tested in line-aligned slices (every match of the query
 * lies within one line, so slicing at line breaks answers the same); a
 * single huge line stays one slice.
 */
import {
  definitionMatcher,
  type ScriptAsset,
  type ScriptOrigin
} from '../../../../lib/panel/undefined-refs';

/** Main-thread time one slice of work may take before yielding (ms). */
export const SEARCH_SLICE_MS = 8;

/** Line-aligned slice size for long sources (chars). */
export const SOURCE_SLICE_CHARS = 64 * 1024;

/** Hand the main thread back; resolves when the search may continue. */
export type YieldToMain = () => Promise<void>;

/** The scheduler shape as this context may or may not have it. */
interface SchedulerShape {
  readonly scheduler?: { readonly yield?: () => Promise<void> };
}

/**
 * The default yield: `scheduler.yield()` where it exists (Chromium 129+,
 * under the manifest's 145 floor — continuation keeps its priority), else a
 * macrotask via `MessageChannel` (no 4 ms timer clamping), else `setTimeout`.
 *
 * @returns The yield function for this context.
 */
export function defaultYieldToMain(): YieldToMain {
  const scheduler = (globalThis as SchedulerShape).scheduler;
  const yieldFn = scheduler?.yield;
  if (typeof yieldFn === 'function') return () => yieldFn.call(scheduler);
  if (typeof MessageChannel === 'function') {
    return () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
  }
  return () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
}

/**
 * Split a source at line breaks into slices of about `maxChars` (a line
 * longer than that stays whole — it cannot be split without changing what
 * the query sees).
 *
 * @param content The source text.
 * @param maxChars The target slice size.
 * @returns The slices, in order (one slice for a short source).
 */
export function lineSlices(content: string, maxChars: number): string[] {
  if (content.length <= maxChars) return [content];
  const slices: string[] = [];
  let start = 0;
  while (start < content.length) {
    const target = start + maxChars;
    if (target >= content.length) {
      slices.push(content.slice(start));
      break;
    }
    const breakAt = content.indexOf('\n', target);
    const end = breakAt === -1 ? content.length : breakAt + 1;
    slices.push(content.slice(start, end));
    start = end;
  }
  return slices;
}

/** The search loop's injected effects. */
export interface SearchPacing {
  /** Hand the main thread back. */
  readonly yieldToMain: YieldToMain;
  /** A monotonic clock (ms). */
  readonly now: () => number;
  /** The work budget between yields (ms). */
  readonly sliceMs: number;
  /** Whether the search was abandoned (checked after every yield). */
  readonly cancelled: () => boolean;
}

/**
 * A pacer shared by consecutive word searches: it tracks how long the
 * current task has run and yields once the budget is spent.
 */
export interface Pacer {
  /**
   * Yield if this task's budget is spent.
   *
   * @returns `false` when the search was cancelled meanwhile.
   */
  checkpoint(): Promise<boolean>;
}

/**
 * Create a pacer.
 *
 * @param pacing The pacing effects.
 * @returns The pacer.
 */
export function createPacer(pacing: SearchPacing): Pacer {
  let taskStart = pacing.now();
  return {
    async checkpoint() {
      if (pacing.now() - taskStart < pacing.sliceMs) return !pacing.cancelled();
      await pacing.yieldToMain();
      taskStart = pacing.now();
      return !pacing.cancelled();
    }
  };
}

/** Same origin, structurally (consecutive duplicates answer once). */
function sameOrigin(left: ScriptOrigin, right: ScriptOrigin): boolean {
  if (left.kind === 'url' && right.kind === 'url') return left.url === right.url;
  return left.kind === right.kind;
}

/**
 * Search one word across the sources, yielding through the pacer. Answers
 * exactly what the shared engine's batch search answers for the word.
 *
 * @param word The word (the cross-origin sentinel answers `[]`).
 * @param assets The sources.
 * @param pacer The shared pacer.
 * @param sliceChars The line-aligned slice size.
 * @returns The origins, or `null` when the search was cancelled.
 */
export async function searchWord(
  word: string,
  assets: readonly ScriptAsset[],
  pacer: Pacer,
  sliceChars: number = SOURCE_SLICE_CHARS
): Promise<readonly ScriptOrigin[] | null> {
  const matches = definitionMatcher(word);
  if (matches === null) return [];
  const definitions: ScriptOrigin[] = [];
  for (const asset of assets) {
    const last = definitions.at(-1);
    const duplicate = last !== undefined && sameOrigin(last, asset.origin);
    if (!duplicate) {
      for (const slice of lineSlices(asset.content, sliceChars)) {
        const hit = matches(slice);
        if (!(await pacer.checkpoint())) return null;
        if (hit) {
          definitions.push(asset.origin);
          break;
        }
      }
    }
  }
  return definitions;
}
