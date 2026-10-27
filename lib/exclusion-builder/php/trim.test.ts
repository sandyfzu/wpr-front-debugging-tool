import { describe, expect, it } from 'vitest';
import { phpTrim } from './trim';

describe('phpTrim', () => {
  it('strips space, tab, LF, CR, NUL and vertical tab only (PHP 8.1 `trim`)', () => {
    expect(phpTrim('\n\r\t \v\0a\0\v \t\r\n')).toBe('a');
    expect(phpTrim('\f a \u00a0')).toBe('\f a \u00a0');
  });
});

describe('phpTrim (vertical tab, inner text)', () => {
  it("strips PHP's default characters only", () => {
    expect(phpTrim(' \t\n\r\0\x0Ba  \x0B')).toBe('a ');
    expect(phpTrim('\f a')).toBe('\f a');
  });
});
