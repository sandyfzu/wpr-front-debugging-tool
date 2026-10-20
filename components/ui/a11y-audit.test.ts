/**
 * The audit seam's pin: the page-frame rule list (excluded from the component
 * tier, priced by the browser suite), that the runner wires the exclusions
 * through `axe-core`'s configured run — a drift in the exclusions off, and
 * component-tier suites reading "zero violations" would double-count the
 * page frame — and that the run is effective at all: a real violation is
 * caught (zero here can never degrade to vacuous).
 */
import { describe, expect, it } from 'vitest';
import type { Result } from 'axe-core';
import { PAGE_FRAME_RULES, describeAxeViolations, runAxeAudit } from './a11y-audit';

describe('a11y-audit', () => {
  it('excludes exactly the page-frame rules this tier cannot see', () => {
    expect(PAGE_FRAME_RULES).toEqual([
      'document-title',
      'html-has-lang',
      'landmark-one-main',
      'page-has-heading-one',
      'region'
    ]);
  });

  it('summarizes violations rule-first with node selectors', () => {
    const violation = {
      id: 'label',
      impact: 'critical',
      nodes: [{ target: ['#row > input'] }, { target: ['#other'] }]
    } as unknown as Result;
    const summary = describeAxeViolations([violation]);
    expect(summary).toContain('label (critical)');
    expect(summary).toContain('#row > input');
    expect(summary).toContain('#other');
  });

  it('catches a real violation (the exclusions are scoped, the run never vacuous)', async () => {
    // The tier's shape: an unnamed control in a fragment container. If the
    // exclusions were a blanket off — or the document were invisible to axe —
    // this would come back empty and every tier suite's zero would be fake.
    const button = document.createElement('button');
    document.body.appendChild(button);
    try {
      const result = await runAxeAudit();
      // The content rule is ON: the unnamed button is caught…
      expect(result.violations.some((violation) => violation.id === 'button-name')).toBe(true);
      // …and rules still complete passes elsewhere (only the page frame is off).
      expect(result.passes.length).toBeGreaterThan(0);
    } finally {
      button.remove();
    }
  });
});
