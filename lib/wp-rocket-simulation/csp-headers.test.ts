import { describe, expect, it } from 'vitest';
import { cspHeaderFacts, cspHeaderLines } from './csp-headers';

describe('cspHeaderLines / cspHeaderFacts', () => {
  it('keeps the CSP lines of a response, in order, as received', () => {
    expect(
      cspHeaderLines([
        { name: 'content-type', value: 'text/html' },
        { name: 'Content-Security-Policy', value: 'a' },
        { name: 'content-security-policy' },
        { name: 'content-security-policy-report-only', value: 'b' }
      ])
    ).toEqual([
      { name: 'Content-Security-Policy', value: 'a' },
      { name: 'content-security-policy-report-only', value: 'b' }
    ]);
  });

  it('carries the lines as a facts field only when there are any', () => {
    expect(cspHeaderFacts([{ name: 'content-type', value: 'text/html' }])).toEqual({});
    expect(cspHeaderFacts([{ name: 'Content-Security-Policy', value: 'a' }])).toEqual({
      cspHeaders: [{ name: 'Content-Security-Policy', value: 'a' }]
    });
  });
});
