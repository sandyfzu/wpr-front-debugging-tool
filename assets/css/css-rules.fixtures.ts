/**
 * Test-only stylesheet reader shared by the CSS contract tests (the token
 * gate, the injected UIs' rule checks): flattens a sheet into
 * single-selector rules with their declarations, so a test can reason about
 * selectors and values without a browser. Never imported by shipped code.
 */

/** One style rule of a stylesheet, flattened to a single selector. */
export interface CssRule {
  /** The selector, whitespace-normalized (selector lists are split). */
  selector: string;
  /** The enclosing at-rule preludes, outermost first. */
  within: string[];
  /** Declarations in source order: property → value (whitespace-normalized). */
  declarations: [string, string][];
  /** Source position, for the cascade's "later wins" tie-break. */
  order: number;
}

/**
 * Flatten a stylesheet into its style rules (comments ignored; nested
 * at-rules kept as context, not applied; keyframe steps skipped).
 *
 * @param css The stylesheet text.
 * @returns One {@link CssRule} per selector of each rule, in source order.
 */
export function parseRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const preludes: string[] = [];
  let from = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      // A statement at-rule (`@import …;`) before a rule is not its prelude.
      const head = text.slice(from, index);
      preludes.push(head.slice(head.lastIndexOf(';') + 1).trim());
      from = index + 1;
    } else if (char === '}') {
      const prelude = preludes.pop() ?? '';
      const declarations: [string, string][] = [];
      for (const line of text.slice(from, index).split(';')) {
        const colon = line.indexOf(':');
        if (colon > 0) {
          const value = line
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim();
          declarations.push([line.slice(0, colon).trim(), value]);
        }
      }
      // Keyframe blocks (`50% { … }`) are animation steps, not style rules.
      const keyframes = preludes.some((outer) => outer.startsWith('@keyframes'));
      if (declarations.length > 0 && !prelude.startsWith('@') && !keyframes) {
        // Split the selector list on top-level commas only (`:where(a, b)` stays whole).
        for (const part of prelude.split(/,(?![^()]*\))/)) {
          rules.push({
            selector: part.replace(/\s+/g, ' ').trim(),
            within: [...preludes],
            declarations,
            order: rules.length
          });
        }
      }
      from = index + 1;
    }
  }
  return rules;
}
