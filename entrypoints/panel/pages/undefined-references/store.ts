/**
 * The Undefined References page's store: owned by the page component and
 * disposed with it — every signal, timer and in-flight read lives in the
 * closure of one `createUndefinedReferencesStore` call, so a re-mount starts
 * clean and nothing outlives the page.
 *
 * Flow: when the page's scripts can have run (no Delay JS, or Delay JS
 * reported them loaded) the store reads them once; each word is then searched
 * through the incremental definition memo, so a push adding one word runs
 * one search. A new page (the shell's data refetch) resets the scan and the
 * memo; a rescan keeps the current results on screen until the new read
 * lands. Results render the moment they are computed — no artificial delay.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { Accessor } from 'solid-js';
import { createLogger } from '../../../../lib/logger';
import {
  refreshDefinitions,
  type InlineScriptSource,
  type ScriptAsset,
  type ScriptOrigin
} from '../../../../lib/panel/undefined-refs';
import {
  arrivedWords,
  classifyScanError,
  newReferencesAnnouncement,
  resolvePageView,
  SCAN_IDLE,
  SCAN_UNSUPPORTED,
  searchableAssets,
  transitionScan,
  uniqueWords,
  type PageView,
  type ScanEvent,
  type ScanFailure,
  type ScanState
} from './model';
import type { ScriptLoader } from './inspected-scripts';

const log = createLogger('panel');

/**
 * How long a script read may take before it counts as failed. DevTools
 * answers in milliseconds; a read that never calls back would otherwise
 * leave the processing state up forever with no way out.
 */
export const SCAN_TIMEOUT_MS = 15_000;

/** The page data the store reads (accessors, so it follows pushes). */
export interface UndefinedReferencesInput {
  /** Delay JavaScript execution is present on the page. */
  readonly delayJsPresent: Accessor<boolean>;
  /** Delay JS reported every held script as loaded. */
  readonly allScriptsLoaded: Accessor<boolean>;
  /** The undefined-reference words the page reported, arrival order. */
  readonly words: Accessor<readonly string[]>;
  /** The inline script sources the inline asset is built from. */
  readonly inlineScripts: Accessor<readonly InlineScriptSource[]>;
  /** Changes whenever a new page's data landed (the scan then restarts). */
  readonly pageKey: Accessor<number>;
}

/** The store's injected effects. */
export interface UndefinedReferencesDeps {
  /** The script reader, or `null` when this browser cannot list scripts. */
  readonly loadScripts: ScriptLoader | null;
  /** The incremental search (injectable so tests can count its work). */
  readonly refresh?: typeof refreshDefinitions;
  /** Arm a one-shot timer; returns its cancel. Default `setTimeout`. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
  /** The read timeout (default {@link SCAN_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** Report a failed rescan (results stay; the page toasts it). */
  readonly onRescanFailed?: (failure: ScanFailure) => void;
}

/** One status-region message; `seq` changes per message so equal texts re-announce. */
export interface Announcement {
  readonly text: string;
  readonly seq: number;
}

/** What the page reads from the store. */
export interface UndefinedReferencesStore {
  /** Which state body renders. */
  readonly view: Accessor<PageView>;
  /** The listed words, unique, arrival order (stable identities for keyed lists). */
  readonly words: Accessor<readonly string[]>;
  /**
   * A word's possible definitions; `null` when no search ran (no asset list).
   *
   * @param word A listed word.
   */
  readonly definitionsOf: (word: string) => readonly ScriptOrigin[] | null;
  /** A rescan is in flight (current results stay visible). */
  readonly rescanning: Accessor<boolean>;
  /** The latest new-words announcement (empty text before any). */
  readonly announcement: Accessor<Announcement>;
  /** Retry a failed scan. */
  retry(): void;
  /** Re-read the page's scripts (for scripts added since the last read). */
  rescan(): void;
}

/** The default timer seam. */
function defaultSchedule(run: () => void, ms: number): () => void {
  const handle = setTimeout(run, ms);
  return () => {
    clearTimeout(handle);
  };
}

/**
 * Create the page store. Call inside the page component (a reactive owner):
 * its effects and cleanup bind to that owner.
 *
 * @param input The page data accessors.
 * @param deps The injected effects.
 * @returns The store.
 */
export function createUndefinedReferencesStore(
  input: UndefinedReferencesInput,
  deps: UndefinedReferencesDeps
): UndefinedReferencesStore {
  const refresh = deps.refresh ?? refreshDefinitions;
  const schedule = deps.schedule ?? defaultSchedule;
  const timeoutMs = deps.timeoutMs ?? SCAN_TIMEOUT_MS;

  const [scan, setScan] = createSignal<ScanState>(
    deps.loadScripts === null ? SCAN_UNSUPPORTED : SCAN_IDLE
  );
  /** Bumped by every new read, reset and disposal: a settle with an old ticket is stale. */
  let ticket = 0;
  let cancelTimeout: (() => void) | null = null;

  /** Apply one scan event; returns the state after it. */
  const apply = (event: ScanEvent): ScanState => {
    const before = untrack(scan);
    const next = transitionScan(before, event);
    if (next !== before) setScan(next);
    return next;
  };

  /** Drop the pending timeout (a read settled, or the store moved on). */
  const disarm = (): void => {
    cancelTimeout?.();
    cancelTimeout = null;
  };

  /** Settle a read as failed, unless it is stale. */
  const fail = (readTicket: number, failure: ScanFailure, cause?: unknown): void => {
    if (readTicket !== ticket) return;
    ticket += 1;
    disarm();
    log.warn('Reading the inspected page scripts failed', {
      failure,
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    const before = untrack(scan);
    const wasRescan = before.kind === 'scanning' && before.previous !== null;
    apply({ type: 'failed', failure });
    if (wasRescan) deps.onRescanFailed?.(failure);
  };

  /** Start a read when the state allows one (first scan, retry, rescan). */
  const startScan = (): void => {
    const loader = deps.loadScripts;
    if (loader === null) return;
    const before = untrack(scan);
    if (apply({ type: 'start' }) === before) return;
    ticket += 1;
    const readTicket = ticket;
    disarm();
    cancelTimeout = schedule(() => {
      fail(readTicket, 'timed-out');
    }, timeoutMs);
    let read: Promise<ScriptAsset[]>;
    try {
      read = loader(untrack(input.inlineScripts));
    } catch (cause) {
      read = Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
    read.then(
      (assets) => {
        if (readTicket !== ticket) return;
        ticket += 1;
        disarm();
        apply({ type: 'settled', assets });
      },
      (cause: unknown) => {
        fail(readTicket, classifyScanError(cause), cause);
      }
    );
  };

  // A new page's data: the old read and asset list describe the old page.
  createEffect(
    on(
      input.pageKey,
      () => {
        ticket += 1;
        disarm();
        apply({ type: 'reset' });
      },
      { defer: true }
    )
  );

  // The gate: scripts can only define anything once they ran — immediately
  // without Delay JS, after its "all scripts loaded" report with it.
  createEffect(() => {
    const open = !input.delayJsPresent() || input.allScriptsLoaded();
    if (open && scan().kind === 'idle') startScan();
  });

  const words = createMemo(() => uniqueWords(input.words()));

  // The incremental search. The word memo is valid for one asset list only,
  // so a new list (new page, rescan) starts a fresh one.
  let wordMemo: ReadonlyMap<string, readonly ScriptOrigin[]> = new Map();
  let memoAssets: readonly ScriptAsset[] | null = null;
  const assets = createMemo(() => searchableAssets(scan()));
  const answers = createMemo((): ReadonlyMap<string, readonly ScriptOrigin[]> | null => {
    const list = assets();
    const current = words();
    if (list === null) return null;
    if (list !== memoAssets) {
      wordMemo = new Map();
      memoAssets = list;
    }
    const result = refresh(wordMemo, current, list);
    wordMemo = result.memo;
    return new Map(result.definitions.map((entry) => [entry.word, entry.definitions]));
  });

  // New-word announcements: words present at mount (or on a new page) are
  // the baseline, only later arrivals announce.
  // One effect over both sources, so a new page always re-baselines before
  // its words are compared (two effects would race on their run order).
  const [announcement, setAnnouncement] = createSignal<Announcement>({ text: '', seq: 0 });
  let known: Set<string> | null = null;
  let knownPage: number | null = null;
  createEffect(
    on([input.pageKey, words], ([page, current]) => {
      if (known === null || page !== knownPage) {
        known = new Set(current);
        knownPage = page;
        return;
      }
      const added = arrivedWords(known, current);
      if (added.length === 0) return;
      for (const word of added) known.add(word);
      setAnnouncement((previous) => ({
        text: newReferencesAnnouncement(added.length),
        seq: previous.seq + 1
      }));
    })
  );

  onCleanup(() => {
    // A read settling after the page closed must land nowhere.
    ticket += 1;
    disarm();
  });

  const view = createMemo(() =>
    resolvePageView({
      delayJsPresent: input.delayJsPresent(),
      allScriptsLoaded: input.allScriptsLoaded(),
      wordCount: words().length,
      scan: scan()
    })
  );

  return {
    view,
    words,
    definitionsOf: (word) => answers()?.get(word) ?? null,
    rescanning: () => {
      const current = scan();
      return current.kind === 'scanning' && current.previous !== null;
    },
    announcement,
    retry: () => {
      if (untrack(scan).kind === 'failed') startScan();
    },
    rescan: () => {
      if (untrack(scan).kind === 'scanned') startScan();
    }
  };
}
