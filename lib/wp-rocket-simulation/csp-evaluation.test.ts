/**
 * The CSP evaluator against every browser receipt: the P21B probe table
 * (16 policies), its 4 audit pages and precedence/fix-round pages, and
 * the P21H probes (spec facts checked in Chromium 156 + Firefox 155) —
 * one row each, per browser engine.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import {
  delayedInlineScripts,
  evaluateSimulationCsp,
  type SimulationCspVerdict
} from './csp-evaluation';
import { cspMetaPolicies } from './csp-meta';
import type { SimulationCspBrowser, SimulationCspLimit } from './spec';

/** A stand-in runtime (its `$1` is replacement syntax: the injected text differs). */
const RUNTIME = 'window.rt=1;/*$9*/';
/** The runtime as the transform writes it (`$9` names no group: removed). */
const INJECTED = 'window.rt=1;/**/';
/** The receipt pages' nonce. */
const NONCE = 'N0nce';

/** One delayed script of a fixture page. */
interface Delayed {
  readonly text: string;
  readonly nonce?: string;
  /** Extra attribute text. */
  readonly attrs?: string;
}

/** The receipts' delayed inline probe (one per page). */
const PROBE: Delayed = { text: "document.documentElement.dataset.probe='1'" };
/** The probe, nonce'd (the receipts' "N page"). */
const PROBE_N: Delayed = { ...PROBE, nonce: NONCE };
/** The P21H probe page's four delayed inline scripts, in order. */
const P1: Delayed = { text: "document.documentElement.dataset.inl1='1'" };
const PN: Delayed = { text: "document.documentElement.dataset.inlN='1'", nonce: NONCE };
const P2: Delayed = { text: "document.documentElement.dataset.inl2='1'" };
const PCR: Delayed = { text: "document.documentElement.dataset.crlf='1';\r\nvoid 0" };
const FOUR = [P1, PN, P2, PCR];

/** `'<algorithm>-<base64>'` of a text. */
function hash(algorithm: 'sha256' | 'sha384' | 'sha512', text: string): string {
  return `'${algorithm}-${createHash(algorithm).update(text, 'utf8').digest('base64')}'`;
}

/** `<h>`: the runtime's hash (the IE fallback's is irrelevant to the verdict). */
const H = hash('sha256', INJECTED);

/** A served page: head metas before/after the head opening, body with delayed scripts' originals. */
function servedPage(beforeHead = '', inHead = ''): string {
  return `<!doctype html><html>${beforeHead}<head>${inHead}<title>t</title></head><body><p>x</p></body></html>`;
}

/** The simulated page: the runtime after `<head>`, the delayed scripts in the body. */
function simulatedPage(delayed: readonly Delayed[], served: string): string {
  const scripts = delayed
    .map(
      (script) =>
        `<script type="rocketlazyloadscript"${script.nonce === undefined ? '' : ` nonce="${script.nonce}"`}${script.attrs ?? ''}>${script.text}</script>`
    )
    .join('');
  return served
    .replace('<head>', `<head><script>${INJECTED}</script>`)
    .replace(
      '</body>',
      `<script type="rocketlazyloadscript" data-rocket-src="/ext.js"></script>${scripts}</body>`
    );
}

/** One receipt row's page. */
interface Page {
  readonly headers?: readonly string[];
  readonly reportOnly?: readonly string[];
  /** A meta before the `<head>` opening tag. */
  readonly metaBefore?: string;
  /** A meta in head, after the runtime's insertion point. */
  readonly metaAfter?: string;
  readonly delayed?: readonly Delayed[];
}

/** Expected verdict: blocked, unreadable (limits unknown), or the limits. */
type Expected = 'blocked' | 'unreadable' | readonly SimulationCspLimit[];

/** Evaluate a page for one engine. */
function verdict(page: Page, browser: SimulationCspBrowser): Expected {
  const meta = (content: string): string =>
    `<meta http-equiv="Content-Security-Policy" content="${content}">`;
  const served = servedPage(
    page.metaBefore === undefined ? '' : meta(page.metaBefore),
    page.metaAfter === undefined ? '' : meta(page.metaAfter)
  );
  const metas = [page.metaBefore, page.metaAfter].flatMap((content) =>
    content === undefined ? [] : [{ content, offset: served.indexOf(meta(content)) }]
  );
  const csp: SimulationCspInput = {
    browser,
    headers: [
      ...(page.headers ?? []).map((value) => ({ name: 'Content-Security-Policy', value })),
      ...(page.reportOnly ?? []).map((value) => ({
        name: 'content-security-policy-report-only',
        value
      }))
    ],
    metas
  };
  const result = evaluateSimulationCsp({
    csp,
    served,
    simulated: simulatedPage(page.delayed ?? [PROBE], served),
    runtime: RUNTIME
  });
  if (result.blocked) return 'blocked';
  return 'unavailable' in result ? result.unavailable : result.limits;
}

/** A receipt row: the page, then the verdict per engine. */
type Row = readonly [name: string, page: Page, chromium: Expected, firefox: Expected];

/** The P21B probe table: 16 policies (one row per page; `<h>` = the runtime's hash, N = nonce). */
const P21B_TABLE: readonly Row[] = [
  ['none', {}, [], []],
  ["H script-src 'self'", { headers: ["script-src 'self'"] }, 'blocked', 'blocked'],
  [
    "N page + 'nonce-N' 'self'",
    { headers: [`script-src 'nonce-${NONCE}' 'self'`], delayed: [PROBE_N] },
    'blocked',
    'blocked'
  ],
  [
    "N page + 'nonce-N' 'strict-dynamic'",
    { headers: [`script-src 'nonce-${NONCE}' 'strict-dynamic'`], delayed: [PROBE_N] },
    'blocked',
    'blocked'
  ],
  ["script-src-elem 'self'", { headers: ["script-src-elem 'self'"] }, 'blocked', 'blocked'],
  ["M script-src 'self' before <head>", { metaBefore: "script-src 'self'" }, 'blocked', 'blocked'],
  [
    "H script-src <h> 'self'",
    { headers: [`script-src ${H} 'self'`] },
    ['eval', 'inline'],
    ['eval', 'inline']
  ],
  [
    "H 'self' 'unsafe-inline' data:",
    { headers: ["script-src 'self' 'unsafe-inline' data:"] },
    ['eval'],
    ['eval']
  ],
  [
    "H 'self' 'unsafe-inline' 'unsafe-eval' (Chromium: inline via fallback)",
    { headers: ["script-src 'self' 'unsafe-inline' 'unsafe-eval'"] },
    ['data'],
    []
  ],
  [
    "M script-src 'self' before </head> (after the runtime)",
    { metaAfter: "script-src 'self'" },
    ['eval', 'inline'],
    ['eval', 'inline']
  ],
  [
    "H script-src <h> 'nonce-N' 'self', probe nonce'd",
    { headers: [`script-src ${H} 'nonce-${NONCE}' 'self'`], delayed: [PROBE_N] },
    ['eval'],
    ['eval']
  ],
  [
    "H script-src <h> 'nonce-N' 'self', probe plain",
    { headers: [`script-src ${H} 'nonce-${NONCE}' 'self'`] },
    ['eval', 'inline'],
    ['eval', 'inline']
  ],
  [
    "H script-src <h> 'strict-dynamic', no nonce anywhere",
    { headers: [`script-src ${H} 'strict-dynamic'`] },
    ['eval'],
    ['eval']
  ],
  [
    "H script-src <h> 'nonce-N' 'strict-dynamic', probe nonce'd",
    { headers: [`script-src ${H} 'nonce-${NONCE}' 'strict-dynamic'`], delayed: [PROBE_N] },
    ['eval'],
    ['eval']
  ],
  [
    "H script-src <h> 'nonce-N' 'strict-dynamic', probe plain",
    { headers: [`script-src ${H} 'nonce-${NONCE}' 'strict-dynamic'`] },
    ['eval'],
    ['eval']
  ],
  [
    "H script-src-elem 'self' 'unsafe-inline' (no eval directive)",
    { headers: ["script-src-elem 'self' 'unsafe-inline'"] },
    ['data'],
    []
  ],
  [
    "H script-src 'self'; script-src-elem 'self' 'unsafe-inline' (elem wins)",
    { headers: ["script-src 'self'; script-src-elem 'self' 'unsafe-inline'"] },
    ['eval', 'data'],
    ['eval']
  ],
  [
    "H default-src 'self' 'unsafe-inline'",
    { headers: ["default-src 'self' 'unsafe-inline'"] },
    ['eval', 'data'],
    ['eval']
  ],
  [
    "H default-src … 'unsafe-eval'; script-src 'self' 'unsafe-inline' (script-src wins for eval)",
    {
      headers: [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline'"
      ]
    },
    ['eval', 'data'],
    ['eval']
  ],
  [
    "H×2: permissive + 'self' 'unsafe-inline' (both apply)",
    {
      headers: [
        "script-src * 'unsafe-inline' 'unsafe-eval' data:",
        "script-src 'self' 'unsafe-inline'"
      ]
    },
    ['eval', 'data'],
    ['eval']
  ],
  [
    "N page + 'nonce-N' 'self' 'unsafe-inline' ('unsafe-inline' ignored)",
    { headers: [`script-src 'nonce-${NONCE}' 'self' 'unsafe-inline'`], delayed: [PROBE_N] },
    'blocked',
    'blocked'
  ],
  ["Report-Only script-src 'self'", { reportOnly: ["script-src 'self'"] }, [], []],
  [
    "H script-src <h> 'self' 'unsafe-inline' 'unsafe-eval' ('unsafe-inline' ignored beside a hash)",
    { headers: [`script-src ${H} 'self' 'unsafe-inline' 'unsafe-eval'`] },
    ['inline'],
    ['inline']
  ],
  [
    "H script-src <h> 'self' data: (fresh tab passes; fails after an earlier page's fallback)",
    { headers: [`script-src ${H} 'self' data:`] },
    ['eval', 'inline-after-fallback'],
    ['eval', 'inline']
  ]
];

/** The P21H probes (Chromium 156 + Firefox 155, real runtime, four delayed inline scripts). */
const P21H_PROBES: readonly Row[] = [
  [
    "'strict-dynamic' 'unsafe-inline' ('unsafe-inline' ignored: runtime blocked)",
    { headers: ["script-src 'strict-dynamic' 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'require-trusted-types-for: every delayed script fails',
    {
      headers: [
        "script-src 'unsafe-inline' 'unsafe-eval' data:; require-trusted-types-for 'script'"
      ]
    },
    ['eval', 'trusted-types'],
    ['eval', 'trusted-types']
  ],
  [
    'require-trusted-types-for report-only: nothing',
    { reportOnly: ["require-trusted-types-for 'script'"] },
    [],
    []
  ],
  [
    'a delayed script allowed by its hash (recreated copy)',
    { headers: [`script-src ${H} ${hash('sha256', P1.text)} 'self'`], delayed: FOUR },
    ['eval', 'data', 'inline'],
    ['eval', 'inline']
  ],
  [
    'hash of the LF-normalized text matches a CRLF script',
    {
      headers: [`script-src ${H} ${hash('sha256', PCR.text.replace(/\r\n/g, '\n'))} 'self'`],
      delayed: [PCR]
    },
    ['eval', 'data'],
    ['eval']
  ],
  [
    'hash of the raw CRLF text does not',
    { headers: [`script-src ${H} ${hash('sha256', PCR.text)} 'self'`], delayed: [PCR] },
    ['eval', 'inline'],
    ['eval', 'inline']
  ],
  [
    'report-only data: violation switches Chromium to recreating mid-document',
    { headers: [`script-src ${H} 'self' data:`], reportOnly: ["script-src 'self'"], delayed: FOUR },
    ['eval', 'inline', 'inline-after-fallback'],
    ['eval', 'inline']
  ],
  [
    'keywords and directive names caseless (no data: — Chromium falls back)',
    { headers: ["SCRIPT-SRC 'UNSAFE-INLINE' 'UNSAFE-EVAL'"], delayed: FOUR },
    ['data'],
    []
  ],
  [
    'runtime allowed by sha384',
    { headers: [`script-src ${hash('sha384', INJECTED)} 'self'`] },
    ['eval', 'inline'],
    ['eval', 'inline']
  ],
  [
    'runtime allowed by sha512 (+ unsafe-eval)',
    { headers: [`script-src ${hash('sha512', INJECTED)} 'self' 'unsafe-eval'`] },
    ['inline'],
    ['inline']
  ],
  [
    'runtime allowed by a base64url hash',
    { headers: [`script-src ${H.replace(/\+/g, '-').replace(/\//g, '_')} 'self'`] },
    ['eval', 'inline'],
    ['eval', 'inline']
  ],
  [
    'unpadded runtime hash: Chromium allows, Firefox blocks',
    { headers: [`script-src ${H.replace(/=/g, '')} 'self' 'unsafe-eval'`] },
    ['inline'],
    'blocked'
  ],
  [
    'one header line, two comma-separated policies (both apply)',
    {
      headers: [
        "script-src 'self' 'unsafe-inline', script-src 'unsafe-inline' 'unsafe-eval' data:"
      ],
      delayed: FOUR
    },
    ['eval', 'data'],
    ['eval']
  ],
  [
    'data: allowed, only the nonce allows a recreated copy',
    { headers: [`script-src ${H} 'nonce-${NONCE}' data:`], delayed: FOUR },
    ['eval', 'inline-after-fallback'],
    ['eval', 'inline']
  ],
  [
    'a repeated directive is ignored (the first counts)',
    {
      headers: ["script-src 'unsafe-inline' 'unsafe-eval' data:; script-src 'self'"],
      delayed: FOUR
    },
    [],
    []
  ],
  [
    "<h> 'strict-dynamic' 'unsafe-inline' 'unsafe-eval'",
    { headers: [`script-src ${H} 'strict-dynamic' 'unsafe-inline' 'unsafe-eval'`], delayed: FOUR },
    [],
    []
  ],
  ['empty script-src is none', { headers: ['script-src; default-src *'] }, 'blocked', 'blocked'],
  [
    '* never matches data: (Chromium falls back)',
    { headers: ["script-src * 'unsafe-inline'"], delayed: FOUR },
    ['eval', 'data'],
    ['eval']
  ],
  [
    'nonce prefix caseless, value exact',
    { headers: [`script-src ${H} 'NONCE-${NONCE}' 'nonce-n0nce' 'unsafe-eval'`], delayed: [PN] },
    [],
    []
  ],
  [
    'a nonce value differing in case does not match',
    {
      headers: [`script-src ${H} 'nonce-${NONCE.toLowerCase()}' 'unsafe-eval'`],
      delayed: [PN]
    },
    ['inline'],
    ['inline']
  ],
  [
    'an element with <script in an attribute is not nonceable',
    {
      headers: [`script-src ${H} 'nonce-${NONCE}' 'unsafe-eval'`],
      delayed: [{ ...PN, attrs: ' data-x="<script"' }]
    },
    ['inline'],
    ['inline']
  ],
  [
    'meta after the runtime binds its later work only',
    { metaAfter: "script-src 'self' 'unsafe-inline'", delayed: FOUR },
    ['eval', 'data'],
    ['eval']
  ],
  // Fix-round probes (Chromium 156 + Firefox 155).
  ['header sandbox (no flags): no script runs', { headers: ['sandbox'] }, 'blocked', 'blocked'],
  [
    'header sandbox allow-scripts only: the runtime throws on sessionStorage',
    { headers: ['sandbox allow-scripts'] },
    'blocked',
    'blocked'
  ],
  [
    'header sandbox with both flags (caseless): evaluated as usual',
    { headers: ['sandbox ALLOW-SCRIPTS Allow-Same-Origin bogus'] },
    [],
    []
  ],
  [
    'a sandbox in a comma-joined policy applies',
    { headers: ["script-src 'unsafe-inline' 'unsafe-eval' data:, sandbox allow-scripts"] },
    'blocked',
    'blocked'
  ],
  [
    'two policies sandbox: their flags intersect',
    { headers: ['sandbox allow-scripts allow-same-origin', 'sandbox allow-scripts'] },
    'blocked',
    'blocked'
  ],
  ['report-only sandbox is ignored', { reportOnly: ['sandbox'] }, [], []],
  ['meta sandbox is ignored', { metaBefore: 'sandbox' }, [], []],
  [
    "require-trusted-types-for 'SCRIPT' is invalid (no effect)",
    {
      headers: [
        "script-src 'unsafe-inline' 'unsafe-eval' data:; require-trusted-types-for 'SCRIPT'"
      ]
    },
    [],
    []
  ],
  [
    "require-trusted-types-for 'SCRIPT' 'script' requires Trusted Types",
    {
      headers: [
        "script-src 'unsafe-inline' 'unsafe-eval' data:; require-trusted-types-for 'SCRIPT' 'script'"
      ]
    },
    ['eval', 'trusted-types'],
    ['eval', 'trusted-types']
  ],
  [
    'meta before the runtime, comma: two policies on Chromium, one on Firefox',
    { metaBefore: "script-src 'unsafe-inline' 'unsafe-eval' data:, script-src 'self'" },
    'blocked',
    []
  ],
  [
    'meta after the runtime, comma: two policies on Chromium, one on Firefox',
    { metaAfter: "script-src 'unsafe-inline' 'unsafe-eval' data:, script-src 'self'" },
    ['eval', 'inline'],
    []
  ],
  [
    'a repeated attribute: not nonceable in place (Chromium), its recreated copy is',
    {
      headers: [`script-src ${H} 'nonce-${NONCE}' 'unsafe-eval'`],
      delayed: [{ ...PN, attrs: ' id=a id=b' }]
    },
    ['data'],
    []
  ],
  [
    'a repeated attribute under data: loads in place',
    {
      headers: [`script-src ${H} 'nonce-${NONCE}' 'unsafe-eval' data:`],
      delayed: [{ ...PN, attrs: ' id=a id=b' }]
    },
    [],
    []
  ],
  [
    'a nonce spelled with &plus; / &sol; matches',
    {
      headers: [`script-src ${H} 'nonce-N+0/x' 'unsafe-eval'`],
      delayed: [{ ...PN, nonce: 'N&plus;0&sol;x' }]
    },
    [],
    []
  ],
  [
    'an unreadable nonce under a nonce source: limits unknown',
    {
      headers: [`script-src ${H} 'nonce-${NONCE}' 'unsafe-eval'`],
      delayed: [{ ...PN, nonce: 'N0nce&nbsp;' }]
    },
    'unreadable',
    'unreadable'
  ],
  [
    'an unreadable nonce without nonce sources does not matter',
    {
      headers: ["script-src 'unsafe-inline' 'unsafe-eval' data:"],
      delayed: [{ ...PN, attrs: ' data-x="&copy;"' }]
    },
    [],
    []
  ]
];

describe('evaluateSimulationCsp — receipt rows', () => {
  for (const [name, page, chromium, firefox] of [...P21B_TABLE, ...P21H_PROBES]) {
    it(`${name} — Chromium`, () => {
      expect(verdict(page, 'chromium')).toEqual(chromium);
    });
    it(`${name} — Firefox`, () => {
      expect(verdict(page, 'firefox')).toEqual(firefox);
    });
  }
});

describe('evaluateSimulationCsp — inputs', () => {
  const served = servedPage();
  const simulated = simulatedPage([PROBE], served);
  const strict = (browser: SimulationCspBrowser): SimulationCspInput => ({
    browser,
    headers: [{ name: 'Content-Security-Policy', value: "script-src 'none'" }],
    metas: []
  });

  it('allows everything when no policy is known', () => {
    expect(evaluateSimulationCsp({ csp: undefined, served, simulated, runtime: RUNTIME })).toEqual({
      blocked: false,
      limits: []
    });
  });

  it('allows everything when the page has no <head…> (no runtime injected)', () => {
    const headless = '<p>x</p>';
    expect(
      evaluateSimulationCsp({
        csp: strict('chromium'),
        served: headless,
        simulated: headless,
        runtime: RUNTIME
      })
    ).toEqual({ blocked: false, limits: [] });
  });

  it('a meta whose &NewLine; separates a hash source blocks the runtime (scanned, decoded)', () => {
    const page = servedPage(
      `<meta http-equiv="Content-Security-Policy" content="script-src &#39;unsafe-inline&#39; &#39;self&#39;&NewLine;&#39;sha256-${'A'.repeat(43)}=&#39;">`
    );
    for (const browser of ['chromium', 'firefox'] as const) {
      const { metas, unreadable } = cspMetaPolicies(page);
      expect(unreadable).toBe(false);
      const csp: SimulationCspInput = { browser, headers: [], metas };
      expect(
        evaluateSimulationCsp({
          csp,
          served: page,
          simulated: simulatedPage([PROBE], page),
          runtime: RUNTIME
        })
      ).toEqual({ blocked: true });
    }
  });

  it('an unreadable meta: the readable policies still block; otherwise unreadable', () => {
    const page = servedPage('', '<meta http-equiv="Content-Security-Policy" content="a&nbsp;">');
    const simulated = simulatedPage([PROBE], page);
    const cases: readonly (readonly [string, SimulationCspVerdict])[] = [
      ["script-src 'self'", { blocked: true }],
      ['sandbox', { blocked: true }],
      ["script-src 'unsafe-inline'", { blocked: false, unavailable: 'unreadable' }]
    ];
    for (const browser of ['chromium', 'firefox'] as const) {
      for (const [header, verdict] of cases) {
        const csp: SimulationCspInput = {
          browser,
          headers: [{ name: 'Content-Security-Policy', value: header }],
          metas: [],
          metasUnreadable: true
        };
        expect(
          evaluateSimulationCsp({ csp, served: page, simulated, runtime: RUNTIME }),
          `${browser}: ${header}`
        ).toEqual(verdict);
      }
    }
  });

  it('an unreadable meta: a readable meta binding the runtime still blocks it', () => {
    const page = servedPage(
      `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`
    );
    const offset = page.indexOf('<meta');
    for (const browser of ['chromium', 'firefox'] as const) {
      const csp: SimulationCspInput = {
        browser,
        headers: [],
        metas: [{ content: "script-src 'self'", offset }],
        metasUnreadable: true
      };
      const simulated = simulatedPage([PROBE], page);
      expect(evaluateSimulationCsp({ csp, served: page, simulated, runtime: RUNTIME })).toEqual({
        blocked: true
      });
    }
  });

  it('ignores other header names and empty or directive-less policies', () => {
    const csp: SimulationCspInput = {
      browser: 'firefox',
      headers: [
        { name: 'X-Content-Security-Policy', value: "script-src 'none'" },
        { name: 'content-security-policy', value: ' ; ,  ' }
      ],
      metas: [{ content: '  ', offset: 0 }]
    };
    expect(evaluateSimulationCsp({ csp, served, simulated, runtime: RUNTIME })).toEqual({
      blocked: false,
      limits: []
    });
  });

  it('reads the hash of the runtime as written into the page (replacement syntax applied)', () => {
    const raw = hash('sha256', RUNTIME);
    const csp: SimulationCspInput = {
      browser: 'chromium',
      headers: [{ name: 'content-security-policy', value: `script-src ${raw} 'unsafe-eval'` }],
      metas: []
    };
    expect(evaluateSimulationCsp({ csp, served, simulated, runtime: RUNTIME })).toEqual({
      blocked: true
    });
  });

  it('a meta after the runtime does not block it, one before does (offset vs the <head…> end)', () => {
    const page = '<html><head><title>t</title></head></html>';
    const at = (offset: number, browser: SimulationCspBrowser): SimulationCspInput => ({
      browser,
      headers: [],
      metas: [{ content: "script-src 'none'", offset }]
    });
    const check = (offset: number): boolean =>
      evaluateSimulationCsp({
        csp: at(offset, 'firefox'),
        served: page,
        simulated: page,
        runtime: RUNTIME
      }).blocked;
    expect(check(page.indexOf('<head>'))).toBe(true);
    expect(check(page.indexOf('<head>') + '<head>'.length)).toBe(false);
  });
});

describe('delayedInlineScripts', () => {
  it('reads the delayed inline scripts only, with nonce and parser-normalized text', () => {
    const html = [
      '<script>plain()</script>',
      '<script type="rocketlazyloadscript" data-rocket-src="/a.js"></script>',
      '<script type="ROCKETLAZYLOADSCRIPT" nonce="n&#61;">a()\r\nb()\rc()\0</script>',
      '<script type="rocketlazyloadscript" nomodule>skipped()</script>',
      '<script type="text/rocketlazyloadscript" nonce>d()</script>',
      '<script type="rocketlazyloadscript" nonce="x" onerror="<style>">e()</script>'
    ].join('');
    expect(delayedInlineScripts(html)).toEqual([
      { nonce: 'n=', inPlaceNonce: 'n=', nonceUnreadable: false, text: 'a()\nb()\nc()\uFFFD' },
      { nonce: null, inPlaceNonce: null, nonceUnreadable: false, text: 'd()' },
      { nonce: null, inPlaceNonce: null, nonceUnreadable: false, text: 'e()' }
    ]);
  });

  it('nonceability: hijack text decoded, repeats in place only, unreadable values flagged', () => {
    const html = [
      '<script type="rocketlazyloadscript" nonce="x" data-a="&lt;script">a()</script>',
      '<script type="rocketlazyloadscript" nonce="x" id=a ID=b>b()</script>',
      '<script type="rocketlazyloadscript" nonce="x&nbsp;">c()</script>',
      '<script type="rocketlazyloadscript" data-a="&nbsp;">d()</script>'
    ].join('');
    expect(
      delayedInlineScripts(html).map(({ nonce, inPlaceNonce, nonceUnreadable }) => [
        nonce,
        inPlaceNonce,
        nonceUnreadable
      ])
    ).toEqual([
      [null, null, false],
      ['x', null, false],
      [null, null, true],
      [null, null, false]
    ]);
  });
});
