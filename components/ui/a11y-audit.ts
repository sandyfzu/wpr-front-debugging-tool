/**
 * The component-tier accessibility audit seam: one runner around `axe-core`
 * that every render test shares, so a11y assertions never drift between files.
 *
 * `axe-core` audits a whole rendered document, and the component tier renders
 * fragments into a bland container — the *page-frame* rules (title, lang,
 * landmarks, headings, region) can never see the real document there and would
 * always fail spuriously. Those rules are excluded here, declared once, and
 * left to the browser suite (the tier that renders and styles for real).
 */

import type { AxeResults, Result } from 'axe-core';

/** The axe rules that audit the page frame — browser-suite territory only. */
export const PAGE_FRAME_RULES: readonly string[] = [
  'document-title',
  'html-has-lang',
  'landmark-one-main',
  'page-has-heading-one',
  'region'
];

/**
 * Run the audit under the shared node environment (happy-dom's document), over
 * the whole document (the fragment container included).
 *
 * @returns The full axe result; callers assert `violations`.
 */
export async function runAxeAudit(): Promise<AxeResults> {
  // The trimming import: axe's parent-facing runtime reads the test DOM through
  // the same global document; its context param is typed for the browser's Node
  // only — hence the cast — and options come as the second arg per its runtime
  // parameter normalization.
  const axe = await import('axe-core');
  return axe.run(document as unknown as Node, {
    rules: Object.fromEntries(PAGE_FRAME_RULES.map((rule) => [rule, { enabled: false }]))
  });
}

/**
 * The readable summary a failing audit prints — but a suite wants more than a
 * count: each violation's rule id with the failing nodes' selectors.
 *
 * @param violations The axe result's violations to summarize.
 */
export function describeAxeViolations(violations: Result[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}) → ${violation.nodes
          .map((node) => node.target.join(' '))
          .join('; ')}`
    )
    .join('\n');
}
