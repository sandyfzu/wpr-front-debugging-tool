/**
 * The LazyLoad CSP check's own rules (browser receipts:
 * `lazyload-csp.receipts.test.ts`): no policy, the placeholders limit only
 * where placeholders were written, header-only `sandbox`, unreadable metas,
 * the options script's text as hashed, and linear time on hostile policies.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import {
  evaluateLazyloadCsp,
  inlineScriptText,
  lazyloadRuntimeRequest,
  runtimeUndeliverable,
  type LazyloadCspCheck
} from './lazyload-csp';
import type { SimulationCspBrowser } from './spec';

const OPTIONS_TEXT = 'window.lazyLoadOptions=[{}];';
const OPTIONS = `<script>${OPTIONS_TEXT}</script>`;
const PAGE = 'https://site.test/post/';
const RUNTIME =
  'https://site.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
const OK = "script-src 'self' 'unsafe-inline'";

/** A check under header policies (and metas) for an engine. */
function check(
  headers: readonly string[],
  browser: SimulationCspBrowser = 'chromium',
  more: Partial<SimulationCspInput> & Partial<Omit<LazyloadCspCheck, 'csp'>> = {}
): ReturnType<typeof evaluateLazyloadCsp> {
  const { placeholders = true, optionsScript = OPTIONS, ...csp } = more;
  return evaluateLazyloadCsp({
    csp: {
      browser,
      headers: headers.map((value) => ({ name: 'Content-Security-Policy', value })),
      metas: [],
      ...csp
    },
    pageUrl: PAGE,
    runtimeUrl: RUNTIME,
    optionsScript,
    placeholders
  });
}

const ALLOWED = { blocked: false, limits: [] };
const BLOCKED = { blocked: true };

describe('evaluateLazyloadCsp', () => {
  it('allows everything without known policy inputs', () => {
    const verdict = evaluateLazyloadCsp({
      csp: undefined,
      pageUrl: PAGE,
      runtimeUrl: RUNTIME,
      optionsScript: OPTIONS,
      placeholders: true
    });
    expect(verdict).toEqual(ALLOWED);
  });

  it('names broken placeholders only where the page got placeholders', () => {
    const imgSelf = `${OK}; img-src 'self'`;
    expect(check([imgSelf])).toEqual({ blocked: false, limits: ['placeholders'] });
    expect(check([imgSelf], 'chromium', { placeholders: false })).toEqual(ALLOWED);
    expect(check([`${OK}; img-src 'self' DATA:`])).toEqual(ALLOWED);
    // Every enforced policy must allow them: one blocking is enough.
    expect(check([OK, "img-src 'self'"])).toEqual({ blocked: false, limits: ['placeholders'] });
  });

  it('blocks when any enforced policy blocks the options script or the runtime', () => {
    expect(check([OK, "script-src 'self'"])).toEqual(BLOCKED);
    expect(check([OK, "script-src 'unsafe-inline'"])).toEqual(BLOCKED);
    expect(check([OK, "script-src-elem 'self' 'unsafe-inline' 'strict-dynamic'"])).toEqual(BLOCKED);
  });

  it('applies every meta policy (all precede LazyLoad’s footer)', () => {
    const metas = [{ content: "script-src 'self'", offset: 9 }];
    expect(check([], 'chromium', { metas })).toEqual(BLOCKED);
    expect(check([], 'firefox', { metas })).toEqual(BLOCKED);
    // Chromium splits a meta on `,`; Firefox reads one policy (`data:,` and the rest are its tokens).
    const joined = [{ content: `${OK} data:, script-src 'self'`, offset: 9 }];
    expect(check([], 'chromium', { metas: joined })).toEqual(BLOCKED);
    expect(check([], 'firefox', { metas: joined })).toEqual(ALLOWED);
  });

  it('stops on a header `sandbox` without `allow-scripts` only (storage is not needed)', () => {
    for (const browser of ['chromium', 'firefox'] as const) {
      expect(check(['sandbox'], browser)).toEqual(BLOCKED);
      expect(check(['sandbox allow-forms'], browser)).toEqual(BLOCKED);
      expect(check([`sandbox ALLOW-SCRIPTS; ${OK}`], browser)).toEqual(ALLOWED);
      // A meta `sandbox` is never applied.
      const metas = [{ content: 'sandbox', offset: 9 }];
      expect(check([], browser, { metas })).toEqual(ALLOWED);
    }
  });

  it('ignores report-only policies', () => {
    const verdict = evaluateLazyloadCsp({
      csp: {
        browser: 'chromium',
        headers: [
          { name: 'Content-Security-Policy-Report-Only', value: "default-src 'none'; sandbox" }
        ],
        metas: []
      },
      pageUrl: PAGE,
      runtimeUrl: RUNTIME,
      optionsScript: OPTIONS,
      placeholders: true
    });
    expect(verdict).toEqual(ALLOWED);
  });

  it('keeps a readable block over an unreadable meta, else reports it unreadable', () => {
    const unreadable = { metasUnreadable: true as const };
    expect(check(["script-src 'self'"], 'chromium', unreadable)).toEqual(BLOCKED);
    expect(check(['sandbox'], 'firefox', unreadable)).toEqual(BLOCKED);
    expect(check([OK], 'chromium', unreadable)).toEqual({
      blocked: false,
      unavailable: 'unreadable'
    });
    // Never a limit beside an unknown policy.
    expect(check([`${OK}; img-src 'self'`], 'firefox', unreadable)).toEqual({
      blocked: false,
      unavailable: 'unreadable'
    });
  });

  it('hashes the options script’s text as parsed (CRLF read as LF)', () => {
    const crlf = '<script>a=1;\r\nb=2;</script>';
    const lf = createHash('sha256').update('a=1;\nb=2;', 'utf8').digest('base64');
    const policy = `script-src 'self' 'sha256-${lf}'`;
    expect(check([policy], 'firefox', { optionsScript: crlf })).toEqual(ALLOWED);
    expect(check([policy], 'firefox')).toEqual(BLOCKED);
  });
});

describe('evaluateLazyloadCsp — upgrade-insecure-requests', () => {
  const HTTP_PAGE = 'http://site.test:8080/p';
  const HTTP_RUNTIME = 'http://site.test:8080/wp/lazyload.min.js';
  const UIR = 'upgrade-insecure-requests';

  /** A check of the http runtime on the http page. */
  const http = (headers: readonly string[], browser: SimulationCspBrowser, metas: string[] = []) =>
    evaluateLazyloadCsp({
      csp: {
        browser,
        headers: headers.map((value) => ({ name: 'Content-Security-Policy', value })),
        metas: metas.map((content) => ({ content, offset: 0 }))
      },
      pageUrl: HTTP_PAGE,
      runtimeUrl: HTTP_RUNTIME,
      optionsScript: OPTIONS,
      placeholders: false
    });

  it('Chromium judges the upgraded URL, under every policy', () => {
    const port = `${UIR}; script-src http://site.test:8080 'unsafe-inline'`;
    expect(http([port], 'chromium')).toEqual(BLOCKED);
    expect(http([`${UIR}; ${OK}`], 'chromium')).toEqual(ALLOWED);
    expect(http(["script-src https: 'unsafe-inline'", UIR], 'chromium')).toEqual(ALLOWED);
    expect(http(["script-src https: 'unsafe-inline'"], 'chromium', [UIR])).toEqual(ALLOWED);
    expect(http(["script-src https: 'unsafe-inline'"], 'chromium')).toEqual(BLOCKED);
  });

  it('Firefox judges the written URL, as https under its own policy’s upgrade only', () => {
    const port = `${UIR}; script-src http://site.test:8080 'unsafe-inline'`;
    expect(http([port], 'firefox')).toEqual(ALLOWED);
    expect(http([`${UIR}; script-src https: 'unsafe-inline'`], 'firefox')).toEqual(ALLOWED);
    expect(http(["script-src https: 'unsafe-inline'", UIR], 'firefox')).toEqual(BLOCKED);
    expect(http(["script-src https: 'unsafe-inline'"], 'firefox', [UIR])).toEqual(BLOCKED);
  });

  it('never upgrades from a report-only policy', () => {
    const verdict = evaluateLazyloadCsp({
      csp: {
        browser: 'chromium',
        headers: [
          { name: 'Content-Security-Policy', value: "script-src http: 'unsafe-inline'" },
          { name: 'Content-Security-Policy-Report-Only', value: UIR }
        ],
        metas: []
      },
      pageUrl: HTTP_PAGE,
      runtimeUrl: 'http://site.test:8080/wp/lazyload.min.js',
      optionsScript: OPTIONS,
      placeholders: false
    });
    expect(verdict).toEqual(ALLOWED);
  });
});

describe('lazyloadRuntimeRequest', () => {
  const csp = (headers: readonly string[], metas: string[] = []): SimulationCspInput => ({
    browser: 'firefox',
    headers: headers.map((value) => ({ name: 'Content-Security-Policy', value })),
    metas: metas.map((content) => ({ content, offset: 0 }))
  });
  const HTTP_RT = 'http://site.test/wp/lazyload.min.js';

  it('is the tag’s URL, upgraded by an enforced header or meta', () => {
    expect(lazyloadRuntimeRequest(undefined, 'http://site.test/p', HTTP_RT)).toEqual({
      url: HTTP_RT
    });
    expect(lazyloadRuntimeRequest(csp([OK]), 'http://site.test/p', HTTP_RT)).toEqual({
      url: HTTP_RT
    });
    const upgraded = 'https://site.test/wp/lazyload.min.js';
    expect(
      lazyloadRuntimeRequest(csp(['upgrade-insecure-requests']), 'http://site.test/p', HTTP_RT)
    ).toEqual({ url: upgraded });
    expect(
      lazyloadRuntimeRequest(csp([], ['upgrade-insecure-requests']), 'http://site.test/p', HTTP_RT)
    ).toEqual({ url: upgraded });
    expect(lazyloadRuntimeRequest(csp([OK]), PAGE, RUNTIME)).toEqual({ url: RUNTIME });
  });

  it('is mixed content for an http runtime on an https page without the upgrade', () => {
    expect(lazyloadRuntimeRequest(undefined, PAGE, HTTP_RT)).toEqual({ refused: 'mixed-content' });
    expect(lazyloadRuntimeRequest(csp([OK]), PAGE, HTTP_RT)).toEqual({ refused: 'mixed-content' });
    expect(lazyloadRuntimeRequest(csp(['upgrade-insecure-requests']), PAGE, HTTP_RT)).toEqual({
      url: 'https://site.test/wp/lazyload.min.js'
    });
  });
});

describe('runtimeUndeliverable', () => {
  /** Header policies as an engine's input. */
  const input = (values: readonly string[], browser: SimulationCspBrowser): SimulationCspInput => ({
    browser,
    headers: values.map((value) => ({ name: 'Content-Security-Policy', value })),
    metas: []
  });

  it('holds on Firefox for a header sandbox that runs scripts in an opaque origin', () => {
    expect(runtimeUndeliverable(input(['sandbox allow-scripts'], 'firefox'))).toBe(true);
    expect(runtimeUndeliverable(input([OK, 'sandbox Allow-Scripts allow-forms'], 'firefox'))).toBe(
      true
    );
  });

  it('never holds on Chromium, without a sandbox, or where no script runs', () => {
    expect(runtimeUndeliverable(undefined)).toBe(false);
    expect(runtimeUndeliverable(input(['sandbox allow-scripts'], 'chromium'))).toBe(false);
    expect(runtimeUndeliverable(input([OK], 'firefox'))).toBe(false);
    expect(
      runtimeUndeliverable(input(['sandbox allow-scripts allow-same-origin'], 'firefox'))
    ).toBe(false);
    expect(runtimeUndeliverable(input(['sandbox'], 'firefox'))).toBe(false);
    const meta = {
      ...input([], 'firefox'),
      metas: [{ content: 'sandbox allow-scripts', offset: 0 }]
    };
    expect(runtimeUndeliverable(meta)).toBe(false);
  });
});

describe('inlineScriptText', () => {
  it('reads the text between a script element’s tags', () => {
    expect(inlineScriptText(OPTIONS)).toBe(OPTIONS_TEXT);
    expect(inlineScriptText('<script id="x">a\rb\0</script>')).toBe('a\nb�');
  });

  it.each(['<style>a</style>', '<script>a', 'a</script>'])('refuses %s', (element) => {
    expect(() => inlineScriptText(element)).toThrow('Not a script element');
  });
});

describe('evaluateLazyloadCsp — hostile sizes', () => {
  for (const browser of ['chromium', 'firefox'] as const) {
    it(
      `32 policies of thousands of non-matching sources stay linear (${browser})`,
      () => {
        const scaling = linearScaling(
          (bytes) => {
            // Host, path and hash sources that never match, then the one that does.
            const sources = Array.from(
              { length: Math.floor(bytes / 32 / 40) },
              (_, at) => `https://h${String(at)}.test:${String(at % 9000)}/a/b/`
            );
            const policy = `script-src ${sources.join(' ')} 'self' 'unsafe-inline'; img-src ${sources.join(' ')} data:`;
            return Array.from({ length: 32 }, () => policy);
          },
          (headers) => check(headers, browser)
        );
        expect(scaling.violation).toBeUndefined();
        expect(scaling.output).toEqual(ALLOWED);
      },
      LINEAR_SCALING_TIMEOUT_MS
    );
  }
});
