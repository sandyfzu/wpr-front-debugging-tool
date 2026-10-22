/**
 * PHP's `strip_tags($text)` with no allowed tags — the state machine of
 * `php_strip_tags_ex` (identical in PHP 8.1 and 8.4), ported step for step
 * because WordPress's `sanitize_text_field` runs it on every row holding a
 * `<`, and its quirks decide what WP Rocket stores:
 * - a `<` followed by whitespace is kept as text (`a < b` survives);
 * - inside a tag, quotes are tracked, so a `>` inside quotes does not end it;
 * - a `<` inside a tag opens a nested level that a later `>` closes;
 * - `<!--…-->` comments, `<!…>` declarations and `<?…?>` blocks are removed;
 * - NUL characters outside tags are dropped.
 *
 * Every decision is on ASCII characters, so running over UTF-16 code units
 * is exactly running over the UTF-8 bytes (a multi-byte sequence never holds
 * an ASCII byte, and both halves of a surrogate pair always take the same
 * path).
 */

/** The machine's states (`php_strip_tags_ex`'s `state` 0–4). */
const enum State {
  /** Plain text: characters are kept. */
  Text,
  /** Inside a tag. */
  Tag,
  /** Inside a `<?…` block (with `<?xml` switching back to a tag). */
  Processing,
  /** Inside a `<!…` declaration. */
  Declaration,
  /** Inside a `<!--…` comment, until `-->`. */
  Comment
}

/** C's `isspace` in the C locale. */
function isCSpace(char: string): boolean {
  return (
    char === ' ' ||
    char === '\t' ||
    char === '\n' ||
    char === '\v' ||
    char === '\f' ||
    char === '\r'
  );
}

/** The character at `index`, or `\0` past the end (PHP reads the string's terminator there). */
function at(text: string, index: number): string {
  return index < text.length ? text.charAt(index) : '\0';
}

/** Whether `text` holds `word` (ASCII, case-insensitive) ending right before `index`. */
function endsWithWordBefore(text: string, index: number, word: string): boolean {
  const start = index - word.length;
  return start >= 0 && text.slice(start, index).toLowerCase() === word;
}

/**
 * Strip tags the way PHP's `strip_tags` does (no allowed tags).
 *
 * @param text The text (UTF-16 view of valid UTF-8).
 * @returns The text with tags, comments and `<?…?>` blocks removed.
 */
export function stripTags(text: string): string {
  let out = '';
  let state: State = State.Text;
  let depth = 0;
  /** The open quote character inside a tag, or `''`. */
  let quote = '';
  /** The last significant character (PHP's `lc`). */
  let last = '\0';
  /** Parenthesis balance inside a `<?…` block (PHP's `br`). */
  let parens = 0;
  /** Inside an `<?xml` tag (PHP's `is_xml`). */
  let xml = false;

  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    const previous = index >= 1 ? text.charAt(index - 1) : '';
    switch (state) {
      case State.Text:
        if (char === '\0') break;
        if (char === '<') {
          if (quote !== '') break;
          if (isCSpace(at(text, index + 1))) {
            out += char;
            break;
          }
          last = '<';
          state = State.Tag;
          break;
        }
        if (char === '>') {
          if (depth > 0) {
            depth--;
            break;
          }
          if (quote !== '') break;
        }
        out += char;
        break;
      case State.Tag:
        if (char === '<') {
          if (quote !== '' || isCSpace(at(text, index + 1))) break;
          depth++;
        } else if (char === '>') {
          if (depth > 0) {
            depth--;
            break;
          }
          if (quote !== '') break;
          last = '>';
          if (xml && previous === '-') break;
          quote = '';
          xml = false;
          state = State.Text;
        } else if (char === '"' || char === "'") {
          if (index !== 0 && (quote === '' || char === quote)) quote = quote === '' ? char : '';
        } else if (char === '!' && previous === '<') {
          state = State.Declaration;
          last = char;
        } else if (char === '?' && previous === '<') {
          parens = 0;
          state = State.Processing;
        }
        break;
      case State.Processing:
        if (char === '(' || char === ')') {
          if (last !== '"' && last !== "'") {
            last = char;
            parens += char === '(' ? 1 : -1;
          }
        } else if (char === '>') {
          if (depth > 0) {
            depth--;
            break;
          }
          if (quote !== '') break;
          if (parens === 0 && last !== '"' && previous === '?') {
            quote = '';
            state = State.Text;
          }
        } else if (char === '"' || char === "'") {
          if (previous !== '\\') {
            if (last === char) last = '\0';
            else if (last !== '\\') last = char;
            if (index !== 0 && (quote === '' || char === quote)) quote = quote === '' ? char : '';
          }
        } else if ((char === 'l' || char === 'L') && index > 4) {
          // `<?xml` is a tag, not a processing block.
          if (text.charAt(index - 4) === '<' && endsWithWordBefore(text, index, '?xm')) {
            state = State.Tag;
            xml = true;
          }
        }
        break;
      case State.Declaration:
        if (char === '>') {
          if (depth > 0) {
            depth--;
            break;
          }
          if (quote !== '') break;
          quote = '';
          state = State.Text;
        } else if (char === '"' || char === "'") {
          if (index !== 0 && previous !== '\\' && (quote === '' || char === quote)) {
            quote = quote === '' ? char : '';
          }
        } else if (char === '-') {
          if (index >= 2 && previous === '-' && text.charAt(index - 2) === '!') {
            state = State.Comment;
          }
        } else if ((char === 'e' || char === 'E') && index > 6) {
          // `<!DOCTYPE` is read as a tag.
          if (endsWithWordBefore(text, index, 'doctyp')) state = State.Tag;
        }
        break;
      case State.Comment:
        if (char === '>' && quote === '' && previous === '-' && at(text, index - 2) === '-') {
          quote = '';
          state = State.Text;
        }
        break;
    }
  }
  return out;
}
