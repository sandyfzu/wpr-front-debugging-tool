/**
 * The modal dialog's render tests: the accessible naming (title → labelled,
 * description → described), the mount-driven open (fresh per mount, gone on
 * close), every dismissal seam (Escape, the explicit close control, an
 * outside pointerdown), and the mount-time autofocus on the first focusable —
 * asserted on roles/attributes, never on pixel geometry (the resource-less
 * DOM gives no layout).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Show, createSignal } from 'solid-js';
import { ModalDialog } from './dialog';
import { Button } from './button';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** Mount-driven rendering like the shells do: a Show per open state. */
function renderDialog(options?: {
  description?: string;
  closeButton?: boolean;
  original?: string;
}) {
  const [open, setOpen] = createSignal(true);
  const onClose = vi.fn();
  render(() => (
    <Show when={open()}>
      <ModalDialog
        title="Settings"
        description={options?.description}
        closeButton={options?.closeButton}
        onClose={onClose}
      >
        {options?.original ? <p>{options.original}</p> : <Button>First control</Button>}
      </ModalDialog>
    </Show>
  ));
  return { onClose, close: () => setOpen(false) };
}

describe('ModalDialog structure', () => {
  it('names the dialog from its title and describes from its description', async () => {
    renderDialog({ description: 'The stored appearance' });
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByText('Settings').id);
    expect(dialog.getAttribute('aria-describedby')).toBe(
      screen.getByText('The stored appearance').id
    );
    // Overlay naming is presentational only — the dialog carries the name.
    expect(screen.getByRole('dialog').getAttribute('role')).toBe('dialog');
  });

  it('keeps the close control out by default; only callers who need it render it', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Close dialog' })).toBeNull();
    cleanup();
    renderDialog({ closeButton: true });
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy();
  });

  it('clamps the plate inside the viewport height (a short docked panel cannot clip it)', () => {
    // The plate is a height-clamped flex column: the shell's scroll-owning
    // content shrinks under the clamp, so the plate's bottom rows stay in
    // the viewport at every docking geometry (the scroll lives inside).
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[calc(100dvh-5rem)]');
    expect(dialog.className).toContain('flex-col');
  });
});

describe('ModalDialog dismissals', () => {
  it('closes on Escape, exactly once', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside pointerdown (the scrim, not the content)', async () => {
    const { onClose } = renderDialog();
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    // The dismissable-layer arms its document listener a tick after mount.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const content = screen.getByRole('dialog');
    const scrim = document.querySelector('[data-fdt="dialog-overlay"]');
    expect(scrim).not.toBeNull();
    expect(content.contains(scrim as HTMLElement)).toBe(false);
    (scrim as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes through the explicit close control when the caller renders one', async () => {
    const { onClose } = renderDialog({ closeButton: true });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close dialog' })).toBeTruthy();
    });
    screen.getByRole('button', { name: 'Close dialog' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ModalDialog focus management', () => {
  it('autofocuses the first focusable element inside the content on mount', async () => {
    renderDialog();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'First control' })).toBe(document.activeElement);
    });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});
