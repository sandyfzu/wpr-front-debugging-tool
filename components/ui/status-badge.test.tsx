/**
 * Render tests for the status vocabulary (UX-D7): every kind paints from the
 * shared tables (never ad-hoc), and the icon option draws the vocabulary
 * icon. These assertions pin the *class wiring*, not colors (both palettes
 * come through the `light-dark()` tokens).
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  StatusBadge,
  STATUS_KINDS,
  STATUS_ICONS,
  STATUS_SOFT_CLASSES,
  STATUS_TEXT_CLASSES
} from './status-badge';

afterEach(() => {
  cleanup();
});

describe('StatusBadge', () => {
  it('renders all five vocabulary kinds with their soft + text classes', () => {
    render(() => (
      <div>
        <For each={STATUS_KINDS}>{(kind) => <StatusBadge kind={kind}>{kind}</StatusBadge>}</For>
      </div>
    ));
    expect(STATUS_KINDS).toEqual(['ok', 'warn', 'error', 'info', 'neutral']);
    for (const kind of STATUS_KINDS) {
      const badge = screen.getByText(kind).closest('span[data-fdt]');
      expect(badge?.className).toContain(STATUS_SOFT_CLASSES[kind].split(' ')[0] ?? '');
      expect(badge?.className).toContain(STATUS_TEXT_CLASSES[kind].split(' ')[0] ?? '');
    }
  });

  it('adds the vocabulary icon only when asked', () => {
    render(() => (
      <div>
        <StatusBadge kind="ok">enabled</StatusBadge>
        <StatusBadge kind="warn" icon>
          degraded
        </StatusBadge>
      </div>
    ));
    const plain = screen.getByText('enabled').closest('span[data-fdt]');
    expect(plain?.querySelectorAll('svg')).toHaveLength(0);
    const iconed = screen.getByText('degraded').closest('span[data-fdt]');
    expect(iconed?.querySelectorAll('svg')).toHaveLength(1);
  });

  it('declares one icon per kind for consumers (nav badges, toasts)', () => {
    for (const kind of STATUS_KINDS) {
      expect(STATUS_ICONS[kind]).toBeTypeOf('function');
    }
  });
});

describe('StatusBadge title', () => {
  it('carries an optional title, none by default', () => {
    render(() => (
      <>
        <StatusBadge kind="warn" title="Excluded by FDT">
          Excluded
        </StatusBadge>
        <StatusBadge kind="info">Delayed</StatusBadge>
      </>
    ));
    expect(screen.getByText('Excluded').getAttribute('title')).toBe('Excluded by FDT');
    expect(screen.getByText('Delayed').hasAttribute('title')).toBe(false);
  });
});
