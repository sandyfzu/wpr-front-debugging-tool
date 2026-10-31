import { describe, expect, it } from 'vitest';
import type { InterceptedDocument } from './backend';
import { createCspSource } from './simulation-csp-source';
import { fitSimulationCsp } from '../messaging/exclusion-simulation';
import {
  evaluateSimulationCsp,
  type SimulationCspVerdict
} from '../wp-rocket-simulation/csp-evaluation';

/** A document with the given CSP header lines. */
function document(cspHeaders?: InterceptedDocument['cspHeaders']): InterceptedDocument {
  return {
    tabId: 1,
    documentUrl: 'https://site.test/',
    body: new Uint8Array(),
    status: 200,
    method: 'GET',
    contentType: 'text/html',
    ...(cspHeaders === undefined ? {} : { cspHeaders })
  };
}

describe('createCspSource', () => {
  const html = `<head><meta http-equiv="content-security-policy" content="script-src 'self'"></head>`;

  it('reads the captured header lines and the head metas, for its engine', () => {
    const headers = [{ name: 'Content-Security-Policy', value: "default-src 'self'" }];
    expect(createCspSource('firefox')(document(headers), html)).toEqual({
      browser: 'firefox',
      headers,
      metas: [{ content: "script-src 'self'", offset: 6 }]
    });
  });

  it('a document without CSP lines has no header policies', () => {
    expect(createCspSource('chromium')(document(), '<p>x</p>')).toEqual({
      browser: 'chromium',
      headers: [],
      metas: []
    });
  });

  it('flags an unreadable CSP meta beside the headers; the fit carries the flag', () => {
    const unreadable = `<head><meta http-equiv="content-security-policy" content="a&nbsp;"></head>`;
    const headers = [{ name: 'Content-Security-Policy', value: "script-src 'self'" }];
    for (const browser of ['chromium', 'firefox'] as const) {
      const raw = { browser, headers, metas: [], metasUnreadable: true };
      expect(createCspSource(browser)(document(headers), unreadable)).toEqual(raw);
      expect(fitSimulationCsp(raw, unreadable.length)).toEqual({ csp: raw });
    }
  });

  it('end to end: blocking headers win over an unreadable meta; otherwise unreadable', () => {
    const served = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="a&nbsp;"></head><body></body></html>`;
    const simulated = served.replace('<head>', '<head><script>rt()</script>');
    const cases: readonly (readonly [string, SimulationCspVerdict])[] = [
      ["script-src 'self'", { blocked: true }],
      ['sandbox', { blocked: true }],
      ["script-src 'self' 'unsafe-inline'", { blocked: false, unavailable: 'unreadable' }]
    ];
    for (const browser of ['chromium', 'firefox'] as const) {
      for (const [value, verdict] of cases) {
        const headers = [{ name: 'Content-Security-Policy', value }];
        const fitted = fitSimulationCsp(
          createCspSource(browser)(document(headers), served),
          served.length
        );
        if (!('csp' in fitted)) throw new Error(`unfit CSP for ${value}`);
        expect(
          evaluateSimulationCsp({ csp: fitted.csp, served, simulated, runtime: 'rt()' }),
          `${browser}: ${value}`
        ).toEqual(verdict);
      }
    }
  });
});
