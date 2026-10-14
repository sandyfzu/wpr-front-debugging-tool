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
  scriptLocation,
  splitScriptUrl,
  summarizeResults,
  summaryFacts,
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
    expect(wordVerdict('a', [])).toEqual({ kind: 'not-found', partial: false });
    expect(wordVerdict('a', [], 2)).toEqual({ kind: 'not-found', partial: true });
    expect(wordVerdict('a', [], 0, true)).toEqual({ kind: 'not-found', partial: true });
    expect(wordVerdict('a', [url], 2)).toEqual({ kind: 'found', count: 1 });
    expect(wordVerdict('a', [url, { kind: 'inline' }])).toEqual({ kind: 'found', count: 2 });
  });

  it('words every verdict as visible text, singular and plural', () => {
    expect(verdictText({ kind: 'found', count: 1 })).toBe('In 1 script');
    expect(verdictText({ kind: 'found', count: 3 })).toBe('In 3 scripts');
    expect(verdictText({ kind: 'not-found', partial: false })).toBe('No definition found');
    expect(verdictText({ kind: 'not-found', partial: true })).toBe(
      'No definition found in the readable scripts'
    );
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

describe('splitScriptUrl + scriptLocation', () => {
  const PAGE = 'https://example.com';

  it('splits file, query and directory, dropping the page’s own host', () => {
    const parts = splitScriptUrl(
      'https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1',
      PAGE
    );
    expect(parts).toEqual({
      file: 'jquery.min.js',
      query: '?ver=3.7.1',
      directory: 'wp-includes/js/jquery/',
      host: null
    });
    expect(scriptLocation(parts)).toBe('wp-includes/js/jquery/');
  });

  it('shows every directory in one short form: no leading slash, no wp-content/', () => {
    const plugin = splitScriptUrl(
      'https://example.com/wp-content/plugins/some-plugin/assets/js/a.js',
      PAGE
    );
    expect(plugin.directory).toBe('plugins/some-plugin/assets/js/');
    expect(splitScriptUrl('https://example.com/wp-content/themes/t/js/b.js', PAGE).directory).toBe(
      'themes/t/js/'
    );
    // Only the leading WordPress prefix shortens.
    expect(
      splitScriptUrl('https://example.com/blog/wp-content/plugins/p/c.js', PAGE).directory
    ).toBe('blog/wp-content/plugins/p/');
    expect(splitScriptUrl('https://example.com/wp-content/uploads/x/d.js', PAGE).directory).toBe(
      'uploads/x/'
    );
    // A root file of the page's own origin has no location line.
    const root = splitScriptUrl('https://example.com/main.js', PAGE);
    expect(root.directory).toBe('');
    expect(scriptLocation(root)).toBe('');
  });

  it('decodes the directory and file for display only', () => {
    const parts = splitScriptUrl(
      'https://example.com/wp-content/plugins/mi%20plugin/js/pr%C3%A9f.js?ver=1',
      PAGE
    );
    expect(parts.directory).toBe('plugins/mi plugin/js/');
    expect(parts.file).toBe('préf.js');
    // Undecodable text stays as it is.
    expect(splitScriptUrl('https://example.com/js/a%FF.js', PAGE).file).toBe('a%FF.js');
    // An encoded `/` stays encoded — no fake path separator in a name.
    expect(splitScriptUrl('https://example.com/js/a%2Fb%20c.js', PAGE).file).toBe('a%2Fb c.js');
    expect(splitScriptUrl('https://example.com/js/x%2fy/z.js', PAGE).directory).toBe('js/x%2fy/');
  });

  it('puts another origin’s host after the directory (the slug survives truncation)', () => {
    const parts = splitScriptUrl('https://cdn.example.com/wp-content/plugins/p/a.js', PAGE);
    expect(parts.host).toBe('cdn.example.com');
    expect(scriptLocation(parts)).toBe('plugins/p/ · cdn.example.com');
    expect(splitScriptUrl('http://localhost:8891/a.js', null)).toEqual({
      file: 'a.js',
      query: '',
      directory: '',
      host: 'localhost:8891'
    });
    expect(scriptLocation(splitScriptUrl('http://localhost:8891/a.js', null))).toBe(
      'localhost:8891'
    );
    // Same host, other scheme: another origin.
    expect(splitScriptUrl('http://example.com/a.js', PAGE).host).toBe('example.com');
  });

  it('keeps the whole URL as the file without a file segment, a parse, or http(s)', () => {
    for (const url of [
      'https://cdn.example.com/js/',
      'https://cdn.example.com',
      'not a url',
      'javascript:alert(1)',
      'file:///srv/a.js'
    ]) {
      expect(splitScriptUrl(url, PAGE)).toEqual({
        file: url,
        query: '',
        directory: '',
        host: null
      });
    }
  });
});

/**
 * WP Rocket's save pipeline for a `delay_js_exclusions` line:
 * `sanitize_text_field` (drops `%XX` octets, collapses whitespace, trims)
 * then `rocket_clean_wildcards` (per `/` component, `.*`, `*`, `(*)` and
 * `(.*)` become `(.*)`). A pattern must come out of it unchanged.
 */
function wpRocketSave(pattern: string): string {
  const sanitized = pattern
    .replace(/%[a-f0-9]{2}/gi, '')
    .replace(/[\r\n\t ]+/g, ' ')
    .trim();
  return sanitized
    .split('/')
    .map((part) => part.replace(/\(\.\*\)|\(\*\)|\.\*|\*/g, '(.*)'))
    .join('/');
}

/**
 * WP Rocket's matching of one saved exclusion against a script element: it
 * escapes `+`, `?ver` and `#`, then runs `preg_match("#{$pattern}#i", $tag)`
 * over the whole element (attributes and inline body). The JS equivalent of
 * that PCRE pattern (no PCRE-only syntax is involved; the escaped `\#` is a
 * literal in both) is a case-insensitive RegExp.
 */
function wpRocketMatches(pattern: string, tag: string): boolean {
  const escaped = wpRocketSave(pattern)
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

  it('writes regex syntax as one-char classes, `*` and brackets as `.` — never a backslash', () => {
    expect(exclusionPattern('https://shop.example.com/js/a+b(c)[d]$f|h*i.js', PAGE)).toBe(
      '/js/a[+]b[(]c[)].d.[$]f[|]h.i.js'
    );
    // An encoded `+` accepts its raw or encoded spelling.
    expect(exclusionPattern('https://shop.example.com/js/a%2Bb.js', PAGE)).toBe(
      '/js/a(?:[+]|[%]2B)b.js'
    );
  });

  it('never writes `?` as a quantifier — WP Rocket would escape a `)?` before `ver`', () => {
    const cases: { url: string; tags: string[] }[] = [
      {
        url: 'https://shop.example.com/wp-content/plugins/p/js/p&ver.js',
        tags: [
          '<script src="https://shop.example.com/wp-content/plugins/p/js/p&#038;ver.js?ver=1"></script>',
          '<script src="https://shop.example.com/wp-content/plugins/p/js/p&ver.js?ver=1"></script>'
        ]
      },
      {
        url: 'https://shop.example.com/wp-content/plugins/p/js/50%25ver.js',
        tags: [
          '<script src="https://shop.example.com/wp-content/plugins/p/js/50%25ver.js?ver=1"></script>',
          '<script src="https://shop.example.com/wp-content/plugins/p/js/50%ver.js?ver=1"></script>'
        ]
      },
      {
        url: "https://shop.example.com/wp-content/plugins/p/js/o'ver.js",
        tags: [
          '<script src="https://shop.example.com/wp-content/plugins/p/js/o&#039;ver.js?ver=1"></script>'
        ]
      }
    ];
    for (const { url, tags } of cases) {
      const pattern = exclusionPattern(url, PAGE) ?? '';
      for (const tag of tags) {
        expect(wpRocketMatches(pattern, tag), `${pattern} ~ ${tag}`).toBe(true);
        expect(regexpMatches(pattern, tag), `${pattern} ~ ${tag}`).toBe(true);
      }
    }
    // Across every shape this suite generates: a `?` only ever opens a
    // non-capturing group `(?:` or sits in the literal class `[?]`.
    const urls = [
      ...cases.map((entry) => entry.url),
      'https://shop.example.com/js/a%2Fb%25c%27d%26e%22f%2Ag%3Ch.js',
      "https://shop.example.com/wp-content/plugins/o'neil&co/js/x.js",
      'https://shop.example.com/js/?script=1&ver=2',
      'https://shop.example.com/js/a?b.js?ver=1'
    ];
    for (const url of urls) {
      const pattern = exclusionPattern(url, PAGE) ?? '';
      expect(pattern.replaceAll('(?:', '').replaceAll('[?]', ''), pattern).not.toContain('?');
    }
  });

  it('`a+b` matches `a+b` only — not `aab` — under both readers', () => {
    const pattern = exclusionPattern('https://shop.example.com/js/a+b/x.js', PAGE) ?? '';
    const own = '<script src="https://shop.example.com/js/a+b/x.js?ver=1"></script>';
    const sibling = '<script src="https://shop.example.com/js/aab/x.js?ver=1"></script>';
    // WP Rocket escapes `+`: `[+]` becomes `[\+]`, still a literal `+`.
    expect(wpRocketMatches(pattern, own)).toBe(true);
    expect(regexpMatches(pattern, own)).toBe(true);
    expect(wpRocketMatches(pattern, sibling)).toBe(false);
    expect(regexpMatches(pattern, sibling)).toBe(false);
  });

  it("matches a path with `'` and `&` in WordPress' entity spellings", () => {
    const pattern =
      exclusionPattern("https://shop.example.com/wp-content/plugins/o'neil&co/js/x.js", PAGE) ?? '';
    expect(pattern).toBe(
      "/wp-content/plugins/o(?:'|&#0{0,1}39;)neil&(?:#0{0,1}38;|amp;){0,1}co/js/x.js"
    );
    for (const src of [
      'https://shop.example.com/wp-content/plugins/o&#039;neil&#038;co/js/x.js',
      "https://shop.example.com/wp-content/plugins/o'neil&co/js/x.js",
      'https://shop.example.com/wp-content/plugins/o&#39;neil&amp;co/js/x.js'
    ]) {
      const tag = `<script src="${src}?ver=1" id="oneil-js"></script>`;
      expect(wpRocketMatches(pattern, tag), tag).toBe(true);
      expect(regexpMatches(pattern, tag), tag).toBe(true);
    }
  });

  it('keeps the first query parameter of a file-less URL, with the host', () => {
    expect(exclusionPattern('https://shop.example.com/?script=1', PAGE)).toBe(
      `shop.example.com/[?]script=1[&"']`
    );
    expect(exclusionPattern('https://shop.example.com/js/?script=1&ver=2&x=3', PAGE)).toBe(
      `shop.example.com/js/[?]script=1[&"']`
    );
    expect(exclusionPattern('https://shop.example.com/js/?', PAGE)).toBe('shop.example.com/js/');
    // The value is closed: `?script=1` never matches `?script=10`.
    const pattern = exclusionPattern('https://shop.example.com/js/?script=1', PAGE) ?? '';
    expect(
      wpRocketMatches(pattern, '<script src="https://shop.example.com/js/?script=10"></script>')
    ).toBe(false);
  });

  it('keeps the host when the path is a single segment (too generic alone)', () => {
    expect(exclusionPattern('https://shop.example.com/main.js?ver=1', PAGE)).toBe(
      'shop.example.com/main.js'
    );
    expect(exclusionPattern('https://shop.example.com/js/main.js', PAGE)).toBe('/js/main.js');
  });

  it('decodes encoded runs: non-ASCII raw, ASCII as raw-or-encoded units, no wildcard', () => {
    // The URL parser encodes spaces, backticks, braces, `^` and non-ASCII.
    expect(exclusionPattern('https://shop.example.com/js/my plugin/a`b{c}^d.js', PAGE)).toBe(
      '/js/my(?:[ ]|[%]20)plugin/a(?:[`]|[%]60)b(?:[{]|[%]7B)c(?:[}]|[%]7D)(?:[^/%]|[%]5E)d.js'
    );
    expect(
      exclusionPattern('https://shop.example.com/wp-content/themes/t/js/préférences.js', PAGE)
    ).toBe('/wp-content/themes/t/js/préférences.js');
    expect(exclusionPattern('https://shop.example.com/js/скрипт.js', PAGE)).toBe('/js/скрипт.js');
    // Not UTF-8: the bytes stay encoded, `[%]XX` each (a bare `%XX` is sanitized away).
    expect(exclusionPattern('https://shop.example.com/js/a%FFb%FE%FDc.js', PAGE)).toBe(
      '/js/a[%]FFb[%]FE[%]FDc.js'
    );
    // `/`, `%`, `'`, `&`, `"`, `*` and `<` decoded from an encoded run.
    expect(
      exclusionPattern('https://shop.example.com/js/a%2Fb%25c%27d%26e%22f%2Ag%3Ch.js', PAGE)
    ).toBe(
      "/js/a[%]2Fb[%](?:25){0,1}c(?:'|&#0{0,1}39;|[%]27)d(?:&(?:#0{0,1}38;|amp;){0,1}|[%]26)e(?:&quot;|&#0{0,1}34;|[%]22)f(?:[^/%]|[%]2A)g(?:[^/%]|[%]3C)h.js"
    );
    for (const url of [
      'https://shop.example.com/js/my plugin/a.js',
      'https://shop.example.com/js/ñandú.js',
      'https://shop.example.com/js/a%FF.js',
      'https://shop.example.com/js/a%2A%3Cb%3E.js'
    ]) {
      const value = exclusionPattern(url, PAGE) ?? '';
      expect(value).not.toContain('*');
      expect(value).not.toContain('<');
      expect(value).not.toMatch(/%[0-9a-f]{2}/i);
      // WP Rocket's save pipeline leaves it unchanged.
      expect(wpRocketSave(value)).toBe(value);
    }
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
      },
      {
        url: 'https://shop.example.com/wp-content/themes/t/js/préférences.js?ver=1',
        tags: [
          '<script src="https://shop.example.com/wp-content/themes/t/js/préférences.js?ver=1&#038;a=b"></script>'
        ]
      },
      {
        url: 'https://shop.example.com/wp-content/plugins/my plugin/js/app.js',
        tags: [
          '<script src="https://shop.example.com/wp-content/plugins/my%20plugin/js/app.js"></script>',
          '<script src="/wp-content/plugins/my plugin/js/app.js"></script>'
        ]
      },
      {
        url: 'https://shop.example.com/main.js?ver=3',
        tags: ['<script src="https://shop.example.com/main.js?ver=4"></script>']
      },
      {
        url: 'https://shop.example.com/js/?script=1&ver=2',
        tags: [
          '<script src="https://shop.example.com/js/?script=1&#038;ver=3"></script>',
          '<script src="https://shop.example.com/js/?script=1"></script>'
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

  it('fail-safe residual: a tag spelling non-ASCII percent-encoded does not match', () => {
    const pattern = exclusionPattern('https://shop.example.com/js/préférences.js', PAGE) ?? '';
    const encodedTag =
      '<script src="https://shop.example.com/js/pr%C3%A9f%C3%A9rences.js?ver=1"></script>';
    expect(wpRocketMatches(pattern, encodedTag)).toBe(false);
    expect(regexpMatches(pattern, encodedTag)).toBe(false);
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

describe('summaryFacts', () => {
  const summary = { undefinedNames: 3, withDefinition: 2, crossOriginError: true };

  it('lists names, found, the cross-origin error and skipped scripts, in order', () => {
    expect(summaryFacts(summary, true, 2)).toEqual([
      { count: 3, label: 'undefined references' },
      { count: 2, label: 'with a possible definition' },
      { count: 1, label: 'cross-origin error' },
      { count: 2, label: 'scripts could not be read' }
    ]);
    expect(summaryFacts({ ...summary, undefinedNames: 1 }, true, 1)).toEqual([
      { count: 1, label: 'undefined reference' },
      { count: 2, label: 'with a possible definition' },
      { count: 1, label: 'cross-origin error' },
      { count: 1, label: 'script could not be read' }
    ]);
  });

  it('adds the cut inline stack as a count-less fact, only when a search runs', () => {
    expect(summaryFacts(summary, true, 0, true).at(-1)).toEqual({
      label: 'inline scripts only partly captured'
    });
    expect(summaryFacts(summary, false, 0, true)).not.toContainEqual({
      label: 'inline scripts only partly captured'
    });
  });

  it('leaves out search facts when no search runs, and empty facts', () => {
    expect(summaryFacts(summary, false, 4)).toEqual([
      { count: 3, label: 'undefined references' },
      { count: 1, label: 'cross-origin error' }
    ]);
    expect(
      summaryFacts({ undefinedNames: 0, withDefinition: 0, crossOriginError: true }, true, 0)
    ).toEqual([{ count: 1, label: 'cross-origin error' }]);
  });
});

describe('exclusionPattern — sibling corpus (only its own tag)', () => {
  const ORIGIN = 'https://shop.example';
  /** A WordPress-printed script tag: raw UTF-8 path, `&#038;` in the query. */
  const tag = (path: string, id: string): string =>
    `<script src="${ORIGIN}${path}?ver=1.0&#038;x=2" id="${id}-js"></script>`;
  const scripts: { path: string; id: string }[] = [
    { path: '/wp-content/plugins/wpml/res/js/ñandú.js', id: 'nandu' },
    { path: '/wp-content/plugins/wpml/res/js/sandbox.js', id: 'sandbox' },
    { path: '/wp-content/plugins/wpml/res/js/handler.js', id: 'handler' },
    { path: '/wp-content/plugins/wpml/res/js/app.js', id: 'app' },
    { path: '/wp-content/plugins/wpml/res/js/app.min.js', id: 'app-min' },
    { path: '/wp-content/plugins/mi plugin/js/main.js', id: 'mi-main' },
    { path: '/wp-content/plugins/mi-other-plugin/js/main.js', id: 'mi-other' },
    { path: '/wp-content/plugins/mi plugin-pro/js/main.js', id: 'mi-pro' },
    { path: '/wp-content/plugins/wpml-pro/res/js/app.js', id: 'wpml-pro' },
    { path: '/wp-content/themes/tema/js/menú.js', id: 'menu-accent' },
    { path: '/wp-content/themes/tema/js/menu.js', id: 'menu' },
    { path: '/wp-content/themes/tema/js/menu.min.js', id: 'menu-min' },
    { path: '/wp-content/plugins/a`b/js/x{1}.js', id: 'backtick' },
    { path: '/wp-content/plugins/ab/js/x1.js', id: 'backtick-sibling' }
  ];
  const inlineConfig = `<script id="cfg">var cfg={"base":"${ORIGIN}/wp-content/plugins/wpml/res/js/","themes":"/wp-content/themes/tema/js/","plugin":"/wp-content/plugins/mi","files":["x.js","main.js","menu.js"]};</script>`;
  const corpus = [...scripts.map((script) => tag(script.path, script.id)), inlineConfig];

  it('matches only its own element, raw or `%20` spelled, after WP Rocket’s save pipeline', () => {
    for (const script of scripts) {
      const url = new URL(`${ORIGIN}${script.path}?ver=1.0`).href;
      const pattern = exclusionPattern(url, ORIGIN);
      expect(pattern, script.path).not.toBeNull();
      const own = tag(script.path, script.id);
      const matched = corpus.filter((element) => wpRocketMatches(pattern ?? '', element));
      expect(matched, `${String(pattern)} over-matches`).toEqual([own]);
      expect(regexpMatches(pattern ?? '', own)).toBe(true);
      // The same script printed with its space still encoded matches too.
      if (script.path.includes(' ')) {
        const encoded = tag(script.path.replaceAll(' ', '%20'), script.id);
        expect(wpRocketMatches(pattern ?? '', encoded), encoded).toBe(true);
        expect(regexpMatches(pattern ?? '', encoded), encoded).toBe(true);
      }
    }
  });

  it('a sibling differing at an encoded position does not match (exact units)', () => {
    const pattern = exclusionPattern(`${ORIGIN}/wp-content/plugins/a%60b/js/main.js`, ORIGIN) ?? '';
    expect(wpRocketMatches(pattern, tag('/wp-content/plugins/a-b/js/main.js', 'lookalike'))).toBe(
      false
    );
    expect(wpRocketMatches(pattern, tag('/wp-content/plugins/a`b/js/main.js', 'own'))).toBe(true);
    expect(wpRocketMatches(pattern, tag('/wp-content/plugins/a%60b/js/main.js', 'own'))).toBe(true);
  });
});

/** A seeded PRNG (mulberry32), so the fuzz is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Milliseconds one RegExp test takes. */
function timed(pattern: RegExp, text: string): number {
  const start = performance.now();
  pattern.test(text);
  return performance.now() - start;
}

describe('exclusionPattern — ReDoS guards', () => {
  const ORIGIN = 'https://shop.example';

  it('30 encoded spaces evaluate fast against a non-matching 4 KB tag', () => {
    const pattern =
      exclusionPattern(`${ORIGIN}/wp-content/plugins/x/js/${'%20'.repeat(30)}Z.js`, ORIGIN) ?? '';
    const tag = `<script src="${ORIGIN}/wp-content/plugins/x/js/${' '.repeat(4000)}"></script>`;
    const encodedTag = `<script src="${ORIGIN}/wp-content/plugins/x/js/${'%20'.repeat(1300)}"></script>`;
    for (const text of [tag, encodedTag]) {
      expect(timed(new RegExp(pattern), text)).toBeLessThan(50);
      expect(timed(new RegExp(pattern, 'i'), text)).toBeLessThan(50);
    }
  });

  it('seeded fuzz: every generated pattern stays fast on long, look-alike, non-matching tags', () => {
    const random = seeded(0x5eed);
    const alphabet = [
      'a',
      'b',
      'n',
      '-',
      '.',
      ' ',
      '`',
      '{',
      '}',
      '^',
      '+',
      '(',
      ')',
      '$',
      '|',
      "'",
      '&',
      'ñ',
      'é',
      '%FF',
      '%2B',
      '%20'
    ];
    const pick = (): string => alphabet[Math.floor(random() * alphabet.length)] ?? 'a';
    for (let round = 0; round < 60; round += 1) {
      const name = Array.from({ length: 8 + Math.floor(random() * 32) }, pick).join('');
      const pattern = exclusionPattern(`${ORIGIN}/wp-content/plugins/p/js/${name}Z.js`, ORIGIN);
      expect(pattern).not.toBeNull();
      const filler = Array.from({ length: 4000 }, pick).join('');
      // Plausible text, printed raw and printed encoded, never ending in `Z.js`.
      for (const text of [
        `<script src="${ORIGIN}/wp-content/plugins/p/js/${filler}.js"></script>`,
        `<script src="${ORIGIN}/wp-content/plugins/p/js/${encodeURI(filler)}.js"></script>`
      ]) {
        const elapsed = Math.max(
          timed(new RegExp(pattern ?? ''), text),
          timed(new RegExp(pattern ?? '', 'i'), text)
        );
        expect(elapsed, `${String(pattern)} took ${elapsed.toFixed(1)} ms`).toBeLessThan(50);
      }
    }
  });
});
