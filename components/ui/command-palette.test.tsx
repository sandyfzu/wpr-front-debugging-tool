/**
 * The command palette's render tests, over its task-real surface: the APG
 * field semantics (combobox role, expanded state, activedescendant), arrow
 * navigation with wrap, Home/End jumps, Enter running the highlighted
 * command, click running, the disabled row rendered-but-skipped, the
 * injected matcher driving the list per keystroke, the no-match empty
 * state (its listbox kept, hidden), Escape dismissing the dialog, the
 * mount-time autofocus on the field, and the mounted (shadow-root) mode.
 *
 * Idiom note: static imports (the lucide-heavy tree hangs under
 * `vi.resetModules()`), and assertions on roles/attributes — never on pixel
 * geometry (the resource-less DOM gives none).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { Show, createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import Rocket from 'lucide-solid/icons/rocket';
import Zap from 'lucide-solid/icons/zap';
import { FOCUS_RING } from './classes';
import {
  CommandPalette,
  PALETTE_LOOKS,
  type CommandPaletteVariant,
  type PaletteCommand
} from './command-palette';
import { cn } from '../../utils/cn';

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
    id: 'copy-report',
    label: 'Copy report',
    hint: 'Export',
    disabled: true,
    disabledNote: 'No page data loaded'
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
  variant?: CommandPaletteVariant;
  footer?: JSX.Element;
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
      variant={options?.variant}
      footer={options?.footer}
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
    expect(screen.getByText('Copy report')).toBeTruthy();
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

describe('CommandPalette looks', () => {
  /**
   * The shipped markup's classes, verbatim (copied from the released palette,
   * never derived from the module under test): the on-page palette renders
   * this look (its own stylesheet keys on the hooks), so the default must
   * never move — any added, dropped or reordered class fails here.
   */
  const SHIPPED = {
    plate: 'pt-1.5',
    root: 'flex min-h-0 flex-1 flex-col gap-1',
    fieldFrame: null,
    field:
      'h-8 w-full shrink-0 rounded border border-line-3 bg-surface-2 px-2 text-xs text-fg-primary placeholder:text-fg-muted hover:border-line-2',
    list: 'max-h-72 overflow-y-auto rounded p-1',
    row: 'flex h-7 w-full cursor-pointer select-none items-center gap-2 rounded px-2 text-left text-xs text-fg-secondary no-underline data-highlighted:bg-surface-3 data-highlighted:text-fg-primary data-disabled:cursor-not-allowed data-disabled:text-fg-muted',
    rowIcon: 'shrink-0 text-fg-muted',
    hint: 'shrink-0 text-2xs',
    empty: 'px-2 py-1.5 text-xs text-fg-muted'
  };

  /** The released dialog plate's classes (the palette's plate merges `pt-1.5` onto them). */
  const SHIPPED_DIALOG_PLATE =
    'fixed left-1/2 top-16 z-50 flex max-h-[calc(100dvh-5rem)] w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col rounded-lg border border-line-2 bg-surface-2 shadow-elev-3 pt-1.5';

  it('pins the default look to the shipped classes, part by part', () => {
    expect({ ...PALETTE_LOOKS.default }).toStrictEqual(SHIPPED);
  });

  it('renders the shipped look by default: bare field first, shipped classes everywhere', async () => {
    const { field } = await mountPalette();
    const palette = document.querySelector('[data-fdt="palette"]');
    expect(palette?.className).toBe(SHIPPED.root);
    expect(palette?.firstElementChild).toBe(field);
    expect(field.className).toBe(cn(SHIPPED.field, FOCUS_RING));
    expect(screen.getByRole('dialog').className).toBe(SHIPPED_DIALOG_PLATE);
    expect(document.querySelector('[role="listbox"]')?.className).toBe(
      cn(SHIPPED.list, 'flex-1 min-h-0')
    );
    const row = document.querySelector('[data-fdt="palette-command"]');
    expect(row?.className).toBe(cn(SHIPPED.row, FOCUS_RING));
    // The icon library prefixes its own `lucide*` classes; the rest is the look's, verbatim.
    const iconClasses = (row?.querySelector('svg')?.getAttribute('class') ?? '')
      .split(' ')
      .filter((token) => !token.startsWith('lucide'));
    expect(iconClasses.join(' ')).toBe(SHIPPED.rowIcon);
    expect(row?.querySelector('[data-fdt="palette-command-hint"]')?.className).toBe(SHIPPED.hint);
    // The dialog keeps its shipped look too.
    expect(document.querySelector('[data-fdt="dialog-title"]')?.className).toBe('sr-only');
  });

  it('panel look: the field leads with its search icon above a hairline', async () => {
    const { field } = await mountPalette({ variant: 'panel' });
    const palette = document.querySelector('[data-fdt="palette"]');
    expect(palette?.className).toBe(PALETTE_LOOKS.panel.root);
    const frame = palette?.firstElementChild;
    expect(frame?.className).toBe(PALETTE_LOOKS.panel.fieldFrame);
    expect(frame?.contains(field)).toBe(true);
    expect(frame?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(field.className).toBe(cn(PALETTE_LOOKS.panel.field, FOCUS_RING));
    expect(field.classList).toContain('rounded-control');
    // The field keeps every combobox fact in its frame.
    expect(field.getAttribute('role')).toBe('combobox');
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('dialog').className).not.toContain('pt-1.5');
  });

  it('panel look: rows tint the highlight in the accent, hints stay muted', async () => {
    await mountPalette({ variant: 'panel' });
    const rows = [...document.querySelectorAll<HTMLElement>('[data-fdt="palette-command"]')];
    expect(rows[0]?.className).toBe(cn(PALETTE_LOOKS.panel.row, FOCUS_RING));
    expect(rows[0]?.classList).toContain('data-highlighted:bg-accent-soft');
    expect(rows[0]?.hasAttribute('data-highlighted')).toBe(true);
    expect(rows[0]?.querySelector('svg')?.getAttribute('class')).toContain(
      'group-data-highlighted:text-accent'
    );
    for (const row of rows) {
      expect(row.querySelector('[data-fdt="palette-command-hint"]')?.className).toBe(
        PALETTE_LOOKS.panel.hint
      );
      // The eliding name span keeps its shape in both looks.
      expect(row.querySelector('.truncate')?.className).toBe('min-w-0 flex-1 truncate');
    }
  });

  it('panel look: the no-match line is centered, and the footer renders under the list', async () => {
    const { field } = await mountPalette({
      variant: 'panel',
      footer: <div data-probe-footer>Keys</div>
    });
    fireEvent.input(field, { target: { value: 'zzz' } });
    await waitFor(() => {
      expect(document.querySelector('[data-fdt="palette-empty"]')?.className).toBe(
        PALETTE_LOOKS.panel.empty
      );
    });
    const footer = document.querySelector('[data-probe-footer]');
    expect(footer?.previousElementSibling?.getAttribute('data-fdt')).toBe('palette');
  });

  it('pins both looks to token classes (no literal colors, no transitions)', () => {
    for (const look of Object.values(PALETTE_LOOKS)) {
      expect(Object.values(look).join(' ')).not.toMatch(/#|rgb|transition/);
    }
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

  it('collapses the field over its kept (hidden) listbox in the empty state, and re-expands', async () => {
    const { field } = await mountPalette();
    expect(field.getAttribute('aria-expanded')).toBe('true');
    fireEvent.input(field, { target: { value: 'zzz' } });
    await waitFor(() => {
      expect(screen.getByText(/No commands match/)).toBeTruthy();
    });
    const list = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(list).not.toBeNull();
    expect(list?.hidden).toBe(true);
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(field.getAttribute('aria-controls')).toBe(list?.id);
    // A matching query shows it again.
    fireEvent.input(field, { target: { value: 'lazy' } });
    await waitFor(() => {
      expect(list?.hidden).toBe(false);
    });
    expect(field.getAttribute('aria-expanded')).toBe('true');
  });

  it('announces the no-match line through a polite status kept mounted', async () => {
    const { field } = await mountPalette();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    expect(status.classList.contains('sr-only')).toBe(true);
    fireEvent.input(field, { target: { value: 'zzz' } });
    await waitFor(() => {
      expect(status.textContent).toBe('No commands match “zzz”');
    });
    expect(status.classList.contains('sr-only')).toBe(false);
    // The same node all along: assistive tech hears the change.
    expect(screen.getByRole('status')).toBe(status);
    // Rows again: the same region speaks the count, visually hidden.
    fireEvent.input(field, { target: { value: 'lazy' } });
    await waitFor(() => {
      expect(status.textContent).toBe('1 command available');
    });
    expect(status.classList.contains('sr-only')).toBe(true);
  });

  it('keeps the visible no-match line on the current query, and clears it when rows return', async () => {
    const { field } = await mountPalette();
    const status = screen.getByRole('status');
    fireEvent.input(field, { target: { value: 'zz' } });
    await waitFor(() => {
      expect(status.textContent).toBe('No commands match “zz”');
    });
    fireEvent.input(field, { target: { value: 'zzq' } });
    await waitFor(() => {
      expect(status.textContent).toBe('No commands match “zzq”');
    });
    // Cleared: every row is back, the line is hidden again.
    fireEvent.input(field, { target: { value: '' } });
    await waitFor(() => {
      expect(document.querySelector<HTMLElement>('[role="listbox"]')?.hidden).toBe(false);
    });
    expect(status.classList.contains('sr-only')).toBe(true);
    expect(status.textContent).not.toMatch(/No commands match/);
  });

  it('shows the no-match line when the rows go away without a query change (never stale)', async () => {
    const [rows, setRows] = createSignal<readonly PaletteCommand[]>(ROWS);
    render(() => (
      <CommandPalette commands={rows()} filter={identityFilter} onRun={vi.fn()} onClose={vi.fn()} />
    ));
    const field = await screen.findByRole('combobox');
    fireEvent.input(field, { target: { value: 'lazy' } });
    const status = screen.getByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe('1 command available');
    });
    setRows([]);
    await waitFor(() => {
      expect(status.textContent).toBe('No commands match “lazy”');
    });
    expect(status.classList.contains('sr-only')).toBe(false);
  });

  it('names an empty command set with nothing typed (never a quoted blank query)', async () => {
    render(() => (
      <CommandPalette commands={[]} filter={identityFilter} onRun={vi.fn()} onClose={vi.fn()} />
    ));
    await screen.findByRole('combobox');
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('No commands available');
    expect(status.classList.contains('sr-only')).toBe(false);
  });

  it('speaks the result count per query, and stays silent at open and on arrow moves', async () => {
    const { field } = await mountPalette();
    const status = screen.getByRole('status');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(status.textContent).toBe('');
    fireEvent.input(field, { target: { value: 'o' } });
    await waitFor(() => {
      // "Detections", "Lazyload", "Export JSON", "Copy report" all contain an "o".
      expect(status.textContent).toBe('4 commands available');
    });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(status.textContent).toBe('4 commands available');
  });
});

describe('CommandPalette mounted mode (an injected shadow root)', () => {
  it('renders into the given node with the caller’s description, and dismisses on Escape', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const container = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(container);
    const onClose = vi.fn();
    render(() => (
      <CommandPalette
        commands={ROWS}
        filter={identityFilter}
        onRun={vi.fn()}
        onClose={onClose}
        mount={container}
        description="Filter the on-page actions, run the highlighted one"
      />
    ));
    await waitFor(() => {
      expect(container.querySelector('[data-fdt="palette-input"]')).not.toBeNull();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-fdt="dialog-description"]')?.textContent).toBe(
      'Filter the on-page actions, run the highlighted one'
    );
    const field = container.querySelector('[data-fdt="palette-input"]') as HTMLInputElement;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CommandPalette mount-time focus', () => {
  it('focuses the field in the same task it is inserted (no gap another UI could take focus in)', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    const [open, setOpen] = createSignal(false);
    render(() => (
      <Show when={open()}>
        <CommandPalette
          commands={ROWS}
          filter={identityFilter}
          onRun={vi.fn()}
          onClose={vi.fn()}
          mount={container}
        />
      </Show>
    ));
    setOpen(true);
    // A microtask checkpoint, no task boundary: no frame or timer ran yet.
    await Promise.resolve();
    expect(document.activeElement).toBe(host);
    expect(shadow.activeElement?.getAttribute('data-fdt')).toBe('palette-input');
  });
});

describe('CommandPalette disabled rows', () => {
  it('renders disabled rows marked and explained, skipped by the arrows, inert to clicks', async () => {
    const { field, onRun } = await mountPalette();
    const disabled = screen.getByRole('option', { name: /Copy report/ });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(disabled.textContent).toContain('No page data loaded');

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

describe('CommandPalette on Apple platforms (VoiceOver)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('also speaks the highlighted row: with the count per query, alone per arrow move', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { field } = await mountPalette();
    const status = screen.getByRole('status');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(status.textContent).toBe('Lazyload');
    fireEvent.input(field, { target: { value: 'export' } });
    await waitFor(() => {
      expect(status.textContent).toBe('1 command available, Export JSON');
    });
  });
});

describe('CommandPalette pointer', () => {
  it('moves the highlight onto a hovered enabled row, never onto a disabled one', async () => {
    const { field } = await mountPalette();
    const exportRow = screen.getByRole('option', { name: /Export JSON/ });
    fireEvent.pointerMove(exportRow, { pointerType: 'mouse' });
    expect(field.getAttribute('aria-activedescendant')).toBe(exportRow.id);
    expect(exportRow.getAttribute('aria-selected')).toBe('true');
    expect(exportRow.hasAttribute('data-highlighted')).toBe(true);
    fireEvent.pointerMove(screen.getByRole('option', { name: /Copy report/ }), {
      pointerType: 'mouse'
    });
    expect(field.getAttribute('aria-activedescendant')).toBe(exportRow.id);
  });

  it('ignores touch/pen moves (no hover highlight without a mouse)', async () => {
    const { field } = await mountPalette();
    const before = field.getAttribute('aria-activedescendant');
    fireEvent.pointerMove(screen.getByRole('option', { name: /Export JSON/ }), {
      pointerType: 'touch'
    });
    expect(field.getAttribute('aria-activedescendant')).toBe(before);
  });

  it('keeps focus in the field when a row is pressed (mousedown default prevented)', async () => {
    await mountPalette();
    const pressed = fireEvent.mouseDown(screen.getByRole('option', { name: /Export JSON/ }));
    expect(pressed).toBe(false);
  });
});

describe('CommandPalette keys', () => {
  it('leaves keys to an active IME composition (Enter commits it, runs nothing)', async () => {
    const { field, onRun } = await mountPalette();
    const before = field.getAttribute('aria-activedescendant');
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(field, { key: 'ArrowDown', isComposing: true });
    expect(onRun).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-activedescendant')).toBe(before);
  });

  it('leaves Shift/Alt/Meta + Arrow/Home/End to the field (text selection), moving nothing', async () => {
    const { field } = await mountPalette();
    const before = field.getAttribute('aria-activedescendant');
    for (const modifier of ['shiftKey', 'altKey', 'metaKey'] as const) {
      for (const key of ['ArrowDown', 'End']) {
        const notCancelled = fireEvent.keyDown(field, { key, [modifier]: true });
        expect(notCancelled).toBe(true);
      }
    }
    expect(field.getAttribute('aria-activedescendant')).toBe(before);
    // Bare, the same key still moves the highlight.
    expect(fireEvent.keyDown(field, { key: 'ArrowDown' })).toBe(false);
    expect(field.getAttribute('aria-activedescendant')).not.toBe(before);
  });

  it('dismisses on Tab instead of cycling focus back into the field', async () => {
    const { field, onClose } = await mountPalette();
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrolls the list (never the document) to keep the highlighted row in view', async () => {
    const { field } = await mountPalette();
    const list = document.querySelector<HTMLElement>('[role="listbox"]');
    if (list === null) throw new Error('listbox missing');
    const rows = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    // A 64 px list window; each row 32 px tall, stacked from the list's top.
    list.getBoundingClientRect = () => new DOMRect(0, 0, 100, 64);
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(0, index * 32 - list.scrollTop, 100, 32);
    });
    fireEvent.keyDown(field, { key: 'ArrowDown' }); // row 1: 32–64, in view
    expect(list.scrollTop).toBe(0);
    fireEvent.keyDown(field, { key: 'ArrowDown' }); // row 2: 64–96 → 32 down
    expect(list.scrollTop).toBe(32);
  });
});

describe('CommandPalette host-document isolation (mounted mode)', () => {
  it('never writes into document.body across open, typing, moves, run-less close and dispose', async () => {
    const host = document.createElement('div');
    document.documentElement.append(host);
    const container = document.createElement('div');
    host.attachShadow({ mode: 'open' }).append(container);
    const bodyBefore = [...document.body.childNodes];
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => writes.push(...records));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    const onClose = vi.fn();
    const { unmount } = render(
      () => (
        <CommandPalette
          commands={ROWS}
          filter={identityFilter}
          onRun={vi.fn()}
          onClose={onClose}
          mount={container}
        />
      ),
      { container: document.createElement('div') }
    );
    const field = await waitFor(() => {
      const found = container.querySelector<HTMLInputElement>('[data-fdt="palette-input"]');
      expect(found?.getAttribute('aria-activedescendant')).not.toBeNull();
      return found as HTMLInputElement;
    });
    fireEvent.input(field, { target: { value: 'lazy' } });
    fireEvent.input(field, { target: { value: 'zzz' } });
    fireEvent.input(field, { target: { value: '' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'End' });
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    await Promise.resolve();
    observer.disconnect();
    expect(writes).toEqual([]);
    expect([...document.body.childNodes]).toEqual(bodyBefore);
    expect(document.querySelector('[data-live-announcer]')).toBeNull();
    host.remove();
  });
});
