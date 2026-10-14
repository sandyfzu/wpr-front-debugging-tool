/**
 * The page store: the scan gate (the three states' trigger conditions), the
 * refresh wiring driving the incremental definition memo, page resets, stale
 * and late settles, the timeout, retry/rescan, the new-words announcement and
 * per-mount isolation (no module state survives a disposal).
 */
import { batch, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  refreshDefinitions,
  type DefinitionsRefresh,
  type InlineScriptSource,
  type ScriptAsset
} from '../../../../lib/panel/undefined-refs';
import type { ScriptLoader } from './inspected-scripts';
import type { ScanFailure } from './model';
import {
  SCAN_TIMEOUT_MS,
  createUndefinedReferencesStore,
  type UndefinedReferencesStore
} from './store';

/** One controllable loader call. */
interface PendingRead {
  readonly inline: readonly InlineScriptSource[];
  resolve(assets: ScriptAsset[]): void;
  reject(cause: unknown): void;
}

const URL_A = 'https://x.test/a.js';
const URL_B = 'https://x.test/b.js';
const ASSETS: ScriptAsset[] = [
  { origin: { kind: 'url', url: URL_A }, content: 'var alpha = 1;\nfunction beta() {}' },
  { origin: { kind: 'inline' }, content: 'gamma = 2;' }
];

/** Let promise reactions (the loader's settle) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

interface HarnessOptions {
  delayJs?: boolean;
  allLoaded?: boolean;
  words?: string[];
  unsupported?: boolean;
  loader?: ScriptLoader;
}

/** A store over controllable signals, a scripted loader and a manual timer. */
function harness(options: HarnessOptions = {}) {
  const reads: PendingRead[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const refreshes: DefinitionsRefresh[] = [];
  const rescanFailures: ScanFailure[] = [];
  const loader: ScriptLoader =
    options.loader ??
    vi.fn(
      (inline: readonly InlineScriptSource[]) =>
        new Promise<ScriptAsset[]>((resolve, reject) => {
          reads.push({ inline, resolve, reject });
        })
    );
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
        loadScripts: options.unsupported ? null : loader,
        refresh: (prior, list, assets) => {
          const result = refreshDefinitions(prior, list, assets);
          refreshes.push(result);
          return result;
        },
        schedule: (run, ms) => {
          const timer = { run, ms, cancelled: false };
          timers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
        onRescanFailed: (failure) => rescanFailures.push(failure)
      }
    );
  });
  return {
    store,
    dispose,
    reads,
    timers,
    refreshes,
    rescanFailures,
    loader,
    setDelayJs,
    setAllLoaded,
    setWords,
    setPageKey
  };
}

describe('the scan gate (state trigger conditions)', () => {
  it('scans at once without Delay JS, handing the inline sources to the loader', () => {
    const h = harness({ words: ['alpha'] });
    expect(h.reads).toHaveLength(1);
    expect(h.reads[0]?.inline).toEqual([{ content: 'gamma = 2;' }]);
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.dispose();
  });

  it('waits for interaction while Delay JS holds the scripts, then scans', () => {
    const h = harness({ delayJs: true, words: ['alpha'] });
    expect(h.reads).toHaveLength(0);
    expect(h.store.view()).toEqual({ kind: 'waiting-interaction' });
    h.setAllLoaded(true);
    expect(h.reads).toHaveLength(1);
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.dispose();
  });

  it('shows empty (monitoring until Delay JS reports loaded) with no words — no scan wait', () => {
    const h = harness();
    expect(h.store.view()).toEqual({ kind: 'empty', monitoring: true });
    const d = harness({ delayJs: true, allLoaded: true });
    expect(d.store.view()).toEqual({ kind: 'empty', monitoring: false });
    h.dispose();
    d.dispose();
  });

  it('renders results the moment the read settles — no artificial delay', async () => {
    const h = harness({ words: ['alpha', 'gamma', 'nope'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    expect(h.store.definitionsOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
    expect(h.store.definitionsOf('gamma')).toEqual([{ kind: 'inline' }]);
    expect(h.store.definitionsOf('nope')).toEqual([]);
    // Nothing waits on a timer: the only one armed is the read timeout, now cancelled.
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.cancelled).toBe(true);
    h.dispose();
  });
});

describe('incremental refresh wiring', () => {
  it('a push adding one word searches that word only (memo hits for the rest)', async () => {
    const h = harness({ words: ['alpha', 'beta'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.refreshes.at(-1)?.recomputed).toEqual(['alpha', 'beta']);
    h.setWords(['alpha', 'beta', 'gamma']);
    expect(h.refreshes.at(-1)?.recomputed).toEqual(['gamma']);
    expect(h.refreshes.at(-1)?.memoHits).toEqual(['alpha', 'beta']);
    expect(h.store.words()).toEqual(['alpha', 'beta', 'gamma']);
    expect(h.store.definitionsOf('gamma')).toEqual([{ kind: 'inline' }]);
    h.dispose();
  });

  it('a new page resets the scan and starts a fresh memo over its own assets', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.setPageKey(2);
    expect(h.reads).toHaveLength(2);
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.reads[1]?.resolve([{ origin: { kind: 'url', url: URL_B }, content: 'var alpha;' }]);
    await flush();
    expect(h.refreshes.at(-1)?.recomputed).toEqual(['alpha']);
    expect(h.store.definitionsOf('alpha')).toEqual([{ kind: 'url', url: URL_B }]);
    h.dispose();
  });

  it('ignores a read that settles after a newer one started', async () => {
    const h = harness({ words: ['alpha'] });
    h.setPageKey(2);
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.reads[0]?.reject(new Error('late'));
    await flush();
    expect(h.store.view()).toEqual({ kind: 'processing' });
    h.reads[1]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    h.dispose();
  });

  it('dedupes repeated words from a payload', () => {
    const h = harness({ words: ['a', 'b', 'a'] });
    expect(h.store.words()).toEqual(['a', 'b']);
    h.dispose();
  });
});

describe('failures, retry and rescan', () => {
  it('fails after the read timeout, ignores the late answer, and retries', async () => {
    const h = harness({ words: ['alpha'] });
    expect(h.timers[0]?.ms).toBe(SCAN_TIMEOUT_MS);
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
    h.dispose();
  });

  it('classifies rejections (extension reload vs listing failure) and a sync throw', async () => {
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
      loader: () => {
        throw new Error('sync');
      }
    });
    await flush();
    expect(throwing.store.view()).toEqual({ kind: 'failed', failure: 'list-failed' });
    throwing.dispose();
  });

  it('rescans with the results kept on screen, then answers from the new read', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.store.rescan();
    expect(h.reads).toHaveLength(2);
    expect(h.store.rescanning()).toBe(true);
    expect(h.store.view()).toEqual({ kind: 'results', searched: true });
    expect(h.store.definitionsOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
    // A second click while busy starts nothing.
    h.store.rescan();
    expect(h.reads).toHaveLength(2);
    h.reads[1]?.resolve([{ origin: { kind: 'url', url: URL_B }, content: 'var alpha;' }]);
    await flush();
    expect(h.store.rescanning()).toBe(false);
    expect(h.store.definitionsOf('alpha')).toEqual([{ kind: 'url', url: URL_B }]);
    h.dispose();
  });

  it('a failed rescan keeps the previous results and reports it', async () => {
    const h = harness({ words: ['alpha'] });
    h.reads[0]?.resolve(ASSETS);
    await flush();
    h.store.rescan();
    h.reads[1]?.reject(new Error('boom'));
    await flush();
    expect(h.rescanFailures).toEqual(['list-failed']);
    expect(h.store.rescanning()).toBe(false);
    expect(h.store.definitionsOf('alpha')).toEqual([{ kind: 'url', url: URL_A }]);
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

describe('feature absent', () => {
  it('lists the words unsearched when the browser cannot read scripts', () => {
    const h = harness({ unsupported: true, words: ['alpha'] });
    expect(h.store.view()).toEqual({ kind: 'results', searched: false });
    expect(h.store.definitionsOf('alpha')).toBeNull();
    h.store.rescan();
    h.store.retry();
    h.setPageKey(2);
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

  it('re-baselines on a new page instead of announcing its words', () => {
    const h = harness({ words: ['a'] });
    // The shell lands a new page's data in one state write: key + words together.
    batch(() => {
      h.setPageKey(2);
      h.setWords(['x', 'y']);
    });
    expect(h.store.announcement().seq).toBe(0);
    h.setWords(['x', 'y', 'z']);
    expect(h.store.announcement()).toEqual({ text: '1 new undefined reference', seq: 1 });
    h.dispose();
  });
});

describe('page-owned state', () => {
  it('a disposal cancels the timeout and drops a late settle', async () => {
    const h = harness({ words: ['alpha'] });
    h.dispose();
    expect(h.timers[0]?.cancelled).toBe(true);
    h.reads[0]?.resolve(ASSETS);
    await flush();
    expect(h.store.view()).toEqual({ kind: 'processing' });
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
    expect(second.store.definitionsOf('alpha')).toBeNull();
    expect(second.store.announcement()).toEqual({ text: '', seq: 0 });
    second.reads[0]?.resolve(ASSETS);
    await flush();
    // A fresh memo: the word is searched again, not served from the old store.
    expect(second.refreshes.at(-1)?.recomputed).toEqual(['alpha']);
    second.dispose();
  });
});
