/**
 * The undefined-references engine's suites: the definition query's parity
 * over the reference sample set + the metacharacter hardening, the asset
 * loader's zero-settle regression (never hangs on an empty page), and the
 * incremental re-analysis (a refresh with one new word runs exactly one
 * word's query — the memo hit count asserted, not assumed).
 */
import { describe, expect, it } from 'vitest';
import {
  findDefinitions,
  loadScriptAssets,
  refreshDefinitions,
  type InspectedScriptResource,
  type InspectedWindowResources,
  type ScriptAsset
} from './undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../wp-rocket/constants';

const url = (value: string): ScriptAsset => ({
  origin: { kind: 'url', url: value },
  content: value
});
const inline = (content: string): ScriptAsset => ({ origin: { kind: 'inline' }, content });

describe('findDefinitions — the query over the reference sample set', () => {
  it('finds declaration-style definitions (case-sensitive, like the identifiers)', () => {
    const assets = [
      url('var overlay = 1;'),
      url('function overlay() {}'),
      url('const OVERLAY = true;'),
      url('let overlay2 = null;')
    ];
    // Decl + boundary (or line end) reads as a definition of 'overlay';
    // the case-different `OVERLAY` and the suffixed `overlay2` do not.
    const result = findDefinitions(assets, ['overlay']);
    expect(result[0]).toEqual({
      word: 'overlay',
      definitions: [
        { kind: 'url', url: 'var overlay = 1;' },
        { kind: 'url', url: 'function overlay() {}' }
      ]
    });
  });

  it('finds assignment- and property-style definitions', () => {
    const assets = [
      url('app.overlay = enabled;'),
      url('settings.overlay: true'),
      url('myOverlay = 1;')
    ];
    // 'myOverlay' has no boundary before the word — never a match.
    expect(findDefinitions(assets, ['overlay'])[0]?.definitions).toEqual([
      { kind: 'url', url: 'app.overlay = enabled;' },
      { kind: 'url', url: 'settings.overlay: true' }
    ]);
  });

  it('runs the whole word list and keeps the word order', () => {
    const assets = [url('var alpha = 1;'), url('window.beta = 2;')];
    const result = findDefinitions(assets, ['alpha', 'gamma', 'beta']);
    expect(result.map((row) => row.word)).toEqual(['alpha', 'gamma', 'beta']);
    expect(result[1]?.definitions).toEqual([]);
  });

  it('multiple lines match (the m flag) and one asset lists once', () => {
    const asset = url('a;\nlet overlay = null;\noverlay.dontcare;\nOverlay nested; Overlay: -;\n');
    const result = findDefinitions([asset], ['overlay']);
    expect(result[0]?.definitions).toEqual([{ kind: 'url', url: asset.content }]);
    expect(result[0]?.definitions).toHaveLength(1);
  });

  it('inline assets discriminate as inline (the typed chip, never a string match)', () => {
    const result = findDefinitions([inline('const setData = 1;')], ['setData']);
    expect(result[0]).toEqual({
      word: 'setData',
      definitions: [{ kind: 'inline' }]
    });
  });

  it('the cross-origin sentinel is answered with no definitions', () => {
    const result = findDefinitions(
      [url('__EXTERNAL_ORIGIN_ERROR__ = 1;')],
      [UNDEFINED_REFERENCE_EXTERNAL_ERROR]
    );
    expect(result[0]).toEqual({ word: UNDEFINED_REFERENCE_EXTERNAL_ERROR, definitions: [] });
  });

  it('an empty asset list simply finds nothing (no throw, no hang)', () => {
    expect(findDefinitions([], ['jQuery', 'wp'])).toEqual([
      { word: 'jQuery', definitions: [] },
      { word: 'wp', definitions: [] }
    ]);
  });
});

describe('findDefinitions — the metacharacter escape hardening', () => {
  it('a `(` searches for the literal `(`, not a rewritten regex', () => {
    // The literal appears as an assignment target: the definition found.
    const matched = findDefinitions([url('obj ( = fancy;')], ['(']);
    expect(matched[0]?.definitions).toEqual([{ kind: 'url', url: 'obj ( = fancy;' }]);
    // Without the literal present, a metacharacter word fabricates nothing:
    // the raw interpolation would have turned this into a declaration
    // pattern ("let <boundary>") and called it a definition of `(`.
    const unmatched = findDefinitions([url('let ! = 1;')], ['(']);
    expect(unmatched[0]?.definitions).toEqual([]);
  });

  it('quantifier words (`a+b`) match only the literal string', () => {
    expect(findDefinitions([url('var aab = 1;')], ['a+b'])[0]?.definitions).toEqual([]);
    expect(findDefinitions([url('var a+b = 1;')], ['a+b'])[0]?.definitions).toEqual([
      { kind: 'url', url: 'var a+b = 1;' }
    ]);
  });

  it('anchor words (`f$`) match the literal dollar, not line ends', () => {
    expect(findDefinitions([url('letter Sly = 1;')], ['f$'])[0]?.definitions).toEqual([]);
    expect(findDefinitions([url('f$ = 1;')], ['f$'])[0]?.definitions).toEqual([
      { kind: 'url', url: 'f$ = 1;' }
    ]);
  });

  it('dotted words search for the literal dot, not any character', () => {
    // The raw regex would have matched `var axc = 1` (the `.` standing in
    // for `x`) and credited the word `a.c` with a definition it never had.
    expect(findDefinitions([url('var axc = 1;')], ['a.c'])[0]?.definitions).toEqual([]);
    expect(findDefinitions([url('a.c = 1;')], ['a.c'])[0]?.definitions).toEqual([
      { kind: 'url', url: 'a.c = 1;' }
    ]);
  });

  it('every special-character word builds without throwing', () => {
    const specials = ['(', ')', '[', ']', '{', '}', '.', '*', '+', '?', '^', '$', '|', '\\'];
    for (const word of specials) {
      expect(() => findDefinitions([url(`var probe = 1;`)], [word])).not.toThrow();
    }
  });
});

describe('loadScriptAssets — the inspected-window loader', () => {
  /** A double that answers every resource's content with the given delays. */
  function fakeApi(
    defs: Array<{ url: string; type?: string; content?: string | null; delay?: number }>
  ): InspectedWindowResources {
    return {
      getResources(onComplete) {
        const resources: InspectedScriptResource[] = defs.map((def) => ({
          url: def.url,
          type: def.type,
          getContent: (onContent) => {
            setTimeout(() => {
              onContent(def.content ?? null);
            }, def.delay ?? 0);
          }
        }));
        onComplete(resources);
      }
    };
  }

  it('a page with zero script resources resolves to [] (never hangs)', async () => {
    const assets = await loadScriptAssets(
      fakeApi([{ url: 'https://strings.example/a.css', type: 'stylesheet' }]),
      []
    );
    expect(assets).toEqual([]);
  });

  it('an entirely empty page resolves []', async () => {
    await expect(loadScriptAssets(fakeApi([]), [])).resolves.toEqual([]);
  });

  it('loads script resources with url origins, skipping other types and protocols', async () => {
    const assets = await loadScriptAssets(
      fakeApi([
        { url: 'https://cdn.example/lib.js', type: 'script', content: 'var lib = 1;' },
        { url: 'https://cdn.example/img.png', type: 'image', content: 'pixels' },
        { url: 'chrome-extension://x/injected.js', type: 'script', content: 'ours' },
        { url: 'https://cdn.example/lazy.js', type: 'script', content: 'var lazy = 2;' }
      ]),
      []
    );
    expect(assets).toEqual([
      { origin: { kind: 'url', url: 'https://cdn.example/lib.js' }, content: 'var lib = 1;' },
      { origin: { kind: 'url', url: 'https://cdn.example/lazy.js' }, content: 'var lazy = 2;' }
    ]);
  });

  it('appends the inline stack as ONE inline asset after the url assets', async () => {
    const assets = await loadScriptAssets(
      fakeApi([{ url: 'https://cdn.example/lib.js', type: 'script', content: 'lib();' }]),
      [{ content: 'inlineOne();' }, { content: 'inlineTwo();' }]
    );
    expect(assets).toEqual([
      { origin: { kind: 'url', url: 'https://cdn.example/lib.js' }, content: 'lib();' },
      { origin: { kind: 'inline' }, content: 'inlineOne();\n\ninlineTwo();' }
    ]);
  });

  it('a single inline script joins with no leading separator', async () => {
    const assets = await loadScriptAssets(fakeApi([]), [{ content: 'inlineOne();' }]);
    expect(assets).toEqual([{ origin: { kind: 'inline' }, content: 'inlineOne();' }]);
  });

  it('a script record without content is not an inline source', async () => {
    const assets = await loadScriptAssets(fakeApi([]), [
      {},
      { content: 'inlineOne();' },
      { content: undefined }
    ]);
    expect(assets).toEqual([{ origin: { kind: 'inline' }, content: 'inlineOne();' }]);
  });

  it('a resource whose content cannot be read contributes nothing', async () => {
    const assets = await loadScriptAssets(
      fakeApi([
        { url: 'https://cdn.example/dead.js', type: 'script', content: null },
        { url: 'https://cdn.example/live.js', type: 'script', content: 'var live = 1;' }
      ]),
      []
    );
    expect(assets).toEqual([
      { origin: { kind: 'url', url: 'https://cdn.example/live.js' }, content: 'var live = 1;' }
    ]);
  });

  it('the last-indexed resource resolving first still waits for the rest', async () => {
    // The settle is keyed to ALL resources' contents, never to one callback's
    // ordering — the empty-page regression's companion pin.
    const assets = await loadScriptAssets(
      fakeApi([
        { url: 'https://cdn.example/slow.js', type: 'script', content: 'var slow = 1;', delay: 20 },
        { url: 'https://cdn.example/fast.js', type: 'script', content: 'var fast = 1;', delay: 0 }
      ]),
      []
    );
    expect(assets).toEqual([
      { origin: { kind: 'url', url: 'https://cdn.example/slow.js' }, content: 'var slow = 1;' },
      { origin: { kind: 'url', url: 'https://cdn.example/fast.js' }, content: 'var fast = 1;' }
    ]);
  });

  it('the real inspectedWindow API satisfies the loader seam (type-level)', () => {
    // Compile-time check only: an unrelated shape does not typecheck as the
    // seam, and the auto-imported WXT `browser`'s inspectedWindow does.
    const asRealApi = undefined as unknown as (typeof browser)['devtools']['inspectedWindow'];
    const seam: InspectedWindowResources = asRealApi;
    expect(seam).toBeUndefined();
  });
});

describe('refreshDefinitions — the incremental re-analysis', () => {
  const assets = [url('var known = 1;'), url('var fresh = 2;')];

  it('a first analysis queries every word (fresh memo handed back)', () => {
    const first = refreshDefinitions(new Map(), ['known', 'fresh'], assets);
    expect(first.recomputed).toEqual(['known', 'fresh']);
    expect(first.memoHits).toEqual([]);
    expect(first.definitions.map((row) => row.definitions.length)).toEqual([1, 1]);
    expect(first.memo.get('known')).toEqual([{ kind: 'url', url: 'var known = 1;' }]);
  });

  it('a push with one new word runs the query for that word only (memo hit count asserted)', () => {
    const first = refreshDefinitions(new Map(), ['known', 'fresh'], assets);
    const second = refreshDefinitions(first.memo, ['known', 'fresh', 'newest'], assets);
    // One new word ⇒ exactly one query ran; the two prior words were hits.
    expect(second.recomputed).toEqual(['newest']);
    expect(second.memoHits).toEqual(['known', 'fresh']);
    expect(second.memoHits).toHaveLength(2);
    // The full answer still covers every word, cached results untouched —
    // and the word that matched nothing renders its no-definitions answer.
    expect(second.definitions).toHaveLength(3);
    expect(second.definitions[0]?.definitions).toEqual(first.definitions[0]?.definitions);
    expect(second.definitions[2]?.definitions).toEqual([]);
  });

  it('the caller\u2019s prior memo is never mutated (the refresh copies)', () => {
    const prior = new Map([['known', [{ kind: 'inline' }] as const]]);
    const snapshot = new Map(prior);
    refreshDefinitions(prior, ['known', 'brandNew'], assets);
    expect(prior).toEqual(snapshot);
    expect(prior.has('brandNew')).toBe(false);
  });

  it('repeated words in one push answer once, first occurrence wins', () => {
    const refresh = refreshDefinitions(new Map(), ['known', 'known'], assets);
    expect(refresh.recomputed).toEqual(['known']);
    expect(refresh.definitions).toHaveLength(1);
  });

  it('a word in the memo is served even when its asset vanished from this set', () => {
    // The memo is the analysis's unit of transaction per asset list — the
    // caller hands a fresh memo when the assets change; within one list the
    // memo is the word's answer regardless of match count.
    const refresh = refreshDefinitions(new Map([['known', []]]), ['known'], assets);
    expect(refresh.memoHits).toEqual(['known']);
    expect(refresh.recomputed).toEqual([]);
    expect(refresh.definitions[0]).toEqual({ word: 'known', definitions: [] });
  });
});
