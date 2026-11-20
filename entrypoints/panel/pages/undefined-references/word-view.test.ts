/**
 * The word rows and views: the row identity, the view per answer (verdict
 * included), the count column, the preview line (names, the
 * "+N more" fold, verdict words), the detail's kind label, the searched field
 * and the copy action per URL class.
 */
import { describe, expect, it } from 'vitest';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import {
  INLINE_DEFINITION_LABEL,
  PREVIEW_DEFINITIONS,
  definitionCopy,
  definitionLabel,
  wordDefinitionCount,
  wordKind,
  wordPreview,
  wordRow,
  wordRowView,
  wordSearchField
} from './word-view';

const PAGE = 'https://example.com';
const URL_A = 'https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1';
const URL_CDN = 'https://cdn.example.net/js/app.js';
const INLINE: ScriptOrigin = { kind: 'inline' };

/** `n` distinct script origins on the page's own host. */
function files(n: number): ScriptOrigin[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'url',
    url: `${PAGE}/js/file-${String(i)}.js`
  }));
}

describe('wordRowView', () => {
  it('keys the row by its word and carries the verdict of its answer', () => {
    const answer = [INLINE];
    expect(wordRowView('alpha', answer, 0, false)).toEqual({
      key: 'alpha',
      word: 'alpha',
      answer,
      verdict: { kind: 'found', count: 1 }
    });
  });

  it('softens a not-found verdict when scripts were skipped or the inline text was cut', () => {
    expect(wordRowView('x', [], 0, false).verdict).toEqual({ kind: 'not-found', partial: false });
    expect(wordRowView('x', [], 2, false).verdict).toEqual({ kind: 'not-found', partial: true });
    expect(wordRowView('x', [], 0, true).verdict).toEqual({ kind: 'not-found', partial: true });
  });

  it('states searching, not searched and the hidden cross-origin error', () => {
    expect(wordRowView('x', 'pending', 0, false).verdict.kind).toBe('searching');
    expect(wordRowView('x', null, 0, false).verdict.kind).toBe('not-searched');
    expect(wordRowView(UNDEFINED_REFERENCE_EXTERNAL_ERROR, [], 0, false).verdict.kind).toBe(
      'hidden'
    );
  });
});

describe('wordRow', () => {
  it('is the word alone, keyed by itself', () => {
    expect(wordRow('alpha')).toEqual({ key: 'alpha', word: 'alpha' });
  });
});

describe('wordDefinitionCount', () => {
  it('counts the defining scripts once searched, zero when none', () => {
    expect(wordDefinitionCount(wordRowView('a', files(3), 0, false))).toBe('3');
    expect(wordDefinitionCount(wordRowView('a', [], 2, true))).toBe('0');
  });

  it('leaves the cell empty while unanswered or for the cross-origin error', () => {
    expect(wordDefinitionCount(wordRowView('a', 'pending', 0, false))).toBeUndefined();
    expect(wordDefinitionCount(wordRowView('a', null, 0, false))).toBeUndefined();
    expect(
      wordDefinitionCount(wordRowView(UNDEFINED_REFERENCE_EXTERNAL_ERROR, [], 0, false))
    ).toBeUndefined();
  });
});

describe('definitionLabel', () => {
  it('names a script by its file (query dropped) and an inline one by the label', () => {
    expect(definitionLabel({ kind: 'url', url: URL_A }, PAGE)).toBe('jquery.min.js');
    expect(definitionLabel(INLINE, PAGE)).toBe(INLINE_DEFINITION_LABEL);
    expect(INLINE_DEFINITION_LABEL).toBe('Inline script');
  });

  it('keeps a non-http(s) URL whole (no file to cut it to)', () => {
    expect(definitionLabel({ kind: 'url', url: 'javascript:alert(1)' }, PAGE)).toBe(
      'javascript:alert(1)'
    );
  });
});

describe('wordPreview', () => {
  it('names where a found word may be defined, in answer order', () => {
    const view = wordRowView('a', [{ kind: 'url', url: URL_A }, INLINE], 0, false);
    expect(wordPreview(view, PAGE)).toBe('jquery.min.js · Inline script');
  });

  it(`names the first ${String(PREVIEW_DEFINITIONS)} and folds the rest into "+N more"`, () => {
    expect(PREVIEW_DEFINITIONS).toBe(3);
    expect(wordPreview(wordRowView('a', files(3), 0, false), PAGE)).toBe(
      'file-0.js · file-1.js · file-2.js'
    );
    // One past the fold still folds: "+1 more" (the boundary).
    expect(wordPreview(wordRowView('a', files(4), 0, false), PAGE)).toBe(
      'file-0.js · file-1.js · file-2.js · +1 more'
    );
    expect(wordPreview(wordRowView('a', files(5), 0, false), PAGE)).toBe(
      'file-0.js · file-1.js · file-2.js · +2 more'
    );
  });

  it("says the verdict's own words when there is no definition to name", () => {
    expect(wordPreview(wordRowView('a', [], 0, false), PAGE)).toBe('No definition found');
    expect(wordPreview(wordRowView('a', [], 1, false), PAGE)).toBe(
      'No definition found in the readable scripts'
    );
    expect(wordPreview(wordRowView('a', 'pending', 0, false), PAGE)).toBe('Searching…');
    expect(wordPreview(wordRowView('a', null, 0, false), PAGE)).toBe('Not searched');
    expect(wordPreview(wordRowView(UNDEFINED_REFERENCE_EXTERNAL_ERROR, [], 0, false), PAGE)).toBe(
      'Details hidden'
    );
  });
});

describe('wordKind and the searched field', () => {
  it('labels an undefined name apart from the cross-origin error', () => {
    expect(wordKind(wordRow('a'))).toBe('Undefined reference');
    expect(wordKind(wordRow(UNDEFINED_REFERENCE_EXTERNAL_ERROR))).toBe('Cross-origin error');
  });

  it('searches the word as shown (the sentinel as its message)', () => {
    expect(wordSearchField(wordRow('jQuery'))).toBe('jQuery');
    expect(wordSearchField(wordRow(UNDEFINED_REFERENCE_EXTERNAL_ERROR))).toBe('Script error.');
  });
});

describe('definitionCopy', () => {
  const SITE = 'http://127.0.0.1:8493';
  const SERVED_MINIFIED = `${SITE}/wp-content/cache/min/1/wp-content/mu-plugins/assets/fdt-delayed-definer.js?ver=1792430636`;
  const ORIGINAL_PATH = '/wp-content/mu-plugins/assets/fdt-delayed-definer.js';

  it('copies the path of an untouched same-origin script, host dropped', () => {
    expect(definitionCopy(URL_A, PAGE)).toEqual({
      kind: 'pattern',
      pattern: '/wp-includes/js/jquery/jquery.min.js'
    });
  });

  it('keeps the host of another origin', () => {
    expect(definitionCopy(URL_CDN, PAGE)).toEqual({
      kind: 'pattern',
      pattern: 'cdn.example.net/js/app.js'
    });
  });

  it('copies the original path of a served minified URL, not the cache path', () => {
    expect(definitionCopy(SERVED_MINIFIED, SITE)).toEqual({
      kind: 'pattern',
      pattern: ORIGINAL_PATH
    });
    // Unknown page origin: the hostless original path.
    expect(definitionCopy(SERVED_MINIFIED, null)).toEqual({
      kind: 'pattern',
      pattern: ORIGINAL_PATH
    });
  });

  it('copies the hostless original path when the served URL hides the host', () => {
    expect(
      definitionCopy(
        'https://wp-rocket.me/wp-content/cache/min/1/onsite/js/PD7as8/klaviyo.js?ver=1791299187',
        'https://wp-rocket.me'
      )
    ).toEqual({ kind: 'pattern', pattern: '/onsite/js/PD7as8/klaviyo.js' });
  });

  it('has no pattern for a combined bundle, nor for a non-http(s) URL', () => {
    expect(
      definitionCopy(`${SITE}/wp-content/cache/min/1/cdb2e71f9f3da2a001630dcca225acbf.js`, SITE)
    ).toEqual({
      kind: 'combined'
    });
    expect(definitionCopy('javascript:alert(1)', PAGE)).toEqual({ kind: 'none' });
  });
});
