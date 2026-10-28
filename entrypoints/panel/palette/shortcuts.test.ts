/**
 * The shell's shortcut wiring: the global `Cmd/Ctrl K` toggles the palette
 * from anywhere (even out of an editable field), the shortcuts overlay
 * answers its own declared binding — `/` as the advertised primary, `?` kept
 * as the unadvertised alias — but yields to editable targets, Escape is
 * deliberately never handled here (the dialogs own it; the search-Esc rule
 * stays the data layer's), and the returned stop handle takes the listener
 * down. The user's chosen chord toggles the palette too (live, by the
 * shared decision): may-type chords yield to typed-text fields, a chosen
 * chord equal to the fixed one toggles once, and the overlay's palette row
 * names it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ChordBinding } from '../../../lib/palette-chord/keydown';
import {
  PANEL_SHORTCUTS,
  SHORTCUTS_OVERLAY_BINDING,
  isEditableTarget,
  registerPanelShortcuts,
  shortcutKeys
} from './shortcuts';

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
    // The overlay's own row advertises its declared binding — the exact
    // typed key, never the host-claimed alias (copy amendment, 2026-10-13:
    // the binding re-ownership; the listener's alias side is pinned
    // separately below).
    expect(flat).toContain('/ Open or close this list');
    // The find-bar rows: Enter/Shift Enter next/previous, Esc clears — the
    // stream the panel actually receives from DevTools.
    expect(flat).toContain('Ctrl / ⌘ F');
    expect(flat).toContain('Next / previous match');
    expect(flat).toContain('Esc');
    // The appearance cycle rides a palette row (it has no direct key).
    expect(flat).toContain('Cycle appearance');
  });

  it('the overlay row’s keys chip is the declared binding’s hint (copy cannot drift)', () => {
    // The trap class this binding exists for: copy advertising a key the
    // DevTools window keeps for itself. The table renders the binding's
    // advertised hint (the exact typed key), not the alias.
    const overlayRow = PANEL_SHORTCUTS.find((row) => row.action.includes('this list'));
    expect(overlayRow?.keys).toBe(SHORTCUTS_OVERLAY_BINDING.hint);
    expect(overlayRow?.keys).toBe('/');
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

  it('the overlay binding is one table: every accepted key toggles, `/` primary, alias included', () => {
    // The listener and the hint row read the same declared binding; this
    // loop pins the listener's side against it, key by key, and the
    // editable-guard along the way (the key belongs to the query in a field).
    for (const key of SHORTCUTS_OVERLAY_BINDING.accepts) {
      const { toggles, stop } = wire();
      expect(pressKey(key)).toBe(true);
      expect(toggles.shortcuts).toBe(1);
      expect(toggles.palette).toBe(0);

      const field = document.createElement('input');
      document.body.append(field);
      expect(pressKey(key, { target: field })).toBe(false);
      expect(toggles.shortcuts).toBe(1);
      stop();
    }
  });

  it('never answers an unbound character (the reported layout’s unshifted glyph)', () => {
    // Layout-independence by contract: the binding matches `event.key`
    // exactly — on the owner's layout the unshifted glyph on `/`'s key is
    // `'`, and no untyped-for character may toggle the shell's overlays.
    const { toggles, stop } = wire();
    expect(pressKey("'")).toBe(false);
    expect(toggles.shortcuts).toBe(0);
    expect(toggles.palette).toBe(0);
    stop();
  });

  it('the overlay branch requires an unmodified key (the palette branch’s exactness, mirrored)', () => {
    // The audit round's hardening: a chord ending in the binding's glyph is
    // not our chord — Ctrl/⌘/Alt stay for the host or nothing; Shift is
    // deliberately ungated (the accepted glyphs arrive with Shift held: the
    // `?` composition, or a layout's own way to produce `/`).
    const { toggles, stop } = wire();
    for (const key of SHORTCUTS_OVERLAY_BINDING.accepts) {
      expect(pressKey(key, { ctrlKey: true })).toBe(false);
      expect(pressKey(key, { metaKey: true })).toBe(false);
      expect(pressKey(key, { altKey: true })).toBe(false);
      // The flag the contract keeps: shift-held arrival still toggles...
      expect(pressKey(key, { shiftKey: true })).toBe(true);
      expect(toggles.shortcuts).toBe(1);
      toggles.shortcuts = 0;
    }
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

/**
 * A trusted keydown carrying a physical key (the chosen-chord decision reads
 * `code` and ignores script-dispatched events, so the test marks it trusted
 * the way real input arrives).
 */
function pressChord(
  code: string,
  options: KeyboardEventInit & { target?: HTMLElement; key?: string } = {}
): boolean {
  const target = options.target ?? document.body;
  const event = new KeyboardEvent('keydown', {
    key: options.key ?? code.replace(/^Key/, '').toLowerCase(),
    code,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: options.ctrlKey,
    metaKey: options.metaKey,
    altKey: options.altKey,
    shiftKey: options.shiftKey
  });
  Object.defineProperty(event, 'isTrusted', { value: true });
  // happy-dom reports AltGraph whenever Alt is held; a real Alt press does
  // not (AltGr is its own key), so the double answers like a browser.
  const modifierState = event.getModifierState.bind(event);
  Object.defineProperty(event, 'getModifierState', {
    value: (key: string): boolean => key !== 'AltGraph' && modifierState(key)
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** {@link wire} with a chosen binding the test can swap (the live rebinding). */
function wireChosen(initial: ChordBinding | null) {
  const chosen = { current: initial };
  const toggles = { palette: 0, shortcuts: 0 };
  const stop = registerPanelShortcuts(
    {
      togglePalette: () => {
        toggles.palette += 1;
      },
      toggleShortcuts: () => {
        toggles.shortcuts += 1;
      }
    },
    () => chosen.current
  );
  return { toggles, stop, chosen };
}

const MAC_ALT_K: ChordBinding = { chord: { code: 'KeyK', alt: true }, platform: 'mac' };
const OTHER_ALT_K: ChordBinding = { chord: { code: 'KeyK', alt: true }, platform: 'other' };

describe('registerPanelShortcuts — the chosen chord', () => {
  it('toggles the palette on the chosen chord (and consumes it), both ways', () => {
    const { toggles, stop } = wireChosen(OTHER_ALT_K);
    expect(pressChord('KeyK', { altKey: true })).toBe(true);
    expect(pressChord('KeyK', { altKey: true })).toBe(true);
    expect(toggles.palette).toBe(2);
    expect(toggles.shortcuts).toBe(0);
    stop();
  });

  it('follows a rebinding live: the new chord toggles, the old one passes', () => {
    const { toggles, stop, chosen } = wireChosen(OTHER_ALT_K);
    chosen.current = { chord: { code: 'KeyJ', alt: true }, platform: 'other' };
    expect(pressChord('KeyK', { altKey: true })).toBe(false);
    expect(toggles.palette).toBe(0);
    expect(pressChord('KeyJ', { altKey: true })).toBe(true);
    expect(toggles.palette).toBe(1);
    stop();
  });

  it('matches nothing while unresolved (the fixed chord still works)', () => {
    const { toggles, stop } = wireChosen(null);
    expect(pressChord('KeyK', { altKey: true })).toBe(false);
    expect(pressChord('KeyK', { ctrlKey: true })).toBe(true);
    expect(toggles.palette).toBe(1);
    stop();
  });

  it('a may-type chord types in a field (never consumed there); outside it toggles', () => {
    const { toggles, stop } = wireChosen(MAC_ALT_K);
    const field = document.createElement('input');
    document.body.append(field);
    expect(pressChord('KeyK', { altKey: true, key: '˚', target: field })).toBe(false);
    expect(toggles.palette).toBe(0);
    expect(pressChord('KeyK', { altKey: true, key: '˚' })).toBe(true);
    expect(toggles.palette).toBe(1);
    stop();
  });

  it('a command-modifier chosen chord toggles from inside a field too', () => {
    const { toggles, stop } = wireChosen({
      chord: { code: 'KeyO', mod: true, alt: true },
      platform: 'mac'
    });
    const field = document.createElement('textarea');
    document.body.append(field);
    expect(pressChord('KeyO', { metaKey: true, altKey: true, target: field })).toBe(true);
    expect(toggles.palette).toBe(1);
    stop();
  });

  it('a chosen chord equal to Ctrl/⌘ K toggles once, not twice', () => {
    for (const binding of [
      { chord: { code: 'KeyK', mod: true }, platform: 'other' },
      { chord: { code: 'KeyK', mod: true }, platform: 'mac' }
    ] as const satisfies readonly ChordBinding[]) {
      const { toggles, stop } = wireChosen(binding);
      pressChord('KeyK', binding.platform === 'mac' ? { metaKey: true } : { ctrlKey: true });
      expect(toggles.palette).toBe(1);
      stop();
    }
  });

  it('ignores an untrusted or already handled keystroke (the shared decision)', () => {
    const { toggles, stop } = wireChosen(OTHER_ALT_K);
    const untrusted = new KeyboardEvent('keydown', {
      code: 'KeyK',
      key: 'k',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    document.body.dispatchEvent(untrusted);
    const handled = new KeyboardEvent('keydown', {
      code: 'KeyK',
      key: 'k',
      altKey: true,
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(handled, 'isTrusted', { value: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(toggles.palette).toBe(0);
    stop();
  });

  it('the stop handle takes the chosen chord down with the rest', () => {
    const { toggles, stop } = wireChosen(OTHER_ALT_K);
    stop();
    pressChord('KeyK', { altKey: true });
    expect(toggles.palette).toBe(0);
  });
});

describe('shortcutKeys (the overlay row text)', () => {
  const paletteRow = PANEL_SHORTCUTS.find((row) => row.opensPalette === true);
  if (paletteRow === undefined) throw new Error('the table lost its palette row');

  it('names the fixed chord alone until the chosen one resolves', () => {
    expect(shortcutKeys(paletteRow, null)).toBe('Ctrl / ⌘ K');
  });

  it('adds the chosen chord in the platform notation', () => {
    expect(shortcutKeys(paletteRow, MAC_ALT_K)).toBe('Ctrl / ⌘ K or ⌥K');
    expect(shortcutKeys(paletteRow, OTHER_ALT_K)).toBe('Ctrl / ⌘ K or Alt+K');
  });

  it('never repeats the fixed chord when it is the chosen one', () => {
    for (const platform of ['mac', 'other'] as const) {
      expect(shortcutKeys(paletteRow, { chord: { code: 'KeyK', mod: true }, platform })).toBe(
        'Ctrl / ⌘ K'
      );
    }
  });

  it('leaves every other row as declared', () => {
    for (const row of PANEL_SHORTCUTS.filter((entry) => entry !== paletteRow)) {
      expect(shortcutKeys(row, MAC_ALT_K)).toBe(row.keys);
    }
  });
});
