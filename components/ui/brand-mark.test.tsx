/** Render tests for the brand tile: decorative, 24 px, on the accent gradient tokens. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

afterEach(() => {
  cleanup();
});

/** The rendered tile. */
function tile(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt="brand-mark"]');
  if (found === null) throw new Error('no brand tile');
  return found;
}

describe('BrandMark', () => {
  it('is hidden from assistive tech (the name rides beside it as text)', () => {
    render(() => <BrandMark />);
    expect(tile().getAttribute('aria-hidden')).toBe('true');
    expect(tile().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(tile().textContent).toBe('');
  });

  it('paints the 24 px tile from the gradient tokens only', () => {
    render(() => <BrandMark />);
    for (const token of [
      'size-6',
      'bg-linear-to-br',
      'from-accent-from',
      'to-accent-to',
      'text-on-accent'
    ]) {
      expect(tile().classList).toContain(token);
    }
    expect(tile().getAttribute('style')).toBeNull();
  });

  it('merges caller classes last', () => {
    render(() => <BrandMark class="ms-1" />);
    expect(tile().classList).toContain('ms-1');
  });
});
