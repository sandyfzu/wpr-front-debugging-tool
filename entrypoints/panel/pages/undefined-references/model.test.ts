/**
 * The page's pure model: the scan transition table (every state × event),
 * the view resolver's trigger matrix, verdicts, copy builders and the URL
 * split.
 */
import { describe, expect, it } from 'vitest';
import type { ScriptAsset, ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import {
  SCAN_IDLE,
  SCAN_UNSUPPORTED,
  arrivedWords,
  classifyScanError,
  displayWord,
  isCrossOriginSentinel,
  newReferencesAnnouncement,
  resolvePageView,
  scanFailureMessage,
  searchableAssets,
  splitScriptUrl,
  summarizeResults,
  transitionScan,
  uniqueWords,
  verdictText,
  wordVerdict,
  type ScanEvent,
  type ScanState
} from './model';

const ASSETS: readonly ScriptAsset[] = [{ origin: { kind: 'inline' }, content: 'var a = 1;' }];
const OTHER: readonly ScriptAsset[] = [
  { origin: { kind: 'url', url: 'https://x.test/a.js' }, content: 'var b;' }
];

const START: ScanEvent = { type: 'start' };
const SETTLE: ScanEvent = { type: 'settled', assets: OTHER };
const FAIL: ScanEvent = { type: 'failed', failure: 'list-failed' };
const RESET: ScanEvent = { type: 'reset' };

const scanning = (previous: readonly ScriptAsset[] | null): ScanState => ({
  kind: 'scanning',
  previous
});
const scanned: ScanState = { kind: 'scanned', assets: ASSETS };
const failed: ScanState = { kind: 'failed', failure: 'timed-out' };

describe('transitionScan', () => {
  it('starts a first scan from idle and a fresh scan from failed', () => {
    expect(transitionScan(SCAN_IDLE, START)).toEqual(scanning(null));
    expect(transitionScan(failed, START)).toEqual(scanning(null));
  });

  it('turns a start on scanned into a rescan that keeps the assets', () => {
    const next = transitionScan(scanned, START);
    expect(next).toEqual(scanning(ASSETS));
    expect(next.kind === 'scanning' && next.previous).toBe(ASSETS);
  });

  it('ignores a start while scanning (dedupe) and when unsupported', () => {
    const flying = scanning(null);
    expect(transitionScan(flying, START)).toBe(flying);
    expect(transitionScan(SCAN_UNSUPPORTED, START)).toBe(SCAN_UNSUPPORTED);
  });

  it('settles only a scan in flight', () => {
    expect(transitionScan(scanning(null), SETTLE)).toEqual({ kind: 'scanned', assets: OTHER });
    expect(transitionScan(scanning(ASSETS), SETTLE)).toEqual({ kind: 'scanned', assets: OTHER });
    for (const state of [SCAN_IDLE, scanned, failed, SCAN_UNSUPPORTED]) {
      expect(transitionScan(state, SETTLE)).toBe(state);
    }
  });

  it('fails a first scan, but a failed rescan falls back to the kept assets', () => {
    expect(transitionScan(scanning(null), FAIL)).toEqual({
      kind: 'failed',
      failure: 'list-failed'
    });
    expect(transitionScan(scanning(ASSETS), FAIL)).toEqual({ kind: 'scanned', assets: ASSETS });
    for (const state of [SCAN_IDLE, scanned, failed, SCAN_UNSUPPORTED]) {
      expect(transitionScan(state, FAIL)).toBe(state);
    }
  });

  it('resets every state but unsupported (terminal) and idle (already there)', () => {
    for (const state of [scanning(null), scanning(ASSETS), scanned, failed]) {
      expect(transitionScan(state, RESET)).toBe(SCAN_IDLE);
    }
    expect(transitionScan(SCAN_IDLE, RESET)).toBe(SCAN_IDLE);
    expect(transitionScan(SCAN_UNSUPPORTED, RESET)).toBe(SCAN_UNSUPPORTED);
  });
});

describe('searchableAssets', () => {
  it('answers from scanned assets or the kept ones during a rescan, else null', () => {
    expect(searchableAssets(scanned)).toBe(ASSETS);
    expect(searchableAssets(scanning(ASSETS))).toBe(ASSETS);
    expect(searchableAssets(scanning(null))).toBeNull();
    expect(searchableAssets(SCAN_IDLE)).toBeNull();
    expect(searchableAssets(failed)).toBeNull();
    expect(searchableAssets(SCAN_UNSUPPORTED)).toBeNull();
  });
});

describe('resolvePageView', () => {
  const base = { delayJsPresent: false, allScriptsLoaded: false, wordCount: 2, scan: scanned };

  it('waits for interaction while Delay JS holds the scripts — whatever else is known', () => {
    for (const scan of [SCAN_IDLE, scanned, failed, SCAN_UNSUPPORTED]) {
      for (const wordCount of [0, 3]) {
        expect(resolvePageView({ ...base, delayJsPresent: true, wordCount, scan })).toEqual({
          kind: 'waiting-interaction'
        });
      }
    }
  });

  it('shows the empty state for zero words without waiting on any scan', () => {
    for (const scan of [SCAN_IDLE, scanning(null), failed, SCAN_UNSUPPORTED, scanned]) {
      expect(resolvePageView({ ...base, wordCount: 0, scan })).toEqual({
        kind: 'empty',
        monitoring: true
      });
    }
    expect(
      resolvePageView({ ...base, delayJsPresent: true, allScriptsLoaded: true, wordCount: 0 })
    ).toEqual({ kind: 'empty', monitoring: false });
  });

  it('processes while words wait on a first scan (idle before the gate effect, or in flight)', () => {
    expect(resolvePageView({ ...base, scan: SCAN_IDLE })).toEqual({ kind: 'processing' });
    expect(resolvePageView({ ...base, scan: scanning(null) })).toEqual({ kind: 'processing' });
    expect(
      resolvePageView({ ...base, delayJsPresent: true, allScriptsLoaded: true, scan: SCAN_IDLE })
    ).toEqual({ kind: 'processing' });
  });

  it('renders the failure, the unsearched results, and the searched results', () => {
    expect(resolvePageView({ ...base, scan: failed })).toEqual({
      kind: 'failed',
      failure: 'timed-out'
    });
    expect(resolvePageView({ ...base, scan: SCAN_UNSUPPORTED })).toEqual({
      kind: 'results',
      searched: false
    });
    expect(resolvePageView(base)).toEqual({ kind: 'results', searched: true });
    // A rescan keeps the results up.
    expect(resolvePageView({ ...base, scan: scanning(ASSETS) })).toEqual({
      kind: 'results',
      searched: true
    });
  });
});

describe('words and verdicts', () => {
  const url: ScriptOrigin = { kind: 'url', url: 'https://x.test/a.js' };

  it('recognizes the cross-origin sentinel and displays it as the browser message', () => {
    expect(isCrossOriginSentinel(UNDEFINED_REFERENCE_EXTERNAL_ERROR)).toBe(true);
    expect(isCrossOriginSentinel('jQuery')).toBe(false);
    expect(displayWord(UNDEFINED_REFERENCE_EXTERNAL_ERROR)).toBe('Script error.');
    expect(displayWord('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  it('derives the verdict: sentinel hidden first, then unsearched, found, not found', () => {
    expect(wordVerdict(UNDEFINED_REFERENCE_EXTERNAL_ERROR, [url])).toEqual({ kind: 'hidden' });
    expect(wordVerdict(UNDEFINED_REFERENCE_EXTERNAL_ERROR, null)).toEqual({ kind: 'hidden' });
    expect(wordVerdict('a', null)).toEqual({ kind: 'not-searched' });
    expect(wordVerdict('a', [])).toEqual({ kind: 'not-found' });
    expect(wordVerdict('a', [url, { kind: 'inline' }])).toEqual({ kind: 'found', count: 2 });
  });

  it('words every verdict as visible text, singular and plural', () => {
    expect(verdictText({ kind: 'found', count: 1 })).toBe('In 1 script');
    expect(verdictText({ kind: 'found', count: 3 })).toBe('In 3 scripts');
    expect(verdictText({ kind: 'not-found' })).toBe('No definition found');
    expect(verdictText({ kind: 'hidden' })).toBe('Details hidden');
    expect(verdictText({ kind: 'not-searched' })).toBe('Not searched');
  });

  it('announces arrivals with the right number', () => {
    expect(newReferencesAnnouncement(1)).toBe('1 new undefined reference');
    expect(newReferencesAnnouncement(4)).toBe('4 new undefined references');
  });

  it('finds arrived words in arrival order', () => {
    expect(arrivedWords(new Set(['a']), ['a', 'c', 'b'])).toEqual(['c', 'b']);
    expect(arrivedWords(new Set(['a']), ['a'])).toEqual([]);
    expect(arrivedWords(new Set(), [])).toEqual([]);
  });

  it('keeps a unique list as is and dedupes a repeated one, first occurrence first', () => {
    const unique = ['a', 'b'];
    expect(uniqueWords(unique)).toBe(unique);
    expect(uniqueWords(['b', 'a', 'b', 'a'])).toEqual(['b', 'a']);
  });

  it('summarizes in one pass: total and words with a definition', () => {
    const answers = new Map<string, readonly ScriptOrigin[]>([
      ['a', [url]],
      ['b', []],
      [UNDEFINED_REFERENCE_EXTERNAL_ERROR, [url]]
    ]);
    expect(
      summarizeResults(['a', 'b', UNDEFINED_REFERENCE_EXTERNAL_ERROR, 'c'], (word) =>
        answers.has(word) ? (answers.get(word) ?? null) : null
      )
    ).toEqual({ total: 4, withDefinition: 1 });
    expect(summarizeResults([], () => null)).toEqual({ total: 0, withDefinition: 0 });
  });
});

describe('scan failures', () => {
  it('names each failure with its remedy', () => {
    expect(scanFailureMessage('list-failed')).toBe(
      "DevTools could not list the inspected page's scripts."
    );
    expect(scanFailureMessage('timed-out')).toContain('in time');
    expect(scanFailureMessage('context-invalidated')).toContain('Close and reopen DevTools');
  });

  it('classifies an extension reload apart from any other rejection', () => {
    expect(classifyScanError(new Error('Extension context invalidated.'))).toBe(
      'context-invalidated'
    );
    expect(classifyScanError('extension context invalidated')).toBe('context-invalidated');
    expect(classifyScanError(new Error('boom'))).toBe('list-failed');
    expect(classifyScanError({ message: 'Extension context invalidated.' })).toBe('list-failed');
    expect(classifyScanError(undefined)).toBe('list-failed');
  });
});

describe('splitScriptUrl', () => {
  it('splits the file name (with its query) from host + directory', () => {
    expect(
      splitScriptUrl('https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1')
    ).toEqual({ name: 'jquery.min.js?ver=3.7.1', location: 'example.com/wp-includes/js/jquery/' });
    expect(splitScriptUrl('http://localhost:8891/a.js')).toEqual({
      name: 'a.js',
      location: 'localhost:8891/'
    });
  });

  it('keeps the whole URL as the name without a file segment or when it does not parse', () => {
    expect(splitScriptUrl('https://cdn.example.com/js/')).toEqual({
      name: 'https://cdn.example.com/js/',
      location: ''
    });
    expect(splitScriptUrl('https://cdn.example.com')).toEqual({
      name: 'https://cdn.example.com',
      location: ''
    });
    expect(splitScriptUrl('not a url')).toEqual({ name: 'not a url', location: '' });
    expect(splitScriptUrl('javascript:alert(1)')).toEqual({
      name: 'javascript:alert(1)',
      location: ''
    });
    expect(splitScriptUrl('file:///srv/a.js')).toEqual({ name: 'file:///srv/a.js', location: '' });
  });
});
