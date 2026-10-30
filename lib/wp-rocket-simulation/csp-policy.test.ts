import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allowsCreatedInline,
  allowsDataScript,
  allowsParsedInline,
  allowsParsedScriptUrl,
  checkedScript,
  elementListFacts,
  governingList,
  headerPolicies,
  metaPolicies,
  parsePolicy,
  parsePolicyList,
  policyFacts,
  type CspPolicy,
  type PolicyFacts
} from './csp-policy';
import type { SimulationCspBrowser } from './spec';

/** A policy that must parse. */
function policy(text: string, browser: SimulationCspBrowser = 'chromium'): CspPolicy {
  const parsed = parsePolicy(text, browser);
  if (parsed === null) throw new Error(`no policy in ${text}`);
  return parsed;
}

/** A policy's facts for an engine. */
const facts = (text: string, browser: SimulationCspBrowser = 'chromium'): PolicyFacts =>
  policyFacts(policy(text, browser), browser);

/** Base64 digest of a text. */
const digest = (algorithm: string, text: string): string =>
  createHash(algorithm).update(text, 'utf8').digest('base64');

describe('parsePolicy', () => {
  it('splits directives on ;, names lowercased, tokens on ASCII whitespace', () => {
    expect([...policy(" Script-Src 'self'\t data: ;;\nDEFAULT-src  * ")]).toEqual([
      ['script-src', ["'self'", 'data:']],
      ['default-src', ['*']]
    ]);
  });

  it('keeps the first of a repeated directive', () => {
    expect(policy("script-src 'a'; SCRIPT-SRC 'b'").get('script-src')).toEqual(["'a'"]);
  });

  it('keeps an empty directive (a list matching nothing)', () => {
    expect(policy('script-src').get('script-src')).toEqual([]);
  });

  it('is null without any directive', () => {
    expect(parsePolicy('', 'chromium')).toBeNull();
    expect(parsePolicy(' ;\t; ', 'chromium')).toBeNull();
  });
});

describe('parsePolicyList / headerPolicies', () => {
  it('splits a header value into comma-separated policies, dropping empty ones', () => {
    expect(
      parsePolicyList("script-src 'a', , default-src 'b'", 'chromium').map((p) => [...p.keys()])
    ).toEqual([['script-src'], ['default-src']]);
  });

  it('sorts header lines by disposition, names caseless, others ignored', () => {
    const { enforced, reportOnly } = headerPolicies(
      [
        { name: 'Content-Security-Policy', value: "script-src 'a', script-src 'b'" },
        { name: 'CONTENT-SECURITY-POLICY-REPORT-ONLY', value: "script-src 'c'" },
        { name: 'X-Content-Security-Policy', value: "script-src 'd'" }
      ],
      'chromium'
    );
    expect(enforced.map((p) => p.get('script-src'))).toEqual([["'a'"], ["'b'"]]);
    expect(reportOnly.map((p) => p.get('script-src'))).toEqual([["'c'"]]);
  });
});

describe('metaPolicies', () => {
  it('Chromium splits a meta content on commas, Firefox reads one policy', () => {
    const content = "script-src 'unsafe-inline', script-src 'self'";
    expect(metaPolicies(content, 'chromium').map((p) => p.get('script-src'))).toEqual([
      ["'unsafe-inline'"],
      ["'self'"]
    ]);
    expect(metaPolicies(content, 'firefox').map((p) => p.get('script-src'))).toEqual([
      ["'unsafe-inline',", 'script-src', "'self'"]
    ]);
    expect(metaPolicies(' ; ', 'firefox')).toEqual([]);
  });
});

describe('governingList', () => {
  const all = policy("default-src 'd'; script-src 's'; script-src-elem 'e'");
  it('elements: script-src-elem, then script-src, then default-src', () => {
    expect(governingList(all, 'element')).toEqual(["'e'"]);
    expect(governingList(policy("default-src 'd'; script-src 's'"), 'element')).toEqual(["'s'"]);
    expect(governingList(policy("default-src 'd'"), 'element')).toEqual(["'d'"]);
    expect(governingList(policy("img-src 'i'"), 'element')).toBeUndefined();
  });
  it('eval: script-src, then default-src, never script-src-elem', () => {
    expect(governingList(all, 'eval')).toEqual(["'s'"]);
    expect(governingList(policy("script-src-elem 'e'"), 'eval')).toBeUndefined();
  });
});

describe('policy facts', () => {
  /** A script with no nonce. */
  const plain = (text: string, browser: SimulationCspBrowser = 'chromium') =>
    checkedScript(text, null, browser);

  it('keywords caseless; invalid nonce/hash sources ignored', () => {
    const list = elementListFacts(
      ["'UNSAFE-INLINE'", 'DATA:', "'nonce-a b'", "'nonce-'", "'md5-abc='", "'sha256-'"],
      'chromium'
    );
    expect(list).toMatchObject({ allInline: true, strictDynamic: false, data: true });
    expect(list.nonces.size).toBe(0);
    expect(list.hashes.size).toBe(0);
    expect(elementListFacts(["'unsafe-inline'"], 'chromium').allInline).toBe(true);
  });

  it("'unsafe-inline' counts only without a nonce, hash or 'strict-dynamic'", () => {
    const allInline = (tokens: string[]): boolean => elementListFacts(tokens, 'firefox').allInline;
    expect(allInline(["'unsafe-inline'", "'nonce-abc'"])).toBe(false);
    expect(allInline(["'unsafe-inline'", `'sha256-${digest('sha256', 'x')}'`])).toBe(false);
    expect(allInline(["'unsafe-inline'", "'Strict-Dynamic'"])).toBe(false);
    expect(allInline(["'self'"])).toBe(false);
  });

  it('nonces: prefix caseless, value exact, base64url characters and padding allowed', () => {
    const nonced = (value: string | null) => checkedScript('d()', value, 'chromium');
    expect(allowsCreatedInline(facts("script-src 'NONCE-Ab+/_-=='"), nonced('Ab+/_-=='))).toBe(
      true
    );
    expect(allowsCreatedInline(facts("script-src 'nonce-Ab'"), nonced('ab'))).toBe(false);
    expect(allowsCreatedInline(facts("script-src 'nonce-Ab'"), nonced(null))).toBe(false);
    expect(allowsCreatedInline(facts("script-src 'nonce-a!b'"), nonced('a!b'))).toBe(false);
  });

  it('hashes: each algorithm, base64url read as base64, padding exact on Firefox only', () => {
    const text = 'a()\n';
    for (const algorithm of ['sha256', 'sha384', 'sha512']) {
      const value = digest(algorithm, text);
      const upper = `script-src '${algorithm.toUpperCase()}-${value}'`;
      expect(allowsParsedInline(facts(upper, 'firefox'), plain(text, 'firefox'))).toBe(true);
      const url = value.replace(/\+/g, '-').replace(/\//g, '_');
      const urlPolicy = facts(`script-src '${algorithm}-${url}'`, 'firefox');
      expect(allowsParsedInline(urlPolicy, plain(text, 'firefox'))).toBe(true);
      expect(allowsParsedInline(facts(upper), plain('other'))).toBe(false);
    }
    const padded = digest('sha256', text);
    expect(padded.endsWith('=')).toBe(true);
    const unpadded = `script-src 'sha256-${padded.replace(/=+$/, '')}'`;
    expect(allowsParsedInline(facts(unpadded, 'chromium'), plain(text, 'chromium'))).toBe(true);
    expect(allowsParsedInline(facts(unpadded, 'firefox'), plain(text, 'firefox'))).toBe(false);
  });

  it('digests a script once per algorithm, and only algorithms a policy names', () => {
    const script = checkedScript('x', null, 'firefox');
    const sha512 = script.digest('sha512');
    expect(script.digest('sha512')).toBe(sha512);
    expect(sha512).toBe(digest('sha512', 'x'));
    expect(allowsParsedInline(facts("script-src 'self'"), script)).toBe(false);
  });

  it('a parsed inline script: all inline or its hash (never a nonce, never strict-dynamic)', () => {
    const text = 'rt()';
    expect(allowsParsedInline(facts("img-src 'none'"), plain(text))).toBe(true);
    expect(allowsParsedInline(facts("script-src 'unsafe-inline'"), plain(text))).toBe(true);
    const hashed = facts(`script-src 'sha256-${digest('sha256', text)}'`);
    expect(allowsParsedInline(hashed, plain(text))).toBe(true);
    expect(allowsParsedInline(facts("script-src 'strict-dynamic'"), plain(text))).toBe(false);
    const nonced = checkedScript(text, 'a', 'chromium');
    expect(allowsParsedInline(facts("script-src 'nonce-a'"), nonced)).toBe(false);
  });

  it('a created inline script: all inline, strict-dynamic, its nonce or its hash', () => {
    const nonced = checkedScript('d()', 'n', 'chromium');
    expect(allowsCreatedInline(facts("script-src 'strict-dynamic'"), plain('d()'))).toBe(true);
    expect(allowsCreatedInline(facts("script-src 'nonce-n'"), nonced)).toBe(true);
    expect(allowsCreatedInline(facts("script-src 'nonce-n'"), plain('d()'))).toBe(false);
    const hashed = facts(`script-src 'sha256-${digest('sha256', 'd()')}'`);
    expect(allowsCreatedInline(hashed, plain('d()'))).toBe(true);
    expect(allowsCreatedInline(facts("script-src 'self' data:"), plain('d()'))).toBe(false);
    expect(allowsCreatedInline(facts("style-src 'none'"), plain('d()'))).toBe(true);
  });

  it('a data: script: the data: scheme (caseless), its nonce, or strict-dynamic — never * or self', () => {
    expect(allowsDataScript(facts("script-src 'self' DATA:"), null)).toBe(true);
    expect(allowsDataScript(facts("script-src 'nonce-n'"), 'n')).toBe(true);
    expect(allowsDataScript(facts("script-src 'nonce-n'"), null)).toBe(false);
    expect(allowsDataScript(facts("script-src 'strict-dynamic'"), null)).toBe(true);
    expect(allowsDataScript(facts("script-src * 'self' 'unsafe-inline'"), null)).toBe(false);
    expect(allowsDataScript(facts("object-src 'none'"), null)).toBe(true);
  });

  it("eval needs 'unsafe-eval' (caseless) in the eval directive", () => {
    expect(facts("script-src 'UNSAFE-EVAL'").evalAllowed).toBe(true);
    expect(facts("script-src 'self'; default-src 'unsafe-eval'").evalAllowed).toBe(false);
    expect(facts("script-src-elem 'self'").evalAllowed).toBe(true);
    expect(facts("script-src 'wasm-unsafe-eval'").evalAllowed).toBe(false);
  });

  it("Trusted Types: required only by an exact 'script' (Chromium 156 / Firefox 155 ignore 'SCRIPT')", () => {
    expect(facts("require-trusted-types-for 'script'").trustedTypes).toBe(true);
    expect(facts("require-trusted-types-for 'SCRIPT' 'script'").trustedTypes).toBe(true);
    expect(facts("require-trusted-types-for 'SCRIPT'").trustedTypes).toBe(false);
    expect(facts('trusted-types default').trustedTypes).toBe(false);
    expect(facts('require-trusted-types-for').trustedTypes).toBe(false);
  });

  it('sandbox stops the runtime unless it allows scripts and same-origin (flags caseless)', () => {
    expect(facts('sandbox').sandboxStopsRuntime).toBe(true);
    expect(facts('sandbox allow-scripts').sandboxStopsRuntime).toBe(true);
    expect(facts('sandbox allow-same-origin').sandboxStopsRuntime).toBe(true);
    expect(facts('sandbox ALLOW-SCRIPTS Allow-Same-Origin bogus').sandboxStopsRuntime).toBe(false);
    // The first sandbox directive counts.
    expect(facts('sandbox allow-scripts allow-same-origin; sandbox').sandboxStopsRuntime).toBe(
      false
    );
    expect(facts("script-src 'self'").sandboxStopsRuntime).toBe(false);
  });
});

describe('LazyLoad facts', () => {
  const url = new URL('https://site.test/wp/lazyload.min.js');
  const self = new URL('https://site.test/p');

  it('reads a `sandbox` that stops every script (no `allow-scripts`, caseless)', () => {
    expect(facts('sandbox').sandboxStopsScripts).toBe(true);
    expect(facts('sandbox allow-same-origin').sandboxStopsScripts).toBe(true);
    expect(facts('sandbox Allow-Scripts').sandboxStopsScripts).toBe(false);
    expect(facts("script-src 'self'").sandboxStopsScripts).toBe(false);
  });

  it('reads whether `data:` images load: `img-src`, else `default-src`', () => {
    expect(facts("script-src 'none'").imageDataAllowed).toBe(true);
    expect(facts("default-src 'self'").imageDataAllowed).toBe(false);
    expect(facts("default-src 'self'; img-src DATA:").imageDataAllowed).toBe(true);
    expect(facts('default-src data:; img-src *').imageDataAllowed).toBe(false);
  });

  it('keeps the governing list’s tokens as written', () => {
    expect(facts("script-src 'self' https://cdn.test/a/").element?.sources).toEqual([
      "'self'",
      'https://cdn.test/a/'
    ]);
  });

  it('allows a parser-inserted script URL by the list, never under `strict-dynamic`', () => {
    expect(allowsParsedScriptUrl(facts("img-src 'none'"), url, self, 'chromium')).toBe(true);
    expect(allowsParsedScriptUrl(facts("script-src 'self'"), url, self, 'firefox')).toBe(true);
    expect(allowsParsedScriptUrl(facts("script-src 'none'"), url, self, 'firefox')).toBe(false);
    expect(
      allowsParsedScriptUrl(facts("script-src 'self' 'strict-dynamic'"), url, self, 'chromium')
    ).toBe(false);
  });

  it('reads upgrade-insecure-requests (any value), dropped with a non-ASCII value', () => {
    expect(facts('upgrade-insecure-requests').upgradeInsecure).toBe(true);
    expect(facts("UPGRADE-INSECURE-REQUESTS foo; script-src 'self'").upgradeInsecure).toBe(true);
    expect(facts("script-src 'self'").upgradeInsecure).toBe(false);
    expect(facts("upgrade-insecure-requests é; script-src 'self'").upgradeInsecure).toBe(false);
  });

  it('Firefox matches an http URL as https under its own policy’s upgrade only', () => {
    const http = new URL('http://site.test/x.js');
    const https = 'script-src https:; upgrade-insecure-requests';
    expect(allowsParsedScriptUrl(facts(https, 'firefox'), http, self, 'firefox')).toBe(true);
    expect(
      allowsParsedScriptUrl(facts('script-src https:', 'firefox'), http, self, 'firefox')
    ).toBe(false);
    // Chromium is handed the upgraded URL by its caller: the written one never matches as https.
    expect(allowsParsedScriptUrl(facts(https), http, self, 'chromium')).toBe(false);
  });
});

describe('non-ASCII directives (dropped whole, per engine)', () => {
  const engines = ['chromium', 'firefox'] as const;

  it('drops a directive holding a non-ASCII character, on both engines', () => {
    for (const browser of engines) {
      const parsed = policy("default-src 'none'; script-src 'self' https://bücher.de", browser);
      expect([...parsed.keys()]).toEqual(['default-src']);
      expect(parsePolicy("script-src 'none' é", browser)).toBeNull();
      expect(parsePolicy("script-src 'none'\u00a0'self'", browser)).toBeNull();
      expect(
        policy("script-src-elem 'self' ‘report-sample’; script-src 'none'", browser).has(
          'script-src-elem'
        )
      ).toBe(false);
      expect(policy("scrïpt-src 'self'; script-src 'none'", browser).get('script-src')).toEqual([
        "'none'"
      ]);
    }
  });

  it('Chromium: the dropped directive still claims its name (caseless); Firefox applies the repeat', () => {
    const text = "SCRIPT-SRC 'none' é; script-src 'none'; img-src 'self'";
    expect(policy(text, 'chromium').has('script-src')).toBe(false);
    expect(policy(text, 'firefox').get('script-src')).toEqual(["'none'"]);
  });

  it('drops per policy in a header list and a meta', () => {
    for (const browser of engines) {
      const list = parsePolicyList("script-src 'none' é, script-src 'none'", browser);
      expect(list.map((p) => p.get('script-src'))).toEqual([["'none'"]]);
      expect(metaPolicies("script-src 'none' é", browser)).toEqual([]);
      const { enforced } = headerPolicies(
        [{ name: 'Content-Security-Policy', value: "script-src 'self' é; img-src 'self'" }],
        browser
      );
      expect(enforced.map((p) => [...p.keys()])).toEqual([['img-src']]);
    }
  });
});
