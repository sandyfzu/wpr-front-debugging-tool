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
import { buildSupportReport, codeSpan, SUPPORT_REPORT_TITLE } from './support-report';
import { emptyDetections, makeReportData } from './support-report.fixtures';

/** A fully populated page: plugin cached, platform matched, mixed optimizations. */
function fullData(): FdtData {
  return makeReportData({
    pageHeaders: [
      { name: 'Server', value: 'nginx' },
      { name: 'X-Powered-By', value: 'WP Engine/7.3' },
      { name: 'Cache-Control', value: 'max-age=3600' },
      { name: 'Set-Cookie', value: 'wordpress_sess=abc123; path=/' },
      { name: 'X-Weird', value: 'a|b `c`' },
      { name: 'age', value: '120' }
    ],
    undefinedReferencesOnPage: ['jQuery', UNDEFINED_REFERENCE_EXTERNAL_ERROR],
    wprDetections: {
      ...emptyDetections(),
      wpr: { present: true, cached: true, version: '3.20.1', timeStamp: 1791342253 },
      async_css: { present: true },
      delay_js: { present: true, scripts: [], version: '2.0', delayedScripts: 3 },
      lazyload: { present: true, images: [] },
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
  '- **WP Rocket:** Detected, version `3.20.1`',
  '- **Page cache:** Cached, generated 2026-10-07 03:04:13 UTC',
  '- **Platform:** WP Engine (matched by `X-Powered-By`)',
  '- **Server:** `nginx`',
  '- **Optimizations:** 5 of 14 active',
  '',
  '### Detections',
  '',
  '| Feature | Status | Details |',
  '| --- | --- | --- |',
  '| Server | Active | `nginx` |',
  '| Known Platform | Active | WP Engine (matched by `X-Powered-By`) |',
  '| WP Rocket | Active | Version `3.20.1` |',
  '| Cached | Active | Generated 2026-10-07 03:04:13 UTC |',
  '| Load CSS asynchronously | Active | Optimize CSS Delivery |',
  '| Lazyload for CSS background images | Not active | — |',
  '| Minify CSS files | Not active | — |',
  '| Minify JavaScript files | Not active | — |',
  '| Preload Links | Not active | — |',
  '| RocketCDN | Not active | — |',
  '| Delay JavaScript execution | Active | Version `2.0` |',
  '| Load JavaScript deferred | Not active | — |',
  '| Lazyload for images | Active | — |',
  '| Lazyload for iframes and videos | Active | Replace iframe with preview image |',
  '| Optimize critical images | Active | Preloaded images detected: 2 |',
  '| Automatic lazy rendering | Not active | — |',
  '| Preload fonts | Not active | — |',
  '| Preconnect to external domains | Not active | — |',
  '| Priority Elements beacon | Not active | — |',
  '',
  '### Response headers (6)',
  '',
  '| Header | Value |',
  '| --- | --- |',
  '| `Cache-Control` | `max-age=3600` |',
  '| `age` | `120` |',
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
  '- **WP Rocket:** Not detected',
  '- **Optimizations:** 0 of 14 active',
  '',
  '### Detections',
  '',
  '| Feature | Status | Details |',
  '| --- | --- | --- |',
  '| WP Rocket | Not active | — |',
  '| Optimize CSS Delivery | Not active | — |',
  '| Lazyload for CSS background images | Not active | — |',
  '| Minify CSS files | Not active | — |',
  '| Minify JavaScript files | Not active | — |',
  '| Preload Links | Not active | — |',
  '| RocketCDN | Not active | — |',
  '| Delay JavaScript execution | Not active | — |',
  '| Load JavaScript deferred | Not active | — |',
  '| Lazyload for images | Not active | — |',
  '| Lazyload for iframes and videos | Not active | — |',
  '| Optimize critical images | Not active | — |',
  '| Automatic lazy rendering | Not active | — |',
  '| Preload fonts | Not active | — |',
  '| Preconnect to external domains | Not active | — |',
  '| Priority Elements beacon | Not active | — |',
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
    expect(buildSupportReport(fullData())).toBe(FULL_GOLDEN);
  });

  it('renders the all-absent page exactly (headers null, no references)', () => {
    expect(buildSupportReport(makeReportData())).toBe(ABSENT_GOLDEN);
  });

  it('is deterministic: same data, same bytes (clock-free)', () => {
    expect(buildSupportReport(fullData())).toBe(buildSupportReport(fullData()));
  });
});

describe('buildSupportReport — branches', () => {
  /** The report's lines for one payload. */
  const lines = (data: FdtData): string[] => buildSupportReport(data).split('\n');

  it('states an empty header capture distinctly from a missing one', () => {
    const report = lines(makeReportData({ pageHeaders: [] }));
    expect(report).toContain('### Response headers (0)');
    expect(report).toContain('None were captured for this page.');
    // An empty capture still yields the server card (not active) but no server fact.
    expect(report.some((line) => line.startsWith('- **Server:**'))).toBe(false);
    expect(report).toContain('| Server | Not active | — |');
  });

  it('reports a cached page without a representable stamp honestly', () => {
    const report = lines(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          wpr: { present: true, cached: true, version: null, timeStamp: 9e20 }
        }
      })
    );
    expect(report).toContain('- **WP Rocket:** Detected (version not available)');
    expect(report).toContain('- **Page cache:** Cached (generation time not available)');
    expect(report).toContain('| WP Rocket | Active | Version not available |');
    expect(report).toContain('| Cached | Active | Time not available |');
  });

  it('reports a present-but-uncached plugin as not cached', () => {
    const report = lines(
      makeReportData({
        wprDetections: {
          ...emptyDetections(),
          wpr: { present: true, cached: false, version: '3.1', timeStamp: null }
        }
      })
    );
    expect(report).toContain('- **Page cache:** Not cached');
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
      })
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
    ['\u0000\u0007', false, '—']
  ])('codeSpan(%j, inTable=%s) → %s', (value, inTable, expected) => {
    expect(codeSpan(value, inTable)).toBe(expected);
  });
});
