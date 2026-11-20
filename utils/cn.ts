import { clsx, type ClassValue } from 'clsx';
import { createTailwindMerge, getDefaultConfig } from 'tailwind-merge';

/**
 * `tailwind-merge` taught the theme's own names beyond its defaults: unknown
 * `text-*` names read as colors, so `text-stat` beside `text-fg-primary` would
 * be dropped as a conflicting color (`2xs` already parses as a size); unknown
 * `rounded-*` names match no group, so `rounded-control` and a caller's
 * `rounded-full` would both survive and the stylesheet order would pick.
 * Built with `createTailwindMerge` + a config function (not
 * `extendTailwindMerge`, whose object form bundles the config merger) so every
 * bundle using `cn` grows by the added names only.
 */
const twMerge = createTailwindMerge(getDefaultConfig, (config) => ({
  ...config,
  theme: {
    ...config.theme,
    text: [...(config.theme.text ?? []), 'stat', 'tile'],
    radius: [...(config.theme.radius ?? []), 'control']
  }
}));

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
