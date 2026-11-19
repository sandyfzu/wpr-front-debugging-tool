/**
 * Render tests for the palette's key footer: the three hints in reading
 * order, each key in the shared chip (glyphs as decorative icons).
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_CHIP } from '../../../components/ui/classes';
import { PALETTE_FOOTER_HINTS, PaletteFooter } from './palette-footer';

afterEach(() => {
  cleanup();
});

describe('PaletteFooter', () => {
  it('lists move, run and close in that order, keys before words', () => {
    render(() => <PaletteFooter />);
    const footer = document.querySelector('[data-fdt="palette-footer"]');
    const hints = [...(footer?.children ?? [])];
    expect(hints.map((hint) => hint.textContent)).toEqual(['move', 'run', 'Escclose']);
    expect(PALETTE_FOOTER_HINTS.map((hint) => hint.action)).toEqual(['move', 'run', 'close']);
    expect(hints.map((hint) => hint.querySelectorAll('kbd').length)).toEqual([2, 1, 1]);
  });

  it('draws every key in the shared chip, one height; glyphs are hidden icons', () => {
    render(() => <PaletteFooter />);
    const chips = [...document.querySelectorAll('[data-fdt="palette-footer"] kbd')];
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      for (const token of KEY_CHIP.split(' ')) expect(chip.classList).toContain(token);
      expect(chip.classList).toContain('h-4.5');
    }
    const glyphs = chips.slice(0, 3).map((chip) => chip.querySelector('svg'));
    for (const glyph of glyphs) expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(chips[3]?.textContent).toBe('Esc');
  });

  it('sits above the plate edge on a hairline, in the muted meta tone', () => {
    render(() => <PaletteFooter />);
    const footer = document.querySelector('[data-fdt="palette-footer"]');
    for (const token of ['border-t', 'border-line-1', 'text-2xs', 'text-fg-muted', 'flex-wrap']) {
      expect(footer?.classList).toContain(token);
    }
  });
});
