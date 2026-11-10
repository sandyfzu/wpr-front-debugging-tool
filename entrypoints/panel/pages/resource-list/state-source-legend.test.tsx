/** The chip-source legend: the page's sources once, in legend order, with their words and the chip's icon or swatch. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { StateSourceLegend, legendSources } from './state-source-legend';
import { STATE_SOURCES, STATE_SOURCE_LOOKS, type StateSource } from './state-sources';

afterEach(cleanup);

/**
 * The legend's items.
 *
 * @param sources The page's sources (default: all four).
 */
function items(sources: readonly StateSource[] = STATE_SOURCES): HTMLElement[] {
  const { container } = render(() => <StateSourceLegend sources={sources} />);
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[data-fdt="state-source-legend"] > [data-fdt-source]'
    )
  ];
}

describe('StateSourceLegend', () => {
  it('names the four sources in one line, in order', () => {
    const legend = items();
    expect(legend.map((item) => item.dataset.fdtSource)).toEqual([...STATE_SOURCES]);
    expect(legend.map((item) => item.textContent)).toEqual([
      'WP Rocket',
      'Simulated by FDT',
      'Excluded by FDT',
      'Page'
    ]);
  });

  it('leads each word with its chip icon in the chip color; the page with an outlined swatch', () => {
    const [wpRocket, simulated, excluded, page] = items();
    expect(wpRocket?.querySelector('svg')?.classList.contains('lucide-rocket')).toBe(true);
    expect(simulated?.querySelector('svg')?.classList.contains('lucide-flask-conical')).toBe(true);
    expect(excluded?.querySelector('svg')?.classList.contains('lucide-ban')).toBe(true);
    expect(wpRocket?.className).toContain('text-status-info');
    expect(simulated?.className).toContain('text-status-info');
    expect(excluded?.className).toContain('text-status-warn');
    // The page's words are muted, as its plain outline chip carries no tone.
    expect(page?.className).toContain('text-fg-muted');
    expect(page?.className).not.toContain('text-status-neutral');
    expect(page?.querySelector('svg')).toBeNull();
    const swatch = page?.querySelector('span[aria-hidden="true"]');
    expect(swatch?.className).toContain('border-line-2');
  });
});

describe('StateSourceLegend — per page', () => {
  it("lists only the page's sources (a WP Rocket-only page names just WP Rocket)", () => {
    const legend = items(['wp-rocket']);
    expect(legend.map((item) => item.textContent)).toEqual(['WP Rocket']);
  });
});

describe('legendSources', () => {
  it('keeps legend order and each source once, whatever the declaration', () => {
    expect(legendSources(['page', 'wp-rocket', 'page', 'excluded'])).toEqual([
      'wp-rocket',
      'excluded',
      'page'
    ]);
    expect(legendSources([])).toEqual([]);
  });
});

describe('STATE_SOURCE_LOOKS', () => {
  it('sets every source apart by icon or treatment, never by color alone', () => {
    const looks = STATE_SOURCES.map((source) => STATE_SOURCE_LOOKS[source]);
    // One icon per source (the iconless page counted once).
    expect(new Set(looks.map((look) => look.icon)).size).toBe(STATE_SOURCES.length);
    // The page's own state has no icon: its plain outline (the type chip's) says it.
    expect(STATE_SOURCE_LOOKS.page).toMatchObject({
      variant: 'outline',
      icon: null,
      kind: 'neutral'
    });
    expect(STATE_SOURCE_LOOKS['wp-rocket']).toMatchObject({ variant: 'soft', kind: 'info' });
    expect(STATE_SOURCE_LOOKS.simulated).toMatchObject({ variant: 'dashed', kind: 'info' });
    expect(STATE_SOURCE_LOOKS.excluded).toMatchObject({ variant: 'soft', kind: 'warn' });
  });
});
