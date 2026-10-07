import { describe, expect, it } from 'vitest';
import { cn } from './cn';

/**
 * Pretend-rebooleans so the strict "unnecessary condition" lint keeps out of the
 * way without casts; values here flow through exactly like component code passes
 * conditionals into `cn`.
 */
const classNameWhen = (value: boolean, className: string): string | false => value && className;

describe('cn', () => {
  it('joins class lists, dropping falsy inputs including undefined and null', () => {
    expect(cn('a', classNameWhen(false, 'never'), undefined, null, 'b', 'c')).toBe('a b c');
  });

  it('resolves conflicting utilities by list order', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-2xs')).toBe('text-2xs');
  });

  it('keeps our design-system tokens without dropping earlier density sizes', () => {
    // Size × color coexist; color tokens conflict within their group (last wins).
    expect(cn('text-2xs', 'text-accent')).toBe('text-2xs text-accent');
    expect(cn('text-accent', 'text-status-error')).toBe('text-status-error');
    expect(cn('bg-surface-0', 'bg-surface-2')).toBe('bg-surface-2');
    expect(cn('shadow-elev-1', 'shadow-elev-2')).toBe('shadow-elev-2');
  });

  it('handles conditional objects and arrays', () => {
    expect(cn('base', { active: true, hidden: false }, ['x', 'y'])).toBe('base active x y');
  });
});
