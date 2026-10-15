/**
 * The withheld-value presentation: marker text visible, the reason on the
 * title and in screen-reader text, the lock decorative.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { WITHHELD_LEGEND, WITHHELD_NOTE, WithheldLegend, WithheldValue } from './withheld-value';

afterEach(() => {
  cleanup();
});

describe('WithheldValue', () => {
  it('shows the marker with its reason as title and sr text', () => {
    render(() => <WithheldValue value="sid=(value redacted)" class="extra" />);
    const node = document.querySelector('[data-fdt-redacted]');
    expect(node?.getAttribute('title')).toBe(WITHHELD_NOTE);
    expect(node?.className).toContain('extra');
    expect(node?.textContent).toBe(`sid=(value redacted) — ${WITHHELD_NOTE}`);
    expect(node?.querySelector('.sr-only')?.textContent).toBe(` — ${WITHHELD_NOTE}`);
    expect(node?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('WithheldLegend', () => {
  it('states the reason once, visibly, with a decorative lock', () => {
    render(() => <WithheldLegend class="extra" />);
    const node = document.querySelector('[data-fdt="withheld-legend"]');
    expect(node?.textContent).toBe(WITHHELD_LEGEND);
    expect(node?.className).toContain('extra');
    expect(node?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
