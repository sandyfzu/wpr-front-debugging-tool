/** The appearance choices every user-facing surface offers, in registry order. */
export const APPEARANCES = ['system', 'dark', 'light'] as const;

/** What every user-facing surface offers as its appearance choice. */
export type Appearance = (typeof APPEARANCES)[number];

/**
 * Whether a value is one of the three documented appearance choices — the
 * vocabulary's guard for values typed wider than `Appearance` (untrusted
 * storage reads, registry row values). Derived from the `APPEARANCES` order
 * — never a second spelling of the vocabulary.
 *
 * @param value Any value to test.
 */
export function isAppearance(value: unknown): value is Appearance {
  return typeof value === 'string' && (APPEARANCES as readonly string[]).includes(value);
}

/** The palette CSS actually renders — what the three-way choice collapses to. */
export type Theme = 'dark' | 'light';

/**
 * The next choice in the registry order, wrapping at the end — the cycle the
 * keyboard surfaces step through (system → dark → light → system).
 *
 * @param current The appearance currently in effect (or stored).
 * @returns The choice one step after `current`.
 */
export function nextAppearance(current: Appearance): Appearance {
  const at = APPEARANCES.indexOf(current);
  if (at === -1) throw new Error(`nextAppearance: unknown choice '${current}'.`);
  const next = APPEARANCES[(at + 1) % APPEARANCES.length];
  // The modulo is provably in range for a non-empty registry; the guard keeps
  // the indexed read honest and names the drift if the order ever empties.
  if (next === undefined) {
    throw new Error(
      `nextAppearance: the appearance registry is empty — cannot step past '${current}'.`
    );
  }
  return next;
}

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
 * Set the theme over an element's `data-theme` attribute.
 *
 * `'dark'`/`'light'` pin an explicit palette; they always win over the system
 * scheme per the token stylesheet. Passing `'system'` declares the system
 * choice explicitly — the injected-UI container contract: the shadow-root
 * mount's isolation reset aborts the documented `:host` scheme chain, so the
 * container must declare `"light dark"` itself for `light-dark()` to follow
 * the user's OS preference (live) inside the tree.
 *
 * Passing `null` clears the attribute, handing control back to the
 * stylesheet's `:root` media query — the `<html>` (extension page) contract.
 *
 * @param root The element the theme applies to (`<html>` or a shadow-root container).
 * @param theme The theme to pin, or `null` to follow the system through the media query.
 */
export function applyTheme(root: HTMLElement, theme: Theme | 'system' | null): void {
  if (theme === null) root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
}
