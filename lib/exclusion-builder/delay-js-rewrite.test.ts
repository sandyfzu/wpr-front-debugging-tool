/**
 * The forward model of WP Rocket's Delay JS attribute rewrite. Expected
 * values were observed on the real `DelayJS\HTML::delay_js` (WP Rocket
 * 3.23.5.1, PHP 8.1.34 / PCRE2 10.49) through the parity harness.
 */
import { describe, expect, it } from 'vitest';
import { DELAY_JS_ALLOWED_TYPES, delayAttributeRewrite } from './delay-js-rewrite';

describe('delayAttributeRewrite', () => {
  it('renames `type=`/`src=` in place, whitespace around `=` dropped, then trims', () => {
    expect(delayAttributeRewrite(' src="/a.js" id="x"')).toBe('data-rocket-src="/a.js" id="x"');
    expect(delayAttributeRewrite(' type = "text/javascript" src = \'/b.js\' ')).toBe(
      'data-rocket-type="text/javascript" data-rocket-src=\'/b.js\''
    );
    expect(delayAttributeRewrite(' ')).toBe('');
  });

  it('renames the first quoted occurrence per line, inside other names and values too', () => {
    expect(delayAttributeRewrite(' data-src="/lazy.js" src="/d.js"')).toBe(
      'data-data-rocket-src="/lazy.js" src="/d.js"'
    );
    expect(delayAttributeRewrite(' data-x="src=1" src="/a.js"')).toBe(
      'data-x="src=1" data-rocket-src="/a.js"'
    );
    // Greedy to the last matching quote of the line; a new line starts again.
    expect(delayAttributeRewrite(' src="/a.js"\nsrc="/b.js"')).toBe(
      'data-rocket-src="/a.js"\ndata-rocket-src="/b.js"'
    );
  });

  it('removes a valueless `type` with its surrounding whitespace, even inside a value', () => {
    expect(delayAttributeRewrite(' type src="/f.js"')).toBe('data-rocket-src="/f.js"');
    expect(delayAttributeRewrite(' title="a type b"')).toBe('title="ab"');
    // PCRE `$` also matches before a final line feed.
    expect(delayAttributeRewrite(' id="x" type\n')).toBe('id="x"');
  });

  it('leaves the script undelayed for a non-empty type it does not delay', () => {
    expect(delayAttributeRewrite(' type="application/ld+json"')).toBeNull();
    // The check reads the first `type=` lazily — `data-type` counts too.
    expect(delayAttributeRewrite(' data-type="foo" src="/e.js"')).toBeNull();
    for (const type of DELAY_JS_ALLOWED_TYPES) {
      expect(delayAttributeRewrite(` type="${type}"`)).toBe(`data-rocket-type="${type}"`);
    }
    // `empty()` reads '' and '0' as no type; the check trims the value.
    expect(delayAttributeRewrite(' type=""')).toBe('data-rocket-type=""');
    expect(delayAttributeRewrite(' type="0"')).toBe('data-rocket-type="0"');
    expect(delayAttributeRewrite(' type=" module "')).toBe('data-rocket-type=" module "');
  });

  it('folds case for ASCII only', () => {
    expect(delayAttributeRewrite(' SRC="/a.js"')).toBe('data-rocket-src="/a.js"');
    // `ſ` (U+017F) upper-cases to `S` in Unicode, never in PCRE without UTF.
    expect(delayAttributeRewrite(' ſrc="/a.js"')).toBe('ſrc="/a.js"');
  });
});
