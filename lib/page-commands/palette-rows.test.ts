/**
 * The palette's view-only rows: display order and labels from the
 * vocabulary, lowercase keywords for every row, the analysis-host
 * availability note, the master gate's confirm copy (naming both ways back
 * on) and the page facts read from a URL.
 */
import { describe, expect, it } from 'vitest';
import { PAGE_UI_GATE_RESCUE_LABEL, pageCommandLabel } from './commands';
import { pageCommandFacts, paletteRowViews } from './palette-rows';

/** Facts of an ordinary site page and of the analysis host. */
const SITE = { analysisHost: false } as const;
const ANALYSIS_HOST = { analysisHost: true } as const;

describe('paletteRowViews', () => {
  it('lists the palette rows in display order with the vocabulary’s labels', () => {
    const rows = paletteRowViews(SITE);
    expect(rows.map((row) => row.id)).toEqual([
      'side-by-side',
      'psi-side-by-side',
      'toggle-detection-widget',
      'exclusion-builder',
      'page-ui-gate'
    ]);
    for (const row of rows) expect(row.label).toBe(pageCommandLabel(row.id));
  });

  it('keeps keywords lowercase and non-empty (the matcher scores them as given)', () => {
    for (const row of paletteRowViews(SITE)) {
      expect(row.keywords.length).toBeGreaterThan(0);
      for (const keyword of row.keywords) expect(keyword).toBe(keyword.toLowerCase());
    }
  });

  it('disables the PageSpeed Insights flow on the analysis host only', () => {
    expect(paletteRowViews(SITE).every((row) => row.disabledNote === null)).toBe(true);
    const disabled = paletteRowViews(ANALYSIS_HOST).filter((row) => row.disabledNote !== null);
    expect(disabled.map((row) => [row.id, row.disabledNote])).toEqual([
      ['psi-side-by-side', 'Starts from a site, not from PageSpeed Insights']
    ]);
  });

  it('asks a confirm naming the consequence and both ways back, for the master gate only', () => {
    const confirming = paletteRowViews(SITE).filter((row) => row.confirm !== null);
    expect(confirming.map((row) => row.id)).toEqual(['page-ui-gate']);
    expect(confirming[0]?.confirm).toEqual({
      title: 'Turn off all on-page UI?',
      body: 'This also turns off this command palette. Turn it back on from the page’s right-click menu (“Turn on all on-page UI”) or the extension’s options.',
      action: 'Turn off'
    });
    expect(confirming[0]?.confirm?.body).toContain(PAGE_UI_GATE_RESCUE_LABEL);
  });
});

describe('pageCommandFacts', () => {
  it('flags the PageSpeed Insights host only', () => {
    expect(pageCommandFacts(new URL('https://pagespeed.web.dev/analysis?url=x'))).toEqual(
      ANALYSIS_HOST
    );
    expect(pageCommandFacts(new URL('https://example.com/'))).toEqual(SITE);
    expect(pageCommandFacts(new URL('https://web.dev/'))).toEqual(SITE);
  });
});
