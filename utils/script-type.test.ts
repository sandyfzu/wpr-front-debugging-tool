import { describe, expect, it } from 'vitest';
import { isBlankScriptType, isClassicScriptType } from './script-type';

describe('isClassicScriptType', () => {
  it.each([
    'application/ecmascript',
    'application/javascript',
    'application/x-ecmascript',
    'application/x-javascript',
    'text/ecmascript',
    'text/javascript',
    'text/javascript1.0',
    'text/javascript1.1',
    'text/javascript1.2',
    'text/javascript1.3',
    'text/javascript1.4',
    'text/javascript1.5',
    'text/jscript',
    'text/livescript',
    'text/x-ecmascript',
    'text/x-javascript'
  ])('every essence of the list is classic (%s)', (type) => {
    expect(isClassicScriptType(type)).toBe(true);
  });

  it('matches ASCII case-insensitively, after stripping ASCII whitespace edges', () => {
    expect(isClassicScriptType('Text/JavaScript')).toBe(true);
    expect(isClassicScriptType(' \t\n\f\rtext/javascript\r\n ')).toBe(true);
  });

  it('is no match for parameters, inner spaces, Unicode spaces or Unicode case folds', () => {
    expect(isClassicScriptType('text/javascript; charset=utf-8')).toBe(false);
    expect(isClassicScriptType('text / javascript')).toBe(false);
    expect(isClassicScriptType(' text/javascript')).toBe(false);
    // U+212A KELVIN SIGN lowercases to "k" under Unicode rules, never ASCII.
    expect(isClassicScriptType('text/Kavascript')).toBe(false);
  });

  it('is no match for module, other types, empty and blank values', () => {
    for (const type of ['module', 'importmap', 'text/template', 'application/json', '', '  ']) {
      expect(isClassicScriptType(type), type).toBe(false);
    }
  });
});

describe('isBlankScriptType', () => {
  it('holds for empty and ASCII-whitespace-only values', () => {
    expect(isBlankScriptType('')).toBe(true);
    expect(isBlankScriptType(' \t\n\f\r')).toBe(true);
  });

  it('does not hold once anything else remains', () => {
    expect(isBlankScriptType(' module ')).toBe(false);
    expect(isBlankScriptType(' ')).toBe(false);
  });
});
