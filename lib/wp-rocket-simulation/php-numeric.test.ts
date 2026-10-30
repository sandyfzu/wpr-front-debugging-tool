/**
 * `absint` on attribute strings: expected values printed by PHP 8.1's
 * `abs((int) $value)`; values past 2^53 are refused (PHP saturates there).
 */
import { describe, expect, it } from 'vitest';
import { phpAbsint } from './php-numeric';

describe('phpAbsint', () => {
  it.each<[string, number]>([
    ['12px', 12],
    ['  12', 12],
    ['\\v12', 0],
    ['\f12', 12],
    ['\v12', 12],
    [' \n12 ', 12],
    ['+5', 5],
    ['-5', 5],
    ['1e3', 1000],
    ['1.9', 1],
    ['.5', 0],
    ['5.', 5],
    ['1e', 1],
    ['0x1A', 0],
    ['abc', 0],
    ['', 0],
    ['9007199254740991', 9007199254740991]
  ])('%j → %d', (text, expected) => {
    expect(phpAbsint(text)).toBe(expected);
  });

  it.each(['9223372036854775808', '-9223372036854775808', '1e19', '9007199254740993'])(
    'refuses %j (PHP saturates or rounds past 2^53)',
    (text) => {
      expect(phpAbsint(text)).toBeNull();
    }
  );
});
