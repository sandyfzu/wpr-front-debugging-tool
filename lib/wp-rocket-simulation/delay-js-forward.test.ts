/**
 * The forward Delay JS transform's own behavior: report, identities, rows,
 * the backtrack limit at its measured boundaries, edge pages and speed.
 * Expected pages marked "plugin" are the real WP Rocket's output for the
 * same input (parity harness, `php -n -d pcre.jit=1`, sentinels `R`/`F`).
 */
import { describe, expect, it } from 'vitest';
import { ExclusionValidationError } from '../exclusion-builder/errors';
import {
  firstUnreproducibleListRow,
  readForwardRows,
  simulateDelayJs,
  type DelayJsForwardInput
} from './delay-js-forward';
import { metaCharsetCost } from './meta-charset-cost';
import { UNREPRODUCED_STEP_CEILING } from './unreproduced-limits';
import { byteView, type ByteMeasure } from './utf8';

/**
 * Simulate with the short sentinels the pinned plugin outputs used.
 *
 * @param html The page.
 * @param more Other inputs.
 */
function run(html: string, more: Partial<DelayJsForwardInput> = {}) {
  return simulateDelayJs({ html, runtime: 'R', ieFallback: 'F', listRows: [], rows: [], ...more });
}

const HEAD = '<head><script>F</script><script>R</script></head>';
const DIGEST = '0123456789abcdef0123456789abcdef';

describe('simulateDelayJs — report', () => {
  it('counts delayed scripts and the injection', () => {
    const result = run(
      '<html><head></head><body><script src="/a.js"></script><script>b()</script><script type="text/template">x</script></body></html>'
    );
    expect(result.report).toEqual({
      state: 'simulated',
      delayed: 2,
      runtimeInjected: true,
      caveats: [],
      regexLimitHit: false,
      undetermined: 0
    });
  });

  it('injects nothing without a `<head…>`, still delaying', () => {
    const result = run('<body><script src="/a.js"></script></body>');
    expect(result.html).toBe(
      '<body><script type="text/rocketlazyloadscript" data-rocket-src="/a.js"></script></body>'
    );
    expect(result.report.runtimeInjected).toBe(false);
  });

  it('names the combined-js caveat', () => {
    const result = run(`<head></head><script src="/wp-content/cache/min/1/${DIGEST}.js"></script>`);
    expect(result.report.caveats).toEqual(['combined-js']);
  });

  it('never writes a wpr_ comment or a generator token', () => {
    const html = run('<html><head></head><body><script>a()</script></body></html>').html;
    expect(html).not.toMatch(/wpr_|data-wpr-features/);
  });

  it('serves an empty page as is, with nothing to inject', () => {
    expect(run('').html).toBe('');
    expect(run('0').html).toBe('0');
  });
});

describe('simulateDelayJs — identities', () => {
  it('returns an already-delayed page as is', () => {
    const html =
      '<head></head><script type="text/rocketlazyloadscript" data-rocket-src="/a.js"></script><script src="/b.js"></script>';
    expect(run(html)).toEqual({
      html,
      report: {
        state: 'already-served',
        delayed: 0,
        runtimeInjected: false,
        caveats: [],
        regexLimitHit: false,
        undetermined: 0
      }
    });
  });

  it('returns an AMP page as is', () => {
    const html = '<html amp><head></head><script src="/a.js"></script></html>';
    const result = run(html);
    expect(result.html).toBe(html);
    expect(result.report.state).toBe('not-applicable');
  });

  it('is the identity on its own output', () => {
    const once = run('<html><head></head><body><script>a()</script></body></html>', {
      runtime: 'RocketLazyLoadScripts.run();'
    });
    const twice = run(once.html, { runtime: 'RocketLazyLoadScripts.run();' });
    expect(twice.html).toBe(once.html);
    expect(twice.report.state).toBe('already-served');
  });
});

describe('simulateDelayJs — edge pages (plugin output)', () => {
  it.each([
    [
      'a `0` attribute counts as none',
      '<head></head><script0>x</script><script 0>y</script>',
      `${HEAD}<script type="text/rocketlazyloadscript">x</script><script type="text/rocketlazyloadscript" 0>y</script>`
    ],
    ['an unclosed `<head`', '<html><head', '<html><head'],
    [
      'a declaration whose `<meta` span removed a conditional placeholder',
      '<html><head><meta charset=utf-8><meta x><!--[if IE]><p>c</p><![endif]--><meta charset=latin1></head><body><!--[if IE 9]><b>d</b><![endif]--></body></html>',
      '<!--[if IE 9]><b>d</b><![endif]--><script>F</script><script>R</script></head><body><!--[if IE]><p>c</p><![endif]--></body></html>'
    ],
    [
      'a conditional script with attributes',
      '<head></head><!--[if IE]> <script src="x">  var a="$1\\\\d\\\\\\\\e";  </script> <![endif]-->',
      `${HEAD}<!--[if IE]> <script src="x">var a="\\$1\\\\\\d\\\\\\\\\\e";</script> <![endif]-->`
    ]
  ])('%s', (_name, html, served) => {
    expect(run(html).html).toBe(served);
  });

  it('reads the runtime and fallback as replacement syntax', () => {
    const result = run('<html><head data-a="1"><title>t</title></head></html>', {
      runtime: 'a$0b\\\\c\\$d${1}e\\\\\\\\f',
      ieFallback: '$0$0'
    });
    expect(result.html).toBe(
      '<html><head data-a="1"><script><head data-a="1"><head data-a="1"></script><script>a<head data-a="1">b\\c$de\\\\f</script><title>t</title></head></html>'
    );
  });

  it('leaves an xmp region inside an svg one as its placeholder, as WP Rocket restores them', () => {
    // WP Rocket writes a random 13-hex id here; this transform writes its own.
    expect(
      run('<html><head></head><body><svg><xmp>q</xmp></svg><script>1</script></body></html>').html
    ).toBe(
      `<html>${HEAD}<body><svg><!-- WPR_XMP_0000000000001 --></svg><script type="text/rocketlazyloadscript">1</script></body></html>`
    );
  });

  it('picks placeholder ids the page does not spell', () => {
    const html =
      '<head></head><!-- WPR_SVG_0000000000000 --><svg><script>s()</script></svg><script>1</script>';
    expect(run(html).html).toBe(
      `${HEAD}<!-- WPR_SVG_0000000000000 --><svg><script>s()</script></svg><script type="text/rocketlazyloadscript">1</script>`
    );
  });
});

describe('simulateDelayJs — rows', () => {
  it('tests the list before the stored rows, and skips a row PCRE rejects', () => {
    const result = run(
      '<head></head><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>',
      {
        listRows: ['/a\\.js'],
        rows: ['(unclosed', '/b.js']
      }
    );
    expect(result.html).toBe(
      `${HEAD}<script src="/a.js"></script><script src="/b.js"></script><script type="text/rocketlazyloadscript" data-rocket-src="/c.js"></script>`
    );
    expect(result.report.delayed).toBe(1);
  });

  it('leaves a script whose verdict depends on WP Rocket’s random ids as served', () => {
    const result = run('<head></head><script>a<svg></svg></script><script>b<svg></svg></script>', {
      rows: ['WPR_SVG_[0-7]']
    });
    expect(result.html).toBe(`${HEAD}<script>a<svg></svg></script><script>b<svg></svg></script>`);
    expect(result.report.undetermined).toBe(2);
  });

  it('refuses stored rows it cannot reproduce, by their index', () => {
    let caught: unknown;
    try {
      readForwardRows(['ok'], ['fine', '(?R)']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ExclusionValidationError);
    expect((caught as ExclusionValidationError).invalid.map((entry) => entry.index)).toEqual([1]);
  });

  it('refuses a list row it cannot reproduce', () => {
    expect(() => readForwardRows(['(?R)'], [])).toThrow(/list row 0 .* cannot be reproduced/);
  });

  it('names the first list row it cannot reproduce, as readForwardRows refuses it', () => {
    expect(firstUnreproducibleListRow(['ok', 'jquery'])).toBeNull();
    expect(firstUnreproducibleListRow([])).toBeNull();
    const found = firstUnreproducibleListRow(['ok', '(?R)', '(?R)x']);
    expect(found).toMatchObject({ index: 1, row: '(?R)' });
    expect(found?.reason).not.toBe('');
    expect(() => readForwardRows(['ok', '(?R)'], [])).toThrow(/list row 1 /);
  });

  it('takes a list row PCRE rejects as reproduced: it never matches, as on WP Rocket', () => {
    expect(firstUnreproducibleListRow(['(unclosed'])).toBeNull();
    expect(() => readForwardRows(['(unclosed'], [])).not.toThrow();
  });
});

describe('simulateDelayJs — PCRE backtrack limit (boundaries measured on the plugin)', () => {
  const page = (x: string): string =>
    `<!DOCTYPE html><html><head><title>t</title><meta charset="utf-8"></head><body>${x}<script src="/after.js"></script></body></html>\n`;
  const families: readonly (readonly [string, (n: number) => string, number])[] = [
    ['plain body', (n) => page(`<script>${'a'.repeat(n)}</script>`), 499_995],
    ['spaced attributes', (n) => page(`<script   id="x">${'a'.repeat(n)}</script>`), 499_989],
    ['`<` in the body', (n) => page(`<script>${'<p>'.repeat(n)}</script>`), 142_855],
    ['`</script` in the body', (n) => page(`<script>${'</scriptx'.repeat(n)}</script>`), 47_618],
    ['two-byte characters', (n) => page(`<script>${'é'.repeat(n)}</script>`), 249_997],
    ['four-byte characters', (n) => page(`<script>${'😀'.repeat(n)}</script>`), 124_998],
    [
      'masked svg in the body',
      (n) =>
        page(
          `<script>${'a'.repeat(n)}<svg><path d="M0"/></svg>${'<svg>x</svg>'.repeat(100)}</script>`
        ),
      496_915
    ],
    [
      'IE conditionals in the body',
      (n) => page(`<script>${'a'.repeat(n)}${'<!--[if IE]>x<![endif]-->'.repeat(50)}</script>`),
      498_370
    ],
    [
      'an unclosed script with spaced attributes',
      (n) =>
        `<html><head></head><body><script src="/a.js"></script><script   >${'a'.repeat(n)}</body></html>`,
      124_979
    ],
    [
      'an unclosed script starting with `<`',
      (n) =>
        `<html><head></head><body><script src="/a.js"></script><script><${'b'.repeat(n)}</body></html>`,
      249_979
    ]
  ];

  it.each(families)(
    '%s: delays up to its measured bound, gives up one unit past it',
    (_name, make, n) => {
      const within = run(make(n));
      expect(within.report.regexLimitHit).toBe(false);
      expect(within.report.delayed).toBeGreaterThan(0);
      const past = run(make(n + 1));
      expect(past.report).toMatchObject({ regexLimitHit: true, delayed: 0, runtimeInjected: true });
      // Nothing delayed, yet runtime + fallback injected and the charset moved.
      expect(past.html).not.toContain('rocketlazyloadscript');
      expect(past.html).toContain('<script>F</script><script>R</script>');
    }
  );
});

describe('simulateDelayJs — speed', () => {
  it('rewrites a 4 MiB page well inside the 2 000 ms document budget', () => {
    const block = `<p>${'text '.repeat(40)}</p><script src="/wp-content/plugins/p/a.js?ver=1"></script><script>var x=${'1'.repeat(200)};</script><svg><path d="M0 0"/></svg>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body>${block.repeat(Math.ceil((4 * 1024 * 1024) / block.length))}</body></html>`;
    expect(html.length).toBeGreaterThanOrEqual(4 * 1024 * 1024);
    const started = performance.now();
    const result = run(html, {
      listRows: ['nowprocket', 'lazyLoadOptions', '/jquery-?[0-9.](.*)(.min|.slim|.slim.min)?.js']
    });
    const elapsed = performance.now() - started;
    expect(result.report.delayed).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('simulateDelayJs — not applicable', () => {
  it('names AMP as the reason', () => {
    const result = run('<html amp><head></head><script src="/a.js"></script></html>');
    expect(result.report).toMatchObject({ state: 'not-applicable', reason: 'amp' });
    expect(result.report.unreproducedRegex).toBeUndefined();
  });

  it('leaves `reason` out of a simulated report', () => {
    expect(run('<head></head><script>a</script>').report.reason).toBeUndefined();
  });
});

describe('simulateDelayJs — beyond exact reproduction (estimate at the ceiling, then one over)', () => {
  /**
   * Run `make(n)` and `make(n + 1)`: the first is simulated, the second is
   * the identity naming `regex`.
   *
   * @param make The page builder.
   * @param n The largest size whose estimate is the ceiling.
   * @param regex The regex the guard names.
   */
  function expectBoundary(make: (n: number) => string, n: number, regex: string): void {
    expect(run(make(n)).report.state).toBe('simulated');
    const past = make(n + 1);
    expect(run(past)).toEqual({
      html: past,
      report: {
        state: 'not-applicable',
        reason: 'beyond-exact-reproduction',
        unreproducedRegex: regex,
        delayed: 0,
        runtimeInjected: false,
        caveats: [],
        regexLimitHit: false,
        undetermined: 0
      }
    });
  }

  it('a long IE conditional (1 step per byte + 16)', () => {
    // Its span is n + 24 bytes.
    expectBoundary(
      (n) => `<head></head><!--[if IE]>${'a'.repeat(n)}<![endif]--><script>b</script>`,
      UNREPRODUCED_STEP_CEILING - 40,
      'ie-conditionals'
    );
  });

  it('an IE opening with no end, read to the page end', () => {
    // From the opening: 12 + n bytes.
    expectBoundary(
      (n) => `<head></head><script>b</script><!--[if IE]>${'a'.repeat(n)}`,
      UNREPRODUCED_STEP_CEILING - 28,
      'ie-conditionals'
    );
  });

  it('a script conditional’s re-injection reading (8 steps per byte + 16)', () => {
    // The conditional is n + 43 bytes: 8 × 62 498 + 16 = the ceiling.
    expectBoundary(
      (n) => `<head></head><!--[if IE]><script a>${'x'.repeat(n)}</script><![endif]-->`,
      (UNREPRODUCED_STEP_CEILING - 16) / 8 - 43,
      'ie-conditional-script'
    );
  });

  it('a long xmp region (1 step per byte, 4 per `<`, + 16)', () => {
    // n + 11 bytes, two `<`.
    expectBoundary(
      (n) => `<head></head><xmp>${'a'.repeat(n)}</xmp><script>b</script>`,
      UNREPRODUCED_STEP_CEILING - 35,
      'xmp-mask'
    );
  });

  it('an unclosed svg region, read twice to the page end', () => {
    // 2 × (n + 5) bytes, one `<`, + 16.
    expectBoundary(
      (n) => `<head></head><script>b</script><svg>${'a'.repeat(n)}`,
      (UNREPRODUCED_STEP_CEILING - 30) / 2,
      'svg-mask'
    );
  });

  it('the meta charset pattern’s lookahead to a far `</head>`', () => {
    const page = (n: number): string =>
      `<html><head><meta charset="utf-8">${'a'.repeat(n)}</head><body><script>b</script></body></html>`;
    // The explored attempt reads one step per byte to `</head>`: find its constant at n = 0.
    const injected =
      '<html><head><script>F</script><script>R</script><meta charset="utf-8"></head>';
    const base = metaCharsetCost(byteView(injected), { attempt: Infinity, work: Infinity });
    expectBoundary(page, UNREPRODUCED_STEP_CEILING - base.mostSteps, 'meta-charset');
  });

  it('simulates a page whose metas the pattern never matches, however costly they are', () => {
    // WP Rocket gives up or finds nothing: either way the metas stay.
    const html = `<html><head>${'<meta charset'.repeat(80)}</head><body><script>b</script></body></html>`;
    expect(run(html).report).toMatchObject({ state: 'simulated', delayed: 1 });
  });
});

describe('simulateDelayJs — the byte measure', () => {
  const page = '<html><head><title>t</title><meta charset=é></head><body></body></html>';

  it('reads the page as UTF-8 by default: `=é` is 3 bytes, enough for the meta rule', () => {
    expect(run(page).html).toBe(
      '<html><head><meta charset=é><script>F</script><script>R</script><title>t</title></head><body></body></html>'
    );
  });

  it('reads it with the served charset’s measure when given', () => {
    const singleByte: ByteMeasure = { unitBytes: () => 1, maxUnitBytes: 1 };
    expect(run(page, { measure: singleByte }).html).toBe(
      '<html><head><script>F</script><script>R</script><title>t</title><meta charset=é></head><body></body></html>'
    );
  });
});
