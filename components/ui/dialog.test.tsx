/**
 * The modal dialog's render tests: the accessible naming (title → labelled,
 * description → described), the mount-driven open (fresh per mount, gone on
 * close), every dismissal seam (Escape, the explicit close control, an
 * outside pointerdown; a context-menu press ignored on a modal scrim), the
 * mount-time autofocus on the first focusable, and the mounted mode
 * (shadow-root render node, nothing written into the host document, Escape
 * on the panel, outside pointer dismissal, context-menu presses included) —
 * asserted on roles/attributes, never on pixel geometry (the resource-less
 * DOM gives no layout).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Show, createSignal } from 'solid-js';
import { DIALOG_LOOKS, isContextMenuPress, ModalDialog } from './dialog';
import { FOCUS_RING } from './classes';
import { cn } from '../../utils/cn';
import { Button } from './button';
import { isolateUiEvents } from '../injected-ui/event-isolation';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** Report `platform` as the navigator's platform (the library reads the same value). */
function stubPlatform(platform: string): void {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
}

/** The modal dialog's scrim (the document body's overlay). */
function modalScrim(): HTMLElement {
  return document.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
}

/** Press the scrim: a `pointerdown` with these facts, then (unless a right press) its `click`. */
function pressScrim(scrim: HTMLElement, init: PointerEventInit): void {
  scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, ...init }));
  if (init.button !== 2) {
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ...init }));
  }
}

/** Let the library arm its deferred outside-pointer listener. */
async function armLibrary(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('isContextMenuPress', () => {
  const press = (button: number, ctrlKey = false, metaKey = false) => ({
    button,
    ctrlKey,
    metaKey
  });

  it('is the secondary button, whatever the modifiers and platform', () => {
    expect(isContextMenuPress(press(2), false)).toBe(true);
    expect(isContextMenuPress(press(2), true)).toBe(true);
    expect(isContextMenuPress(press(2, true, true), false)).toBe(true);
  });

  it('is a primary press with Ctrl alone off macOS, Cmd alone on macOS', () => {
    expect(isContextMenuPress(press(0, true), false)).toBe(true);
    expect(isContextMenuPress(press(0, false, true), false)).toBe(false);
    expect(isContextMenuPress(press(0, true, true), false)).toBe(false);
    expect(isContextMenuPress(press(0, false, true), true)).toBe(true);
    expect(isContextMenuPress(press(0, true), true)).toBe(false);
    expect(isContextMenuPress(press(0, true, true), true)).toBe(false);
  });

  it('is never a plain primary or a middle press', () => {
    expect(isContextMenuPress(press(0), false)).toBe(false);
    expect(isContextMenuPress(press(0), true)).toBe(false);
    expect(isContextMenuPress(press(1, true), false)).toBe(false);
    expect(isContextMenuPress(press(1, false, true), true)).toBe(false);
  });
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

describe('ModalDialog looks', () => {
  /**
   * Each look's classes, verbatim (literals, never read from the module under
   * test): `default.close` is the released close control (injected UIs render
   * it), so any added, dropped or reordered class fails here.
   */
  const LOOKS = {
    default: {
      close:
        'absolute end-1.5 top-1.5 inline-grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary',
      title: 'text-sm font-semibold text-fg-primary'
    },
    panel: {
      close:
        'absolute end-2.5 top-2.5 inline-grid size-7 place-items-center rounded-control text-fg-muted hover:bg-surface-3 hover:text-fg-primary',
      title: 'pe-8 text-sm font-semibold text-fg-primary'
    }
  };

  /** The released dialog plate's classes (the default look never touches them). */
  const SHIPPED_PLATE =
    'fixed left-1/2 top-16 z-50 flex max-h-[calc(100dvh-5rem)] w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col rounded-lg border border-line-2 bg-surface-2 shadow-elev-3';

  it('pins every look to its literal classes', () => {
    expect({
      default: { ...DIALOG_LOOKS.default },
      panel: { ...DIALOG_LOOKS.panel }
    }).toStrictEqual(LOOKS);
  });

  it('keeps the shipped look by default: hidden title, the 24 px close square', () => {
    renderDialog({ closeButton: true });
    expect(screen.getByText('Settings').className).toBe('sr-only');
    const close = screen.getByRole('button', { name: 'Close dialog' });
    expect(close.className).toBe(cn(LOOKS.default.close, FOCUS_RING));
    expect(screen.getByRole('dialog').className).toBe(SHIPPED_PLATE);
  });

  it('panel look: the close control on the control corner, a step larger', () => {
    render(() => (
      <ModalDialog title="Shortcuts" variant="panel" closeButton onClose={vi.fn()}>
        <p>Body</p>
      </ModalDialog>
    ));
    const close = screen.getByRole('button', { name: 'Close dialog' });
    expect(close.className).toBe(cn(LOOKS.panel.close, FOCUS_RING));
    expect(close.classList).toContain('rounded-control');
    expect(close.classList).toContain('size-7');
    // The title stays hidden unless asked for.
    expect(screen.getByText('Shortcuts').className).toBe('sr-only');
  });

  it('shows the title as the plate heading on request, in the look’s heading type', () => {
    for (const variant of ['default', 'panel'] as const) {
      render(() => (
        <ModalDialog title="Shortcuts" variant={variant} showTitle onClose={vi.fn()}>
          <p>Body</p>
        </ModalDialog>
      ));
      const title = screen.getByText('Shortcuts');
      expect(title.tagName).toBe('H2');
      expect(title.className).toBe(LOOKS[variant].title);
      expect(title.classList).not.toContain('sr-only');
      // Still the dialog's name.
      expect(screen.getByRole('dialog').getAttribute('aria-labelledby')).toBe(title.id);
      cleanup();
    }
  });

  it('pins every look to token classes (no literal colors, no transitions)', () => {
    for (const look of Object.values(DIALOG_LOOKS)) {
      expect(`${look.close} ${look.title}`).not.toMatch(/#|rgb|transition/);
    }
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

  it('closes on a scrim press right after mount, before the library arms its outside listener', () => {
    // The browser runs input ahead of timers: a press can land before the
    // library's deferred document listener exists.
    const { onClose } = renderDialog();
    const scrim = document.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes exactly once when the scrim and the armed library both see the press', async () => {
    const { onClose } = renderDialog();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const scrim = document.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a touch press on the scrim on its click, not its pointerdown', () => {
    // A touch dismissal on pointerdown would let the tap's click land on the page below.
    const { onClose } = renderDialog();
    const scrim = document.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    expect(onClose).not.toHaveBeenCalled();
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a right press on the scrim, before and after the library arms', async () => {
    const { onClose } = renderDialog();
    pressScrim(modalScrim(), { button: 2, pointerType: 'mouse' });
    await armLibrary();
    pressScrim(modalScrim(), { button: 2, pointerType: 'mouse' });
    expect(onClose).not.toHaveBeenCalled();
    // Not stuck: the next plain press still closes.
    pressScrim(modalScrim(), { button: 0, pointerType: 'mouse' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a Ctrl-press (primary) on the scrim off macOS, before and after arming', async () => {
    stubPlatform('Win32');
    const { onClose } = renderDialog();
    pressScrim(modalScrim(), { button: 0, ctrlKey: true, pointerType: 'mouse' });
    await armLibrary();
    pressScrim(modalScrim(), { button: 0, ctrlKey: true, pointerType: 'mouse' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a Cmd-press (primary) and its click on the scrim on macOS, before and after arming', async () => {
    stubPlatform('MacIntel');
    const { onClose } = renderDialog();
    pressScrim(modalScrim(), { button: 0, metaKey: true, pointerType: 'mouse' });
    await armLibrary();
    pressScrim(modalScrim(), { button: 0, metaKey: true, pointerType: 'mouse' });
    expect(onClose).not.toHaveBeenCalled();
    // Ctrl is no context-menu modifier there: a Ctrl-press closes.
    pressScrim(modalScrim(), { button: 0, ctrlKey: true, pointerType: 'mouse' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a Ctrl + touch tap on the scrim off macOS (its click too), before and after arming', async () => {
    // A touchscreen with a keyboard: the tap is a context-menu press the library ignores.
    stubPlatform('Win32');
    const { onClose } = renderDialog();
    pressScrim(modalScrim(), { button: 0, ctrlKey: true, pointerType: 'touch' });
    await armLibrary();
    pressScrim(modalScrim(), { button: 0, ctrlKey: true, pointerType: 'touch' });
    expect(onClose).not.toHaveBeenCalled();
    // Not stuck: a plain tap still closes on its click.
    pressScrim(modalScrim(), { button: 0, pointerType: 'touch' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a pen press on the scrim at its pointerdown', () => {
    const { onClose } = renderDialog();
    modalScrim().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'pen' })
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

describe('ModalDialog initial focus (in the mount task)', () => {
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
    // A microtask checkpoint, no task boundary: a frame or timer callback
    // could not have run yet.
    await Promise.resolve();
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

  it('falls back to the deferred autofocus when the target is detached', async () => {
    const { shadow, open } = renderLaterOpen(() => document.createElement('input'));
    open();
    await waitFor(() => {
      expect(shadow.activeElement?.textContent).toBe('First control');
    });
  });

  it('focuses the dialog panel, in the same task, when the target refuses focus', async () => {
    const { shadow, host, onClose, open } = renderLaterOpen((field) => {
      if (field !== undefined) field.disabled = true;
      return field;
    });
    open();
    await Promise.resolve();
    expect(document.activeElement).toBe(host);
    expect(shadow.activeElement?.getAttribute('role')).toBe('dialog');
    // The prevented library autofocus never moves it afterwards.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadow.activeElement?.getAttribute('role')).toBe('dialog');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('arms the modal focus trap with the target: an outside focus move is pulled back', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    document.body.append(outside);
    const [open, setOpen] = createSignal(false);
    let field: HTMLInputElement | undefined;
    render(() => (
      <Show when={open()}>
        <ModalDialog title="Palette" onClose={vi.fn()} initialFocus={() => field}>
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
    setOpen(true);
    await Promise.resolve();
    expect(document.activeElement).toBe(field);
    // Past the library's deferred work, no in-dialog focus move since open.
    await new Promise((resolve) => setTimeout(resolve, 20));
    outside.focus();
    expect(document.activeElement).toBe(field);
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

  it('closes on a scrim press right after mount, the root keeping events from the page', () => {
    const { shadow, onClose } = renderMounted();
    const scrim = shadow.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    scrim.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerType: 'mouse' })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a right press on the scrim, as the library does outside a non-modal dialog', async () => {
    const first = renderMounted();
    const scrim = (): HTMLElement =>
      first.shadow.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    pressScrim(scrim(), { button: 2, pointerType: 'mouse' });
    expect(first.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = renderMounted();
    await armLibrary();
    pressScrim(second.shadow.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement, {
      button: 2,
      pointerType: 'mouse'
    });
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes a touch tap on the scrim on its click, the root keeping the click from the page', () => {
    const { shadow, onClose } = renderMounted();
    const scrim = shadow.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    scrim.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerType: 'touch' })
    );
    expect(onClose).not.toHaveBeenCalled();
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a pen press on the scrim at its pointerdown', () => {
    const { shadow, onClose } = renderMounted();
    const scrim = shadow.querySelector('[data-fdt="dialog-overlay"]') as HTMLElement;
    scrim.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, composed: true, pointerType: 'pen' })
    );
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

describe('ModalDialog scrim classes', () => {
  it('keeps the default scrim as is and merges a caller’s scrim classes last', () => {
    renderDialog();
    expect(modalScrim().className).toBe('fixed inset-0 z-40 bg-[var(--scrim)]');
    cleanup();
    render(() => (
      <ModalDialog title="Sheet" onClose={() => undefined} overlayClass="opacity-0">
        <Button>Only control</Button>
      </ModalDialog>
    ));
    expect(modalScrim().className).toBe('fixed inset-0 z-40 bg-[var(--scrim)] opacity-0');
  });
});

describe('ModalDialog controlled mode (`open`)', () => {
  /**
   * Report `animationName: none` for every element, as a real browser does
   * here (no keyframes): the library's presence then unmounts at once on its
   * own close. The resource-less DOM reports `''`, which reads as animating.
   */
  function stubNoAnimation(): void {
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      return new Proxy(style, {
        get(target, key) {
          if (key === 'animationName') return 'none';
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
        }
      });
    });
  }

  /** A dialog the caller never unmounts, so only the library could remove it. */
  function renderKept(open: boolean | undefined) {
    const onClose = vi.fn();
    render(() => (
      <ModalDialog title="Kept" open={open} onClose={onClose}>
        <Button>Only control</Button>
      </ModalDialog>
    ));
    return { onClose };
  }

  it('without `open`, the library still closes itself on a dismissal (every existing surface)', () => {
    stubNoAnimation();
    const { onClose } = renderKept(undefined);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(modalScrim()).toBeNull();
  });

  it('without `open`, never re-arms: a later press on a still-mounted scrim reports nothing', async () => {
    // Unstubbed style reads as animating, so the closed library keeps the scrim up.
    const { onClose } = renderKept(undefined);
    fireEvent.keyDown(document, { key: 'Escape' });
    await armLibrary();
    expect(modalScrim()).toBeTruthy();
    pressScrim(modalScrim(), { pointerType: 'mouse', button: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with `open`, a dismissal is only a request: the panel and scrim stay mounted', () => {
    stubNoAnimation();
    const { onClose } = renderKept(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
    modalScrim().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('with `open`, reports each later gesture once (re-armed a task after the last one)', async () => {
    const { onClose } = renderKept(true);
    await armLibrary();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await armLibrary();
    // One press both the scrim and the armed library see: still one request.
    pressScrim(modalScrim(), { pointerType: 'mouse', button: 0 });
    expect(onClose).toHaveBeenCalledTimes(2);
    await armLibrary();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('ModalDialog mounted mode leaves the host body’s inline style as found', () => {
  afterEach(() => {
    // The test DOM keeps a removed attribute's declarations readable through
    // `style`; clearing the text first resets both, as a browser's removal does.
    document.body.style.cssText = '';
    document.body.removeAttribute('style');
  });

  /**
   * Open a mounted dialog the way the injected palette does (a `<Show>` per
   * open, inside a shadow root), then close it by unmounting.
   *
   * @returns Toggles the open state.
   */
  function mountToggle(): (open: boolean) => void {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const container = document.createElement('div');
    shadow.append(container);
    isolateUiEvents(shadow);
    const [open, setOpen] = createSignal(false);
    render(() => (
      <Show when={open()}>
        <ModalDialog title="Command palette" mount={container} onClose={() => setOpen(false)}>
          <Button>First control</Button>
        </ModalDialog>
      </Show>
    ));
    return setOpen;
  }

  /** Open, let the library finish its mount work, close, then drain its close work. */
  async function openClose(setOpen: (open: boolean) => void): Promise<void> {
    setOpen(true);
    await armLibrary();
    setOpen(false);
    await armLibrary();
  }

  it.each([
    ['an empty attribute', ''],
    ['a whitespace-only attribute', ' '],
    ['an invalid-only declaration', 'foo:bar'],
    ['several invalid declarations', 'foo: bar; ; baz:1']
  ])('keeps %s (no declarations the CSSOM counts)', async (_label, value) => {
    document.body.setAttribute('style', value);
    const setOpen = mountToggle();
    await openClose(setOpen);
    expect(document.body.getAttribute('style')).toBe(value);
    await openClose(setOpen);
    expect(document.body.getAttribute('style')).toBe(value);
  });

  it.each(['auto', 'none', 'visible'])(
    'keeps a page’s inline pointer-events: %s across open/close',
    async (value) => {
      document.body.style.pointerEvents = value;
      const setOpen = mountToggle();
      await openClose(setOpen);
      expect(document.body.style.pointerEvents).toBe(value);
      expect(document.body.getAttribute('style')).toBe(`pointer-events: ${value};`);
    }
  );

  it('adds no style attribute to a body that had none', async () => {
    const setOpen = mountToggle();
    await openClose(setOpen);
    expect(document.body.getAttribute('style')).toBe(null);
  });

  it('keeps the attribute when the library closes itself (Escape) before the caller unmounts', async () => {
    document.body.setAttribute('style', ' ');
    const setOpen = mountToggle();
    setOpen(true);
    await armLibrary();
    const panel = document.querySelector('div')?.shadowRoot?.querySelector('[role="dialog"]');
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await armLibrary();
    expect(document.querySelector('div')?.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.getAttribute('style')).toBe(' ');
  });

  it('keeps a page’s own style edits made while the dialog is open', async () => {
    document.body.setAttribute('style', ' ');
    const setOpen = mountToggle();
    setOpen(true);
    await armLibrary();
    document.body.style.color = 'red';
    setOpen(false);
    await armLibrary();
    expect(document.body.getAttribute('style')).toBe('color: red;');
  });
});
