/**
 * The page-CSP check of a simulation step (pure): given the page's Content
 * Security Policy inputs, the page as served and as simulated, whether the
 * policy blocks the injected runtime outright (the step then reports
 * `csp-blocked` and serves the page as is) and which of its work it limits
 * — exactly as the browser would treat WP Rocket's own runtime, never
 * bypassed.
 *
 * - An enforced header `sandbox` without both `allow-scripts` and
 *   `allow-same-origin` stops the runtime (no script runs, or its
 *   `sessionStorage` read throws): blocked.
 * - The runtime element (inline, no nonce, right after the first `<head…>`)
 *   must pass every enforced header policy and every meta policy before it.
 *   Report-only policies never block.
 * - An unreadable applied meta (`metasUnreadable`) can only restrict
 *   further: the readable policies' block stands; otherwise the verdict is
 *   `unreadable` (never "allowed").
 * - Its later work meets every enforced policy (all metas apply by then):
 *   `eval` — `new Function` for `on…` handlers; `trusted-types` — a policy
 *   requiring Trusted Types makes every script text/`src` write the runtime
 *   does throw, so no delayed script runs (and `eval` fails too);
 *   delayed inline scripts, per element (a nonce or hash is per element)
 *   and per browser engine, since the runtime branches on it:
 *   - Firefox recreates each one (nonce copied): it runs when every policy
 *     allows a script-created inline script.
 *   - Chromium first points it at a `data:` URL in place; a `data:`
 *     violation (enforced or report-only) switches the runtime, for the
 *     rest of the tab session, to recreating scripts as on Firefox — and
 *     a blocked `data:` load is retried that way. `data` names a fallback
 *     that ran (nothing failed); `inline-after-fallback` a script that ran
 *     from `data:` but whose recreated copy is disallowed — it fails once
 *     an earlier page in the tab switched the runtime (state this
 *     per-document check cannot see).
 */
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { decodeAttributeValue } from '../../utils/html-attribute-value';
import {
  allowsCreatedInline,
  allowsDataScript,
  allowsParsedInline,
  checkedScript,
  headerPolicies,
  metaPolicies,
  policyFacts,
  type CheckedScript,
  type CspPolicy,
  type PolicyFacts
} from './csp-policy';
import { firstOpeningTag } from './opening-tag';
import { expandPhpReplacement } from './php-replacement';
import {
  SIMULATION_CSP_LIMITS,
  type SimulationCspBrowser,
  type SimulationCspLimit,
  type SimulationCspUnavailableReason
} from './spec';

/** The check's verdict. */
export type SimulationCspVerdict =
  | { readonly blocked: true }
  | {
      readonly blocked: false;
      /** Runtime work the policy limits, each once, in vocabulary order (empty: none). */
      readonly limits: readonly SimulationCspLimit[];
    }
  | {
      readonly blocked: false;
      /** The limits could not be evaluated (the runtime itself is allowed). */
      readonly unavailable: Extract<SimulationCspUnavailableReason, 'unreadable'>;
    };

/** What the check reads. */
export interface SimulationCspCheck {
  /** The page's policy inputs (absent: none known — allowed). */
  readonly csp: SimulationCspInput | undefined;
  /** The page the step was given (meta offsets are into it). */
  readonly served: string;
  /** The simulated page (its delayed scripts). */
  readonly simulated: string;
  /** The runtime file's text (as the transform injected it). */
  readonly runtime: string;
}

/** Evaluates a page's CSP against a simulated document. */
export type SimulationCspEvaluator = (check: SimulationCspCheck) => SimulationCspVerdict;

/** A delayed inline script as the checks read it. */
export interface DelayedInlineScript {
  /** Its nonce as a recreated copy carries it (null: none, or not nonceable). */
  readonly nonce: string | null;
  /**
   * Its nonce as the parsed element itself presents it: also null when its
   * tag repeats an attribute (a duplicate-attribute parse error makes it
   * not nonceable; a copy has no duplicate — observed on Chromium 156).
   */
  readonly inPlaceNonce: string | null;
  /** It has a nonce, but an attribute value holds a reference the decoder cannot read. */
  readonly nonceUnreadable: boolean;
  /** Its text as the parser reads it (line breaks normalized, NUL as U+FFFD). */
  readonly text: string;
}

/** The verdict that blocks and limits nothing. */
const ALLOWED: SimulationCspVerdict = { blocked: false, limits: [] };

/** The verdict when a policy or a delayed script's nonce cannot be read. */
const UNREADABLE: SimulationCspVerdict = { blocked: false, unavailable: 'unreadable' };

/** The type suffix the runtime selects delayed scripts by (`script[type$=rocketlazyloadscript]`). */
const DELAYED_TYPE_SUFFIX = 'rocketlazyloadscript';

/** Attribute text that makes a script element not nonceable (a likely injection). */
const NONCE_HIJACK = /<(?:script|style)/i;

/**
 * A verdict listing limits in vocabulary order.
 *
 * @param limits The limits found (any order, repeats allowed).
 */
function limited(limits: ReadonlySet<SimulationCspLimit>): SimulationCspVerdict {
  return { blocked: false, limits: SIMULATION_CSP_LIMITS.filter((limit) => limits.has(limit)) };
}

/**
 * Whether a tag has an attribute.
 *
 * @param tag The tag.
 * @param name The attribute name (lowercase).
 */
function hasAttribute(tag: ScannedTag, name: string): boolean {
  return tag.attrs.some((attr) => attr.name === name);
}

/**
 * A script element's nonces as CSP reads them (CSP3 "is element
 * nonceable"): its first `nonce` value, unless an attribute name or value
 * holds `<script` / `<style`; in place, also not when an attribute repeats.
 *
 * @param tag The script tag.
 */
function elementNonces(
  tag: ScannedTag
): Pick<DelayedInlineScript, 'nonce' | 'inPlaceNonce' | 'nonceUnreadable'> {
  const none = { nonce: null, inPlaceNonce: null, nonceUnreadable: false };
  if (!hasAttribute(tag, 'nonce')) return none;
  const values = tag.attrs.map((attr) => decodeAttributeValue(attr.value ?? ''));
  if (values.some((value) => value === null)) return { ...none, nonceUnreadable: true };
  const hijacked = tag.attrs.some(
    (attr, at) => NONCE_HIJACK.test(attr.name) || NONCE_HIJACK.test(values[at] ?? '')
  );
  if (hijacked) return none;
  // An empty nonce matches no nonce source: read as none.
  const nonce = values[tag.attrs.findIndex((attr) => attr.name === 'nonce')] || null;
  const repeated = new Set(tag.attrs.map((attr) => attr.name)).size < tag.attrs.length;
  return { nonce, inPlaceNonce: repeated ? null : nonce, nonceUnreadable: false };
}

/**
 * The inline scripts the runtime will run on interaction, in document
 * order: delayed (`type` ending in the delayed suffix), no
 * `data-rocket-src`, no `nomodule` (skipped by module-capable browsers).
 *
 * @param simulated The simulated page.
 */
export function delayedInlineScripts(simulated: string): DelayedInlineScript[] {
  return scanTags(simulated)
    .filter(
      (tag) =>
        tag.name === 'script' &&
        (tag.attrs.find((attr) => attr.name === 'type')?.value ?? '')
          .toLowerCase()
          .endsWith(DELAYED_TYPE_SUFFIX) &&
        !hasAttribute(tag, 'data-rocket-src') &&
        !hasAttribute(tag, 'nomodule')
    )
    .map((tag) => ({
      ...elementNonces(tag),
      text: simulated
        .slice(tag.openingEnd, tag.contentEnd)
        .replace(/\r\n?/g, '\n')
        .replace(/\0/g, '\uFFFD')
    }));
}

/** A delayed script ready for the checks: its recreated copy, and its nonce in place. */
interface DelayedCheck {
  readonly copy: CheckedScript;
  readonly inPlaceNonce: string | null;
}

/**
 * Chromium's handling of the delayed inline scripts in one fresh tab
 * session: each loads from `data:` in place until a `data:` violation
 * (enforced or report-only) switches the runtime to recreating them;
 * a blocked `data:` load is retried recreated.
 *
 * @param scripts The delayed inline scripts.
 * @param enforced The enforced policies.
 * @param reportOnly The report-only policies.
 * @param limits Where the limits found are added.
 */
function chromiumInlineLimits(
  scripts: readonly DelayedCheck[],
  enforced: readonly PolicyFacts[],
  reportOnly: readonly PolicyFacts[],
  limits: Set<SimulationCspLimit>
): void {
  let recreating = false;
  for (const { copy, inPlaceNonce } of scripts) {
    const created = enforced.every((policy) => allowsCreatedInline(policy, copy));
    if (recreating) {
      if (!created) limits.add('inline');
      continue;
    }
    const loads = enforced.every((policy) => allowsDataScript(policy, inPlaceNonce));
    const reported = !reportOnly.every((policy) => allowsDataScript(policy, inPlaceNonce));
    recreating = !loads || reported;
    if (loads) {
      if (!created) limits.add('inline-after-fallback');
    } else {
      limits.add(created ? 'data' : 'inline');
    }
  }
}

/** A page's policies, each read once for the engine. */
interface PagePolicies {
  readonly headers: readonly PolicyFacts[];
  readonly reportOnly: readonly PolicyFacts[];
  readonly metas: readonly { readonly facts: PolicyFacts; readonly offset: number }[];
}

/**
 * Read a page's policy inputs once for its engine.
 *
 * @param csp The inputs.
 */
function pagePolicies(csp: SimulationCspInput): PagePolicies {
  const read = (policy: CspPolicy): PolicyFacts => policyFacts(policy, csp.browser);
  const { enforced, reportOnly } = headerPolicies(csp.headers);
  return {
    headers: enforced.map(read),
    reportOnly: reportOnly.map(read),
    metas: csp.metas.flatMap((meta) =>
      metaPolicies(meta.content, csp.browser).map((policy) => ({
        facts: read(policy),
        offset: meta.offset
      }))
    )
  };
}

/**
 * Whether a policy names any nonce source.
 *
 * @param policy The policy's facts.
 */
function hasNonceSources(policy: PolicyFacts): boolean {
  return (policy.element?.nonces.size ?? 0) > 0;
}

/**
 * The limits on the runtime's later work, under every enforced policy.
 *
 * @param policies The page's policies.
 * @param enforced Every enforced policy (headers and metas).
 * @param simulated The simulated page.
 * @param browser The engine.
 */
function laterWorkVerdict(
  policies: PagePolicies,
  enforced: readonly PolicyFacts[],
  simulated: string,
  browser: SimulationCspBrowser
): SimulationCspVerdict {
  if (enforced.some((policy) => policy.trustedTypes)) {
    return limited(new Set(['eval', 'trusted-types']));
  }
  const limits = new Set<SimulationCspLimit>();
  if (!enforced.every((policy) => policy.evalAllowed)) limits.add('eval');
  if (enforced.length === 0 && policies.reportOnly.length === 0) return limited(limits);
  const scripts = delayedInlineScripts(simulated);
  if (
    scripts.some((script) => script.nonceUnreadable) &&
    [...enforced, ...policies.reportOnly].some(hasNonceSources)
  ) {
    return UNREADABLE;
  }
  const checks = scripts.map((script) => ({
    copy: checkedScript(script.text, script.nonce, browser),
    inPlaceNonce: script.inPlaceNonce
  }));
  if (browser === 'chromium') {
    chromiumInlineLimits(checks, enforced, policies.reportOnly, limits);
  } else if (
    !checks.every(({ copy }) => enforced.every((policy) => allowsCreatedInline(policy, copy)))
  ) {
    limits.add('inline');
  }
  return limited(limits);
}

/**
 * Evaluate a page's CSP against a simulated document.
 *
 * @param check The policy inputs and both pages.
 * @returns Blocked, the limits, or why they are unknown.
 */
export const evaluateSimulationCsp: SimulationCspEvaluator = ({
  csp,
  served,
  simulated,
  runtime
}) => {
  if (csp === undefined) return ALLOWED;
  const head = firstOpeningTag(served, 'head', false);
  // No `<head…>`: the transform injected no runtime, so nothing runs to be blocked.
  if (head === null) return ALLOWED;
  const policies = pagePolicies(csp);
  if (policies.headers.some((policy) => policy.sandboxStopsRuntime)) return { blocked: true };
  const bindingRuntime = [
    ...policies.headers,
    ...policies.metas.filter((meta) => meta.offset < head.end).map((meta) => meta.facts)
  ];
  if (bindingRuntime.length > 0) {
    // The runtime's text as written into the page (read as replacement syntax).
    const text = expandPhpReplacement(runtime, [served.slice(head.start, head.end)]);
    const element = checkedScript(text, null, csp.browser);
    if (!bindingRuntime.every((policy) => allowsParsedInline(policy, element))) {
      return { blocked: true };
    }
  }
  // The readable policies allow the runtime; an unknown one may still block or limit it.
  if (csp.metasUnreadable === true) return UNREADABLE;
  const enforced = [...policies.headers, ...policies.metas.map((meta) => meta.facts)];
  return laterWorkVerdict(policies, enforced, simulated, csp.browser);
};
