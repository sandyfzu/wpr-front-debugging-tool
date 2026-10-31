/**
 * PHP's `preg_replace` replacement-string expansion, written out: WP Rocket
 * builds several replacements by interpolating text into them (the Delay JS
 * runtime, the IE fallback, a moved `<meta charset>`), so a `$1`, `\1`,
 * `${1}`, `\\` or `\$` inside that text is read as replacement syntax, not
 * copied. Reproducing the served bytes means expanding it the same way.
 */

/**
 * A back-reference at `at` (`\n`, `$n`, `${n}`, one or two digits), as PHP
 * reads one — or `null` when the text there is not one.
 *
 * @param template The replacement string.
 * @param at Offset of its `\` or `$`.
 * @returns The group number and the offset past the reference.
 */
function backReferenceAt(
  template: string,
  at: number
): { readonly group: number; readonly next: number } | null {
  // PHP stops at a NUL (its strings are read as C strings here): a reference needs a next char.
  if (at + 1 >= template.length || template.charCodeAt(at + 1) === 0) return null;
  let walk = at;
  const braced = template[walk] === '$' && template[walk + 1] === '{';
  if (braced) walk++;
  walk++;
  const digit = (index: number): number | null => {
    const code = template.charCodeAt(index);
    return code >= 48 && code <= 57 ? code - 48 : null;
  };
  const first = digit(walk);
  if (first === null) return null;
  let group = first;
  walk++;
  const second = digit(walk);
  if (second !== null) {
    group = group * 10 + second;
    walk++;
  }
  if (braced) {
    if (template[walk] !== '}') return null;
    walk++;
  }
  return { group, next: walk };
}

/**
 * Expand a replacement string as PHP's `preg_replace` does
 * (`php_pcre_replace_impl`): a `\` or `$` right after a copied `\` replaces
 * that `\` (so `\\` → `\`, `\$` → `$`); otherwise a back-reference is
 * substituted (a group past `groups` adds nothing); every other character
 * is copied.
 *
 * @param template The replacement string.
 * @param groups The match's groups, group 0 first.
 * @returns The text written in the match's place.
 */
export function expandPhpReplacement(template: string, groups: readonly string[]): string {
  let out = '';
  // The last character copied (PHP's `walk_last`): a reference leaves it as it was.
  let last = '';
  let walk = 0;
  while (walk < template.length) {
    const char = template.charAt(walk);
    if (char === '\\' || char === '$') {
      if (last === '\\') {
        out = out.slice(0, -1) + char;
        walk++;
        last = '';
        continue;
      }
      const reference = backReferenceAt(template, walk);
      if (reference !== null) {
        out += groups[reference.group] ?? '';
        walk = reference.next;
        continue;
      }
    }
    out += char;
    last = char;
    walk++;
  }
  return out;
}
