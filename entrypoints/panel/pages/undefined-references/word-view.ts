/**
 * The Undefined References list's rows and views (pure). A row is the word
 * alone — a stable identity per word, so a row's DOM (and focus) survives
 * while its answer streams in; the page derives the word's current view
 * (answer + verdict) reactively, and this module says what the calm row shows
 * of it (the defining-script count, a one-line preview of where it may be
 * defined), the detail's kind label, and what each definition's copy action
 * carries. No Solid, no DOM: the page renders these.
 */
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import type { ResourcePageDefinition } from '../../../../lib/panel/resources-view-model';
import { recoverOriginalScript } from '../../../../lib/wp-rocket/minify-url-recovery';
import {
  displayWord,
  exclusionPattern,
  exclusionPatternFromOriginalPath,
  isCrossOriginSentinel,
  splitScriptUrl,
  verdictText,
  wordVerdict,
  type DefinitionAnswer,
  type WordVerdict
} from './model';

/**
 * One listed word as the calm list keys it: identity only. Its answer is
 * read live (see {@link WordRowView}), so a changed answer never replaces the
 * row — the list would rebuild a replaced row's DOM, dropping focus from a
 * row the keyboard is on while the search reaches it.
 */
export interface WordRow {
  /** The row key: the word itself (the store lists each word once). */
  readonly key: string;
  /** The word (page-controlled text; rendered as text only). */
  readonly word: string;
}

/**
 * A listed word's row.
 *
 * @param word The word.
 * @returns The row.
 */
export function wordRow(word: string): WordRow {
  return { key: word, word };
}

/** One listed word's current answer, as the row cells and the detail state it. */
export interface WordRowView {
  /** The row key: the word itself (the store lists each word once). */
  readonly key: string;
  /** The word (page-controlled text; rendered as text only). */
  readonly word: string;
  /** Its search answer (origins keep their identity across re-reads). */
  readonly answer: DefinitionAnswer;
  /** The verdict the row and the detail state. */
  readonly verdict: WordVerdict;
}

/**
 * Build a word's row view.
 *
 * @param word The listed word.
 * @param answer Its search answer.
 * @param unreadable Scripts the read skipped (softens a not-found verdict).
 * @param inlineCut The inline scripts reached the panel cut to size (same).
 * @returns The view.
 */
export function wordRowView(
  word: string,
  answer: DefinitionAnswer,
  unreadable: number,
  inlineCut: boolean
): WordRowView {
  return { key: word, word, answer, verdict: wordVerdict(word, answer, unreadable, inlineCut) };
}

/**
 * The count column: how many scripts may define the word — the answer's
 * length once searched ("0" when the search found none); nothing while the
 * search has not reached it, when no search runs, or for the cross-origin
 * error (no name to search).
 *
 * @param view The row.
 * @returns The cell text, or `undefined` for an empty cell.
 */
export function wordDefinitionCount(view: WordRowView): string | undefined {
  const verdict = view.verdict;
  if (verdict.kind === 'found') return String(verdict.count);
  if (verdict.kind === 'not-found') return '0';
  return undefined;
}

/** Definitions the row's preview names before folding the rest into "+N more". */
export const PREVIEW_DEFINITIONS = 3;

/** The label an inline definition carries (it has no URL to name it by). */
export const INLINE_DEFINITION_LABEL = 'Inline script';

/**
 * One definition's short label: a script file's name (the identifying part,
 * the query dropped), or the inline label.
 *
 * @param origin The definition.
 * @param pageOrigin The inspected page's origin, or `null`.
 * @returns The label.
 */
export function definitionLabel(origin: ScriptOrigin, pageOrigin: string | null): string {
  return origin.kind === 'url'
    ? splitScriptUrl(origin.url, pageOrigin).file
    : INLINE_DEFINITION_LABEL;
}

/**
 * The row's one-line preview: where the word may be defined (the first
 * {@link PREVIEW_DEFINITIONS} labels, then "+N more"), or the verdict's own
 * words when there is no definition to name.
 *
 * @param view The row.
 * @param pageOrigin The inspected page's origin, or `null`.
 * @returns The preview text.
 */
export function wordPreview(view: WordRowView, pageOrigin: string | null): string {
  const answer = view.answer;
  if (view.verdict.kind !== 'found' || answer === null || answer === 'pending') {
    return verdictText(view.verdict);
  }
  const named = answer
    .slice(0, PREVIEW_DEFINITIONS)
    .map((origin) => definitionLabel(origin, pageOrigin))
    .join(' · ');
  const rest = answer.length - PREVIEW_DEFINITIONS;
  return rest > 0 ? `${named} · +${String(rest)} more` : named;
}

/**
 * The detail's caps label: what kind of report the row is.
 *
 * @param row The row.
 * @returns The label.
 */
export function wordKind(row: WordRow): string {
  return isCrossOriginSentinel(row.word) ? 'Cross-origin error' : 'Undefined reference';
}

/**
 * The searched text of a row: the word as shown (the sentinel reads as its message).
 *
 * @param row The row.
 * @returns The searched text.
 */
export function wordSearchField(row: WordRow): string {
  return displayWord(row.word);
}

/**
 * The list's filter input: one identity chip (the bar then shows the search
 * field alone — the words have no dimension worth a chip) and the searched
 * field, so the page joins the panel's one search/find protocol.
 */
export const WORD_LIST: ResourcePageDefinition<WordRow, 'all'> = {
  filters: [{ id: 'all', label: 'All', predicate: () => true }],
  searchField: wordSearchField
};

/**
 * What a script definition's copy action carries:
 * - `pattern` — the Delay JS exclusion to copy;
 * - `combined` — the script ships in WP Rocket's combined bundle (no
 *   original path to copy; the detail explains the remedy instead);
 * - `none` — not an http(s) URL (nothing to exclude it by).
 */
export type DefinitionCopy =
  | { readonly kind: 'pattern'; readonly pattern: string }
  | { readonly kind: 'combined' }
  | { readonly kind: 'none' };

/**
 * Decide a script definition's copy action. The payload names the script's
 * ORIGINAL path: a served minified URL recovers the path its cache URL
 * mirrors (page-origin composed when the host is the site's own; hostless
 * for a host the URL hides — a host the URL does not carry is never
 * fabricated, and the path alone matches both minify states).
 *
 * @param url The definition's script URL (page-derived).
 * @param pageOrigin The inspected page's origin, or `null`.
 * @returns The copy action.
 */
export function definitionCopy(url: string, pageOrigin: string | null): DefinitionCopy {
  const recovered = recoverOriginalScript(url);
  if (recovered.kind === 'combined') return { kind: 'combined' };
  let pattern: string | null;
  if (recovered.kind === 'untouched') {
    pattern = exclusionPattern(url, pageOrigin);
  } else if (recovered.hostKnown === 'site' && pageOrigin !== null) {
    pattern = exclusionPattern(`${pageOrigin}/${recovered.originalPath}`, pageOrigin);
  } else {
    pattern = exclusionPatternFromOriginalPath(recovered.originalPath);
  }
  return pattern === null ? { kind: 'none' } : { kind: 'pattern', pattern };
}
