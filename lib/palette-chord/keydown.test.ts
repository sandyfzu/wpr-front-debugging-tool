/**
 * The shared palette-chord keydown decision (trusted, unhandled, exact match,
 * may-type chords skipped in editable fields only) and the typed-text read
 * over composed paths (open shadow roots included, `designMode` documents).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaletteChord } from '../storage/palette-chord';
import {
  chordKeydownAction,
  takesTypedText,
  type ChordBinding,
  type ChordKeydownFacts
} from './keydown';

afterEach(() => {
  document.body.innerHTML = '';
  document.designMode = 'off';
});

const ALT_K: PaletteChord = { code: 'KeyK', alt: true };
const MOD_K: PaletteChord = { code: 'KeyK', mod: true };
const MOD_ALT_P: PaletteChord = { code: 'KeyP', mod: true, alt: true };
const F8: PaletteChord = { code: 'F8' };

/** A trusted, unhandled keydown with no modifiers, overridden per case. */
function keydown(overrides: Partial<ChordKeydownFacts> = {}): ChordKeydownFacts {
  return {
    isTrusted: true,
    defaultPrevented: false,
    code: 'KeyK',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides
  };
}

const MAC = (chord: PaletteChord): ChordBinding => ({ chord, platform: 'mac' });
const OTHER = (chord: PaletteChord): ChordBinding => ({ chord, platform: 'other' });

describe('chordKeydownAction', () => {
  const outside = (): boolean => false;
  const inside = (): boolean => true;

  it('opens on the exact chord outside an editable field', () => {
    expect(chordKeydownAction(keydown({ altKey: true }), MAC(ALT_K), outside)).toBe('open');
    expect(chordKeydownAction(keydown({ altKey: true }), OTHER(ALT_K), outside)).toBe('open');
    expect(chordKeydownAction(keydown({ metaKey: true }), MAC(MOD_K), outside)).toBe('open');
    expect(chordKeydownAction(keydown({ ctrlKey: true }), OTHER(MOD_K), outside)).toBe('open');
  });

  it('passes a script-dispatched or already handled keystroke', () => {
    expect(
      chordKeydownAction(keydown({ altKey: true, isTrusted: false }), MAC(ALT_K), outside)
    ).toBe('pass');
    expect(
      chordKeydownAction(keydown({ altKey: true, defaultPrevented: true }), MAC(ALT_K), outside)
    ).toBe('pass');
  });

  it.each<[string, Partial<ChordKeydownFacts>]>([
    ['another key', { altKey: true, code: 'KeyJ' }],
    ['no modifier', {}],
    ['an extra Shift', { altKey: true, shiftKey: true }],
    ['an extra command modifier', { altKey: true, metaKey: true }],
    ['the foreign Ctrl on macOS', { altKey: true, ctrlKey: true }],
    ['an auto-repeat', { altKey: true, repeat: true }],
    ['IME composition', { altKey: true, isComposing: true }],
    ['IME key code 229', { altKey: true, keyCode: 229 }]
  ])('passes %s', (_label, overrides) => {
    expect(chordKeydownAction(keydown(overrides), MAC(ALT_K), outside)).toBe('pass');
  });

  it('passes AltGr outside macOS (it types), matches Option on macOS Firefox (AltGraph reported)', () => {
    const altGraph = (key: string): boolean => key === 'AltGraph';
    const press = keydown({ altKey: true, getModifierState: altGraph });
    expect(chordKeydownAction(press, OTHER(ALT_K), outside)).toBe('pass');
    expect(chordKeydownAction(press, MAC(ALT_K), outside)).toBe('open');
  });

  it('lets a may-type chord type in an editable field (the field is asked only on a match)', () => {
    const asked = vi.fn(inside);
    expect(chordKeydownAction(keydown({ altKey: true }), MAC(ALT_K), asked)).toBe('pass');
    expect(asked).toHaveBeenCalledOnce();
    asked.mockClear();
    expect(chordKeydownAction(keydown({ code: 'KeyJ' }), MAC(ALT_K), asked)).toBe('pass');
    expect(asked).not.toHaveBeenCalled();
  });

  it('Ctrl+Alt may type outside macOS (AltGr), ⌘⌥ never does on macOS', () => {
    const press = keydown({ code: 'KeyP', altKey: true, ctrlKey: true });
    expect(chordKeydownAction(press, OTHER(MOD_ALT_P), inside)).toBe('pass');
    expect(chordKeydownAction(press, OTHER(MOD_ALT_P), outside)).toBe('open');
    const macPress = keydown({ code: 'KeyP', altKey: true, metaKey: true });
    expect(chordKeydownAction(macPress, MAC(MOD_ALT_P), inside)).toBe('open');
  });

  it('opens a command-modifier or function-key chord even inside an editable field', () => {
    const asked = vi.fn(inside);
    expect(chordKeydownAction(keydown({ metaKey: true }), MAC(MOD_K), asked)).toBe('open');
    expect(chordKeydownAction(keydown({ code: 'F8' }), OTHER(F8), asked)).toBe('open');
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('takesTypedText', () => {
  /** Append markup and return the element matching `selector`. */
  const element = (html: string, selector: string): Element => {
    document.body.innerHTML = html;
    const found = document.querySelector(selector);
    if (found === null) throw new Error(`fixture misses ${selector}`);
    return found;
  };

  it.each<[string, string, string, boolean]>([
    ['a textarea', '<textarea></textarea>', 'textarea', true],
    ['an untyped input', '<input>', 'input', true],
    ['a search input', '<input type="search">', 'input', true],
    ['a password input', '<input type="password">', 'input', true],
    ['a checkbox', '<input type="checkbox">', 'input', false],
    ['a submit input', '<input type="submit">', 'input', false],
    ['a range input', '<input type="range">', 'input', false],
    ['a button', '<button>Go</button>', 'button', false],
    ['editable content', '<div contenteditable="true">x</div>', 'div', true],
    ['a descendant of editable content', '<div contenteditable="true"><b>x</b></div>', 'b', true],
    ['plain content', '<p>x</p>', 'p', false]
  ])('%s → %s', (_label, html, selector, expected) => {
    const target = element(html, selector);
    expect(takesTypedText([target, document.body, document, window])).toBe(expected);
  });

  it('treats every element of a designMode document as editable', () => {
    const plain = element('<p>x</p>', 'p');
    expect(takesTypedText([plain])).toBe(false);
    document.designMode = 'on';
    expect(takesTypedText([plain, document.body])).toBe(true);
    expect(takesTypedText([document.body, document, window])).toBe(true);
    // Without relying on the engine's `isContentEditable` under designMode.
    const body = { nodeType: 1, localName: 'body', isContentEditable: false };
    expect(takesTypedText([{ ...body, ownerDocument: { designMode: 'on' } } as never])).toBe(true);
    expect(takesTypedText([{ ...body, ownerDocument: { designMode: 'off' } } as never])).toBe(
      false
    );
  });

  it('reads the deepest element, skipping non-element path entries', () => {
    const field = element('<input>', 'input');
    expect(takesTypedText([document.createTextNode('x'), field, document])).toBe(true);
    expect(takesTypedText([document, window])).toBe(false);
    expect(takesTypedText([])).toBe(false);
  });

  it('sees a field inside an open shadow root through the composed path', () => {
    const host = element('<x-widget></x-widget>', 'x-widget');
    const root = host.attachShadow({ mode: 'open' });
    const field = document.createElement('input');
    root.append(field);
    let path: EventTarget[] = [];
    const record = (event: Event): void => {
      path = event.composedPath();
    };
    window.addEventListener('keydown', record, true);
    field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, composed: true }));
    window.removeEventListener('keydown', record, true);
    expect(path[0]).toBe(field);
    expect(takesTypedText(path)).toBe(true);
  });
});
