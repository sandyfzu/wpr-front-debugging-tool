/**
 * The script states: page facts off the detection record, the minify states
 * (Combined only under a meta-declared Combine JS, never from the URL alone;
 * Minified under the page verdict and its footprint rules), the exclusion
 * read and the state table — plus the corpus snapshots read end to end.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DelayedScriptRecord, WprDetections } from '../wp-rocket/types';
import { buildScriptRows, type JsScriptResource } from './resources-view-model';
import {
  JS_SCRIPT_STATES,
  NO_SCRIPT_PAGE_FACTS,
  fdtExclusions,
  isScriptDeferred,
  jsScriptState,
  resolvedScriptUrl,
  sameScriptPageFacts,
  scriptMinifyState,
  scriptPageFacts,
  type ScriptPageFacts
} from './script-states';

/** A minified per-file URL (the original path mirrored under the cache). */
const MINIFIED = 'https://s.test/wp-content/cache/min/1/wp-includes/js/a.js?ver=1';
/** A Combine JS bundle URL (bare digest file name under the cache). */
const BUNDLE = 'https://s.test/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js';
/** A site-moved cache root: the URL arm misses, only the stamp remains. */
const MOVED = 'https://s.test/wp-content/wpr-files/min/1/wp-includes/js/a.js';

/** Every page fact holding. */
const ALL: ScriptPageFacts = { minifyJs: true, wprProven: true, combineDeclared: true };

/** An external record with overrides. */
function record(overrides: Partial<DelayedScriptRecord> = {}): DelayedScriptRecord {
  return {
    inline: false,
    src: 'https://s.test/plain.js',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minifyAttribute: false,
    ...overrides
  };
}

/** A classified row with overrides. */
function row(overrides: Partial<JsScriptResource> = {}): JsScriptResource {
  return {
    id: 0,
    type: 'external',
    content: '/a.js',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minified: false,
    combined: false,
    originalType: null,
    ...overrides
  };
}

/** The rows of one committed detection snapshot. */
function snapshotRows(fixture: string): JsScriptResource[] {
  const path = join(__dirname, '../detection/fixtures', `${fixture}.expected.json`);
  const detections = (JSON.parse(readFileSync(path, 'utf8')) as { wprDetections: WprDetections })
    .wprDetections;
  return buildScriptRows(detections.delay_js, scriptPageFacts(detections));
}

describe('scriptPageFacts', () => {
  /** A record shape with just the rows the facts read. */
  const detections = (
    minifyJs: boolean,
    wpr: boolean,
    combine: WprDetections['minify_concatenate_js']
  ): WprDetections =>
    ({
      wpr: { present: wpr },
      minify_js: { present: minifyJs },
      minify_concatenate_js: combine
    }) as unknown as WprDetections;

  it('reads the Minify JS verdict and WP Rocket proof as given', () => {
    expect(scriptPageFacts(detections(true, true, { present: false }))).toEqual({
      minifyJs: true,
      wprProven: true,
      combineDeclared: false
    });
    expect(scriptPageFacts(detections(false, false, { present: false }))).toEqual(
      NO_SCRIPT_PAGE_FACTS
    );
  });

  it('counts Combine JS only when present from the meta', () => {
    const declared = (combine: WprDetections['minify_concatenate_js']): boolean =>
      scriptPageFacts(detections(false, true, combine)).combineDeclared;
    expect(declared({ present: true, source: 'meta' })).toBe(true);
    expect(declared({ present: false, source: 'meta' })).toBe(false);
    expect(declared({ present: false })).toBe(false);
    // A footprint source never happens for this row (the boundary rejects
    // it); were it to, it would still not count.
    expect(declared({ present: true, source: 'footprint' })).toBe(false);
  });

  it('compares fact sets field by field', () => {
    expect(sameScriptPageFacts(ALL, { ...ALL })).toBe(true);
    for (const key of ['minifyJs', 'wprProven', 'combineDeclared'] as const) {
      expect(sameScriptPageFacts(ALL, { ...ALL, [key]: false })).toBe(false);
    }
  });
});

describe('scriptMinifyState — Combined', () => {
  it('a bundle URL on a meta-declared Combine JS page is Combined, never also Minified', () => {
    expect(scriptMinifyState(record({ src: BUNDLE, minifyAttribute: true }), ALL)).toEqual({
      minified: false,
      combined: true
    });
  });

  it('the bundle URL alone never reads Combined (row absent/undecided or refuted)', () => {
    const undeclared = { ...ALL, combineDeclared: false };
    expect(scriptMinifyState(record({ src: BUNDLE }), undeclared).combined).toBe(false);
    expect(scriptMinifyState(record({ src: BUNDLE }), NO_SCRIPT_PAGE_FACTS).combined).toBe(false);
  });

  it('a no-meta page’s bundle reads Minified (its URL sits under the minify cache)', () => {
    const noMeta = { minifyJs: true, wprProven: true, combineDeclared: false };
    expect(scriptMinifyState(record({ src: BUNDLE }), noMeta)).toEqual({
      minified: true,
      combined: false
    });
  });

  it('a declared Combine JS does not make a per-file URL Combined', () => {
    expect(scriptMinifyState(record({ src: MINIFIED }), ALL)).toEqual({
      minified: true,
      combined: false
    });
  });

  it.each([
    ['root-relative', '/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js'],
    ['protocol-relative', '//s.test/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js'],
    ['path-relative', 'wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js?ver=2'],
    ['backslashed', '\\wp-content\\cache\\min\\1\\5c03bce63bb3260466706a046cb00086.js']
  ])('a %s bundle URL reads Combined, resolved like the served URL', (_form, src) => {
    expect(scriptMinifyState(record({ src }), { ...ALL, minifyJs: false })).toEqual({
      minified: false,
      combined: true
    });
  });
});

describe('resolvedScriptUrl', () => {
  it('keeps absolute URLs and resolves relative forms to an http(s) URL', () => {
    expect(resolvedScriptUrl(MINIFIED)).toBe(MINIFIED);
    expect(resolvedScriptUrl('/a/b.js')).toBe('https://document.invalid/a/b.js');
    expect(resolvedScriptUrl('//cdn.test/b.js')).toBe('https://cdn.test/b.js');
    expect(resolvedScriptUrl('a/../b.js')).toBe('https://document.invalid/b.js');
  });

  it('normalizes what URL parsing normalizes (tabs/newlines stripped)', () => {
    expect(resolvedScriptUrl('/wp-content/cache/min/1/a\n.js')).toBe(
      'https://document.invalid/wp-content/cache/min/1/a.js'
    );
  });

  it('returns an unparseable value as written', () => {
    expect(resolvedScriptUrl('https://[bad')).toBe('https://[bad');
  });
});

describe('scriptMinifyState — Minified', () => {
  it('needs the page verdict: a cache URL alone is not enough', () => {
    expect(scriptMinifyState(record({ src: MINIFIED }), { ...ALL, minifyJs: false })).toEqual({
      minified: false,
      combined: false
    });
  });

  it('the cache URL counts under the verdict', () => {
    expect(
      scriptMinifyState(record({ src: MINIFIED }), { ...ALL, wprProven: false }).minified
    ).toBe(true);
  });

  it('the stamp alone counts only where WP Rocket is proven', () => {
    const stamped = record({ src: MOVED, minifyAttribute: true });
    expect(scriptMinifyState(stamped, ALL).minified).toBe(true);
    expect(scriptMinifyState(stamped, { ...ALL, wprProven: false }).minified).toBe(false);
    expect(scriptMinifyState(stamped, { ...ALL, minifyJs: false }).minified).toBe(false);
  });

  it('reads relative cache URLs, and a newline the URL parser strips', () => {
    const relative = record({ src: '/wp-content/cache/min/1/wp-includes/js/a.js' });
    expect(scriptMinifyState(relative, ALL).minified).toBe(true);
    const split = record({ src: '/wp-content/cache/min/1/a\n.js' });
    expect(scriptMinifyState(split, ALL).minified).toBe(true);
  });

  it('a plain tag is never Minified', () => {
    expect(scriptMinifyState(record(), ALL)).toEqual({ minified: false, combined: false });
  });

  it('inline scripts and empty or missing URLs have no minify state', () => {
    const none = { minified: false, combined: false };
    expect(
      scriptMinifyState(record({ inline: true, src: undefined, minifyAttribute: true }), ALL)
    ).toEqual(none);
    expect(scriptMinifyState(record({ src: '', minifyAttribute: true }), ALL)).toEqual(none);
    expect(scriptMinifyState(record({ src: undefined, minifyAttribute: true }), ALL)).toEqual(none);
  });
});

describe('isScriptDeferred', () => {
  it.each([
    [{ deferred: true }, true],
    [{ deferredByWPR: true }, true],
    [{ deferred: true, deferredByWPR: true }, true],
    [{}, false],
    [{ type: 'inline' as const, deferred: true }, false],
    [{ type: 'inline' as const, deferredByWPR: true }, false]
  ] as const)('%j → %s', (overrides, expected) => {
    expect(isScriptDeferred(row(overrides))).toBe(expected);
  });
});

describe('fdtExclusions', () => {
  it.each([
    [{}, []],
    [{ fdtExcluded: '' }, []],
    [{ fdtExcluded: 'other' }, []],
    [{ fdtExcluded: 'delay_js' }, ['delay_js']],
    [{ fdtExcluded: 'defer_all_js' }, ['defer_all_js']],
    [{ fdtExcluded: 'delay_js,defer_all_js' }, ['delay_js', 'defer_all_js']],
    [{ fdtExcluded: 'defer_all_js delay_js' }, ['delay_js', 'defer_all_js']],
    // A feature that applied anyway was not kept out.
    [{ fdtExcluded: 'delay_js,defer_all_js', delayed: true }, ['defer_all_js']],
    [{ fdtExcluded: 'delay_js,defer_all_js', deferredByWPR: true }, ['delay_js']],
    // Defer JS never applies to an inline script.
    [{ type: 'inline' as const, fdtExcluded: 'delay_js,defer_all_js' }, ['delay_js']]
  ] as const)('%j → %j', (overrides, expected) => {
    expect(fdtExclusions(row(overrides))).toEqual(expected);
  });
});

describe('JS_SCRIPT_STATES', () => {
  it('lists the states most important first, one word each', () => {
    expect(JS_SCRIPT_STATES.map((state) => [state.id, state.label])).toEqual([
      ['excluded', 'Excluded'],
      ['delayed', 'Delayed'],
      ['deferred', 'Deferred'],
      ['combined', 'Combined'],
      ['minified', 'Minified']
    ]);
    for (const state of JS_SCRIPT_STATES) expect(state.label).not.toMatch(/\s/);
  });

  it('each state holds on its own facts only', () => {
    const holding = (overrides: Partial<JsScriptResource>): string[] =>
      JS_SCRIPT_STATES.filter((state) => state.holds(row(overrides))).map((state) => state.id);
    expect(holding({})).toEqual([]);
    expect(holding({ fdtExcluded: 'delay_js' })).toEqual(['excluded']);
    expect(holding({ delayed: true })).toEqual(['delayed']);
    expect(holding({ deferred: true })).toEqual(['deferred']);
    expect(holding({ combined: true })).toEqual(['combined']);
    expect(holding({ minified: true })).toEqual(['minified']);
  });

  it('looks a state up by id; an unknown id is a named wiring bug', () => {
    expect(jsScriptState('minified').label).toBe('Minified');
    expect(() => jsScriptState('cdn' as never)).toThrow(/"cdn"/);
  });
});

describe('the corpus snapshots, end to end', () => {
  it('Combine JS declared by the meta: the bundle reads Combined, nothing Minified', () => {
    const rows = snapshotRows('combine-js.html');
    const bundle = rows.filter((script) => script.combined);
    expect(bundle.map((script) => script.content)).toEqual([
      'http://127.0.0.1:8493/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js'
    ]);
    expect(rows.some((script) => script.minified)).toBe(false);
  });

  it('the same bundle without the meta reads Minified, never Combined', () => {
    const rows = snapshotRows('combine-js-no-meta.html');
    expect(rows.some((script) => script.combined)).toBe(false);
    expect(rows.filter((script) => script.minified).map((script) => script.content)).toEqual([
      'http://127.0.0.1:8493/wp-content/cache/min/1/5c03bce63bb3260466706a046cb00086.js'
    ]);
  });

  it('a moved cache root: the stamp reads Minified where WP Rocket is proven, not otherwise', () => {
    const proven = snapshotRows('minify-moved-cache-root.html').filter((script) => script.minified);
    expect(proven.length).toBeGreaterThan(0);
    expect(proven.every((script) => script.content.includes('/wpr-files/min/1/'))).toBe(true);
    expect(snapshotRows('minify-attribute-only.html').some((script) => script.minified)).toBe(
      false
    );
  });

  it('a meta page keeps its delayed scripts’ original type', () => {
    const typed = snapshotRows('me-blog-alr.html').filter((script) => script.originalType);
    expect(typed.map((script) => [script.delayed, script.originalType])).toEqual([
      [true, 'text/javascript']
    ]);
  });
});
