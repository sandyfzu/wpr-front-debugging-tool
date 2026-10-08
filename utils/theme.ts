/** The appearance choices every user-facing surface offers, in registry order. */
export const APPEARANCES = ['system', 'dark', 'light'] as const;

/** What every user-facing surface offers as its appearance choice. */
export type Appearance = (typeof APPEARANCES)[number];

/** The palette CSS actually renders — what the three-way choice collapses to. */
export type Theme = 'dark' | 'light';

/**
 * Collapse the three-way appearance choice into a concrete palette.
 *
 * `system` defers to the OS scheme (`systemPrefersDark`); explicit choices win.
 * The result is applied via `applyTheme` before first paint so the palette never
 * flashes: on pages set it on `<html>`, on injected UIs on their shadow-root
 * container (see `assets/css/theme.css` for the exact semantics).
 *
 * @param appearance The stored user preference.
 * @param systemPrefersDark Whether the OS currently prefers dark.
 * @returns The palette to apply.
 */
export function resolveTheme(appearance: Appearance, systemPrefersDark: boolean): Theme {
  if (appearance === 'system') return systemPrefersDark ? 'dark' : 'light';
  return appearance;
}

/**
 * Set the explicit theme override on an element's `data-theme` attribute.
 *
 * Passing `null` clears the attribute, which hands control back to the
 * system scheme via the stylesheet's media query. Only `dark`/`light` may be
 * written — an explicit attribute is what "wins" per the token stylesheet.
 *
 * @param root The element the theme applies to (`<html>` or a shadow-root container).
 * @param theme The palette to pin, or `null` to follow the system.
 */
export function applyTheme(root: HTMLElement, theme: Theme | null): void {
  if (theme === null) root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}
