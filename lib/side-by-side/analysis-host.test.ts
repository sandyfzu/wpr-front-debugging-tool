import { describe, expect, it } from 'vitest';
import { PSI_HOST, isPsiHost } from './analysis-host';

describe('isPsiHost', () => {
  it('accepts the analysis host itself, any path and scheme-capitalized hosts', () => {
    expect(PSI_HOST).toBe('pagespeed.web.dev');
    expect(isPsiHost(new URL('https://pagespeed.web.dev/analysis?url=https://x.dev'))).toBe(true);
    expect(isPsiHost(new URL('https://PAGESPEED.web.dev/analysis'))).toBe(true);
    expect(isPsiHost(new URL('http://pagespeed.web.dev/'))).toBe(true);
  });

  it('refuses other hosts, including lookalike suffix matches', () => {
    expect(isPsiHost(new URL('https://www.web.dev/'))).toBe(false);
    expect(isPsiHost(new URL('https://pagespeed.web.dev.example.com/'))).toBe(false);
    expect(isPsiHost(new URL('https://notpagespeed.web.dev/analysis'))).toBe(false);
    expect(isPsiHost(new URL('https://example.com/analysis'))).toBe(false);
  });
});
