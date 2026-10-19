/**
 * The page store: the read gate (the states' trigger conditions), the
 * cooperative search's incremental work, data refreshes in place, stale and
 * late settles, the timeout, retry/rescan, the page origin, the stale-scripts
 * watch, the new-words announcement, and per-mount isolation (no module
 * state survives a disposal).
 */
import { batch, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { InlineScriptSource, ScriptAsset } from '../../../../lib/panel/undefined-refs';
import type { BypassedPageRead, InspectedScripts, ScriptRead } from './inspected-scripts';
import type { ScanFailure } from './model';
import {
  BYPASS_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  createUndefinedReferencesStore,
  type UndefinedReferencesStore
} from './store';

/** One controllable read. */
interface PendingRead {
  readonly inline: readonly InlineScriptSource[];
  /** Settle with these assets (and optionally a count of skipped scripts). */
  resolve(assets: ScriptAsset[], unreadable?: number): void;
  reject(cause: unknown): void;
}

/** One controllable bypass read. */
interface PendingBypass {
  resolve(read: BypassedPageRead | null): void;
}

const URL_A = 'https://x.test/a.js';
const URL_B = 'https://x.test/b.js';
const ASSETS: ScriptAsset[] = [
  { origin: { kind: 'url', url: URL_A }, content: 'var alpha = 1;\nfunction beta() {}' },
  { origin: { kind: 'inline' }, content: 'gamma = 2;' }
];

/** Let promise chains (reads, the search loop's awaits) run to quiescence. */
async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

interface HarnessOptions {
  delayJs?: boolean;
  allLoaded?: boolean;
  words?: string[];
  unsupported?: boolean;
  load?: InspectedScripts['load'];
  origin?: string | null;
}

/** A store over controllable signals, a scripted reader and a manual timer. */
function harness(options: HarnessOptions = {}) {
  const reads: PendingRead[] = [];
  const bypassReads: PendingBypass[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const searches: string[] = [];
  const rescanFailures: ScanFailure[] = [];
  const addedListeners: ((url: string) => void)[] = [];
  const unwatch = vi.fn();
  const inspected: InspectedScripts = {
    load:
      options.load ??
      ((inline) =>
        new Promise<ScriptRead>((resolve, reject) => {
          reads.push({
            inline,
            resolve: (assets, unreadable = 0) => {
              resolve({ assets, unreadable });
            },
            reject
          });
        })),
    readPageOrigin: () =>
      Promise.resolve(options.origin === undefined ? 'https://x.test' : options.origin),
    watchAddedScripts: (onAdded) => {
      addedListeners.push(onAdded);
      return unwatch;
    },
    readBypassedPage: () =>
      new Promise<BypassedPageRead | null>((resolve) => {
        bypassReads.push({ resolve });
      })
  };
  const [delayJs, setDelayJs] = createSignal(options.delayJs ?? false);
  const [allLoaded, setAllLoaded] = createSignal(options.allLoaded ?? false);
  const [words, setWords] = createSignal<readonly string[]>(options.words ?? []);
  const [inline] = createSignal<readonly InlineScriptSource[]>([{ content: 'gamma = 2;' }]);
  const [pageKey, setPageKey] = createSignal(1);
  let store!: UndefinedReferencesStore;
  let dispose!: () => void;
  createRoot((disposeRoot) => {
    dispose = disposeRoot;
    store = createUndefinedReferencesStore(
      {
        delayJsPresent: delayJs,
        allScriptsLoaded: allLoaded,
        words,
        inlineScripts: inline,
        pageKey
      },
      {
        inspected: options.unsupported ? null : inspected,
        schedule: (run, ms) => {
          const timer = { run, ms, cancelled: false };
          timers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
        yieldToMain: () => Promise.resolve(),
        onWordSearch: (word) => searches.push(word),
        onRescanFailed: (failure) => rescanFailures.push(failure)
      }
    );
  });
  /** Land a refetch: new key and data in one write, as the shell does. */
  const refetch = (key: number, nextWords?: readonly string[]): void => {
    batch(() => {
      setPageKey(key);
      if (nextWords) setWords(nextWords);
    });
  };
  return {
    store,
    dispose,
    reads,
    bypassReads,
    timers,
    searches,
    rescanFailures,
    addedListeners,
    unwatch,
    setDelayJs,
    setAllLoaded,
    setWords,
    refetch
  };
}

describe('the read gate (state trigger conditions)', () => {
  it('makes no read while there is nothing to search, then reads on the first word', () => {
    const h = harness();
    expect(h.reads).toHaveLength(0);
    expect(h.store.view()).toEqual({ kind: 'empty', monitoring: true });
    h.setWords(['alpha']);
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0]?.inline).toEqual([{ content: 'gamma = 2;' }]);
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.dispose();
  });

  it('waits for interaction while Delay JS holds the scripts, then reads', () => {
    const h = harness({ delayJs: true, words: ['alpha'] });
    expect(h.reads).toHaveLength(0);
    expect(h.store.view()).toEqual({ kind: 'waiting-interaction' });
    h.setAllLoaded(true);
    expect(h.reads).toHaveLength(1);
    h.dispose();
  });

  it('shows empty without monitoring once Delay JS reported its scripts loaded', () => {
    const h = harness({ delayJs: true, allLoaded: true });
    expect(h.store.view()).toEqual({ kind: 'empty', monitoring: false });
    h.dispose();
  });

  it('renders results the moment the read settles; answers stream in as searched', async () => {
    const h = harness({ words: ['alpha', 'gamma', 'nope'] });
    h.reads[0]?.resolve(ASSETS);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    await flush();
    expect(h.store.answerOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
    expect(h.store.answerOf('gamma')).toEqual([{ kind: 'inline' }]);
    expect(h.store.answerOf('nope')).toEqual([]);
    // Nothing waits on a timer: the only one armed is the read timeout, now cancelled.
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.cancelled).toBe(true);
    h.dispose();
  });

  it('answers pending for a word the search has not reached', async () => {
    let release: (() => void) | undefined;
    const reads: ((assets: ScriptAsset[]) => void)[] = [];
    const [words] = createSignal<readonly string[]>(['alpha', 'beta']);
    let store!: UndefinedReferencesStore;
    const dispose = createRoot((d) => {
      store = createUndefinedReferencesStore(
        {
          delayJsPresent: () => false,
          allScriptsLoaded: () => false,
          words,
          inlineScripts: () => [],
          pageKey: () => 1
        },
        {
          inspected: {
            load: () =>
              new Promise((resolve) =>
                reads.push((assets) => {
                  resolve({ assets, unreadable: 0 });
                })
              ),
            readPageOrigin: () => Promise.resolve(null),
            watchAddedScripts: () => () => undefined,
            readBypassedPage: () => Promise.resolve(null)
          },
          // Every checkpoint yields and holds until released.
          now: (() => {
            let t = 0;
            return () => (t += 100);
          })(),
          yieldToMain: () =>
            new Promise<void>((resolve) => {
              release = resolve;
            })
        }
      );
      return d;
    });
    reads[0]?.(ASSETS);
    await flush();
    expect(store.answerOf('alpha')).toBe('pending');
    expect(store.answerOf('beta')).toBe('pending');
    // Each release lets one slice of work through: alpha is two sources away.
    release?.();
    await flush();
    expect(store.answerOf('alpha')).toBe('pending');
    release?.();
    await flush();
    expect(store.answerOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
    expect(store.answerOf('beta')).toBe('pending');
    dispose();
  });
});

describe('incremental search', () => {
  it('a push adding one word searches that word only', async () => {
    const h = harness({ words: ['alpha', 'beta'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.searches).toEqual(['alpha', 'beta']);
    h.setWords(['alpha', 'beta', 'gamma']);
    await flush();
    expect(h.searches).toEqual(['alpha', 'beta', 'gamma']);
    expect(h.store.answerOf('gamma')).toEqual([{ kind: 'inline' }]);
    h.dispose();
  });

  it('dedupes repeated words from a payload', () => {
    const h = harness({ words: ['a', 'b', 'a'] });
    expect(h.store.words()).toEqual(['a', 'b']);
    h.dispose();
  });
});

describe('data refreshes', () => {
  it('reads again in place: results and answer objects stay until the new answers land', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    const shown = h.store.answerOf('alpha');
    h.refetch(2, ['alpha']);
    expect(h.reads).toHaveLength(2);
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    expect(h.store.answerOf('alpha')).toBe(shown);
    h.reads[1]?.resolve([...ASSETS]);
    await flush();
    // Same answer → the very same array (rows stay mounted).
    expect(h.store.answerOf('alpha')).toBe(shown);
    expect(h.searches).toEqual(['alpha', 'alpha']);
    h.dispose();
  });

  it('swaps a changed answer in place once searched', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.refetch(2);
    h.reads[1]?.resolve([{ origin: { kind: 'url', url: URL_B }, content: 'var alpha;' }]);
    await flush();
    expect(h.store.answerOf('alpha')).toEqual([{ kind: 'url', url: URL_B }]);
    h.dispose();
  });

  it('reports a failed refresh read instead of keeping the old page’s answers', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.refetch(2);
    h.reads[1]?.reject(new Error('boom'));
    await flush();
    expect(h.store.view()).toEqual({ kind: 'failed', failure: 'list-failed' });
    expect(h.store.answerOf('alpha')).toBeNull();
    expect(h.rescanFailures).toEqual([]);
    h.dispose();
  });

  it('drops the read when the refetched data has nothing to search', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.refetch(2, []);
    expect(h.reads).toHaveLength(1);
    expect(h.store.view()).toEqual({ kind: 'empty', monitoring: true });
    h.setWords(['beta']);
    expect(h.reads).toHaveLength(2);
    h.dispose();
  });

  it('ignores a read that settles after a newer one started', async () => {
    const h = harness({ words: ['alpha'] });
    h.refetch(2);
    expect(h.reads).toHaveLength(2);
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.reads[1]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    h.dispose();
  });
});

describe('failures, retry and rescan', () => {
  it('fails after the read timeout, ignores the late answer, and retries', async () => {
    const h = harness({ words: ['alpha'] });
    expect(h.timers[0]?.ms).toBe(SCAN_TIMEOUT_MS);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.timers[0]?.run();
    expect(h.store.view()).toEqual({ kind: 'failed', failure: 'timed-out' });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'failed', failure: 'timed-out' });
    h.store.retry();
    expect(h.reads).toHaveLength(2);
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.reads[1]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    vi.restoreAllMocks();
    h.dispose();
  });

  it('classifies rejections (extension reload vs listing failure) and a sync throw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.reject(new Error('Extension context invalidated.'));
    await flush();
    expect(h.store.view()).toEqual({ kind: 'failed', failure: 'context-invalidated' });
    h.store.retry();
    h.reads[1]?.reject('nope');
    await flush();
    expect(h.store.view()).toEqual({ kind: 'failed', failure: 'list-failed' });
    h.dispose();
    const throwing = harness({
      words: ['alpha'],
      load: () => {
        throw new Error('sync');
      }
    });
    await flush();
    expect(throwing.store.view()).toEqual({ kind: 'failed', failure: 'list-failed' });
    throwing.dispose();
    vi.restoreAllMocks();
  });

  it('rescans with the results kept, counts the completed rescan', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.rescansDone()).toBe(0);
    h.store.rescan();
    expect(h.reads).toHaveLength(2);
    expect(h.store.rescanning()).toBe(true);
    expect(h.store.answerOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
    h.store.rescan();
    expect(h.reads).toHaveLength(2);
    h.reads[1]?.resolve([{ origin: { kind: 'url', url: URL_B }, content: 'var alpha;' }]);
    await flush();
    expect(h.store.rescanning()).toBe(false);
    expect(h.store.rescansDone()).toBe(1);
    expect(h.store.answerOf('alpha')).toEqual([{ kind: 'url', url: URL_B }]);
    h.dispose();
  });

  it('a failed rescan keeps the previous results and reports it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.store.rescan();
    h.reads[1]?.reject(new Error('boom'));
    await flush();
    expect(h.rescanFailures).toEqual(['list-failed']);
    expect(h.store.rescanning()).toBe(false);
    expect(h.store.rescansDone()).toBe(0);
    expect(h.store.answerOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
    vi.restoreAllMocks();
    h.dispose();
  });

  it('retry and rescan are no-ops outside their states', () => {
    const h = harness({ delayJs: true, words: ['alpha'] });
    h.store.retry();
    h.store.rescan();
    expect(h.reads).toHaveLength(0);
    h.setAllLoaded(true);
    h.store.retry();
    h.store.rescan();
    expect(h.reads).toHaveLength(1);
    h.dispose();
  });
});

describe('page origin and stale scripts', () => {
  it('learns the page origin with the read; an origin from an older fetch is dropped', async () => {
    const h = harness({ words: ['alpha'] });
    expect(h.store.pageOrigin()).toBeNull();
    await flush();
    expect(h.store.pageOrigin()).toBe('https://x.test');
    h.dispose();
    let answer: ((origin: string | null) => void) | undefined;
    const [words] = createSignal<readonly string[]>(['alpha']);
    const [key, setKey] = createSignal(1);
    let store!: UndefinedReferencesStore;
    const dispose = createRoot((d) => {
      store = createUndefinedReferencesStore(
        {
          delayJsPresent: () => false,
          allScriptsLoaded: () => false,
          words,
          inlineScripts: () => [],
          pageKey: key
        },
        {
          inspected: {
            load: () => new Promise(() => undefined),
            readPageOrigin: () =>
              new Promise((resolve) => {
                answer = resolve;
              }),
            watchAddedScripts: () => () => undefined,
            readBypassedPage: () => Promise.resolve(null)
          }
        }
      );
      return d;
    });
    const first = answer;
    setKey(2);
    first?.('https://old.test');
    await flush();
    expect(store.pageOrigin()).toBeNull();
    dispose();
  });

  it('marks the read stale when the page loads a script it did not see', async () => {
    const h = harness({ words: ['alpha'] });
    const notify = (url: string): void => {
      for (const listener of h.addedListeners) listener(url);
    };
    notify('https://x.test/early.js');
    expect(h.store.staleScripts()).toBe(false);
    h.reads[0]?.resolve(ASSETS);
    await flush();
    notify(URL_A);
    expect(h.store.staleScripts()).toBe(false);
    notify('https://x.test/late.js');
    expect(h.store.staleScripts()).toBe(true);
    h.store.rescan();
    h.reads[1]?.resolve(ASSETS);
    await flush();
    expect(h.store.staleScripts()).toBe(false);
    notify('https://x.test/later.js');
    h.refetch(2);
    expect(h.store.staleScripts()).toBe(false);
    h.dispose();
    expect(h.unwatch).toHaveBeenCalledOnce();
  });
});

describe('unreadable scripts', () => {
  it('reports how many scripts the last read skipped', async () => {
    const h = harness({ words: ['alpha'] });
    expect(h.store.unreadableScripts()).toBe(0);
    h.reads[0]?.resolve(ASSETS, 2);
    await flush();
    expect(h.store.unreadableScripts()).toBe(2);
    h.store.rescan();
    // Kept while the rescan runs, replaced by its own count.
    expect(h.store.unreadableScripts()).toBe(2);
    h.reads[1]?.resolve(ASSETS, 0);
    await flush();
    expect(h.store.unreadableScripts()).toBe(0);
    h.dispose();
  });
});

describe('feature absent', () => {
  it('lists the words unsearched when the browser cannot read scripts', () => {
    const h = harness({ unsupported: true, words: ['alpha'] });
    expect(h.store.view()).toEqual({ kind: 'results', searched: false });
    expect(h.store.answerOf('alpha')).toBeNull();
    h.store.rescan();
    h.store.retry();
    h.refetch(2);
    expect(h.store.view()).toEqual({ kind: 'results', searched: false });
    h.dispose();
  });
});

describe('new-words announcement', () => {
  it('treats mount-time words as the baseline and announces later arrivals once', () => {
    const h = harness({ words: ['a'] });
    expect(h.store.announcement()).toEqual({ text: '', seq: 0 });
    h.setWords(['a', 'b', 'c']);
    expect(h.store.announcement()).toEqual({ text: '2 new undefined references', seq: 1 });
    h.setWords(['a', 'b', 'c']);
    expect(h.store.announcement().seq).toBe(1);
    h.setWords(['a', 'b', 'c', 'd']);
    expect(h.store.announcement()).toEqual({ text: '1 new undefined reference', seq: 2 });
    h.setWords(['a', 'b', 'c', 'd', 'e']);
    // Same sentence again, but a new message (seq) so it is re-announced.
    expect(h.store.announcement()).toEqual({ text: '1 new undefined reference', seq: 3 });
    h.dispose();
  });

  it('re-baselines on a refetch instead of announcing its words', () => {
    const h = harness({ words: ['a'] });
    h.refetch(2, ['x', 'y']);
    expect(h.store.announcement().seq).toBe(0);
    h.setWords(['x', 'y', 'z']);
    expect(h.store.announcement()).toEqual({ text: '1 new undefined reference', seq: 1 });
    h.dispose();
  });

  it('stays silent about words the waiting view hides', () => {
    const h = harness({ delayJs: true, words: [] });
    h.setWords(['hidden']);
    h.setAllLoaded(true);
    expect(h.store.announcement().seq).toBe(0);
    h.setWords(['hidden', 'seen']);
    expect(h.store.announcement()).toEqual({ text: '1 new undefined reference', seq: 1 });
    h.dispose();
  });
});

describe('page-owned state', () => {
  it('a disposal cancels the timeout, the watch and drops a late settle', async () => {
    const h = harness({ words: ['alpha'] });
    h.dispose();
    expect(h.timers[0]?.cancelled).toBe(true);
    expect(h.unwatch).toHaveBeenCalledOnce();
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'processing' });
    expect(h.searches).toEqual([]);
  });

  it('a re-mount starts clean — nothing leaks from the previous store', async () => {
    const first = harness({ words: ['alpha'] });
    first.reads[0]?.resolve(ASSETS);
    await flush();
    first.setWords(['alpha', 'beta']);
    first.dispose();
    const second = harness({ words: ['alpha'] });
    expect(second.reads).toHaveLength(1);
    expect(second.store.view()).toEqual({ kind: 'processing' });
    expect(second.store.answerOf('alpha')).toBeNull();
    expect(second.store.announcement()).toEqual({ text: '', seq: 0 });
    second.reads[0]?.resolve(ASSETS);
    await flush();
    // A fresh search: the word is searched again, not served from the old store.
    expect(second.searches).toEqual(['alpha']);
    second.dispose();
  });
});

describe('the original-host bypass map', () => {
  const MIRROR_URL =
    'https://wp-rocket.me/wp-content/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=1791299187';
  const BYPASSED_HTML =
    '<script src="https://static.klaviyo.com/onsite/js/PD7as8/klaviyo.js?ver=3.7.3"></script>';

  it('runs one pass when a row needs it, resolves the verdict, runs no more', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve([{ origin: { kind: 'url', url: MIRROR_URL }, content: 'var alpha = 1;' }]);
    await flush();
    expect(h.bypassReads).toHaveLength(1);
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({ kind: 'pending' });
    // The pass's timeout is armed beside the read's own.
    expect(h.timers.some((timer) => timer.ms === BYPASS_TIMEOUT_MS && !timer.cancelled)).toBe(true);
    h.bypassReads[0]?.resolve({
      url: 'https://wp-rocket.me/?fdt-delay=1&nowprocket=1',
      html: BYPASSED_HTML
    });
    await flush();
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({
      kind: 'resolved',
      origin: 'https://static.klaviyo.com'
    });
    // A path the bypassed page does not carry: no unique host to vouch for.
    expect(h.store.originalHostOf('bootstrap/v5/x.js')).toEqual({ kind: 'unresolved' });
    // Settled, the pass never runs again for this page.
    expect(h.bypassReads).toHaveLength(1);
    expect(h.timers.every((timer) => timer.cancelled || timer.ms !== BYPASS_TIMEOUT_MS)).toBe(true);
    expect(h.store.bypassDegraded()).toBe(false);
  });

  it('does not run when no answered row hides its host', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.bypassReads).toHaveLength(0);
    expect(h.store.bypassDegraded()).toBe(false);
  });

  it('a refetch retries the pass (one pass per page, not per store)', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve([{ origin: { kind: 'url', url: MIRROR_URL }, content: 'var alpha = 1;' }]);
    await flush();
    h.bypassReads[0]?.resolve(null);
    await flush();
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({ kind: 'unresolved' });
    expect(h.store.bypassDegraded()).toBe(true);
    // The refetch resets the lane and a new pass runs for the new page.
    h.refetch(2, ['alpha']);
    await flush();
    expect(h.bypassReads).toHaveLength(2);
    h.reads[1]?.resolve([{ origin: { kind: 'url', url: MIRROR_URL }, content: 'var alpha = 1;' }]);
    await flush();
    h.bypassReads[1]?.resolve({ url: 'https://wp-rocket.me/?nowprocket=1', html: BYPASSED_HTML });
    await flush();
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({
      kind: 'resolved',
      origin: 'https://static.klaviyo.com'
    });
    expect(h.store.bypassDegraded()).toBe(false);
  });

  it('a rescan retries a failed pass through the same flow', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve([{ origin: { kind: 'url', url: MIRROR_URL }, content: 'var alpha = 1;' }]);
    await flush();
    h.bypassReads[0]?.resolve(null);
    await flush();
    expect(h.store.bypassDegraded()).toBe(true);
    h.store.rescan();
    await flush();
    expect(h.bypassReads).toHaveLength(2);
  });

  it('a timeout degrades the lane; a late answer lands nowhere', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve([{ origin: { kind: 'url', url: MIRROR_URL }, content: 'var alpha = 1;' }]);
    await flush();
    const bypassTimer = h.timers.find((timer) => timer.ms === BYPASS_TIMEOUT_MS);
    if (!bypassTimer) throw new Error('no bypass timer armed');
    bypassTimer.run();
    await flush();
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({ kind: 'unresolved' });
    expect(h.store.bypassDegraded()).toBe(true);
    // The late read answers into a stale ticket: the state holds.
    h.bypassReads[0]?.resolve({ url: 'https://wp-rocket.me/?nowprocket=1', html: BYPASSED_HTML });
    await flush();
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({ kind: 'unresolved' });
  });

  it('an ambiguous page answer resolves nothing (never guessed)', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve([{ origin: { kind: 'url', url: MIRROR_URL }, content: 'var alpha = 1;' }]);
    await flush();
    h.bypassReads[0]?.resolve({
      url: 'https://wp-rocket.me/?nowprocket=1',
      html:
        '<script src="https://a.test/onsite/js/PD7as8/klaviyo.js"></script>' +
        '<script src="https://b.test/onsite/js/PD7as8/klaviyo.js"></script>'
    });
    await flush();
    expect(h.store.originalHostOf('onsite/js/PD7as8/klaviyo.js')).toEqual({ kind: 'unresolved' });
    expect(h.store.bypassDegraded()).toBe(false);
  });
});
