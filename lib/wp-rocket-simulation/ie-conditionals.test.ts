/**
 * The IE conditional guard. Expected re-injected texts are WP Rocket's
 * own (`IEConditionalSubscriber`, run through the parity harness).
 */
import { describe, expect, it } from 'vitest';
import { HOSTILE_CEILING_MS } from '../../vitest.shared';
import {
  IE_CONDITIONAL_PLACEHOLDER,
  conditionalScan,
  extractIeConditionals,
  injectIeConditionals,
  reinjectedConditional,
  scriptConditionalParts
} from './ie-conditionals';

const P = IE_CONDITIONAL_PLACEHOLDER;

describe('extractIeConditionals', () => {
  it('swaps each conditional, case-insensitively, up to its first end', () => {
    const html = 'a<!--[IF IE]>x<![ENDIF]-->b<!--[if lt IE 9]>y<![endif]--><![endif]-->c';
    expect(extractIeConditionals(html)).toEqual({
      html: `a${P}b${P}<![endif]-->c`,
      conditionals: ['<!--[IF IE]>x<![ENDIF]-->', '<!--[if lt IE 9]>y<![endif]-->']
    });
  });

  it('leaves a page without conditionals as is', () => {
    expect(extractIeConditionals('<p>x</p>')).toEqual({ html: '<p>x</p>', conditionals: [] });
  });

  it('needs `]>` right after the condition, and an end after it', () => {
    expect(extractIeConditionals('<!--[if IE] >x<![endif]-->').conditionals).toEqual([]);
    expect(extractIeConditionals('<!--[if IE]>x').conditionals).toEqual([]);
  });
});

describe('reinjectedConditional', () => {
  it('trims and escapes the content of a script with attributes', () => {
    expect(
      reinjectedConditional(
        '<!--[if IE]> <script src="x">  var a="$1\\d\\\\e";  </script> <![endif]-->'
      )
    ).toBe('<!--[if IE]> <script src="x">var a="\\$1\\\\d\\\\\\e";</script> <![endif]-->');
  });

  it('keeps any other conditional as is (an attribute-less script included)', () => {
    const plain = '<!--[if IE]><script>var r=/\\d+/;var c="$1";</script><![endif]-->';
    expect(reinjectedConditional(plain)).toBe(plain);
    expect(reinjectedConditional('<!--[if IE]><p>$1</p><![endif]-->')).toBe(
      '<!--[if IE]><p>$1</p><![endif]-->'
    );
  });
});

describe('injectIeConditionals', () => {
  it('puts each conditional back at the first placeholder left', () => {
    expect(
      injectIeConditionals(`a${P}b${P}`, ['<!--[if IE]>1<![endif]-->', '<!--[if IE]>2<![endif]-->'])
    ).toBe('a<!--[if IE]>1<![endif]-->b<!--[if IE]>2<![endif]-->');
  });

  it('returns a page without placeholders as is', () => {
    expect(injectIeConditionals('x', ['<!--[if IE]>1<![endif]-->'])).toBe('x');
  });

  it('writes a conditional whose placeholder vanished over the page start, as PHP does', () => {
    const page = `${'z'.repeat(40)}${P}`;
    expect(
      injectIeConditionals(page, ['<!--[if IE]>1<![endif]-->', '<!--[if IE]>2<![endif]-->'])
    ).toBe(`<!--[if IE]>2<![endif]-->${'z'.repeat(8)}<!--[if IE]>1<![endif]-->`);
  });
});

/**
 * A deterministic pseudo-random source (LCG).
 *
 * @param seed The start value.
 */
function random(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 48_271) % 2_147_483_647) / 2_147_483_647;
}

/** PCRE's `\s` as a JS class: the reference patterns below. */
const S = '[\\t\\n\\v\\f\\r ]';

/** WP Rocket's re-injection pattern, as a (backtracking) JS reference. */
const REFERENCE_SCRIPT = new RegExp(
  `^(<!--\\[if[^\\]]*?\\]>${S}*?(?:<!-->)?${S}*<script(?:${S}[^>]*?>))${S}*` +
    `([^]*?)${S}*(<\\/script>${S}*(?:<!--)?${S}*?<!\\[endif\\]-->)$`,
  'i'
);

/** WP Rocket's extraction pattern, as a JS reference (lazy body, first end). */
const REFERENCE_CONDITIONAL = /<!--\[if[^\]]*?\]>[^]*?<!\[endif\]-->/gi;

describe('conditionalScan / scriptConditionalParts — against the patterns', () => {
  const pieces = [
    '<!--[if IE]>',
    '<!--[IF lt IE 9]>',
    '<!--[if',
    ']',
    ']>',
    '>',
    '<script a>',
    '<script>',
    '<SCRIPT\tb>',
    '<!-->',
    ' ',
    '\n',
    'a',
    '$',
    '\\',
    '</script>',
    '</Script>',
    '<!--',
    '<![endif]-->',
    '<![ENDIF]-->',
    'é'
  ];

  it('reads random pages and conditionals exactly as the patterns do', () => {
    const next = random(3);
    let rewritten = 0;
    for (let round = 0; round < 20_000; round++) {
      let html = next() < 0.7 ? `<!--[if IE]>${next() < 0.5 ? ' <!--> ' : ''}<script a>` : '';
      const count = 1 + Math.floor(next() * 10);
      for (let index = 0; index < count; index++) {
        html += pieces[Math.floor(next() * pieces.length)] ?? '';
      }
      if (next() < 0.7)
        html += next() < 0.5 ? '</script> <!-- <![endif]-->' : '</script><![endif]-->';
      const spans = Array.from(html.matchAll(REFERENCE_CONDITIONAL), (found) => [
        found.index,
        found.index + found[0].length
      ]);
      expect(conditionalScan(html).spans, html).toEqual(spans);
      for (const [start, end] of spans) {
        const conditional = html.slice(start, end);
        const parts = REFERENCE_SCRIPT.exec(conditional);
        const scanned = scriptConditionalParts(conditional);
        expect(scanned === null, conditional).toBe(parts === null);
        if (parts === null || scanned === null) continue;
        rewritten++;
        expect(conditional.slice(0, scanned.openingEnd)).toBe(parts[1]);
        expect(conditional.slice(scanned.contentStart, scanned.contentEnd)).toBe(parts[2]);
        expect(conditional.slice(scanned.closingStart)).toBe(parts[3]);
      }
    }
    expect(rewritten).toBeGreaterThan(1000);
  });

  it('names the first opening with no end after it', () => {
    // 25 + 12: the second opening's `]` is not followed by `>`, the third has no end.
    expect(conditionalScan('<!--[if IE]>a<![endif]--><!--[if a] ><!--[if IE]>b').unclosed).toBe(37);
    expect(conditionalScan('<!--[if IE]>a<![endif]-->').unclosed).toBe(-1);
    // No `]` after an opening: no conditional can follow, none is unclosed.
    expect(conditionalScan('<!--[if IE').unclosed).toBe(-1);
  });
});

describe('IE conditionals — linear on hostile input (4 MiB)', () => {
  const MIB4 = 4 * 1024 * 1024;

  it('reads a script conditional with a 4 MiB whitespace body at once', () => {
    const conditional = `<!--[if IE]><script a>${' '.repeat(MIB4)}x<![endif]-->`;
    const started = performance.now();
    expect(reinjectedConditional(conditional)).toBe(conditional);
    // The backtracking pattern took 11 s at 4 KiB (cubic).
    expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
  });

  it('scans 4 MiB of `<!--[if` without a `]`', () => {
    const html = '<!--[if'.repeat(MIB4 / 7);
    const started = performance.now();
    expect(conditionalScan(html)).toEqual({ spans: [], unclosed: -1 });
    expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
  });

  it('puts back 4 MiB of conditionals in one pass', () => {
    const conditional = '<!--[if IE]><script a> $x </script><![endif]-->';
    const html = `<p>${conditional.repeat(MIB4 / conditional.length)}</p>`;
    const started = performance.now();
    const extracted = extractIeConditionals(html);
    const back = injectIeConditionals(extracted.html, extracted.conditionals);
    expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
    expect(back).toBe(html.replaceAll(' $x ', '\\$x'));
  });
});

describe('injectIeConditionals — placeholders in conditionals, and none left', () => {
  /**
   * PHP's `inject_ie_conditionals`, literally: `strpos` from 0, `false` read as 0.
   *
   * @param html The page.
   * @param conditionals The conditionals.
   */
  function literalInjection(html: string, conditionals: readonly string[]): string {
    if (!html.includes(P)) return html;
    let out = html;
    for (const conditional of conditionals) {
      const at = Math.max(out.indexOf(P), 0);
      out = out.slice(0, at) + reinjectedConditional(conditional) + out.slice(at + P.length);
    }
    return out;
  }

  it('fills a placeholder a written conditional spells, as PHP does', () => {
    const conditionals = [`<!--[if a]>1${P}2<![endif]-->`, '<!--[if b]>3<![endif]-->'];
    expect(injectIeConditionals(`x${P}y`, conditionals)).toBe(
      'x<!--[if a]>1<!--[if b]>3<![endif]-->2<![endif]-->y'
    );
  });

  it('matches the literal PHP sequence on random placeholder/vanished mixes', () => {
    const next = random(5);
    const pool = [
      '<!--[if a]>1<![endif]-->',
      `<!--[if b]>${P}<![endif]-->`,
      `<!--[if c]>${P}${P}<![endif]-->`,
      '<!--[if d]><script a> $1 </script><![endif]-->'
    ];
    for (let round = 0; round < 3000; round++) {
      let html = '';
      const pieces = Math.floor(next() * 6);
      for (let index = 0; index < pieces; index++)
        html += next() < 0.4 ? P : 'z'.repeat(next() * 50);
      const conditionals = Array.from(
        { length: Math.floor(next() * 7) },
        () => pool[Math.floor(next() * pool.length)] ?? ''
      );
      expect(injectIeConditionals(html, conditionals), html).toBe(
        literalInjection(html, conditionals)
      );
    }
  });

  it('stays linear when conditionals keep landing on the page start (4 MiB)', () => {
    const count = 40_000;
    const conditionals = Array.from({ length: count }, (_, index) =>
      index % 2 === 0 ? `<!--[if a]>${P}<![endif]-->` : '<!--[if b]>y<![endif]-->'
    );
    const page = `${P}${'z'.repeat(4 * 1024 * 1024)}`;
    const started = performance.now();
    const out = injectIeConditionals(page, conditionals);
    expect(performance.now() - started).toBeLessThan(HOSTILE_CEILING_MS);
    expect(out.endsWith('z'.repeat(1000))).toBe(true);
    expect(injectIeConditionals(page.slice(0, 2000), conditionals.slice(0, 200))).toBe(
      literalInjection(page.slice(0, 2000), conditionals.slice(0, 200))
    );
  });
});
