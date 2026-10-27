/**
 * Layout-true legends: the Keyboard Map probe (absent API, a resolved map,
 * a rejected read) and the legend rule (keycap upper-casing, the US
 * fallback for function keys, dead/whitespace/multi-character values, and
 * case mappings that grow).
 */
import { describe, expect, it, vi } from 'vitest';
import { keyLegend, readKeyboardLayout, type KeyLayoutLookup } from './keyboard-layout';

/** A layout map over plain entries. */
function layoutOf(entries: Record<string, string>): KeyLayoutLookup {
  const map = new Map(Object.entries(entries));
  return { get: (code) => map.get(code) };
}

describe('readKeyboardLayout', () => {
  it('is null where the API is absent (Firefox, Safari)', async () => {
    const log = { debug: vi.fn() };
    expect(await readKeyboardLayout({}, log)).toBeNull();
    expect(await readKeyboardLayout({ keyboard: {} }, log)).toBeNull();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('returns the map, called on the keyboard object', async () => {
    const map = layoutOf({ KeyQ: 'a' });
    const keyboard = {
      getLayoutMap(this: unknown) {
        return this === keyboard ? Promise.resolve(map) : Promise.reject(new Error('unbound'));
      }
    };
    expect(await readKeyboardLayout({ keyboard }, { debug: vi.fn() })).toBe(map);
  });

  it('degrades a rejected read to null with a debug note', async () => {
    const log = { debug: vi.fn() };
    const keyboard = { getLayoutMap: () => Promise.reject(new Error('SecurityError')) };
    expect(await readKeyboardLayout({ keyboard }, log)).toBeNull();
    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining('US key legends'),
      expect.any(Error)
    );
  });
});

describe('keyLegend', () => {
  it('upper-cases the layout character like a keycap (AZERTY KeyQ reads A)', () => {
    const azerty = layoutOf({ KeyQ: 'a', Semicolon: 'm', Digit1: '&', IntlBackslash: '<' });
    expect(keyLegend('KeyQ', azerty)).toBe('A');
    expect(keyLegend('Semicolon', azerty)).toBe('M');
    expect(keyLegend('Digit1', azerty)).toBe('&');
    expect(keyLegend('IntlBackslash', azerty)).toBe('<');
  });

  it('falls back to the US legend without a map, for keys the map does not name and unusable values', () => {
    expect(keyLegend('KeyK', null)).toBe('K');
    expect(keyLegend('IntlBackslash', null)).toBe('\\ (ISO)');
    const odd = layoutOf({ KeyA: ' ', KeyB: 'ab', KeyC: '́', KeyD: '\u0000', KeyE: '' });
    for (const code of ['KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF'] as const) {
      expect(keyLegend(code, odd)).toBe(code.slice(3));
    }
    // Function keys are not writing-system keys: the map never names them.
    expect(keyLegend('F5', layoutOf({ KeyA: 'q' }))).toBe('F5');
  });

  it('keeps a character whose upper case grows (ß stays ß)', () => {
    expect(keyLegend('Minus', layoutOf({ Minus: 'ß' }))).toBe('ß');
  });
});
