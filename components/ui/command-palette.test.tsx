/**
 * The command palette's render tests, over its task-real surface: the APG
 * field semantics (combobox role, expanded state, activedescendant), arrow
 * navigation with wrap, Home/End jumps, Enter running the highlighted
 * command, click running, the disabled row rendered-but-skipped, the
 * injected matcher driving the list per keystroke, the no-match empty
 * state, Escape dismissing the dialog, and the mount-time autofocus on the
 * field.
 *
 * Idiom note: static imports (the lucide-heavy tree hangs under
 * `vi.resetModules()`), and assertions on roles/attributes — never on pixel
 * geometry (the resource-less DOM gives none).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import Rocket from 'lucide-solid/icons/rocket';
import Zap from 'lucide-solid/icons/zap';
import { CommandPalette, type PaletteCommand } from './command-palette';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/**
 * The palette's runner vocabulary, as the panel registers it (the ranking
 * behavior is pinned by the matcher's own tests — this file passes curated
 * results through).
 */
const ROWS: readonly PaletteCommand[] = [
  { id: 'page-detections', label: 'Detections', icon: Rocket, hint: 'Overview' },
  { id: 'page-lazyload', label: 'Lazyload', icon: Zap, hint: 'Inspect' },
  { id: 'export', label: 'Export JSON', hint: 'Export' },
  {
    id: 'reserved',
    label: 'Diagnoser',
    hint: 'Returns with the Diagnoser plugin v2',
    disabled: true,
    disabledNote: 'Returns with the Diagnoser plugin v2'
  }
];

/** The identity matcher, wrapped for call recording (every test mounts the same way). */
function identityFilter(
  commands: readonly PaletteCommand[],
  query: string
): readonly PaletteCommand[] {
  if (query === '') return commands;
  return commands.filter((row) => row.label.toLowerCase().includes(query.toLowerCase()));
}

/** What one mounted palette exposes for its assertions. */
interface PaletteHarness {
  /** The combobox field (autofocused by the dialog's own mount step). */
  field: HTMLInputElement;
  /** The dispatch recorder (one call per executed command). */
  onRun: Mock<(command: PaletteCommand) => void>;
  /** The dismissal recorder. */
  onClose: Mock<() => void>;
  /** The recorded matcher facade. */
  filter: Mock<(commands: readonly PaletteCommand[], query: string) => readonly PaletteCommand[]>;
}

/**
 * Mount the palette and wait for its field focus (the dialog's own mount
 * autofocus runs after the flush); the harness hands every seam out.
 */
async function mountPalette(options?: {
  rows?: readonly PaletteCommand[];
}): Promise<PaletteHarness> {
  const onRun = vi.fn();
  const onClose = vi.fn();
  const filter = vi.fn(identityFilter);
  render(() => (
    <CommandPalette
      commands={options?.rows ?? ROWS}
      filter={filter}
      onRun={onRun}
      onClose={onClose}
    />
  ));
  await waitFor(() => {
    expect(document.activeElement?.getAttribute('role')).toBe('combobox');
    // The highlight arm (the guard's settle tick) is part of "ready": Enter
    // must run the top row without any preceding arrow key.
    expect(
      document.querySelector('[data-fdt="palette-input"]')?.getAttribute('aria-activedescendant')
    ).not.toBeNull();
  });
  return {
    field: document.querySelector('[data-fdt="palette-input"]') as HTMLInputElement,
    onRun,
    onClose,
    filter
  };
}

describe('CommandPalette structure', () => {
  it('renders the field over every command row (label + hint slot)', async () => {
    await mountPalette();
    const list = document.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-label')).toBe('Commands');
    expect(document.querySelectorAll('[data-fdt="palette-command"]')).toHaveLength(4);
    expect(screen.getByText('Export JSON')).toBeTruthy();
    expect(screen.getByText('Diagnoser')).toBeTruthy();
  });

  it('carries the APG combobox state on the field (expanded, listbox owned, autocomplete=list)', async () => {
    const { field } = await mountPalette();
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-haspopup')).toBe('listbox');
    expect(field.getAttribute('aria-autocomplete')).toBe('list');
    expect(field.getAttribute('aria-controls')).toBe(
      document.querySelector('[role="listbox"]')?.getAttribute('id')
    );
  });

  it('autofocuses the palette field, inside the dialog', async () => {
    await mountPalette();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('CommandPalette highlight navigation', () => {
  it('starts on the first row and walks with the arrows (aria-activedescendant)', async () => {
    const { field } = await mountPalette();
    const firstId = document.querySelector('[data-fdt="palette-command"]')?.getAttribute('id');
    expect(field.getAttribute('aria-activedescendant')).toBe(firstId);

    const rows = [...document.querySelectorAll('[data-fdt="palette-command"]')] as HTMLElement[];
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-activedescendant')).toBe(rows[1]?.getAttribute('id'));
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(field.getAttribute('aria-activedescendant')).toBe(rows[0]?.getAttribute('id'));
  });

  it('wraps at both ends (the wrap commitment)', async () => {
    const { field } = await mountPalette();
    const enabled = (
      [...document.querySelectorAll('[data-fdt="palette-command"]')] as HTMLElement[]
    ).filter((row) => row.getAttribute('aria-disabled') !== 'true');
    const lastEnabledId = enabled[enabled.length - 1]?.getAttribute('id');
    // One Up from the first enabled row wraps to the last; one Down wraps back.
    // Disabled rows are never rested on (the Aggregates combobox model).
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(field.getAttribute('aria-activedescendant')).toBe(lastEnabledId);
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(field.getAttribute('aria-activedescendant')).toBe(enabled[0]?.getAttribute('id'));
  });

  it('jumps to the first/last row on Home/End (enabled rows only)', async () => {
    const { field } = await mountPalette();
    fireEvent.keyDown(field, { key: 'End' });
    // The last registry row is disabled: End lands on the last ENABLED row.
    const enabled = (
      [...document.querySelectorAll('[data-fdt="palette-command"]')] as HTMLElement[]
    ).filter((row) => row.getAttribute('aria-disabled') !== 'true');
    expect(field.getAttribute('aria-activedescendant')).toBe(
      enabled[enabled.length - 1]?.getAttribute('id')
    );
    fireEvent.keyDown(field, { key: 'Home' });
    expect(field.getAttribute('aria-activedescendant')).toBe(enabled[0]?.getAttribute('id'));
  });
});

describe('CommandPalette running', () => {
  it('runs the highlighted command on Enter', async () => {
    const { field, onRun } = await mountPalette();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]?.[0].id).toBe('page-detections');
  });

  it('runs a row on click', async () => {
    const { onRun } = await mountPalette();
    fireEvent.click(screen.getByRole('option', { name: /Export JSON/ }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]?.[0].id).toBe('export');
  });

  it('runs the re-highlighted top match after a new query (Enter without arrows)', async () => {
    const { field, onRun } = await mountPalette();
    fireEvent.input(field, { target: { value: 'export' } });
    await waitFor(() => {
      expect(field.getAttribute('aria-activedescendant')).toBe(
        screen.getByText('Export JSON').closest('[data-fdt="palette-command"]')?.getAttribute('id')
      );
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRun.mock.calls[0]?.[0].id).toBe('export');
  });
});

describe('CommandPalette filtering', () => {
  it('feeds the matcher the typed query and renders its ranked result', async () => {
    const { filter, field } = await mountPalette();
    fireEvent.input(field, { target: { value: 'lazy' } });
    await waitFor(() => {
      expect(filter).toHaveBeenCalledWith(expect.anything(), 'lazy');
    });
    const rendered = (
      Array.from(
        document.querySelectorAll('[data-fdt="palette-command"]')
      ) as Array<HTMLElement | null>
    ).map((row) => row?.textContent);
    expect(rendered.length).toBe(1);
    expect(rendered[0]).toContain('Lazyload');
  });

  it('renders the empty state when nothing matches (and runs nothing on Enter)', async () => {
    const { field, onRun } = await mountPalette();
    fireEvent.input(field, { target: { value: 'zzz' } });
    await waitFor(() => {
      expect(screen.getByText(/No commands match/)).toBeTruthy();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('CommandPalette disabled rows', () => {
  it('renders disabled rows marked and explained, skipped by the arrows, inert to clicks', async () => {
    const { field, onRun } = await mountPalette();
    const disabled = screen.getByRole('option', { name: /Diagnoser/ });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.textContent).toContain('Returns with the Diagnoser plugin v2');

    // End lands past the disabled row; stepping further never enters it.
    fireEvent.keyDown(field, { key: 'End' });
    const before = field.getAttribute('aria-activedescendant');
    expect(before).not.toBe(disabled.getAttribute('id'));
    fireEvent.keyDown(field, { key: 'ArrowDown' }); // wrap over the disabled row
    expect(field.getAttribute('aria-activedescendant')).not.toBe(disabled.getAttribute('id'));

    fireEvent.click(disabled);
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('CommandPalette dismissal', () => {
  it('closes through Escape once', async () => {
    const { onClose, field } = await mountPalette();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
