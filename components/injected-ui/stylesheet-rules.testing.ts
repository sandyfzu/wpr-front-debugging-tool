/**
 * Test-only reader for injected UIs' plain stylesheets (no CSS parser in the
 * stack): pins single declarations whose loss the browser tier would only
 * catch late. Supports flat top-level rules — the shape these stylesheets
 * use for their layer and scroller boxes; never imported by production code.
 */

/**
 * The declarations of a top-level rule, comments stripped.
 *
 * @param css The stylesheet's text.
 * @param selector The rule's exact selector (alone on its line, as written).
 * @returns The rule's body.
 * @throws {@link Error} When the stylesheet has no such rule.
 */
function ruleBody(css: string, selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = source.search(new RegExp(`^${escaped} \\{`, 'm'));
  if (start < 0) throw new Error(`stylesheet has no top-level "${selector}" rule`);
  const open = source.indexOf('{', start);
  return source.slice(open + 1, source.indexOf('}', open));
}

/**
 * The value of one property in a top-level rule (the last one wins, as in CSS).
 *
 * @param css The stylesheet's text.
 * @param selector The rule's exact selector.
 * @param property The property name.
 * @returns The trimmed value, or `undefined` when the rule does not set it.
 * @throws {@link Error} When the stylesheet has no such rule.
 */
export function declaredValue(css: string, selector: string, property: string): string | undefined {
  // A lookbehind, not a consumed `;`: adjacent declarations each still match.
  const values = [
    ...ruleBody(css, selector).matchAll(new RegExp(`(?<=^|;)\\s*${property}:\\s*([^;]+);`, 'g'))
  ];
  return values.at(-1)?.[1]?.trim();
}
