import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class lists into one class string.
 *
 * Falsy inputs are dropped, `tailwind-merge` resolves conflicting utilities so the
 * caller wins by list order (e.g. `cn('text-2xs', 'text-accent')` keeps both — sizes
 * and colors are different groups — while `cn('p-2', 'p-4')` keeps the `p-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
