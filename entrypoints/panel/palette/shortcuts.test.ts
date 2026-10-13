/**
 * The shell's shortcut wiring: the global `Cmd/Ctrl K` toggles the palette
 * from anywhere (even out of an editable field), `?` toggles the shortcuts
 * overlay but yields to editable targets, Escape is deliberately never
 * handled here (the dialogs own it; the search-Esc rule stays the data
 * layer's), and the returned stop handle takes the listener down.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PANEL_SHORTCUTS, isEditableTarget, registerPanelShortcuts } from './shortcuts';

/** A keystroke dispatched on a target the test controls. */
function pressKey(key: string, options?: KeyboardEventInit & { target?: HTMLElement }): boolean {
  const target = options?.target ?? document.body;
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options?.ctrlKey,
    metaKey: options?.metaKey,
    altKey: options?.altKey,
    shiftKey: options?.shiftKey
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** The toggle recorder wired to a temp listener; returns the stop + state. */
function wire() {
  const toggles = { palette: 0, shortcuts: 0 };
  const stop = registerPanelShortcuts({
    togglePalette: () => {
      toggles.palette += 1;
    },
    toggleShortcuts: () => {
      toggles.shortcuts += 1;
    }
  });
  return { toggles, stop };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PANEL_SHORTCUTS (the overlay table)', () => {
  it('lists the palette, the overlay, and the DevTools find rows whose streams are real', () => {
    const flat = PANEL_SHORTCUTS.map((row) => `${row.keys} ${row.action}`).join(' | ');
    expect(flat).toContain('Ctrl / ⌘ K');
    expect(flat).toContain('Open or close the command palette');
    expect(flat).toContain('?');
    expect(flat).toContain('Open or close this list');
    // The find-bar rows: Enter/Shift Enter next/previous, Esc clears — the
    // stream the panel actually receives from DevTools.
    expect(flat).toContain('Ctrl / ⌘ F');
    expect(flat).toContain('Next / previous match');
    expect(flat).toContain('Esc');
    // The appearance cycle rides a palette row (it has no direct key).
    expect(flat).toContain('Cycle appearance');
  });
});

describe('isEditableTarget', () => {
  it('recognizes the fields the shell must not disturb', () => {
    const input = document.createElement('input');
    expect(isEditableTarget(input)).toBe(true);
    const textarea = document.createElement('textarea');
    expect(isEditableTarget(textarea)).toBe(true);
    const select = document.createElement('select');
    expect(isEditableTarget(select)).toBe(true);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('registerPanelShortcuts', () => {
  it('Ctrl+K and Cmd+K both toggle the palette, and the key never reaches the browser', () => {
    const { toggles, stop } = wire();
    expect(pressKey('k', { ctrlKey: true })).toBe(true); // defaultPrevented
    expect(pressKey('k', { metaKey: true })).toBe(true);
    expect(toggles.palette).toBe(2);
    stop();
  });

  it('plain K, K with shift, or K with alt do not toggle (the exact chord only)', () => {
    const { toggles, stop } = wire();
    pressKey('k', { ctrlKey: true, shiftKey: true });
    pressKey('k', { ctrlKey: true, altKey: true });
    pressKey('k');
    expect(toggles.palette).toBe(0);
    stop();
  });

  it('? toggles the overlay, but not while the keystroke is headed into a field', () => {
    const { toggles, stop } = wire();
    expect(pressKey('?')).toBe(true);
    expect(toggles.shortcuts).toBe(1);

    const field = document.createElement('input');
    document.body.append(field);
    // Inside the field the shell never interferes (and nothing is prevented —
    // the `?` belongs to the query).
    expect(pressKey('?', { target: field })).toBe(false);
    expect(toggles.shortcuts).toBe(1);
    stop();
  });

  it('Escape is not wired here at all (the dialogs own it; search-Esc stays the data rule)', () => {
    const { toggles, stop } = wire();
    expect(pressKey('Escape')).toBe(false);
    expect(toggles.palette).toBe(0);
    expect(toggles.shortcuts).toBe(0);
    stop();
  });

  it('the stop handle takes the listener down (no double wiring)', () => {
    const { toggles, stop } = wire();
    stop();
    pressKey('k', { ctrlKey: true });
    expect(toggles.palette).toBe(0);
    // A second stop still terminates cleanly.
    stop();
  });
});
