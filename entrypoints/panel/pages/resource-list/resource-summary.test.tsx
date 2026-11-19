import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ResourceSummary } from './resource-summary';

afterEach(() => {
  cleanup();
});

/**
 * The rendered strip's badge text and tone class.
 *
 * @param container The render root.
 */
function badge(container: HTMLElement): { text: string; className: string } {
  const element = container.querySelector('[data-fdt="status-badge"]');
  return { text: element?.textContent ?? '', className: element?.className ?? '' };
}

describe('ResourceSummary', () => {
  it.each([
    [true, false, 'Detected', 'text-status-ok'],
    [false, true, 'Simulated', 'text-status-info'],
    [false, false, 'Not detected', 'text-status-neutral'],
    // A detected footprint wins over a simulation flag (never both in practice).
    [true, true, 'Detected', 'text-status-ok']
  ])(
    'present %s, simulated %s → %s',
    (present: boolean, simulated: boolean, text: string, tone: string) => {
      const { container } = render(() => (
        <ResourceSummary
          featureLabel="LazyLoad for images"
          featurePresent={present}
          featureSimulated={simulated}
        />
      ));
      expect(container.textContent).toContain('LazyLoad for images');
      expect(badge(container).text).toBe(text);
      expect(badge(container).className).toContain(tone);
    }
  );

  it('shows the total only when given, and each note on its own line', () => {
    const { container } = render(() => (
      <ResourceSummary
        featureLabel="WP Rocket hints"
        featurePresent={false}
        total="7 hints"
        notes={['First note.', 'Second note.']}
      />
    ));
    expect(container.querySelector('[data-fdt="resource-total"]')?.textContent).toBe('7 hints');
    const notes = [...container.querySelectorAll('[data-fdt="resource-note"]')];
    expect(notes.map((note) => note.textContent)).toEqual(['First note.', 'Second note.']);
    expect(notes.every((note) => note.className.includes('basis-full'))).toBe(true);
    cleanup();
    const bare = render(() => <ResourceSummary featureLabel="X" featurePresent />);
    expect(bare.container.querySelector('[data-fdt="resource-total"]')).toBeNull();
    expect(bare.container.querySelector('[data-fdt="resource-note"]')).toBeNull();
  });
});
