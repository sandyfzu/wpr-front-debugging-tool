/**
 * The page's pure model: the scan transition table (every state × event),
 * the view resolver's trigger matrix, verdicts, copy builders, the URL
 * display split, the exclusion pattern under both matching semantics, and
 * the answer reconciliation that keeps rows mounted.
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
  exclusionPattern,
  isCrossOriginSentinel,
  isRetryable,
  newReferencesAnnouncement,
  reconcileOrigins,
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
const REFRESH: ScanEvent = { type: 'refresh' };
const SETTLE: ScanEvent = { type: 'settled', assets: OTHER };
const FAIL: ScanEvent = { type: 'failed', failure: 'list-failed' };
const RESET: ScanEvent = { type: 'reset' };

const scanning = (previous: readonly ScriptAsset[] | null, keepOnFailure = false): ScanState => ({
  kind: 'scanning',
  previous,
  keepOnFailure
});
const scanned: ScanState = { kind: 'scanned', assets: ASSETS };
const failed: ScanState = { kind: 'failed', failure: 'timed-out' };

describe('transitionScan', () => {
  it('starts a first read from idle and a fresh read from failed', () => {
    expect(transitionScan(SCAN_IDLE, START)).toEqual(scanning(null));
    expect(transitionScan(failed, START)).toEqual(scanning(null));
  });

  it('turns a start on scanned into a rescan that keeps the assets, also on failure', () => {
    const next = transitionScan(scanned, START);
    expect(next).toEqual(scanning(ASSETS, true));
    expect(next.kind === 'scanning' && next.previous).toBe(ASSETS);
  });

  it('ignores a start while scanning (dedupe) and when unsupported', () => {
    const flying = scanning(null);
    expect(transitionScan(flying, START)).toBe(flying);
    expect(transitionScan(SCAN_UNSUPPORTED, START)).toBe(SCAN_UNSUPPORTED);
  });

  it('refreshes in place: a fresh read that keeps the assets on screen but not on failure', () => {
    expect(transitionScan(scanned, REFRESH)).toEqual(scanning(ASSETS, false));
    const rescan = scanning(ASSETS, true);
    const refreshed = transitionScan(rescan, REFRESH);
    // Always a new object, so the store restarts the read.
    expect(refreshed).not.toBe(rescan);
    expect(refreshed).toEqual(scanning(ASSETS, false));
    const first = scanning(null);
    expect(transitionScan(first, REFRESH)).not.toBe(first);
    expect(transitionScan(first, REFRESH)).toEqual(scanning(null));
    expect(transitionScan(failed, REFRESH)).toEqual(scanning(null));
    expect(transitionScan(SCAN_IDLE, REFRESH)).toEqual(scanning(null));
    expect(transitionScan(SCAN_UNSUPPORTED, REFRESH)).toBe(SCAN_UNSUPPORTED);
  });

  it('settles only a read in flight', () => {
    expect(transitionScan(scanning(null), SETTLE)).toEqual({ kind: 'scanned', assets: OTHER });
    expect(transitionScan(scanning(ASSETS, true), SETTLE)).toEqual({
      kind: 'scanned',
      assets: OTHER
    });
    for (const state of [SCAN_IDLE, scanned, failed, SCAN_UNSUPPORTED]) {
      expect(transitionScan(state, SETTLE)).toBe(state);
    }
  });

  it('falls back to the kept assets only for a user rescan', () => {
    expect(transitionScan(scanning(null), FAIL)).toEqual({
      kind: 'failed',
      failure: 'list-failed'
    });
    expect(transitionScan(scanning(ASSETS, true), FAIL)).toEqual({
      kind: 'scanned',
      assets: ASSETS
    });
    // A data refresh's failure is reported: the page may have changed.
    expect(transitionScan(scanning(ASSETS, false), FAIL)).toEqual({
      kind: 'failed',
      failure: 'list-failed'
    });
    for (const state of [SCAN_IDLE, scanned, failed, SCAN_UNSUPPORTED]) {
      expect(transitionScan(state, FAIL)).toBe(state);
    }
  });

  it('resets every state but unsupported (terminal) and idle (already there)', () => {
    for (const state of [scanning(null), scanning(ASSETS, true), scanned, failed]) {
      expect(transitionScan(state, RESET)).toBe(SCAN_IDLE);
    }
    expect(transitionScan(SCAN_IDLE, RESET)).toBe(SCAN_IDLE);
    expect(transitionScan(SCAN_UNSUPPORTED, RESET)).toBe(SCAN_UNSUPPORTED);
  });
});

describe('searchableAssets', () => {
  it('answers from scanned assets or the kept ones during a read, else null', () => {
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

  it('shows the empty state for zero words without waiting on any read', () => {
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

  it('processes while words wait on a first read', () => {
    expect(resolvePageView({ ...base, scan: SCAN_IDLE })).toEqual({ kind: 'processing' });
    expect(resolvePageView({ ...base, scan: scanning(null) })).toEqual({ kind: 'processing' });
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
    // Reads with kept assets (rescan, data refresh) keep the results up.
    expect(resolvePageView({ ...base, scan: scanning(ASSETS, true) })).toEqual({
      kind: 'results',
      searched: true
    });
    expect(resolvePageView({ ...base, scan: scanning(ASSETS, false) })).toEqual({
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

  it('derives the verdict: sentinel first, then unsearched, searching, found, not found', () => {
    expect(wordVerdict(UNDEFINED_REFERENCE_EXTERNAL_ERROR, [url])).toEqual({ kind: 'hidden' });
    expect(wordVerdict(UNDEFINED_REFERENCE_EXTERNAL_ERROR, 'pending')).toEqual({ kind: 'hidden' });
    expect(wordVerdict('a', null)).toEqual({ kind: 'not-searched' });
    expect(wordVerdict('a', 'pending')).toEqual({ kind: 'searching' });
    expect(wordVerdict('a', [])).toEqual({ kind: 'not-found' });
    expect(wordVerdict('a', [url, { kind: 'inline' }])).toEqual({ kind: 'found', count: 2 });
  });

  it('words every verdict as visible text, singular and plural', () => {
    expect(verdictText({ kind: 'found', count: 1 })).toBe('In 1 script');
    expect(verdictText({ kind: 'found', count: 3 })).toBe('In 3 scripts');
    expect(verdictText({ kind: 'not-found' })).toBe('No definition found');
    expect(verdictText({ kind: 'searching' })).toBe('Searching…');
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

  it('summarizes: undefined names, found ones, and the cross-origin error apart', () => {
    const answers = new Map<string, readonly ScriptOrigin[]>([
      ['a', [url]],
      ['b', []],
      [UNDEFINED_REFERENCE_EXTERNAL_ERROR, [url]]
    ]);
    expect(
      summarizeResults(
        ['a', 'b', UNDEFINED_REFERENCE_EXTERNAL_ERROR, 'c'],
        (word) => answers.get(word) ?? 'pending'
      )
    ).toEqual({ undefinedNames: 3, withDefinition: 1, crossOriginError: true });
    expect(summarizeResults([], () => null)).toEqual({
      undefinedNames: 0,
      withDefinition: 0,
      crossOriginError: false
    });
  });
});

describe('scan failures', () => {
  it('names each failure with its remedy', () => {
    expect(scanFailureMessage('list-failed')).toBe(
      "DevTools could not list the inspected page's scripts."
    );
    expect(scanFailureMessage('timed-out')).toBe(
      "DevTools did not return the inspected page's scripts in time."
    );
    expect(scanFailureMessage('context-invalidated')).toBe(
      'The extension was reloaded, so this panel lost its connection. Close and reopen DevTools to reconnect.'
    );
  });

  it('offers Retry except after an extension reload', () => {
    expect(isRetryable('list-failed')).toBe(true);
    expect(isRetryable('timed-out')).toBe(true);
    expect(isRetryable('context-invalidated')).toBe(false);
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
  const PAGE = 'https://example.com';

  it('splits file, query and location, dropping the page’s own host', () => {
    expect(
      splitScriptUrl('https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1', PAGE)
    ).toEqual({ file: 'jquery.min.js', query: '?ver=3.7.1', location: '/wp-includes/js/jquery/' });
  });

  it('keeps the host for another origin, or when the page origin is unknown', () => {
    expect(splitScriptUrl('https://cdn.example.com/js/a.js', PAGE)).toEqual({
      file: 'a.js',
      query: '',
      location: 'cdn.example.com/js/'
    });
    expect(splitScriptUrl('http://localhost:8891/a.js', null)).toEqual({
      file: 'a.js',
      query: '',
      location: 'localhost:8891/'
    });
    // Same host, other scheme: another origin.
    expect(splitScriptUrl('http://example.com/a.js', PAGE).location).toBe('example.com/');
  });

  it('keeps the whole URL as the file without a file segment, a parse, or http(s)', () => {
    for (const url of [
      'https://cdn.example.com/js/',
      'https://cdn.example.com',
      'not a url',
      'javascript:alert(1)',
      'file:///srv/a.js'
    ]) {
      expect(splitScriptUrl(url, PAGE)).toEqual({ file: url, query: '', location: '' });
    }
  });
});

/**
 * WP Rocket's matching of one exclusion against a script tag: it escapes
 * `+`, `?ver` and `#`, then runs `preg_match("#{$pattern}#i", $tag)`. The
 * JS equivalent of that PCRE pattern (no PCRE-only syntax is involved; the
 * escaped `\#` is a literal in both) is a case-insensitive RegExp.
 */
function wpRocketMatches(pattern: string, tag: string): boolean {
  const escaped = pattern
    .replaceAll('+', '\\+')
    .replaceAll('?ver', '\\?ver')
    .replaceAll('#', '\\#');
  return new RegExp(escaped, 'i').test(tag);
}

/** A plain `new RegExp(pattern)` test (how an exclusion builder previews one). */
function regexpMatches(pattern: string, tag: string): boolean {
  return new RegExp(pattern).test(tag);
}

describe('exclusionPattern', () => {
  const PAGE = 'https://shop.example.com';

  it('is the path for a same-origin script — no scheme, no query', () => {
    expect(
      exclusionPattern(
        'https://shop.example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1',
        PAGE
      )
    ).toBe('/wp-includes/js/jquery/jquery.min.js');
  });

  it('is host + path for another origin, or when the page origin is unknown', () => {
    expect(exclusionPattern('https://cdn.example.net/wp-content/x/a.min.js?ver=2', PAGE)).toBe(
      'cdn.example.net/wp-content/x/a.min.js'
    );
    expect(exclusionPattern('http://localhost:8891/a.js?ver=1', null)).toBe('localhost:8891/a.js');
  });

  it('replaces regex syntax by `.` — never a backslash WP Rocket would double', () => {
    expect(exclusionPattern('https://shop.example.com/js/a+b(c)[d]{e}$f^g|h*i.js', PAGE)).toBe(
      // The URL parser percent-encodes `{`, `}` and `^` in paths (a tag holding
      // those raw would not match — rare in script URLs); the rest becomes `.`.
      '/js/a.b.c..d.%7Be%7D.f%5Eg.h.i.js'
    );
    expect(exclusionPattern('https://shop.example.com/js/a%2Bb.js', PAGE)).toBe('/js/a%2Bb.js');
  });

  it('keeps the query of a file-less URL (neutralized) so the pattern is never a bare `/`', () => {
    expect(exclusionPattern('https://shop.example.com/?script=1', PAGE)).toBe(
      'shop.example.com/.script=1'
    );
  });

  it('answers null for non-http(s) URLs', () => {
    expect(exclusionPattern('javascript:alert(1)', PAGE)).toBeNull();
    expect(exclusionPattern('not a url', PAGE)).toBeNull();
  });

  it('matches its own script tag under both semantics, query and &#038; included', () => {
    const cases: { url: string; tags: string[] }[] = [
      {
        url: 'https://shop.example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1',
        tags: [
          '<script src="https://shop.example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1&#038;x=1" id="jquery-core-js"></script>',
          '<script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.2"></script>',
          '<script type="text/javascript" data-rocket-src="https://shop.example.com/wp-includes/js/jquery/jquery.min.js?ver=9"></script>'
        ]
      },
      {
        url: 'https://cdn.example.net/wp-content/plugins/a+b/app.js?ver=1.2&y=1',
        tags: [
          '<script src="https://cdn.example.net/wp-content/plugins/a+b/app.js?ver=1.3&#038;z=1"></script>'
        ]
      },
      {
        url: 'https://cdn.example.net/wp-content/plugins/x/app(1).js?ver=1',
        tags: [
          '<script src="https://cdn.example.net/wp-content/plugins/x/app(1).js?ver=2"></script>'
        ]
      }
    ];
    for (const { url, tags } of cases) {
      const pattern = exclusionPattern(url, PAGE);
      expect(pattern).not.toBeNull();
      for (const tag of tags) {
        expect(regexpMatches(pattern ?? '', tag), `${String(pattern)} ~ ${tag}`).toBe(true);
        expect(wpRocketMatches(pattern ?? '', tag), `WPR ${String(pattern)} ~ ${tag}`).toBe(true);
      }
    }
  });

  it('a full URL with its query would not have matched — the reason the query goes', () => {
    const url = 'https://shop.example.com/a.js?ver=3.7.1';
    const tag = '<script src="https://shop.example.com/a.js?ver=3.7.1&#038;x=1"></script>';
    expect(regexpMatches(url, tag)).toBe(false);
    expect(regexpMatches(exclusionPattern(url, PAGE) ?? '', tag)).toBe(true);
  });

  it('does not match another script of the same page', () => {
    const pattern = exclusionPattern('https://shop.example.com/js/a.js', PAGE) ?? '';
    expect(
      wpRocketMatches(pattern, '<script src="https://shop.example.com/js/b.js"></script>')
    ).toBe(false);
  });
});

describe('reconcileOrigins', () => {
  const a: ScriptOrigin = { kind: 'url', url: 'https://x.test/a.js' };
  const b: ScriptOrigin = { kind: 'url', url: 'https://x.test/b.js' };
  const inline: ScriptOrigin = { kind: 'inline' };

  it('returns the new answer when there was none', () => {
    const next = [a];
    expect(reconcileOrigins(undefined, next)).toBe(next);
  });

  it('returns the previous array when the answer is unchanged', () => {
    const previous = [a, inline];
    expect(reconcileOrigins(previous, [{ kind: 'url', url: a.url }, { kind: 'inline' }])).toBe(
      previous
    );
    const none: ScriptOrigin[] = [];
    expect(reconcileOrigins(none, [])).toBe(none);
  });

  it('keeps known origin objects inside a changed answer', () => {
    const fresh: ScriptOrigin = { kind: 'url', url: 'https://x.test/c.js' };
    const result = reconcileOrigins([a, b], [{ kind: 'url', url: b.url }, fresh]);
    expect(result).toEqual([b, fresh]);
    expect(result[0]).toBe(b);
    expect(result[1]).toBe(fresh);
  });
});
