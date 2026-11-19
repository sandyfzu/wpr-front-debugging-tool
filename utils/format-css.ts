/**
 * A display-only CSS pretty-printer: one declaration per line, blocks
 * indented by nesting. It never parses CSS; it re-flows the text at the
 * structural characters (`{`, `;`, `}`) outside strings, comments, escapes
 * and parentheses (an unquoted `url(data:…;base64,…)` keeps its `;`), and
 * collapses other whitespace runs to one space. Strings and comments stay
 * verbatim. One linear pass, so megabyte inputs cost milliseconds; the
 * output is for reading only (copies take the original text).
 */

/** The indent per nesting level. */
const INDENT = '  ';

/** CSS whitespace (spec: space, tab, line feed, carriage return, form feed). */
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

/**
 * The end index (exclusive) of a quoted string starting at `start`: through
 * the matching quote, honoring backslash escapes; the text's end when it
 * never closes.
 *
 * @param css The text.
 * @param start The opening quote's index.
 */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length) {
    const char = css[index];
    if (char === '\\') index += 2;
    else if (char === quote) return index + 1;
    else index += 1;
  }
  return css.length;
}

/**
 * The end index (exclusive) of a comment starting at `start` (`/*`): past
 * its `*\/`, or the text's end when it never closes.
 *
 * @param css The text.
 * @param start The comment's first index.
 */
function commentEnd(css: string, start: number): number {
  const close = css.indexOf('*/', start + 2);
  return close === -1 ? css.length : close + 2;
}

/**
 * Pretty-print CSS for display.
 *
 * @param css The CSS, as served (minified or not).
 * @returns The re-flowed text (`''` for blank input); no trailing newline.
 */
export function formatCss(css: string): string {
  const lines: string[] = [];
  let line = '';
  let depth = 0;
  let parens = 0;
  /** End the current line at the current depth (blank lines are dropped). */
  const flush = (): void => {
    const text = line.trim();
    if (text !== '') lines.push(INDENT.repeat(depth) + text);
    line = '';
  };

  let index = 0;
  while (index < css.length) {
    const char = css[index] ?? '';
    if (char === '"' || char === "'") {
      const end = stringEnd(css, index);
      line += css.slice(index, end);
      index = end;
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      const end = commentEnd(css, index);
      line += css.slice(index, end);
      index = end;
      continue;
    }
    if (char === '\\') {
      // An escaped character is never structural (`\;`, `\{`).
      line += css.slice(index, index + 2);
      index += 2;
      continue;
    }
    index += 1;
    if (WHITESPACE.has(char)) {
      if (line !== '' && !line.endsWith(' ')) line += ' ';
      continue;
    }
    if (char === '(') parens += 1;
    else if (char === ')') parens = Math.max(0, parens - 1);
    if (parens > 0) {
      line += char;
      continue;
    }
    if (char === '{') {
      line = `${line.trimEnd()} {`;
      flush();
      depth += 1;
    } else if (char === ';') {
      line = `${line.trimEnd()};`;
      flush();
    } else if (char === '}') {
      flush();
      depth = Math.max(0, depth - 1);
      line = '}';
      flush();
    } else {
      line += char;
    }
  }
  flush();
  return lines.join('\n');
}
