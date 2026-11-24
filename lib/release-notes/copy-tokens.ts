/**
 * Placeholders release-note copy may carry for values only the running
 * extension knows (the user's own palette shortcut, the platform's DevTools
 * shortcut). Copy writes `{name}`; the page fills every token before render,
 * so notes stay plain data and never go stale on a rebound shortcut.
 */

/** The token names copy may use. */
export const COPY_TOKENS = ['paletteShortcut', 'devtoolsShortcut'] as const;

/** One token name. */
export type CopyToken = (typeof COPY_TOKENS)[number];

/** The value of every token, resolved by the page. */
export type CopyTokenValues = Readonly<Record<CopyToken, string>>;

/** Any `{word}` placeholder (known or not — unknown ones are a registry defect). */
const TOKEN_PATTERN = /\{([A-Za-z]+)\}/g;

/**
 * The placeholders a text carries, in order of appearance.
 *
 * @param text Release-note copy.
 * @returns Every `{name}` found (the registry test rejects unknown names).
 */
export function tokensIn(text: string): readonly string[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (match) => match[1] ?? '');
}

/**
 * Fill a text's placeholders.
 *
 * @param text Release-note copy.
 * @param values Every token's value.
 * @returns The text with each known token replaced; an unknown one is left
 *   as written (visible, never silently blank).
 */
export function fillTokens(text: string, values: CopyTokenValues): string {
  return text.replace(TOKEN_PATTERN, (whole, name: string) =>
    (COPY_TOKENS as readonly string[]).includes(name) ? values[name as CopyToken] : whole
  );
}
