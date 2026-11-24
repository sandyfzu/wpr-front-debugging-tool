/**
 * Extension version parsing (the browsers' 1–4 integer parts rule) and
 * ordering (missing trailing parts read as 0).
 */
import { describe, expect, it } from 'vitest';
import { compareExtensionVersions, parseExtensionVersion } from './extension-version';

describe('parseExtensionVersion', () => {
  it('reads one to four integer parts', () => {
    expect(parseExtensionVersion('3')).toEqual([3]);
    expect(parseExtensionVersion('3.0')).toEqual([3, 0]);
    expect(parseExtensionVersion('2.2.5')).toEqual([2, 2, 5]);
    expect(parseExtensionVersion('1.2.3.4')).toEqual([1, 2, 3, 4]);
    expect(parseExtensionVersion('0.65535')).toEqual([0, 65_535]);
  });

  it('rejects everything else', () => {
    for (const bad of [
      '',
      '.',
      '3.',
      '.3',
      '1.2.3.4.5',
      '01.2',
      '1.02',
      '1.65536',
      '1.-1',
      '1.2a',
      '1.2-beta',
      ' 1.2',
      '1..2',
      '1e3'
    ]) {
      expect(parseExtensionVersion(bad), bad).toBeNull();
    }
    for (const notString of [undefined, null, 3, {}, ['3'], true]) {
      expect(parseExtensionVersion(notString)).toBeNull();
    }
  });
});

describe('compareExtensionVersions', () => {
  /** Compare two version strings that must parse. */
  const compare = (a: string, b: string): number => {
    const left = parseExtensionVersion(a);
    const right = parseExtensionVersion(b);
    if (left === null || right === null) throw new Error(`unparsable: ${a} / ${b}`);
    return Math.sign(compareExtensionVersions(left, right));
  };

  it('orders part by part, numerically', () => {
    expect(compare('2.2.5', '3.0.0')).toBe(-1);
    expect(compare('3.0.0', '2.2.5')).toBe(1);
    expect(compare('3.10.0', '3.9.9')).toBe(1);
    expect(compare('3.0.1', '3.0.0')).toBe(1);
    expect(compare('3.0.0.1', '3.0.0')).toBe(1);
  });

  it('treats missing trailing parts as 0', () => {
    expect(compare('3', '3.0.0')).toBe(0);
    expect(compare('3.0', '3.0.0.0')).toBe(0);
    expect(compare('3.0.0', '3.0.0')).toBe(0);
  });
});
