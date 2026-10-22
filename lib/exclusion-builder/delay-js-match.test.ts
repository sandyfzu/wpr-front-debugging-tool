/**
 * Delay JS matching: the pre-delay element rebuilt from WP Rocket's served
 * markup (type dropped with the right space, parked attributes renamed back
 * in place), and rows tested one by one with WP Rocket's escapes and
 * ASCII-only case folding.
 */
import { describe, expect, it } from 'vitest';
import { compileDelayRows, preDelayElement } from './delay-js-match';
import { ExclusionValidationError } from './errors';

describe('preDelayElement', () => {
  it('drops the injected type with the space after it, and renames src back', () => {
    expect(
      preDelayElement(
        '<script type="text/rocketlazyloadscript" data-rocket-src="/a.js" id="d1" data-rocket-defer defer></script>'
      )
    ).toBe('<script src="/a.js" id="d1" data-rocket-defer defer></script>');
  });

  it('restores the original type in place, either quote', () => {
    expect(
      preDelayElement(
        `<script type="rocketlazyloadscript" data-rocket-type='module' data-rocket-src='/m.js'>x</script>`
      )
    ).toBe(`<script type='module' src='/m.js'>x</script>`);
  });

  it('rebuilds an attribute-less script with the space before the type, a lone-space one with its space', () => {
    expect(preDelayElement('<script type="text/rocketlazyloadscript">var a;</script>')).toBe(
      '<script>var a;</script>'
    );
    expect(preDelayElement('<script type="text/rocketlazyloadscript" >var b;</script>')).toBe(
      '<script >var b;</script>'
    );
  });

  it('renames inside other attribute names exactly where WP Rocket renamed', () => {
    expect(
      preDelayElement(
        '<script type="text/rocketlazyloadscript" data-data-rocket-src="/lazy.js" src="/d.js"></script>'
      )
    ).toBe('<script data-src="/lazy.js" src="/d.js"></script>');
  });

  it('never renames past the first `>` (the body is kept as served)', () => {
    const body = 'x.setAttribute("data-rocket-src=", 1)';
    expect(
      preDelayElement(`<script type="text/rocketlazyloadscript" id="i">${body}</script>`)
    ).toBe(`<script id="i">${body}</script>`);
  });

  it('leaves a script without a delay type alone except for the renames, and survives a cut tag', () => {
    expect(preDelayElement('<script data-rocket-status="executed" src="/a.js"></script>')).toBe(
      '<script data-rocket-status="executed" src="/a.js"></script>'
    );
    expect(preDelayElement('<script type="text/rocketlazyloadscript" data-rocket-src="/a')).toBe(
      '<script data-rocket-src="/a'
    );
  });
});

describe('compileDelayRows', () => {
  const SCRIPT = '<script type="text/rocketlazyloadscript" data-rocket-src="/a+b.js"></script>';

  it('answers the first matching row, as WP Rocket tests rows in order', () => {
    const match = compileDelayRows(['nothing', 'a\\x2Bb', 'src']);
    expect(match(SCRIPT)).toBe(1);
    expect(compileDelayRows(['zzz'])(SCRIPT)).toBe(-1);
    expect(compileDelayRows([])(SCRIPT)).toBe(-1);
  });

  it("applies WP Rocket's runtime escapes and ASCII-only case folding", () => {
    // `+` is a literal: `a+b` matches `a+b`, `\+` becomes `\\+` (a backslash).
    expect(compileDelayRows(['A+B\\.JS'])(SCRIPT)).toBe(0);
    expect(compileDelayRows(['a\\+b'])(SCRIPT)).toBe(-1);
    const accented = '<script type="text/rocketlazyloadscript">t = "été"</script>';
    expect(compileDelayRows(['ÉTÉ'])(accented)).toBe(-1);
    expect(compileDelayRows(['T = "été"'])(accented)).toBe(0);
  });

  it('matches the pre-delay element: the served type is gone, the original attributes are back', () => {
    expect(compileDelayRows(['rocketlazyloadscript'])(SCRIPT)).toBe(-1);
    expect(compileDelayRows(['^\\x3Cscript src="/a'])(SCRIPT)).toBe(0);
  });

  it('throws the typed error naming every row WP Rocket would not match as written', () => {
    try {
      compileDelayRows(['ok', '(?a)', '(', '']);
      expect.unreachable('the rows are invalid');
    } catch (error) {
      expect(error).toBeInstanceOf(ExclusionValidationError);
      expect((error as ExclusionValidationError).invalid.map((entry) => entry.problem)).toEqual([
        'match-all',
        'pcre-invalid',
        'match-all'
      ]);
    }
  });
});
