/**
 * The modal dialog's render tests: the accessible naming (title → labelled,
 * description → described), the mount-driven open (fresh per mount, gone on
 * close), every dismissal seam (Escape, the explicit close control, an
 * outside pointerdown), the mount-time autofocus on the first focusable, and
 * the mounted mode (shadow-root render node, nothing written into the host
 * document, Escape on the panel, outside pointer dismissal) —
 * asserted on roles/attributes, never on pixel geometry (the resource-less
 * DOM gives no layout).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Show, createSignal } from 'solid-js';
import { ModalDialog } from './dialog';
import { Button } from './button';
import { isolateUiEvents } from '../injected-ui/event-isolation';

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

describe('ModalDialog initial focus (synchronous, in the mount task)', () => {
  /** A shadow-root dialog opened later, its initial focus target chosen by the test. */
  function renderLaterOpen(
    initialFocus: (field: HTMLInputElement | undefined) => HTMLElement | undefined
  ) {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    const [open, setOpen] = createSignal(false);
    const onClose = vi.fn();
    let field: HTMLInputElement | undefined;
    render(() => (
      <Show when={open()}>
        <ModalDialog
          title="Command palette"
          mount={container}
          onClose={onClose}
          initialFocus={() => initialFocus(field)}
        >
          <Button>First control</Button>
          <input
            aria-label="Field"
            ref={(element) => {
              field = element;
            }}
          />
        </ModalDialog>
      </Show>
    ));
    return { shadow, host, onClose, open: () => setOpen(true) };
  }

  it('focuses the caller’s element in the same task the dialog is inserted', async () => {
    const { shadow, host, onClose, open } = renderLaterOpen((field) => field);
    open();
    // No task boundary yet: a frame or timer callback could not have run.
    expect(document.activeElement).toBe(host);
    expect(shadow.activeElement?.getAttribute('aria-label')).toBe('Field');
    // The library's deferred autofocus does not move it afterwards.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadow.activeElement?.getAttribute('aria-label')).toBe('Field');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to the deferred autofocus on the first focusable when the target is missing', async () => {
    const { shadow, open } = renderLaterOpen(() => undefined);
    open();
    await waitFor(() => {
      expect(shadow.activeElement?.textContent).toBe('First control');
    });
  });
});

describe('ModalDialog mounted mode (an injected shadow root)', () => {
  /** A shadow-root container like the injected UIs mount into, events isolated. */
  function renderMounted() {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    isolateUiEvents(shadow);
    const onClose = vi.fn();
    render(() => (
      <ModalDialog title="Command palette" mount={container} onClose={onClose}>
        <Button>First control</Button>
      </ModalDialog>
    ));
    return { shadow, container, onClose };
  }

  it('renders into the given node, never into the document body', async () => {
    const { shadow } = renderMounted();
    await waitFor(() => {
      expect(shadow.querySelector('[role="dialog"]')).not.toBeNull();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('writes nothing into the host document (no aria-hiding, scroll lock or pointer block)', async () => {
    const sibling = document.createElement('main');
    document.body.prepend(sibling);
    const { shadow } = renderMounted();
    await waitFor(() => {
      expect(shadow.querySelector('[role="dialog"]')).not.toBeNull();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sibling.hasAttribute('aria-hidden')).toBe(false);
    expect(document.body.getAttribute('style') ?? '').toBe('');
    expect(document.documentElement.getAttribute('style') ?? '').toBe('');
  });

  it('closes on Escape inside the panel although the root keeps keys from the document', async () => {
    const { shadow, onClose } = renderMounted();
    await waitFor(() => {
      expect(shadow.querySelector('button')).not.toBeNull();
    });
    const button = shadow.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Other keys pass through untouched.
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a pointerdown on the host page outside the panel', async () => {
    const { shadow, onClose } = renderMounted();
    await waitFor(() => {
      expect(shadow.querySelector('[role="dialog"]')).not.toBeNull();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const outside = document.createElement('p');
    document.body.append(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
