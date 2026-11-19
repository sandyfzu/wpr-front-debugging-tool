import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { featureStateBadge, ResourceSummary } from './resource-summary';

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

describe('featureStateBadge', () => {
  it('served, simulated (never "Not detected"), absent', () => {
    expect(featureStateBadge(true, false)).toEqual({ label: 'Detected', kind: 'ok' });
    expect(featureStateBadge(false, true)).toEqual({ label: 'Simulated', kind: 'info' });
    expect(featureStateBadge(false, false)).toEqual({ label: 'Not detected', kind: 'neutral' });
    // A detected footprint wins over a simulation flag.
    expect(featureStateBadge(true, true)).toEqual({ label: 'Detected', kind: 'ok' });
  });
});

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

  it('shows the version only with a detected footprint, hidden-labelled for readers', () => {
    const { container } = render(() => (
      <ResourceSummary featureLabel="Delay JavaScript execution" featurePresent version="2.0.4" />
    ));
    expect(container.textContent).toContain('Version v2.0.4');
    expect(container.querySelector('.sr-only')?.textContent).toBe('Version ');
    cleanup();
    const absent = render(() => (
      <ResourceSummary featureLabel="X" featurePresent={false} version="2.0.4" />
    ));
    expect(absent.container.textContent).not.toContain('2.0.4');
    cleanup();
    const none = render(() => <ResourceSummary featureLabel="X" featurePresent version={null} />);
    expect(none.container.textContent).not.toContain('Version');
  });

  it('names its hooks by family (resource by default, script for the JavaScript page)', () => {
    const { container } = render(() => (
      <ResourceSummary
        hooks="script"
        featureLabel="X"
        featurePresent
        total="3 scripts"
        notes={['Note.']}
      />
    ));
    expect(container.querySelector('[data-fdt="script-summary"]')).not.toBeNull();
    expect(container.querySelector('[data-fdt="script-total"]')?.textContent).toBe('3 scripts');
    expect(container.querySelector('[data-fdt="script-note"]')?.textContent).toBe('Note.');
    expect(container.querySelector('[data-fdt="resource-summary"]')).toBeNull();
  });
});
