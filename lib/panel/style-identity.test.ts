/** A style's identity line: id, then class tokens, as a selector. */
import { describe, expect, it } from 'vitest';
import { styleIdentity } from './style-identity';

describe('styleIdentity', () => {
  it('reads id and class tokens as a selector, or nothing', () => {
    expect(styleIdentity({ id: '', className: '' })).toBe('');
    expect(styleIdentity({ id: 'a', className: '' })).toBe('#a');
    expect(styleIdentity({ id: 'a', className: ' x  y ' })).toBe('#a.x.y');
    expect(styleIdentity({ id: '', className: 'x' })).toBe('.x');
  });
});
