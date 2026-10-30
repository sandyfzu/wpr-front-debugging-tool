/**
 * The page-CSP check of a simulated LazyLoad page (pure): what the page's
 * Content Security Policy does to what LazyLoad prints, exactly as the
 * browser treats it on WP Rocket's own page (observed on Chromium 156 /
 * Firefox 155; never bypassed).
 *
 * - The options script (inline, no nonce, before `</body>`) and the runtime
 *   tag (parser-inserted `async` script at the runtime URL, no nonce, no
 *   `integrity`) each must pass every enforced policy — headers, and every
 *   applied meta (all are head elements, so all precede the footer). The
 *   runtime initializes only from `window.lazyLoadOptions`, so either one
 *   blocked lazy loads no image: `csp-blocked`, like a blocked runtime.
 *   Options script: effective `'unsafe-inline'` or its hash. Runtime: its
 *   URL in the source list (see `csp-source-match`), never under
 *   `'strict-dynamic'`. Both delivery paths behave as the real file: the
 *   page's CSP judges the URL the page requests — under
 *   `upgrade-insecure-requests` (any enforced policy), Chromium judges the
 *   upgraded URL, Firefox the written one (see `allowsParsedScriptUrl`).
 * - An enforced header `sandbox` without `allow-scripts` runs no script:
 *   blocked (no storage is needed: `allow-same-origin` is not).
 * - An unreadable applied meta only restricts further: a block by the
 *   readable policies stands, otherwise the verdict is `unreadable`.
 * - Allowed: `placeholders` when the page got placeholder images and a
 *   policy blocks `data:` images — they render broken until each loads
 *   (lazy loading still works), as on WP Rocket's page.
 * - Report-only policies never block; the no-JS style is a `<noscript>`
 *   child, raw text while scripting runs, so `style-src` never sees it;
 *   the runtime writes no script sink (Trusted Types do not apply) and
 *   sets background images through the CSSOM (not `style-src-attr`).
 */
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import { pagePolicies, parsedScriptText, type SimulationCspVerdict } from './csp-evaluation';
import {
  allowsParsedInline,
  allowsParsedScriptUrl,
  checkedScript,
  type PolicyFacts
} from './csp-policy';
import { scriptRequestUrl, type ScriptRequestRefusal } from './script-request';

/** What the check reads. */
export interface LazyloadCspCheck {
  /** The page's policy inputs (absent: none known — allowed). */
  readonly csp: SimulationCspInput | undefined;
  /** The document's URL (the policies' `'self'`). */
  readonly pageUrl: string;
  /** The runtime tag's URL. */
  readonly runtimeUrl: string;
  /** The options script as printed (`<script>…</script>`). */
  readonly optionsScript: string;
  /** The simulated page holds placeholder images LazyLoad wrote. */
  readonly placeholders: boolean;
}

/**
 * Whether the extension cannot serve the runtime for the page although its
 * CSP allows it: on Firefox, an enforced header `sandbox` that lets
 * scripts run but withholds `allow-same-origin` makes the page an opaque
 * origin, and Firefox then names no requesting document on the runtime's
 * request — the one fact delivery checks before answering it.
 *
 * @param csp The page's policy inputs (absent: none known).
 */
export function runtimeUndeliverable(csp: SimulationCspInput | undefined): boolean {
  if (csp?.browser !== 'firefox') return false;
  return pagePolicies(csp).headers.some(
    (policy) => policy.sandboxStopsRuntime && !policy.sandboxStopsScripts
  );
}

/**
 * Every enforced policy of a page: header ones, and every applied meta
 * (all are head elements, so all precede the footer).
 *
 * @param csp The page's policy inputs.
 */
function enforcedPolicies(csp: SimulationCspInput): PolicyFacts[] {
  const policies = pagePolicies(csp);
  return [...policies.headers, ...policies.metas.map((meta) => meta.facts)];
}

/** The runtime's request: the URL the page requests, or why it requests none. */
export type LazyloadRuntimeRequest =
  { readonly url: string } | { readonly refused: ScriptRequestRefusal };

/**
 * The URL the simulated page requests for LazyLoad's runtime: the tag's
 * URL, upgraded to `https` when an enforced policy has
 * `upgrade-insecure-requests` — or `mixed-content` when an `https` page
 * would load it over `http` (the browser blocks it before any CSP check,
 * as on WP Rocket's page).
 *
 * @param csp The page's policy inputs (absent: none known).
 * @param pageUrl The document's URL.
 * @param runtimeUrl The runtime tag's URL.
 * @returns The requested URL (serialized), or why none is requested.
 * @throws {@link TypeError} when `pageUrl` or `runtimeUrl` is not a URL (the step's own values always are).
 */
export function lazyloadRuntimeRequest(
  csp: SimulationCspInput | undefined,
  pageUrl: string,
  runtimeUrl: string
): LazyloadRuntimeRequest {
  const upgrade = csp !== undefined && enforcedPolicies(csp).some((p) => p.upgradeInsecure);
  const request = scriptRequestUrl(new URL(runtimeUrl), new URL(pageUrl), upgrade);
  return request instanceof URL ? { url: request.href } : { refused: request };
}

/** The verdict that blocks and limits nothing. */
const ALLOWED: SimulationCspVerdict = { blocked: false, limits: [] };

/**
 * An inline script's text from its printed element.
 *
 * @param element `<script…>text</script>`.
 * @throws {@link Error} when it is not one script element (the data file's texts always are).
 */
export function inlineScriptText(element: string): string {
  const open = element.indexOf('>');
  const close = element.lastIndexOf('</script>');
  if (!element.startsWith('<script') || open < 0 || close < open) {
    throw new Error(`Not a script element: ${element.slice(0, 40)}`);
  }
  return parsedScriptText(element.slice(open + 1, close));
}

/**
 * Evaluate a page's CSP against a simulated LazyLoad page (see the module doc).
 *
 * @param check The policy inputs and what LazyLoad printed.
 * @returns Blocked, the limits, or why they are unknown.
 * @throws {@link TypeError} when `pageUrl` or `runtimeUrl` is not a URL (the step's own values always are).
 */
export function evaluateLazyloadCsp(check: LazyloadCspCheck): SimulationCspVerdict {
  const csp = check.csp;
  if (csp === undefined) return ALLOWED;
  const policies = pagePolicies(csp);
  if (policies.headers.some((policy) => policy.sandboxStopsScripts)) return { blocked: true };
  const enforced = [...policies.headers, ...policies.metas.map((meta) => meta.facts)];
  const options = checkedScript(inlineScriptText(check.optionsScript), null, csp.browser);
  const written = new URL(check.runtimeUrl);
  const self = new URL(check.pageUrl);
  const upgrade = enforced.some((policy) => policy.upgradeInsecure);
  const requested = scriptRequestUrl(written, self, upgrade);
  // Chromium checks the URL it requests; Firefox the written one (its policy relaxing the scheme).
  const url = csp.browser === 'chromium' && requested instanceof URL ? requested : written;
  const runs = enforced.every(
    (policy) =>
      allowsParsedInline(policy, options) && allowsParsedScriptUrl(policy, url, self, csp.browser)
  );
  if (!runs) return { blocked: true };
  if (csp.metasUnreadable === true) return { blocked: false, unavailable: 'unreadable' };
  const brokenPlaceholders =
    check.placeholders && !enforced.every((policy) => policy.imageDataAllowed);
  return { blocked: false, limits: brokenPlaceholders ? ['placeholders'] : [] };
}
