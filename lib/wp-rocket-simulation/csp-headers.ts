/**
 * The Content Security Policy response headers (a leaf: the interception
 * backends capture these lines without loading the policy checks).
 */
import type { SimulationCspHeader } from '../messaging/exclusion-simulation';

/** The enforcing policy header's name (lowercase). */
export const CSP_HEADER = 'content-security-policy';

/** The report-only policy header's name (lowercase): it reports, never blocks. */
export const CSP_REPORT_ONLY_HEADER = 'content-security-policy-report-only';

/**
 * A response's CSP header lines (enforcing and report-only, names compared
 * case-insensitively), in order, as received.
 *
 * @param headers The response's header lines (a value may be missing).
 */
export function cspHeaderLines(
  headers: readonly { readonly name: string; readonly value?: string | undefined }[]
): SimulationCspHeader[] {
  const lines: SimulationCspHeader[] = [];
  for (const { name, value } of headers) {
    const lower = name.toLowerCase();
    if (value !== undefined && (lower === CSP_HEADER || lower === CSP_REPORT_ONLY_HEADER)) {
      lines.push({ name, value });
    }
  }
  return lines;
}

/**
 * The response-facts field carrying a response's CSP lines: present only
 * when it has any.
 *
 * @param headers The response's header lines.
 */
export function cspHeaderFacts(
  headers: readonly { readonly name: string; readonly value?: string | undefined }[]
): { readonly cspHeaders?: readonly SimulationCspHeader[] } {
  const lines = cspHeaderLines(headers);
  return lines.length === 0 ? {} : { cspHeaders: lines };
}
