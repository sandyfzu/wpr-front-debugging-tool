import { describe, expect, it } from 'vitest';
import { tabKey } from './tab-key';

describe('tabKey', () => {
  it('keys tab ids and canonical decimal strings', () => {
    expect(tabKey(0)).toBe('0');
    expect(tabKey(42)).toBe('42');
    expect(tabKey('42')).toBe('42');
  });

  it('refuses anything not tab shaped', () => {
    for (const key of ['042', '+1', '1e3', '1.5', '-1', '', ' 1', -1, 1.5, 2 ** 60, '1e+21']) {
      expect(tabKey(key)).toBeNull();
    }
  });
});
