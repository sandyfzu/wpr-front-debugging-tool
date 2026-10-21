/**
 * The support report's golden tests: the committed expected markdown below
 * IS the report format spec — a format change shows up here as a readable
 * line diff. The matrix covers optimizations present/absent, headers
 * present/empty/null, cached with and without a stamp, the undefined-
 * references list (incl. the cross-origin sentinel), plus the escaping and
 * redaction rules for page-derived strings.
 */
import { describe, expect, it } from 'vitest';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../wp-rocket/constants';
import type { FdtData } from '../wp-rocket/types';
import {
  buildSupportReport,
  codeSpan,
  SUPPORT_REPORT_TITLE,
  type SupportReportContext
} from './support-report';
import { emptyDetections, makeReportData } from './support-report.fixtures';
import { cacheCopy } from '../detection/cache-context';
import { HUD_FEATURES } from '../detection/hud';
import { redactPageHeaders } from '../redaction/headers';
import { PLANTED, PLANTED_RAW_HEADERS } from '../redaction/planted-secrets.fixtures';

/** A fixed provenance: 2026-10-14 12:00:00 UTC, version 1.4.0, a known page. */
const CONTEXT: SupportReportContext = {
  generatedAt: Date.UTC(2026, 9, 14, 12, 0, 0),
  extensionVersion: '1.4.0',
  pageUrl: 'https://example.com/shop/'
};

/** The provenance with neither the page URL nor the version known. */
const BARE_CONTEXT: SupportReportContext = {
  generatedAt: Date.UTC(2026, 9, 14, 12, 0, 0),
  extensionVersion: null,
  pageUrl: null
};

/** A fully populated page: plugin cached, platform matched, mixed optimizations. */
function fullData(): FdtData {
  return makeReportData({
    pageHeaders: [
      { name: 'Server', value: 'nginx' },
      { name: 'X-Powered-By', value: 'WP Engine/7.3' },
      { name: 'Cache-Control', value: 'max-age=3600' },
      { name: 'Set-Cookie', value: 'wordpress_sess=abc123; path=/' },
      { name: 'X-Weird', value: 'a|b `c`' },
      { name: 'age', value: '120' },
      { name: 'cf-cache-status', value: 'HIT' }
    ],
    wordpressVersion: '6.8.1',
    undefinedReferencesOnPage: ['jQuery', UNDEFINED_REFERENCE_EXTERNAL_ERROR],
    wprDetections: {
      ...emptyDetections(),
      wpr: {
        present: true,
        cacheMarkerFound: true,
        cached: true,
        version: '3.20.1',
        timeStamp: 1791342253
      },
      async_css: { present: true, source: 'footprint' },
      delay_js: { present: true, scripts: [], version: '2.0', delayedScripts: 3, source: 'meta' },
      lazyload: { present: true, images: [], source: 'footprint' },
      // Declared by the meta: the honest-unknown copy must not appear.
      image_dimensions: { present: true, source: 'meta' },
      // An enabled family feature not yet applied reads "collecting".
      priority_elements_beacon: { present: true, status: { lrc: true }, isMobile: false },
      lazyload_iframes: { present: true, replaceImage: true },
      rocket_above_the_fold_optimization: {
        present: true,
        lcpComment: true,
        preloadedImages: ['/a.jpg', '/b.jpg']
      }
    }
  });
}

/** The golden report for {@link fullData}. */
const FULL_GOLDEN = [
  '## WP Rocket page report',
  '',
  '- **Page:** `https://example.com/shop/`',
  '- **Generated:** 2026-10-14 12:00:00 UTC',
  '- **Extension version:** `1.4.0`',
  '- **WP Rocket:** Detected, version `3.20.1`',
  '- **Page cache:** Cached, generated 2026-10-07 03:04:13 UTC',
  '- **WordPress version:** `6.8.1`',
  '- **Platform:** WP Engine (matched by `X-Powered-By`)',
  '- **Server:** `nginx`',
  '- **Optimizations:** 6 of 16 active',
  '',
  '### Detections',
  '',
  '| Feature | Status | Source | Details |',
  '| --- | --- | --- | --- |',
  '| Server | Active | — | `nginx` |',
  '| Known Platform | Active | — | WP Engine (matched by `X-Powered-By`) |',
  '| WP Rocket | Active | — | Version `3.20.1` |',
  '| Cached | Active | — | Generated 2026-10-07 03:04:13 UTC |',
  '| Load CSS asynchronously | Active | Page footprint | Optimize CSS delivery |',
  '| Delay JavaScript execution | Active | Generator meta | Version `2.0` |',
  '| Load JavaScript deferred | Not active | — | — |',
  '| Minify CSS files | Not active | — | — |',
  '| Minify JavaScript files | Not active | — | — |',
  '| LazyLoad for images | Active | Page footprint | — |',
  '| LazyLoad for iframes/videos | Active | — | Replace iframe with preview image |',
  '| LazyLoad CSS backgrounds | Not active | — | — |',
  '| Add missing image dimensions | Active | Generator meta | — |',
  '| Self-host Google Fonts | Unknown | — | No generator meta declaration decided it and no self-hosted font link was found; fonts self-hosted through other markup are not detected, so its state is unknown. |',
  '| Preload Links | Not active | — | — |',
  '| RocketCDN | Not active | — | — |',
  '| Optimize Critical Images | Active | — | Preloaded images detected: 2 |',
  '| Automatic Lazy Rendering | Collecting | — | Enabled, not yet applied on this page. |',
  '| Preload fonts | Not active | — | — |',
  '| Preconnect to External Domains | Not active | — | — |',
  '| Priority Elements beacon | Active | — | — |',
  '',
  '### Response headers (7)',
  '',
  '| Header | Value |',
  '| --- | --- |',
  '| `Cache-Control` | `max-age=3600` |',
  '| `age` | `120` |',
  '| `cf-cache-status` | `HIT` |',
  '| `Server` | `nginx` |',
  '| `X-Powered-By` | `WP Engine/7.3` |',
  '| `Set-Cookie` | `wordpress_sess` (value redacted) |',
  '| `X-Weird` | `` a\\|b `c` `` |',
  '',
  '### Undefined references (2)',
  '',
  '- `jQuery`',
  '- A cross-origin script error (the browser hides its details)',
  ''
].join('\n');

/** The golden report for a page with nothing detected and no header capture. */
const ABSENT_GOLDEN = [
  '## WP Rocket page report',
  '',
  '- **Generated:** 2026-10-14 12:00:00 UTC',
  '- **Extension version:** Not available',
  '- **WP Rocket:** Not detected',
  '- **WordPress version:** Not declared by the page',
  '- **Optimizations:** 0 of 16 active',
  '',
  '### Detections',
  '',
  '| Feature | Status | Source | Details |',
  '| --- | --- | --- | --- |',
  '| WP Rocket | Not active | — | — |',
  '| Optimize CSS delivery | Not active | — | — |',
  '| Delay JavaScript execution | Not active | — | — |',
  '| Load JavaScript deferred | Not active | — | — |',
  '| Minify CSS files | Not active | — | — |',
  '| Minify JavaScript files | Not active | — | — |',
  '| LazyLoad for images | Not active | — | — |',
  '| LazyLoad for iframes/videos | Not active | — | — |',
  '| LazyLoad CSS backgrounds | Not active | — | — |',
  '| Add missing image dimensions | Not active | — | — |',
  '| Self-host Google Fonts | Not active | — | — |',
  '| Preload Links | Not active | — | — |',
  '| RocketCDN | Not active | — | — |',
  '| Optimize Critical Images | Not active | — | — |',
  '| Automatic Lazy Rendering | Not active | — | — |',
  '| Preload fonts | Not active | — | — |',
  '| Preconnect to External Domains | Not active | — | — |',
  '| Priority Elements beacon | Not active | — | — |',
  '',
  '### Response headers',
  '',
  'Not captured for this page.',
  '',
  '### Undefined references (0)',
  '',
  'None were reported by the page.',
  ''
].join('\n');

describe('buildSupportReport — golden', () => {
  it('renders the full matrix exactly (present, cached, headers, references)', () => {
    expect(buildSupportReport(fullData(), CONTEXT)).toBe(FULL_GOLDEN);
  });

  it('renders the all-absent page exactly (headers null, no references)', () => {
    expect(buildSupportReport(makeReportData(), BARE_CONTEXT)).toBe(ABSENT_GOLDEN);
  });

  it('is deterministic: same inputs, same bytes (the clock is an argument)', () => {
    expect(buildSupportReport(fullData(), CONTEXT)).toBe(buildSupportReport(fullData(), CONTEXT));
  });
});

describe('buildSupportReport — branches', () => {
  /** The report's lines for one payload. */
  const lines = (data: FdtData): string[] => buildSupportReport(data, CONTEXT).split('\n');

  it('states an empty header capture distinctly from a missing one', () => {
    const report = lines(makeReportData({ pageHeaders: [] }));
    expect(report).toContain('### Response headers (0)');
    expect(report).toContain('None were captured for this page.');
    // An empty capture still yields the server card (not active) but no server fact.
    expect(report.some((line) => line.startsWith('- **Server:**'))).toBe(false);
    expect(report).toContain('| Server | Not active | — | — |');
  });

  it('adds the truncation note under the headers heading only for a marked capture', () => {
    const clipped = [{ name: 'content-security-policy', value: 'x'.repeat(4096) }];
    const marked = lines(makeReportData({ pageHeaders: clipped, pageHeadersTruncated: true }));
    const heading = marked.indexOf('### Response headers (1)');
    expect(marked[heading + 2]).toBe('Some header values were clipped to 4,096 characters.');
    expect(marked[heading + 4]).toBe('| Header | Value |');
    const plain = lines(makeReportData({ pageHeaders: clipped }));
    expect(plain.some((line) => line.includes('clipped'))).toBe(false);
  });

  it('reports a cached page without a representable stamp honestly', () => {
    const report = lines(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: null,
            timeStamp: 9e20
          }
        }
      })
    );
    expect(report).toContain('- **WP Rocket:** Detected (version not available)');
    expect(report).toContain('- **Page cache:** Cached (generation time not available)');
    expect(report).toContain('| WP Rocket | Active | — | Version not available |');
    expect(report).toContain('| Cached | Active | — | Time not available |');
  });

  it('spells the cache vocabulary per evidence class', () => {
    const present = (overrides: Record<string, unknown>) =>
      makeReportData({
        wprDetections: {
          ...makeReportData().wprDetections,
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: null,
            timeStamp: null,
            ...overrides
          }
        }
      });

    const signature = buildSupportReport(present({ cacheMarkerFound: true }), BARE_CONTEXT);
    expect(signature).toContain(
      '- **Page cache:** Plugin fingerprint found, cache not proven for this visit'
    );

    const possibly = buildSupportReport(
      { ...present({}), pageHeaders: [{ name: 'sg-f-cache', value: 'HIT' }] },
      BARE_CONTEXT
    );
    expect(possibly).toContain('- **Page cache:** Possibly cached (SiteGround');

    const bypass = buildSupportReport({ ...present({}), bypassAttested: true }, BARE_CONTEXT);
    expect(bypass).toContain(
      '- **Page cache:** Cache bypass requested (nowprocket; no WP Rocket signature; cache state not proven)'
    );

    // A captured host serve outranks the bypass and keeps its qualification.
    const bypassedHost = buildSupportReport(
      {
        ...present({}),
        pageHeaders: [{ name: 'cf-cache-status', value: 'HIT' }],
        bypassAttested: true
      },
      BARE_CONTEXT
    );
    expect(bypassedHost).toContain(
      '- **Page cache:** Possibly cached (Cloudflare cache-layer marker; no WP Rocket signature; cache bypass requested)'
    );
  });

  it('uses the copy module for the cached line (single declaring site)', () => {
    const report = buildSupportReport(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: true,
            version: '3.1',
            timeStamp: 1791342253
          }
        }
      }),
      BARE_CONTEXT
    );
    expect(report).toContain(
      `- **Page cache:** ${
        cacheCopy({
          kind: 'cached',
          seconds: 1791342253,
          formatted: '2026-10-07 03:04:13 UTC'
        }).report
      }`
    );
  });

  it('spells the header-capture edge states', () => {
    const captured = (data: Partial<Parameters<typeof buildSupportReport>[0]>) =>
      buildSupportReport(
        {
          ...makeReportData({
            wprDetections: {
              ...emptyDetections(),
              wpr: {
                present: true,
                cacheMarkerFound: false,
                cached: false,
                version: null,
                timeStamp: null
              }
            }
          }),
          ...data
        },
        BARE_CONTEXT
      );
    expect(captured({ pageHeaders: [] })).toContain(
      '- **Page cache:** Cache not detected (response headers unavailable)'
    );
    expect(
      captured({
        pageHeaders: [{ name: 'server', value: 'nginx' }],
        pageHeadersTruncated: true
      })
    ).toContain('- **Page cache:** Cache not detected (header capture truncated)');
    expect(captured({ pageHeaders: [{ name: 'cf-cache-status', redacted: true }] })).toContain(
      '- **Page cache:** Cache not detected (cache header value withheld)'
    );
  });

  it('reports a present page without a signature as cache not detected', () => {
    const report = lines(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: '3.1',
            timeStamp: null
          }
        }
      })
    );
    expect(report).toContain('- **Page cache:** Cache not detected (response headers unavailable)');
    expect(report.some((line) => line.startsWith('| Cached |'))).toBe(false);
  });

  it('renders a value-less header row and a value-less Set-Cookie as their absence', () => {
    const report = lines(
      makeReportData({
        pageHeaders: [{ name: 'X-Flag' }, { name: 'set-cookie', value: '=orphan' }]
      })
    );
    expect(report).toContain('| `X-Flag` | — |');
    expect(report).toContain('| `set-cookie` | (value redacted) |');
    expect(report.join('\n')).not.toContain('orphan');
  });

  it('never lets a Set-Cookie value reach the report, in any casing', () => {
    const report = buildSupportReport(
      makeReportData({
        pageHeaders: [
          { name: 'SET-COOKIE', value: 'sid=TOPSECRET; HttpOnly' },
          { name: 'set-cookie', value: 'other=ALSOSECRET' }
        ]
      }),
      CONTEXT
    );
    expect(report).not.toContain('TOPSECRET');
    expect(report).not.toContain('ALSOSECRET');
    expect(report).not.toContain('HttpOnly');
    expect(report).toContain('`sid` (value redacted)');
  });

  it('keeps hostile page strings inert: no row split, no markdown injection', () => {
    const report = lines(
      makeReportData({
        pageHeaders: [{ name: 'X-Evil', value: '| injected | row |\n## heading' }],
        undefinedReferencesOnPage: ['`tick`', '**bold**']
      })
    );
    expect(report).toContain('| `X-Evil` | `\\| injected \\| row \\| ## heading` |');
    expect(report).toContain('- `` `tick` ``');
    expect(report).toContain('- `**bold**`');
    expect(report.filter((line) => line.startsWith('## '))).toEqual([SUPPORT_REPORT_TITLE]);
  });
});

describe('buildSupportReport — provenance', () => {
  it('omits a blank page URL and states an unrepresentable time honestly', () => {
    const report = buildSupportReport(makeReportData(), {
      generatedAt: Number.NaN,
      extensionVersion: '2',
      pageUrl: '   '
    });
    expect(report).not.toContain('**Page:**');
    expect(report).toContain('- **Generated:** Time not available');
    expect(report).toContain('- **Extension version:** `2`');
  });

  it('truncates a sub-second stamp to the second it happened in (rounding would show :01)', () => {
    const report = buildSupportReport(makeReportData(), {
      ...CONTEXT,
      generatedAt: Date.UTC(2026, 9, 14, 12, 0, 0, 900)
    });
    expect(report).toContain('- **Generated:** 2026-10-14 12:00:00 UTC');
  });
});

describe('buildSupportReport — secrets never reach the report', () => {
  it('rebuilds the page URL: no credentials, no fragment, sensitive params redacted', () => {
    const report = buildSupportReport(makeReportData(), {
      ...CONTEXT,
      pageUrl: 'https://user:pw@host.test/?preview_nonce=X&key=Y&nowprocket#access_token=Z'
    });
    expect(report).toContain(
      '- **Page:** `https://host.test/?preview_nonce=[redacted]&key=[redacted]&nowprocket`'
    );
    for (const secret of ['user', 'pw@', '=X', '=Y', 'access_token', '=Z']) {
      expect(report).not.toContain(secret);
    }
  });

  it('omits a page URL that is not http(s), and flattens injected lines', () => {
    expect(
      buildSupportReport(makeReportData(), { ...CONTEXT, pageUrl: 'javascript:alert(1)' })
    ).not.toContain('**Page:**');
    const report = buildSupportReport(makeReportData(), {
      ...CONTEXT,
      pageUrl: 'https://x.test/a\n## injected'
    });
    expect(report).toContain('- **Page:** `https://x.test/a`');
    expect(report.split('\n').filter((line) => line.startsWith('## '))).toEqual([
      SUPPORT_REPORT_TITLE
    ]);
  });

  /** The report for one header row. */
  const reportFor = (name: string, value: string): string =>
    buildSupportReport(makeReportData({ pageHeaders: [{ name, value }] }), CONTEXT);

  it('keeps nothing of a nameless Set-Cookie', () => {
    const report = reportFor('Set-Cookie', 'NAMELESSSECRETTOKEN');
    expect(report).not.toContain('NAMELESSSECRETTOKEN');
    expect(report).toContain('| `Set-Cookie` | (value redacted) |');
  });

  it('cuts a Set-Cookie at its first segment: attributes never pass as a name', () => {
    const report = reportFor('Set-Cookie', 'tok; Path=/; Secure');
    expect(report).not.toContain('tok');
    expect(report).not.toContain('Path');
    expect(report).toContain('| `Set-Cookie` | (value redacted) |');
    expect(reportFor('set-cookie', ' sid = abc; Path=/')).toContain('`sid` (value redacted)');
  });

  it.each([
    'Cookie',
    'Authorization',
    'Proxy-Authorization',
    'X-Debug-Token',
    'X-Debug-Token-Link',
    'X-Session-Id'
  ])('redacts the whole value of %s', (name) => {
    const report = reportFor(name, 'HUNTER2-SECRET');
    expect(report).not.toContain('HUNTER2-SECRET');
    expect(report).toContain(`| \`${name}\` | (value redacted) |`);
  });

  it('renders capture-withheld rows exactly as it renders the same rows unflagged', () => {
    const raw = fullData();
    const captured = { ...raw, pageHeaders: redactPageHeaders(raw.pageHeaders ?? []) };
    expect(captured.pageHeaders.some((row) => row.redacted === true)).toBe(true);
    expect(buildSupportReport(captured, CONTEXT)).toBe(buildSupportReport(raw, CONTEXT));
  });

  it('carries no planted secret, from a capture-redacted or a raw header list', () => {
    for (const pageHeaders of [redactPageHeaders(PLANTED_RAW_HEADERS), PLANTED_RAW_HEADERS]) {
      const report = buildSupportReport(makeReportData({ pageHeaders }), CONTEXT);
      expect(report).not.toContain(PLANTED);
      expect(report).toContain('`wordpress_logged_in_ab` (value redacted)');
    }
  });

  it('flattens C1, line-separator and bidi controls in page strings', () => {
    const report = reportFor('X-Note', 'a\u0085b\u2028c\u202ed\u2067e');
    expect(report).toContain('| `X-Note` | `a b c d e` |');
  });
});

describe('codeSpan', () => {
  it.each([
    ['plain', false, '`plain`'],
    ['a`b', false, '``a`b``'],
    ['``x', false, '``` ``x ```'],
    ['x`', false, '`` x` ``'],
    [' spaced ', false, '`  spaced  `'],
    ['a|b', false, '`a|b`'],
    ['a|b', true, '`a\\|b`'],
    ['line\nbreak\ttab', false, '`line break tab`'],
    ['', false, '—'],
    ['   ', true, '—'],
    ['\u0000\u0007', false, '—'],
    ['a\u009fb', false, '`a b`'],
    ['x\u2029y', false, '`x y`'],
    ['\u202egnp.exe', false, '`gnp.exe`'],
    ['l\u200er\u200fm\u061c', false, '`l r m`'],
    ['\u2066i\u2069', false, '`i`']
  ])('codeSpan(%j, inTable=%s) → %s', (value, inTable, expected) => {
    expect(codeSpan(value, inTable)).toBe(expected);
  });
});

describe('buildSupportReport — the HUD registry feeds the detections table', () => {
  it('names every feature row exactly as the registry and the cards do', () => {
    const data = makeReportData();
    const report = buildSupportReport(data, CONTEXT).split('\n');
    // The RUCSS/async pair shares the merged "Optimize CSS delivery" card.
    for (const feature of HUD_FEATURES) {
      if (feature.row === 'remove_unused_css' || feature.row === 'async_css') continue;
      expect(
        report.filter((line) => line.startsWith(`| ${feature.label} |`)),
        feature.label
      ).toHaveLength(1);
    }
  });

  it('reports the evidence source and the why of an unsure verdict in their cells', () => {
    const report = lines(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: false,
            version: null,
            timeStamp: null
          },
          minify_css: { present: true, source: 'meta' }
        }
      })
    );
    expect(report).toContain('| Minify CSS files | Active | Generator meta | — |');
    expect(report.find((line) => line.startsWith('| Add missing image dimensions |'))).toBe(
      '| Add missing image dimensions | Unknown | — | No generator meta declaration decided it, and this feature leaves no other footprint, so its state is unknown. |'
    );
  });

  it('names the hosting cache layer beside a signature without the debug stamp', () => {
    const report = lines(
      makeReportData({
        pageHeaders: [{ name: 'sg-f-cache', value: 'HIT' }],
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: false,
            version: null,
            timeStamp: null
          }
        }
      })
    );
    expect(report).toContain(
      '- **Page cache:** Plugin fingerprint found, cache not proven for this visit'
    );
    expect(report).toContain(
      "- **Hosting cache layer:** SiteGround cache-layer marker captured (that layer served this response, so this visit may not have reached WP Rocket's cache)"
    );
  });

  it('never repeats the layer on a cached page (stamp) or a possibly-cached one (already named)', () => {
    const headers = [{ name: 'cf-cache-status', value: 'HIT' }];
    const cached = lines(
      makeReportData({
        pageHeaders: headers,
        wprDetections: {
          ...emptyDetections(),
          wpr: { present: true, cacheMarkerFound: true, cached: true, version: null, timeStamp: 1 }
        }
      })
    );
    expect(cached.some((line) => line.startsWith('- **Hosting cache layer:**'))).toBe(false);
    const possibly = lines(
      makeReportData({
        pageHeaders: headers,
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: false,
            cached: false,
            version: null,
            timeStamp: null
          },
          remove_unused_css: { present: true }
        }
      })
    );
    expect(possibly.filter((line) => line.includes('Cloudflare'))).toEqual([
      '- **Page cache:** Possibly cached (Cloudflare cache-layer marker; no WP Rocket signature)'
    ]);
  });

  it('a collecting family row states its why once — no beacon subtitle beside it', () => {
    const report = lines(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          priority_elements_beacon: { present: true, status: { atf: true }, isMobile: null }
        }
      })
    );
    expect(report).toContain(
      '| Optimize Critical Images | Collecting | — | Enabled, not yet applied on this page. |'
    );
    expect(report.join('\n')).not.toContain('Beacon present');
  });

  it('omits the hosting cache-layer line without a served marker', () => {
    const report = lines(
      makeReportData({
        pageHeaders: [{ name: 'cf-cache-status', value: 'MISS' }],
        wprDetections: {
          ...emptyDetections(),
          wpr: {
            present: true,
            cacheMarkerFound: true,
            cached: false,
            version: null,
            timeStamp: null
          }
        }
      })
    );
    expect(report.some((line) => line.startsWith('- **Hosting cache layer:**'))).toBe(false);
  });

  it('code-spans a hostile WordPress version (page-derived text)', () => {
    const report = lines(makeReportData({ wordpressVersion: '6.8`|x' }));
    expect(report).toContain('- **WordPress version:** ``6.8`|x``');
  });
});

/** The report's lines for one payload (the default provenance). */
function lines(data: FdtData): string[] {
  return buildSupportReport(data, CONTEXT).split('\n');
}
