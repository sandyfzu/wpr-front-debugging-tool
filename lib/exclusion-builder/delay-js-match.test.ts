/**
 * Delay JS matching: the pre-delay element read back from WP Rocket's
 * served markup (type dropped with the right space, renames undone only
 * where WP Rocket's own rewrite reproduces the served text), and rows
 * tested one by one with WP Rocket's escapes and ASCII-only case folding.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_RENAME_CHOICES,
  agreedVerdict,
  idsIn,
  readDelayRows,
  compileDelayRows,
  undoDelayRenames
} from './delay-js-match';
import { MASK_ID_SENTINEL } from './delay-js-mask';

describe('idsIn — mask ids carried through a rebuilt opening tag', () => {
  const placeholder = `<!-- WPR_SVG_${MASK_ID_SENTINEL} -->`;

  it('moves ids in the unchanged tail by the length change', () => {
    const original = `<script type="text/rocketlazyloadscript" data-rocket-type="x">a=${placeholder}</script>`;
    const text = `<script type="x">a=${placeholder}</script>`;
    const id = original.indexOf(MASK_ID_SENTINEL);
    expect(idsIn(original, text, [id])).toEqual([text.indexOf(MASK_ID_SENTINEL)]);
    expect(idsIn(original, original, [id])).toEqual([id]);
  });

  it('finds ids in the rebuilt part again, only when exactly as many are there', () => {
    const original = `<script data-rocket-type="x" data-i="${placeholder}">a()</script>`;
    const text = `<script type="x" data-i="${placeholder}">a()</script>`;
    expect(idsIn(original, text, [original.indexOf(MASK_ID_SENTINEL)])).toEqual([
      text.indexOf(MASK_ID_SENTINEL)
    ]);
    // The page spells another sentinel placeholder there too: the ids cannot be told.
    const spelling = `data-j="WPR_XMP_${MASK_ID_SENTINEL} -->" data-i="${placeholder}"`;
    const before = `<script ${spelling} data-rocket-type="x">a()</script>`;
    const after = `<script ${spelling} type="x">a()</script>`;
    expect(idsIn(before, after, [before.lastIndexOf(MASK_ID_SENTINEL)])).toBeNull();
  });
});

describe('readDelayRows — page text spelling a sentinel placeholder', () => {
  it('reads it as page text when the match holds no placeholder of ours', () => {
    const script = `<script type="text/rocketlazyloadscript">q='WPR_SVG_${MASK_ID_SENTINEL} -->';</script>`;
    expect(readDelayRows(['\\x00']).match(script)).toEqual({ row: 0, approximate: false });
  });
});
import { ExclusionValidationError } from './errors';

/** The readings' texts (`rebuilt`), or the one text (`approximate`), or `null` (`not-delayed`). */
function texts(served: string): readonly string[] | string | null {
  const reading = undoDelayRenames(served);
  if (reading.kind === 'rebuilt') return reading.texts;
  return reading.kind === 'approximate' ? reading.text : null;
}

describe('undoDelayRenames', () => {
  it('drops the injected type with the space after it, and renames src back', () => {
    expect(
      texts(
        '<script type="text/rocketlazyloadscript" data-rocket-src="/a.js" id="d1" data-rocket-defer defer></script>'
      )
    ).toEqual(['<script src="/a.js" id="d1" data-rocket-defer defer></script>']);
  });

  it('restores the original type in place, either quote', () => {
    expect(
      texts(
        `<script type="rocketlazyloadscript" data-rocket-type='module' data-rocket-src='/m.js'>x</script>`
      )
    ).toEqual([`<script type='module' src='/m.js'>x</script>`]);
  });

  it('rebuilds an attribute-less script without the type, a lone-space one with its space', () => {
    expect(texts('<script type="text/rocketlazyloadscript">var a;</script>')).toEqual([
      '<script>var a;</script>'
    ]);
    expect(texts('<script type="text/rocketlazyloadscript" >var b;</script>')).toEqual([
      '<script >var b;</script>'
    ]);
  });

  it('renames inside other attribute names exactly where WP Rocket renamed', () => {
    expect(
      texts(
        '<script type="text/rocketlazyloadscript" data-data-rocket-src="/lazy.js" src="/d.js"></script>'
      )
    ).toEqual(['<script data-src="/lazy.js" src="/d.js"></script>']);
  });

  it('keeps an original `data-rocket-src=` that WP Rocket did not write (forward-checked)', () => {
    // WP Rocket renames the first quoted `src=` only: `src=1` is unquoted.
    expect(
      texts(
        '<script type="text/rocketlazyloadscript" data-x="data-rocket-src=1" data-rocket-src="/a.js"></script>'
      )
    ).toEqual(['<script data-x="data-rocket-src=1" src="/a.js"></script>']);
    // An original already spelling a parked name: WP Rocket would have renamed
    // the `type=` inside it, so only the undo fits.
    expect(
      texts('<script type="text/rocketlazyloadscript" id="a" data-rocket-type="module"></script>')
    ).toEqual(['<script id="a" type="module"></script>']);
  });

  it('keeps every original a dropped line feed could explain (PHP-observed served text)', () => {
    // Original `title=" src='/t.js'" src=\r\n' /d.js'`: the line feed after the
    // second `=` made WP Rocket rename both; without one it renames the first
    // only — so keeping the second as served also fits, and both are kept.
    expect(
      texts(
        `<script type="text/rocketlazyloadscript" title=" data-rocket-src='/t.js'" data-rocket-src=' /d.js'></script>`
      )
    ).toEqual([
      `<script title=" src='/t.js'" src=' /d.js'></script>`,
      `<script title=" src='/t.js'" data-rocket-src=' /d.js'></script>`
    ]);
  });

  it('never renames past the first `>` (the body is kept as served)', () => {
    const body = 'x.setAttribute("data-rocket-src=", 1)';
    expect(texts(`<script type="text/rocketlazyloadscript" id="i">${body}</script>`)).toEqual([
      `<script id="i">${body}</script>`
    ]);
  });

  it('finds no original when WP Rocket could not have written the text', () => {
    // WP Rocket never leaves a quoted `src=` unrenamed.
    expect(texts('<script type="text/rocketlazyloadscript" src="/a.js"></script>')).toEqual([]);
    // Nor delays a script with a non-JS type.
    expect(
      texts('<script type="text/rocketlazyloadscript" data-rocket-type="text/template"></script>')
    ).toEqual([]);
    // A cut tag has no attribute end.
    expect(texts('<script type="text/rocketlazyloadscript" data-rocket-src="/a')).toEqual([]);
  });

  it('rebuilds a tag holding exactly the bound of four renames', () => {
    expect(MAX_RENAME_CHOICES).toBe(4);
    const values = Array.from(
      { length: MAX_RENAME_CHOICES - 1 },
      (_, i) => `data-x${String(i)}="data-rocket-src=1"`
    ).join(' ');
    expect(
      texts(`<script type="text/rocketlazyloadscript" data-rocket-src="/a.js" ${values}></script>`)
    ).toEqual([`<script src="/a.js" ${values}></script>`]);
  });

  it('gives up past the rename-choice bound', () => {
    const many = Array.from(
      { length: MAX_RENAME_CHOICES + 1 },
      (_, i) => `data-x${String(i)}="data-rocket-src=1"`
    ).join(' ');
    expect(texts(`<script type="text/rocketlazyloadscript" ${many}></script>`)).toEqual([]);
  });

  it('reads other spellings of a delay type approximately, and leaves other scripts alone', () => {
    expect(texts('<SCRIPT TYPE="rocketlazyloadscript" DATA-ROCKET-SRC="u.js"></SCRIPT>')).toBe(
      '<SCRIPT DATA-ROCKET-SRC="u.js"></SCRIPT>'
    );
    expect(texts('<script type=text/rocketlazyloadscript data-rocket-src=/u.js></script>')).toBe(
      '<script src=/u.js></script>'
    );
    expect(texts('<script data-rocket-status="executed" src="/a.js"></script>')).toBeNull();
  });
});

describe('agreedVerdict', () => {
  it("credits the first original's row when every original agrees, else undetermined", () => {
    expect(agreedVerdict([2, 0])).toEqual({ row: 2, approximate: false });
    expect(agreedVerdict([-1, -1])).toEqual({ row: -1, approximate: false });
    expect(agreedVerdict([1, -1])).toBeNull();
    expect(agreedVerdict([])).toBeNull();
  });
});

describe('compileDelayRows', () => {
  const SCRIPT = '<script type="text/rocketlazyloadscript" data-rocket-src="/a+b.js"></script>';

  it('answers the first matching row, as WP Rocket tests rows in order', () => {
    const match = compileDelayRows(['nothing', 'a\\x2Bb', 'src']);
    expect(match(SCRIPT)).toEqual({ row: 1, approximate: false });
    expect(compileDelayRows(['zzz'])(SCRIPT)).toEqual({ row: -1, approximate: false });
    expect(compileDelayRows([])(SCRIPT)).toEqual({ row: -1, approximate: false });
  });

  it("applies WP Rocket's runtime escapes and ASCII-only case folding", () => {
    // `+` is a literal: `a+b` matches `a+b`, `\+` becomes `\\+` (a backslash).
    expect(compileDelayRows(['A+B\\.JS'])(SCRIPT)?.row).toBe(0);
    expect(compileDelayRows(['a\\+b'])(SCRIPT)?.row).toBe(-1);
    const accented = '<script type="text/rocketlazyloadscript">t = "été"</script>';
    expect(compileDelayRows(['ÉTÉ'])(accented)?.row).toBe(-1);
    expect(compileDelayRows(['T = "été"'])(accented)?.row).toBe(0);
  });

  it('matches the pre-delay element: the served type is gone, the original attributes are back', () => {
    expect(compileDelayRows(['rocketlazyloadscript'])(SCRIPT)?.row).toBe(-1);
    expect(compileDelayRows(['^\\x3Cscript src="/a'])(SCRIPT)?.row).toBe(0);
  });

  it('answers undetermined when no original fits', () => {
    expect(
      compileDelayRows(['x'])('<script type="text/rocketlazyloadscript" src="/x.js"></script>')
    ).toBeNull();
  });

  it('flags verdicts read from an approximate rebuild', () => {
    const other = '<SCRIPT TYPE="rocketlazyloadscript" DATA-ROCKET-SRC="u.js"></SCRIPT>';
    expect(compileDelayRows(['u\\.js'])(other)).toEqual({ row: 0, approximate: true });
  });

  it('throws the typed error naming every blocking row WP Rocket would not match as written', () => {
    try {
      compileDelayRows(['ok', '(?a)', '(', '', '(a{1,}){1,}b']);
      expect.unreachable('the rows are invalid');
    } catch (error) {
      expect(error).toBeInstanceOf(ExclusionValidationError);
      // Rows matching every script only warn: they are not named here.
      expect(
        (error as ExclusionValidationError).invalid.map(({ index, problem }) => [index, problem])
      ).toEqual([
        [2, 'pcre-invalid'],
        [4, 'backtracking-risk']
      ]);
    }
  });

  it('applies rows matching every script — `(?a)` included — and names them', () => {
    const read = readDelayRows(['zzz', '(?a)', '']);
    expect(read.matchAllRows).toEqual(['(?a)', '']);
    expect(read.match(SCRIPT)).toEqual({ row: 1, approximate: false });
    expect(readDelayRows(['src']).matchAllRows).toEqual([]);
  });
});
