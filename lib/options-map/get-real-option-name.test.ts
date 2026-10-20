/**
 * The option-name maps are treated as data with a contract: every key in the
 * committed JSON maps to a non-empty label (breaking that would surface raw
 * ids or empty strings in the panel), and lookups exist for all ids the
 * engine can produce.
 */
import { describe, expect, it } from 'vitest';
import optionNames from './option-names.json' with { type: 'json' };
import otherNames from './other-names.json' with { type: 'json' };
import { getRealOptionName, knownOptionIds } from './get-real-option-name';

describe('option name maps', () => {
  it('maps every key to a non-empty string', () => {
    for (const [key, label] of Object.entries({ ...optionNames, ...otherNames })) {
      expect(typeof label, `option "${key}"`).toBe('string');
      expect(label.trim().length, `option "${key}"`).toBeGreaterThan(0);
    }
  });

  it('carries the expected set sizes (40 plugin options + 5 labels)', () => {
    expect(Object.keys(optionNames).length).toBe(40);
    expect(Object.keys(otherNames).length).toBe(5);
  });

  it('resolves known ids and falls back to the raw id otherwise', () => {
    expect(getRealOptionName('delay_js')).toBe('Delay JavaScript execution');
    expect(getRealOptionName('rocket_cdn')).toBe('RocketCDN');
    expect(getRealOptionName('not_an_option_at_all')).toBe('not_an_option_at_all');
  });

  it('enumerates all mapped ids, without duplicates', () => {
    const ids = knownOptionIds();
    expect(ids.length).toBe(Object.keys(optionNames).length + Object.keys(otherNames).length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
