/**
 * The palette view over its real primitive: nothing renders while closed;
 * an open lists the module's rows (icons, the disabled row explained) with
 * focus in the field; Enter runs the highlighted row; Escape dismisses; the
 * master gate's row swaps to the inline confirm (visible title and
 * consequence, Cancel focused first), whose Cancel dismisses and whose
 * action runs the row; a re-open starts again from the command list; the
 * opening chord's hint renders per open (none while unresolved).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { PaletteCommandId } from '../../lib/page-commands/commands';
import { paletteRowViews } from '../../lib/page-commands/palette-rows';
import { PaletteApp, toPaletteCommand } from './app';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** A silent logger. */
const LOG: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Mount the view (closed) and hand out its seams. */
function mountView(options: { analysisHost?: boolean; chordHint?: () => string | null } = {}) {
  const [open, setOpen] = createSignal(false);
  const onRun = vi.fn<(id: PaletteCommandId) => void>(() => {
    setOpen(false);
  });
  const onDismiss = vi.fn(() => {
    setOpen(false);
  });
  render(() => (
    <PaletteApp
      open={open}
      rows={() => paletteRowViews({ analysisHost: options.analysisHost ?? false })}
      chordHint={options.chordHint ?? (() => '⌥K')}
      onRun={onRun}
      onDismiss={onDismiss}
      log={LOG}
    />
  ));
  return { setOpen, onRun, onDismiss };
}

/** The field once the palette is up with its highlight armed. */
async function readyField(): Promise<HTMLInputElement> {
  await waitFor(() => {
    const field = document.querySelector<HTMLInputElement>('[data-fdt="palette-input"]');
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    expect(field?.getAttribute('aria-activedescendant')).not.toBeNull();
  });
  return document.querySelector('[data-fdt="palette-input"]') as HTMLInputElement;
}

describe('toPaletteCommand', () => {
  it('carries label, keywords, an icon and the disabled note', () => {
    const [sbs, psi] = paletteRowViews({ analysisHost: true });
    if (sbs === undefined || psi === undefined) throw new Error('rows missing');
    const runnable = toPaletteCommand(sbs);
    expect(runnable).toMatchObject({ id: 'side-by-side', label: 'Open Side By Side' });
    expect(runnable.icon).toBeDefined();
    expect(runnable.disabled).toBeUndefined();
    expect(toPaletteCommand(psi)).toMatchObject({
      disabled: true,
      disabledNote: 'Starts from a site, not from PageSpeed Insights'
    });
  });
});

describe('PaletteApp', () => {
  it('renders nothing while closed', () => {
    mountView();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('lists every palette row with its icon, focus in the field', async () => {
    const view = mountView();
    view.setOpen(true);
    await readyField();
    const rows = [...document.querySelectorAll('[data-fdt="palette-command"]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'Open Side By Side',
      'Open Side By Side Performance',
      'Toggle the detection widget on this site',
      'Exclusion Builder',
      'Turn off all on-page UI'
    ]);
    expect(rows.every((row) => row.querySelector('svg') !== null)).toBe(true);
    expect(screen.getByRole('dialog').getAttribute('aria-describedby')).not.toBeNull();
  });

  it('explains the disabled row on the analysis host', async () => {
    const view = mountView({ analysisHost: true });
    view.setOpen(true);
    await readyField();
    const psi = screen.getByRole('option', { name: /Open Side By Side Performance/ });
    expect(psi.getAttribute('aria-disabled')).toBe('true');
    expect(psi.textContent).toContain('Starts from a site, not from PageSpeed Insights');
  });

  it('runs the highlighted row on Enter', async () => {
    const view = mountView();
    view.setOpen(true);
    const field = await readyField();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(view.onRun).toHaveBeenCalledWith('side-by-side');
  });

  it('dismisses on Escape', async () => {
    const view = mountView();
    view.setOpen(true);
    const field = await readyField();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
    expect(view.onRun).not.toHaveBeenCalled();
  });

  it('confirms the master gate inline before running it', async () => {
    const view = mountView();
    view.setOpen(true);
    const field = await readyField();
    fireEvent.input(field, { target: { value: 'turn off' } });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-fdt="palette-command"]')).toHaveLength(1);
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBe(document.activeElement);
    });
    expect(view.onRun).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Turn off all on-page UI?');
    expect(dialog.textContent).toContain(
      'This also turns off this command palette. Turn it back on from the page’s right-click menu (“Turn on all on-page UI”) or the extension’s options (“Show on-page UI”).'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(view.onRun).toHaveBeenCalledWith('page-ui-gate');
  });

  it('focuses the confirm’s Cancel in the task the confirm replaces the list', async () => {
    const view = mountView();
    view.setOpen(true);
    const field = await readyField();
    fireEvent.input(field, { target: { value: 'turn off' } });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-fdt="palette-command"]')).toHaveLength(1);
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    // A microtask checkpoint, no task boundary: no frame or timer ran yet.
    await Promise.resolve();
    expect(document.activeElement?.getAttribute('data-fdt')).toBe('palette-confirm-cancel');
    expect(view.onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses from the confirm’s Cancel and re-opens on the command list', async () => {
    const view = mountView();
    view.setOpen(true);
    const field = await readyField();
    fireEvent.input(field, { target: { value: 'turn off' } });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-fdt="palette-command"]')).toHaveLength(1);
      expect(field.getAttribute('aria-activedescendant')).not.toBeNull();
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(view.onDismiss).toHaveBeenCalledTimes(1);
    view.setOpen(true);
    await readyField();
    expect(document.querySelector('[data-fdt="palette-confirm"]')).toBeNull();
  });

  it('shows the opening chord under the list, read again on every open', async () => {
    let hint: string | null = '⌥K';
    const view = mountView({ chordHint: () => hint });
    view.setOpen(true);
    await readyField();
    const shown = (): string | null =>
      document.querySelector('[data-fdt="palette-hint"]')?.textContent ?? null;
    expect(shown()).toBe('Open with ⌥K');
    // A rebinding while open shows on the next open, never mid-surface.
    hint = '⌥⇧⌘P';
    expect(shown()).toBe('Open with ⌥K');
    view.setOpen(false);
    view.setOpen(true);
    await readyField();
    expect(shown()).toBe('Open with ⌥⇧⌘P');
  });

  it('renders no hint while the chord is unresolved', async () => {
    const view = mountView({ chordHint: () => null });
    view.setOpen(true);
    await readyField();
    expect(document.querySelector('[data-fdt="palette-hint"]')).toBeNull();
  });
});
