/**
 * The Undefined References page's store: owned by the page component and
 * disposed with it — every signal, timer, watch and in-flight read or search
 * lives in the closure of one `createUndefinedReferencesStore` call, so a
 * re-mount starts clean and nothing outlives the page.
 *
 * Flow: once there are words and the page's scripts can have run (no Delay
 * JS, or Delay JS reported them loaded) the store reads the scripts; each
 * word is then searched by a cooperative loop that yields the main thread
 * between slices and streams answers in as they complete — a push adding one
 * word searches that one word. A refetch of the page's data reads again with
 * the cards kept on screen (answers swap in place); a rescan does the same on
 * demand. Results render the moment they are computed — no artificial delay.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import type { Accessor } from 'solid-js';
import { createLogger } from '../../../../lib/logger';
import type {
  InlineScriptSource,
  ScriptAsset,
  ScriptOrigin
} from '../../../../lib/panel/undefined-refs';
import type { InspectedScripts, ScriptRead } from './inspected-scripts';
import {
  arrivedWords,
  classifyScanError,
  newReferencesAnnouncement,
  reconcileOrigins,
  resolvePageView,
  SCAN_IDLE,
  SCAN_UNSUPPORTED,
  searchableAssets,
  transitionScan,
  uniqueWords,
  type DefinitionAnswer,
  type PageView,
  type ScanEvent,
  type ScanFailure,
  type ScanState
} from './model';
import {
  createPacer,
  defaultYieldToMain,
  searchWord,
  SEARCH_SLICE_MS,
  type YieldToMain
} from './search';

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
  /** Changes whenever the page's data was refetched (the read then repeats). */
  readonly pageKey: Accessor<number>;
}

/** The store's injected effects. */
export interface UndefinedReferencesDeps {
  /** The inspected-window reader, or `null` when this browser cannot list scripts. */
  readonly inspected: InspectedScripts | null;
  /** Arm a one-shot timer; returns its cancel. Default `setTimeout`. */
  readonly schedule?: (run: () => void, ms: number) => () => void;
  /** The timeout (default {@link SCAN_TIMEOUT_MS}). */
  readonly timeoutMs?: number;
  /** Report a failed rescan (results stay; the page toasts it). */
  readonly onRescanFailed?: (failure: ScanFailure) => void;
  /** Hand the main thread back during the search (default: {@link defaultYieldToMain}). */
  readonly yieldToMain?: YieldToMain;
  /** The search's clock (default `performance.now`). */
  readonly now?: () => number;
  /** The search's work budget between yields (default {@link SEARCH_SLICE_MS}). */
  readonly sliceMs?: number;
  /** Observe each word search as it starts (tests count the incremental work). */
  readonly onWordSearch?: (word: string) => void;
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
   * A word's search answer: its origins, `'pending'` until the search
   * reaches it, `null` when no search runs.
   *
   * @param word A listed word.
   */
  readonly answerOf: (word: string) => DefinitionAnswer;
  /** The inspected page's origin, once a read learned it. */
  readonly pageOrigin: Accessor<string | null>;
  /** Script files the last read had to skip (the search cannot see them). */
  readonly unreadableScripts: Accessor<number>;
  /** A user rescan is in flight (current results stay visible). */
  readonly rescanning: Accessor<boolean>;
  /** Counts completed user rescans (the control flashes "done" on change). */
  readonly rescansDone: Accessor<number>;
  /** The page loaded scripts after the last read (a rescan would see them). */
  readonly staleScripts: Accessor<boolean>;
  /** The latest new-words announcement (empty text before any). */
  readonly announcement: Accessor<Announcement>;
  /** Retry a failed read. */
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
  const inspected = deps.inspected;
  const schedule = deps.schedule ?? defaultSchedule;
  const timeoutMs = deps.timeoutMs ?? SCAN_TIMEOUT_MS;
  const yieldToMain = deps.yieldToMain ?? defaultYieldToMain();
  const now = deps.now ?? (() => performance.now());
  const sliceMs = deps.sliceMs ?? SEARCH_SLICE_MS;

  const [scan, setScan] = createSignal<ScanState>(
    inspected === null ? SCAN_UNSUPPORTED : SCAN_IDLE
  );
  const [pageOrigin, setPageOrigin] = createSignal<string | null>(null);
  const [rescansDone, setRescansDone] = createSignal(0);
  const [staleScripts, setStaleScripts] = createSignal(false);
  const [unreadableScripts, setUnreadableScripts] = createSignal(0);
  /** Bumped by every new read, failure, reset and disposal: an old read's settle is stale. */
  let readTicket = 0;
  /** Bumped by every data refetch: an origin read from an older page is dropped. */
  let pageGeneration = 0;
  let disposed = false;
  let cancelTimeout: (() => void) | null = null;

  const words = createMemo(() => uniqueWords(input.words()));
  const gateOpen = (): boolean => !input.delayJsPresent() || input.allScriptsLoaded();

  /** Apply one scan event; returns the state before and after it. */
  const apply = (event: ScanEvent): { before: ScanState; after: ScanState } => {
    const before = untrack(scan);
    const after = transitionScan(before, event);
    if (after !== before) setScan(after);
    return { before, after };
  };

  /** Drop the pending read timeout. */
  const disarm = (): void => {
    cancelTimeout?.();
    cancelTimeout = null;
  };

  /** Settle the current read as failed, unless it is stale. */
  const fail = (ticket: number, failure: ScanFailure, cause?: unknown): void => {
    if (ticket !== readTicket || disposed) return;
    readTicket += 1;
    disarm();
    log.warn('Reading the inspected page scripts failed', {
      failure,
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    const { before, after } = apply({ type: 'failed', failure });
    if (before.kind === 'scanning' && after.kind === 'scanned') deps.onRescanFailed?.(failure);
  };

  /** Run the read a fresh `scanning` state asks for. */
  const launchRead = (reader: InspectedScripts): void => {
    readTicket += 1;
    const ticket = readTicket;
    const generation = pageGeneration;
    disarm();
    cancelTimeout = schedule(() => {
      fail(ticket, 'timed-out');
    }, timeoutMs);
    let read: Promise<ScriptRead>;
    try {
      read = reader.load(untrack(input.inlineScripts));
    } catch (cause) {
      read = Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
    read.then(
      ({ assets, unreadable }) => {
        if (ticket !== readTicket || disposed) return;
        readTicket += 1;
        disarm();
        setStaleScripts(false);
        setUnreadableScripts(unreadable);
        const { before } = apply({ type: 'settled', assets });
        if (before.kind === 'scanning' && before.keepOnFailure) setRescansDone((n) => n + 1);
      },
      (cause: unknown) => {
        fail(ticket, classifyScanError(cause), cause);
      }
    );
    void reader.readPageOrigin().then((origin) => {
      if (generation !== pageGeneration || disposed || origin === null) return;
      setPageOrigin(origin);
    });
  };

  /** Apply an event and start the read when it produced a fresh `scanning` state. */
  const transitionAndRead = (event: ScanEvent): void => {
    const { before, after } = apply(event);
    if (inspected !== null && after !== before && after.kind === 'scanning') {
      launchRead(inspected);
    }
  };

  // The data was refetched (a reload, a navigation, the palette's reload):
  // read again with the cards kept, or drop the read when there is nothing
  // to search yet. An idle scan is the gate's to start.
  createEffect(
    on(
      input.pageKey,
      () => {
        pageGeneration += 1;
        setStaleScripts(false);
        const current = untrack(scan);
        if (current.kind === 'idle' || current.kind === 'unsupported') return;
        if (untrack(words).length > 0 && untrack(gateOpen)) {
          transitionAndRead({ type: 'refresh' });
        } else {
          readTicket += 1;
          disarm();
          apply({ type: 'reset' });
        }
      },
      { defer: true }
    )
  );

  // The gate: read once there is something to search and the scripts can
  // have run — immediately without Delay JS, after its "all scripts loaded"
  // report with it.
  createEffect(() => {
    if (gateOpen() && words().length > 0 && scan().kind === 'idle') {
      transitionAndRead({ type: 'start' });
    }
  });

  // The cooperative search. Answers for one asset list stream into
  // `answers`; a new list restarts the search but keeps the old answers on
  // screen until each word's new answer replaces it (an invisible refresh).
  const assets = createMemo(() => searchableAssets(scan()));
  const [answers, setAnswers] = createSignal<ReadonlyMap<string, readonly ScriptOrigin[]>>(
    new Map()
  );
  let searched = new Map<string, readonly ScriptOrigin[]>();
  let searchTicket = 0;
  let loopTicket = -1;

  /** Search every word the current list has not answered, yielding as it goes. */
  const runSearch = async (list: readonly ScriptAsset[], ticket: number): Promise<void> => {
    // A function, not inline checks: `disposed`/`searchTicket` change across awaits.
    const cancelled = (): boolean => ticket !== searchTicket || disposed;
    const pacer = createPacer({ yieldToMain, now, sliceMs, cancelled });
    for (;;) {
      if (cancelled()) return;
      const next = untrack(words).find((word) => !searched.has(word));
      if (next === undefined) return;
      deps.onWordSearch?.(next);
      const origins = await searchWord(next, list, pacer);
      if (origins === null || cancelled()) return;
      searched.set(next, origins);
      setAnswers((previous) => {
        const shown = previous.get(next);
        const kept = reconcileOrigins(shown, origins);
        // An unchanged answer is not a change: no new map, no re-render.
        return kept === shown ? previous : new Map(previous).set(next, kept);
      });
    }
  };

  /** Start the search loop for the current ticket unless one is running. */
  const pump = (list: readonly ScriptAsset[]): void => {
    if (loopTicket === searchTicket) return;
    const ticket = searchTicket;
    loopTicket = ticket;
    runSearch(list, ticket)
      .catch((cause: unknown) => {
        log.error('The definition search failed', cause);
      })
      .finally(() => {
        if (loopTicket === ticket) loopTicket = -1;
        // Words that arrived after the loop's last check are picked up here.
        const current = untrack(assets);
        if (ticket === searchTicket && !disposed && current !== null) {
          if (untrack(words).some((word) => !searched.has(word))) pump(current);
        }
      });
  };

  createEffect(
    on([assets, words], ([list], previous) => {
      const previousList = previous?.[0] ?? null;
      if (list === null) {
        searchTicket += 1;
        searched = new Map();
        setAnswers(new Map());
        return;
      }
      if (list !== previousList) {
        searchTicket += 1;
        searched = new Map();
      }
      pump(list);
    })
  );

  // Scripts the page loads after a read: say a rescan would see them.
  if (inspected !== null) {
    const stopWatch = inspected.watchAddedScripts((url) => {
      const current = untrack(scan);
      if (current.kind !== 'scanned') return;
      const known = current.assets.some(
        (asset) => asset.origin.kind === 'url' && asset.origin.url === url
      );
      if (!known) setStaleScripts(true);
    });
    onCleanup(stopWatch);
  }

  const view = createMemo(() =>
    resolvePageView({
      delayJsPresent: input.delayJsPresent(),
      allScriptsLoaded: input.allScriptsLoaded(),
      wordCount: words().length,
      scan: scan()
    })
  );

  // New-word announcements: words present at mount, on a refetch, or while
  // the waiting view hides them are the baseline; only later arrivals the
  // user can see announce. One effect over both sources, so a refetch always
  // re-baselines before its words are compared.
  const [announcement, setAnnouncement] = createSignal<Announcement>({ text: '', seq: 0 });
  let known: Set<string> | null = null;
  let knownPage: number | null = null;
  createEffect(
    on([input.pageKey, words], ([page, current]) => {
      const hidden = untrack(view).kind === 'waiting-interaction';
      if (known === null || page !== knownPage || hidden) {
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
    // A read or search finishing after the page closed must land nowhere.
    disposed = true;
    readTicket += 1;
    searchTicket += 1;
    disarm();
  });

  return {
    view,
    words,
    answerOf: (word) => (assets() === null ? null : (answers().get(word) ?? 'pending')),
    pageOrigin,
    unreadableScripts,
    rescanning: () => {
      const current = scan();
      return current.kind === 'scanning' && current.keepOnFailure;
    },
    rescansDone,
    staleScripts,
    announcement,
    retry: () => {
      if (untrack(scan).kind === 'failed') transitionAndRead({ type: 'start' });
    },
    rescan: () => {
      if (untrack(scan).kind === 'scanned') transitionAndRead({ type: 'start' });
    }
  };
}
