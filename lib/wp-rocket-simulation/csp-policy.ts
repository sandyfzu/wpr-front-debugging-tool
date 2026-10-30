/**
 * Content Security Policy reading for the simulation (pure): policies
 * parsed from header lines and `<meta>` contents as browsers parse them
 * (CSP Level 3 §2.2), each read once into the facts the Delay JS
 * runtime's work is checked against — an inline script element (by
 * `'unsafe-inline'`, nonce, hash or `'strict-dynamic'`), a `data:` script
 * URL, a parser-inserted external script's URL, a `data:` image, `eval`,
 * Trusted Types, a `sandbox`, `upgrade-insecure-requests`. Keywords, directive names,
 * sandbox flags, the nonce prefix and hash algorithms compare ASCII
 * case-insensitively; `'script'` in `require-trusted-types-for`, nonce
 * values exactly; hash values as base64 (a base64url value read as base64)
 * — exactly on Firefox, padding-blind on Chromium (observed: an unpadded
 * hash of the runtime allows it on Chromium 156, not on Firefox 155).
 * A directive holding a non-ASCII character is dropped whole (CSP3); on
 * Chromium it still claims its name, so a later repeat stays ignored —
 * Firefox applies that repeat (observed on Chromium 156 / Firefox 155:
 * `script-src 'none' é; script-src 'none'` runs scripts on Chromium only).
 */
import type { SimulationCspHeader } from '../messaging/exclusion-simulation';
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER } from './csp-headers';
import { sourceListAllowsUrl } from './csp-source-match';
import type { SimulationCspBrowser } from './spec';
import { sha256Hex } from '../../utils/sha256';
import { sha384Hex, sha512Hex } from '../../utils/sha512';

/** One parsed policy: directive name (lowercase) → its source tokens as written. */
export type CspPolicy = ReadonlyMap<string, readonly string[]>;

/** A page's header policies, by disposition. */
export interface HeaderPolicies {
  readonly enforced: readonly CspPolicy[];
  readonly reportOnly: readonly CspPolicy[];
}

/** The hash algorithms a hash source may name. */
export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512';

/** What a script-element source list allows, read once. */
export interface ElementListFacts {
  /** `'unsafe-inline'` in effect (no nonce, hash or `'strict-dynamic'` beside it). */
  readonly allInline: boolean;
  readonly strictDynamic: boolean;
  /** The `data:` scheme source. */
  readonly data: boolean;
  /** Valid nonce values. */
  readonly nonces: ReadonlySet<string>;
  /** Valid hash values per algorithm, as the engine compares them. */
  readonly hashes: ReadonlyMap<HashAlgorithm, ReadonlySet<string>>;
  /** The list's tokens as written (URL matching reads them on demand). */
  readonly sources: readonly string[];
}

/** What one policy allows the runtime, read once per policy and engine. */
export interface PolicyFacts {
  /** The script-element list's facts, or null when no directive governs elements (allowed). */
  readonly element: ElementListFacts | null;
  /** `eval` / `new Function` allowed. */
  readonly evalAllowed: boolean;
  /** Script sinks require Trusted Types (setting a script's text or `src`, `new Function`). */
  readonly trustedTypes: boolean;
  /**
   * A `sandbox` directive stops the runtime: without `allow-scripts` no
   * script runs; without `allow-same-origin` its `sessionStorage` read
   * throws. Browsers apply it only from an enforced header.
   */
  readonly sandboxStopsRuntime: boolean;
  /** A `sandbox` directive without `allow-scripts`: no script runs (enforced header only). */
  readonly sandboxStopsScripts: boolean;
  /** A `data:` image loads (`img-src`, else `default-src`, names the `data:` scheme, or neither exists). */
  readonly imageDataAllowed: boolean;
  /**
   * `upgrade-insecure-requests`: the page requests http subresources over
   * https (applied from an enforced header or a meta; its value is ignored).
   */
  readonly upgradeInsecure: boolean;
}

/** An inline script under check: its nonce and its text's digests. */
export interface CheckedScript {
  /** Its nonce, or null (none, or not nonceable). */
  readonly nonce: string | null;
  /** Its text's digest as the engine compares it (computed once per algorithm). */
  readonly digest: (algorithm: HashAlgorithm) => string;
}

/** Hex digest per algorithm (each over the text's UTF-8 bytes). */
const HEX_DIGESTS: Readonly<Record<HashAlgorithm, (text: string) => string>> = {
  sha256: sha256Hex,
  sha384: sha384Hex,
  sha512: sha512Hex
};

/** A character outside ASCII: CSP3 drops the directive holding one. */
const NON_ASCII = /[^\x00-\x7F]/;

/** ASCII whitespace (the policy grammar's separators). */
const ASCII_WHITESPACE = /[\t\n\f\r ]+/;

/** A nonce source: `'nonce-<base64-value>'` (the prefix caseless). */
const NONCE_SOURCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/i;

/** A hash source: `'<algorithm>-<base64-value>'` (the algorithm caseless). */
const HASH_SOURCE = /^'(sha256|sha384|sha512)-([A-Za-z0-9+/_-]+={0,2})'$/i;

/** The Trusted Types sink group keyword (matched exactly: `'SCRIPT'` is invalid, no effect). */
const TRUSTED_TYPES_SCRIPT = "'script'";

/** The sandbox flag that lets scripts run (caseless). */
const SCRIPTS_SANDBOX_FLAG = 'allow-scripts';

/** The sandbox flags the Delay JS runtime needs (caseless): scripts, and storage access. */
const RUNTIME_SANDBOX_FLAGS = [SCRIPTS_SANDBOX_FLAG, 'allow-same-origin'] as const;

/** The `data:` scheme source (caseless). */
const DATA_SCHEME = 'data:';

/** The directive that upgrades a page's insecure requests (its value is ignored). */
const UPGRADE_INSECURE_REQUESTS = 'upgrade-insecure-requests';

/**
 * Parse one serialized policy (CSP3 "parse a serialized CSP"): `;`-split
 * directives, each a lowercase name and its whitespace-split tokens; a
 * repeated directive is ignored (the first one counts); a directive with a
 * non-ASCII character is dropped — on Chromium it still counts as the
 * first of its name (see the module doc).
 *
 * @param serialized One policy's text.
 * @param browser The engine parsing it.
 * @returns The policy, or null when it holds no applied directive (no policy).
 */
export function parsePolicy(serialized: string, browser: SimulationCspBrowser): CspPolicy | null {
  const directives = new Map<string, readonly string[]>();
  // Chromium: names claimed by a dropped non-ASCII directive.
  const claimed = new Set<string>();
  for (const part of serialized.split(';')) {
    const [name, ...tokens] = part.split(ASCII_WHITESPACE).filter((token) => token !== '');
    if (name === undefined) continue;
    const lower = name.toLowerCase();
    if (directives.has(lower) || claimed.has(lower)) continue;
    if (!NON_ASCII.test(part)) directives.set(lower, tokens);
    else if (browser === 'chromium') claimed.add(lower);
  }
  return directives.size === 0 ? null : directives;
}

/**
 * The policies of one header value: a comma-separated policy list (a
 * browser may join repeated header lines with `, `).
 *
 * @param value The header value.
 * @param browser The engine parsing it.
 */
export function parsePolicyList(value: string, browser: SimulationCspBrowser): CspPolicy[] {
  return value
    .split(',')
    .map((serialized) => parsePolicy(serialized, browser))
    .filter((policy): policy is CspPolicy => policy !== null);
}

/**
 * The policies of a `<meta>` CSP content: Chromium splits it on `,` as a
 * header value; Firefox reads it as one policy (observed on Chromium 156 /
 * Firefox 155: `…data:, script-src 'self'` blocks inline scripts on
 * Chromium only).
 *
 * @param content The decoded content.
 * @param browser The engine reading it.
 */
export function metaPolicies(content: string, browser: SimulationCspBrowser): CspPolicy[] {
  if (browser === 'chromium') return parsePolicyList(content, browser);
  const policy = parsePolicy(content, browser);
  return policy === null ? [] : [policy];
}

/**
 * The policies of a response's CSP header lines, by disposition (other
 * header names are ignored).
 *
 * @param headers The header lines.
 * @param browser The engine parsing them.
 */
export function headerPolicies(
  headers: readonly SimulationCspHeader[],
  browser: SimulationCspBrowser
): HeaderPolicies {
  const enforced: CspPolicy[] = [];
  const reportOnly: CspPolicy[] = [];
  for (const { name, value } of headers) {
    const lower = name.toLowerCase();
    if (lower === CSP_HEADER) enforced.push(...parsePolicyList(value, browser));
    else if (lower === CSP_REPORT_ONLY_HEADER) reportOnly.push(...parsePolicyList(value, browser));
  }
  return { enforced, reportOnly };
}

/**
 * The source list that governs a use: script elements read
 * `script-src-elem`, then `script-src`, then `default-src`; `eval` reads
 * `script-src`, then `default-src` (never `script-src-elem`).
 *
 * @param policy The policy.
 * @param use What is checked.
 * @returns The governing tokens, or undefined when no directive governs (allowed).
 */
export function governingList(
  policy: CspPolicy,
  use: 'element' | 'eval'
): readonly string[] | undefined {
  if (use === 'element' && policy.has('script-src-elem')) return policy.get('script-src-elem');
  return policy.get('script-src') ?? policy.get('default-src');
}

/**
 * A base64 value as an engine compares it.
 *
 * @param value The value (base64 or base64url).
 * @param browser The engine (Chromium ignores `=` padding).
 */
function comparable(value: string, browser: SimulationCspBrowser): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return browser === 'chromium' ? base64.replace(/=+$/, '') : base64;
}

/**
 * Read a script-element source list once: its keywords, valid nonce and
 * hash sources (an invalid one is ignored, as browsers do).
 *
 * @param list The tokens.
 * @param browser The engine comparing hashes.
 */
export function elementListFacts(
  list: readonly string[],
  browser: SimulationCspBrowser
): ElementListFacts {
  let unsafeInline = false;
  let strictDynamic = false;
  let data = false;
  let hashCount = 0;
  const nonces = new Set<string>();
  const hashes = new Map<HashAlgorithm, Set<string>>();
  for (const token of list) {
    const lower = token.toLowerCase();
    if (lower === "'unsafe-inline'") unsafeInline = true;
    else if (lower === "'strict-dynamic'") strictDynamic = true;
    else if (lower === DATA_SCHEME) data = true;
    const nonce = NONCE_SOURCE.exec(token)?.[1];
    if (nonce !== undefined) nonces.add(nonce);
    const hash = HASH_SOURCE.exec(token);
    if (hash !== null) {
      const algorithm = (hash[1] ?? '').toLowerCase() as HashAlgorithm;
      const values = hashes.get(algorithm) ?? new Set<string>();
      values.add(comparable(hash[2] ?? '', browser));
      hashes.set(algorithm, values);
      hashCount += 1;
    }
  }
  const allInline = unsafeInline && !strictDynamic && nonces.size === 0 && hashCount === 0;
  return { allInline, strictDynamic, data, nonces, hashes, sources: list };
}

/**
 * Whether a token list holds a keyword (caseless).
 *
 * @param list The tokens.
 * @param keyword The keyword, lowercase.
 */
function hasKeyword(list: readonly string[], keyword: string): boolean {
  return list.some((token) => token.toLowerCase() === keyword);
}

/**
 * Read a policy once into what it allows the runtime.
 *
 * @param policy The policy.
 * @param browser The engine enforcing it.
 */
export function policyFacts(policy: CspPolicy, browser: SimulationCspBrowser): PolicyFacts {
  const elementList = governingList(policy, 'element');
  const evalList = governingList(policy, 'eval');
  const sandbox = policy.get('sandbox');
  const imageList = policy.get('img-src') ?? policy.get('default-src');
  return {
    element: elementList === undefined ? null : elementListFacts(elementList, browser),
    evalAllowed: evalList === undefined || hasKeyword(evalList, "'unsafe-eval'"),
    trustedTypes: (policy.get('require-trusted-types-for') ?? []).includes(TRUSTED_TYPES_SCRIPT),
    sandboxStopsRuntime:
      sandbox !== undefined && !RUNTIME_SANDBOX_FLAGS.every((flag) => hasKeyword(sandbox, flag)),
    sandboxStopsScripts: sandbox !== undefined && !hasKeyword(sandbox, SCRIPTS_SANDBOX_FLAG),
    imageDataAllowed: imageList === undefined || hasKeyword(imageList, DATA_SCHEME),
    upgradeInsecure: policy.has(UPGRADE_INSECURE_REQUESTS)
  };
}

/**
 * Lowercase hex digest → base64 (the encoding hash sources carry).
 *
 * @param hex The digest.
 */
function hexToBase64(hex: string): string {
  let binary = '';
  for (let at = 0; at < hex.length; at += 2) {
    binary += String.fromCharCode(parseInt(hex.slice(at, at + 2), 16));
  }
  return btoa(binary);
}

/**
 * A script under check, its digests computed lazily and at most once per
 * algorithm (only an algorithm some policy names is ever computed).
 *
 * @param text Its text as the parser reads it.
 * @param nonce Its nonce (null: none, or not nonceable).
 * @param browser The engine comparing hashes.
 */
export function checkedScript(
  text: string,
  nonce: string | null,
  browser: SimulationCspBrowser
): CheckedScript {
  const digests = new Map<HashAlgorithm, string>();
  return {
    nonce,
    digest: (algorithm) => {
      let digest = digests.get(algorithm);
      if (digest === undefined) {
        digest = comparable(hexToBase64(HEX_DIGESTS[algorithm](text)), browser);
        digests.set(algorithm, digest);
      }
      return digest;
    }
  };
}

/**
 * Whether a script's digest matches one of a list's hash sources.
 *
 * @param list The list's facts.
 * @param script The script.
 */
function matchesHash(list: ElementListFacts, script: CheckedScript): boolean {
  for (const [algorithm, values] of list.hashes) {
    if (values.has(script.digest(algorithm))) return true;
  }
  return false;
}

/**
 * Whether a policy allows a parser-inserted inline script with no nonce
 * (the runtime element as WP Rocket writes it): all inline, or its hash.
 *
 * @param policy The policy's facts.
 * @param script The script (its nonce is not read).
 */
export function allowsParsedInline(policy: PolicyFacts, script: CheckedScript): boolean {
  const list = policy.element;
  return list === null || list.allInline || matchesHash(list, script);
}

/**
 * Whether a policy allows an inline script the runtime creates: all
 * inline, its nonce, its hash, or `'strict-dynamic'` (a trusted script
 * inserting it).
 *
 * @param policy The policy's facts.
 * @param script The script.
 */
export function allowsCreatedInline(policy: PolicyFacts, script: CheckedScript): boolean {
  const list = policy.element;
  return (
    list === null ||
    list.allInline ||
    list.strictDynamic ||
    (script.nonce !== null && list.nonces.has(script.nonce)) ||
    matchesHash(list, script)
  );
}

/**
 * Whether a policy lets a script element load a `data:` URL: the `data:`
 * scheme source, its nonce, or `'strict-dynamic'`.
 *
 * @param policy The policy's facts.
 * @param nonce The element's nonce (null: none, or not nonceable).
 */
export function allowsDataScript(policy: PolicyFacts, nonce: string | null): boolean {
  const list = policy.element;
  return (
    list === null || list.data || list.strictDynamic || (nonce !== null && list.nonces.has(nonce))
  );
}

/**
 * Whether a policy lets a parser-inserted external script with no nonce
 * and no `integrity` load from a URL (WP Rocket's runtime tag): no
 * directive governs, or the list admits the URL — never under
 * `'strict-dynamic'`, which drops parser-inserted scripts. Chromium
 * checks the URL it requests (after an `upgrade-insecure-requests`
 * upgrade); Firefox checks the URL as written, an http URL matching https
 * sources under a policy that itself upgrades insecure requests (observed
 * on Chromium 156 / Firefox 155).
 *
 * @param policy The policy's facts.
 * @param url The script URL as the engine checks it (see above).
 * @param self The document's URL.
 * @param browser The engine.
 */
export function allowsParsedScriptUrl(
  policy: PolicyFacts,
  url: URL,
  self: URL,
  browser: SimulationCspBrowser
): boolean {
  const list = policy.element;
  if (list === null) return true;
  const upgradeAsHttps = browser === 'firefox' && policy.upgradeInsecure;
  return (
    !list.strictDynamic && sourceListAllowsUrl(list.sources, url, self, browser, upgradeAsHttps)
  );
}
