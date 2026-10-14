/**
 * The Undefined References page's pure model: the script-scan state machine,
 * the page-view resolver (which state body renders), the per-word verdict,
 * the copy builders, the script URL display split and the exclusion pattern.
 * No Solid, no DOM, no browser API — the store wires these to signals, the
 * components render them.
 */
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import type { ScriptAsset, ScriptOrigin } from '../../../../lib/panel/undefined-refs';

/** Why a script scan failed — each maps to its own user-facing remedy. */
export type ScanFailure = 'list-failed' | 'timed-out' | 'context-invalidated';

/**
 * The script scan's lifecycle (reading the inspected page's scripts, so every
 * word can be searched against them).
 *
 * - `idle` — not started (no words yet, Delay JS still holds the scripts, or
 *   a new page landed with nothing to search).
 * - `scanning` — a read is in flight. `previous` keeps the last asset list so
 *   the cards stay on screen while it runs (a user rescan, or a refresh of
 *   the page's data); `null` on a first read or a retry. `keepOnFailure`
 *   says what a failed read leaves: the kept assets (a user rescan of the
 *   same page — they still describe it) or the failure (a data refresh — the
 *   page may have changed, so its old assets are no longer trusted).
 * - `scanned` — the asset list every definition search runs over.
 * - `failed` — the read failed; Retry starts a fresh read.
 * - `unsupported` — this browser cannot list the inspected page's scripts;
 *   terminal (the page still lists the words, unsearched).
 */
export type ScanState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'scanning';
      readonly previous: readonly ScriptAsset[] | null;
      readonly keepOnFailure: boolean;
    }
  | { readonly kind: 'scanned'; readonly assets: readonly ScriptAsset[] }
  | { readonly kind: 'failed'; readonly failure: ScanFailure }
  | { readonly kind: 'unsupported' };

/** What can happen to a scan. */
export type ScanEvent =
  /** User start: first read, retry, or rescan — the state decides which. */
  | { readonly type: 'start' }
  /** The page's data was refetched: read again, keeping the cards up meanwhile. */
  | { readonly type: 'refresh' }
  /** The in-flight read answered. */
  | { readonly type: 'settled'; readonly assets: readonly ScriptAsset[] }
  /** The in-flight read failed. */
  | { readonly type: 'failed'; readonly failure: ScanFailure }
  /** Nothing to search on the new data: drop the read and its assets. */
  | { readonly type: 'reset' };

/** The shared idle state (states are immutable, so one instance serves all). */
export const SCAN_IDLE: ScanState = { kind: 'idle' };

/** The shared unsupported state. */
export const SCAN_UNSUPPORTED: ScanState = { kind: 'unsupported' };

/**
 * The scan transition table — total and pure: every (state, event) pair has
 * a result, and a trigger that cannot apply returns the same state object
 * (callers detect "nothing happened" by identity; a returned `scanning`
 * object that is new means "start a read").
 *
 * - `start` from `idle`/`failed` reads with nothing to show meanwhile; from
 *   `scanned` it is a rescan keeping the assets (and keeping them if it
 *   fails); while scanning (dedupe) or `unsupported` it does nothing.
 * - `refresh` always restarts a read (a fresh object) from a state that has
 *   or awaits assets, keeping whatever assets exist on screen; a failure of
 *   that read is reported, not papered over. From `idle`/`failed` it is a
 *   plain first read.
 * - `failed` falls back to the kept assets only when `keepOnFailure`.
 * - `reset` returns to `idle` from anywhere but `unsupported`.
 *
 * @param state The current scan state.
 * @param event The event to apply.
 * @returns The next state (the same object when the event does not apply).
 */
export function transitionScan(state: ScanState, event: ScanEvent): ScanState {
  switch (event.type) {
    case 'start':
      if (state.kind === 'idle' || state.kind === 'failed') {
        return { kind: 'scanning', previous: null, keepOnFailure: false };
      }
      if (state.kind === 'scanned') {
        return { kind: 'scanning', previous: state.assets, keepOnFailure: true };
      }
      return state;
    case 'refresh':
      if (state.kind === 'unsupported') return state;
      return {
        kind: 'scanning',
        previous: searchableAssets(state),
        keepOnFailure: false
      };
    case 'settled':
      return state.kind === 'scanning' ? { kind: 'scanned', assets: event.assets } : state;
    case 'failed':
      if (state.kind !== 'scanning') return state;
      return state.keepOnFailure && state.previous !== null
        ? { kind: 'scanned', assets: state.previous }
        : { kind: 'failed', failure: event.failure };
    case 'reset':
      return state.kind === 'unsupported' || state.kind === 'idle' ? state : SCAN_IDLE;
  }
}

/**
 * The asset list definitions are answered from: the scanned list, or the
 * kept one during a read; `null` while there is nothing to search with.
 *
 * @param state The scan state.
 * @returns The current asset list, or `null`.
 */
export function searchableAssets(state: ScanState): readonly ScriptAsset[] | null {
  if (state.kind === 'scanned') return state.assets;
  if (state.kind === 'scanning') return state.previous;
  return null;
}

/** The facts the page body is chosen from. */
export interface PageViewInput {
  /** The page runs WP Rocket's Delay JavaScript execution. */
  readonly delayJsPresent: boolean;
  /** Delay JS reported every held script as loaded. */
  readonly allScriptsLoaded: boolean;
  /** How many undefined-reference words the page reported. */
  readonly wordCount: number;
  /** The script scan's state. */
  readonly scan: ScanState;
}

/** Which state body the page renders. */
export type PageView =
  /** Delay JS still holds the scripts: nothing has run that could fail yet. */
  | { readonly kind: 'waiting-interaction' }
  /** Words exist and the first script read is in flight (a real wait). */
  | { readonly kind: 'processing' }
  /** Words exist and the read failed: the words list unsearched under the error. */
  | { readonly kind: 'failed'; readonly failure: ScanFailure }
  /** No words; `monitoring` while scripts may still produce some. */
  | { readonly kind: 'empty'; readonly monitoring: boolean }
  /** The word cards; `searched` is false when this browser cannot search. */
  | { readonly kind: 'results'; readonly searched: boolean };

/**
 * Resolve the page body. Order matters:
 *
 * 1. Delay JS present and its scripts not loaded → wait for interaction
 *    (no script has run, so nothing can be undefined yet).
 * 2. No words → the empty state; no read is needed (or made) to know that.
 *    While Delay JS has not reported its scripts loaded the capture is still
 *    watching, which the empty state says.
 * 3. Words, read failed → the words unsearched under the error.
 * 4. Words, no asset list yet → processing (the real read only).
 * 5. Otherwise the results (unsearched when the browser cannot list scripts).
 *
 * @param input The page facts.
 * @returns The view to render.
 */
export function resolvePageView(input: PageViewInput): PageView {
  if (input.delayJsPresent && !input.allScriptsLoaded) return { kind: 'waiting-interaction' };
  if (input.wordCount === 0) return { kind: 'empty', monitoring: !input.allScriptsLoaded };
  const scan = input.scan;
  if (scan.kind === 'failed') return { kind: 'failed', failure: scan.failure };
  if (scan.kind === 'unsupported') return { kind: 'results', searched: false };
  if (searchableAssets(scan) === null) return { kind: 'processing' };
  return { kind: 'results', searched: true };
}

/**
 * One word's search answer as the store hands it to the card: its origins,
 * `'pending'` while the cooperative search has not reached it, `null` when
 * no search runs (no asset list: feature absent or the read failed).
 */
export type DefinitionAnswer = readonly ScriptOrigin[] | 'pending' | null;

/** One word's answer, as the card states it. */
export type WordVerdict =
  /** Possible definitions exist (`count` origins). */
  | { readonly kind: 'found'; readonly count: number }
  /** The search ran and found nothing. */
  | { readonly kind: 'not-found' }
  /** The search has not reached this word yet. */
  | { readonly kind: 'searching' }
  /** The browser redacted a cross-origin error: there is no name to search. */
  | { readonly kind: 'hidden' }
  /** No search runs (feature absent, or the read failed). */
  | { readonly kind: 'not-searched' };

/**
 * Whether a word is the cross-origin sentinel (the browser reported only
 * "Script error." for an error thrown by a script from another origin).
 *
 * @param word A word from the page.
 * @returns True for the sentinel.
 */
export function isCrossOriginSentinel(word: string): boolean {
  return word === UNDEFINED_REFERENCE_EXTERNAL_ERROR;
}

/**
 * The word as the card shows it: the sentinel reads as the browser's own
 * message, every other word verbatim.
 *
 * @param word A word from the page.
 * @returns The display text.
 */
export function displayWord(word: string): string {
  return isCrossOriginSentinel(word) ? 'Script error.' : word;
}

/**
 * A word's verdict from its search answer.
 *
 * @param word The word (the sentinel is always `hidden`).
 * @param answer The search answer.
 * @returns The verdict.
 */
export function wordVerdict(word: string, answer: DefinitionAnswer): WordVerdict {
  if (isCrossOriginSentinel(word)) return { kind: 'hidden' };
  if (answer === null) return { kind: 'not-searched' };
  if (answer === 'pending') return { kind: 'searching' };
  return answer.length > 0 ? { kind: 'found', count: answer.length } : { kind: 'not-found' };
}

/**
 * The verdict's visible text (status is never color alone).
 *
 * @param verdict The verdict.
 * @returns The card header's right-hand text.
 */
export function verdictText(verdict: WordVerdict): string {
  switch (verdict.kind) {
    case 'found':
      return `In ${String(verdict.count)} ${verdict.count === 1 ? 'script' : 'scripts'}`;
    case 'not-found':
      return 'No definition found';
    case 'searching':
      return 'Searching…';
    case 'hidden':
      return 'Details hidden';
    case 'not-searched':
      return 'Not searched';
  }
}

/**
 * The polite announcement for words that arrived while the page was open.
 *
 * @param added How many new words arrived (≥ 1).
 * @returns The sentence for the page's status region.
 */
export function newReferencesAnnouncement(added: number): string {
  return added === 1 ? '1 new undefined reference' : `${String(added)} new undefined references`;
}

/**
 * The words in `next` that `known` has not seen, in arrival order.
 *
 * @param known The words already reported.
 * @param next The current word list.
 * @returns The new words (empty when nothing arrived).
 */
export function arrivedWords(known: ReadonlySet<string>, next: readonly string[]): string[] {
  return next.filter((word) => !known.has(word));
}

/**
 * The word list without repeats, first occurrence kept. The capture already
 * merges uniquely; repeating the guard here keeps the keyed card list valid
 * against any payload.
 *
 * @param words The page's words.
 * @returns The same array when it has no repeats, else a deduplicated copy.
 */
export function uniqueWords(words: readonly string[]): readonly string[] {
  const set = new Set(words);
  return set.size === words.length ? words : [...set];
}

/** Counts for the results summary line. */
export interface ResultsSummary {
  /** Undefined names listed (the cross-origin sentinel is not one). */
  readonly undefinedNames: number;
  /** Names with at least one possible definition. */
  readonly withDefinition: number;
  /** Whether a cross-origin "Script error." card is listed too. */
  readonly crossOriginError: boolean;
}

/**
 * Count the results summary in one pass.
 *
 * @param words The listed words.
 * @param answerOf The search answer per word.
 * @returns The counts.
 */
export function summarizeResults(
  words: readonly string[],
  answerOf: (word: string) => DefinitionAnswer
): ResultsSummary {
  let undefinedNames = 0;
  let withDefinition = 0;
  let crossOriginError = false;
  for (const word of words) {
    if (isCrossOriginSentinel(word)) {
      crossOriginError = true;
      continue;
    }
    undefinedNames += 1;
    if (wordVerdict(word, answerOf(word)).kind === 'found') withDefinition += 1;
  }
  return { undefinedNames, withDefinition, crossOriginError };
}

/**
 * The user-facing sentence naming a scan failure and its remedy.
 *
 * @param failure The failure.
 * @returns One sentence for the error notice or the rescan toast.
 */
export function scanFailureMessage(failure: ScanFailure): string {
  switch (failure) {
    case 'list-failed':
      return "DevTools could not list the inspected page's scripts.";
    case 'timed-out':
      return "DevTools did not return the inspected page's scripts in time.";
    case 'context-invalidated':
      return 'The extension was reloaded, so this panel lost its connection. Close and reopen DevTools to reconnect.';
  }
}

/**
 * Whether a failure can be retried from this panel. An extension reload
 * invalidates every API call this panel makes until DevTools reopens it, so
 * a Retry there could never succeed.
 *
 * @param failure The failure.
 * @returns True when Retry is offered.
 */
export function isRetryable(failure: ScanFailure): boolean {
  return failure !== 'context-invalidated';
}

/**
 * Classify a scan rejection. An extension reload invalidates every API call
 * from this panel with a message naming it; everything else is a plain
 * listing failure.
 *
 * @param cause The rejection value.
 * @returns The failure kind.
 */
export function classifyScanError(cause: unknown): ScanFailure {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return /extension context invalidated/i.test(message) ? 'context-invalidated' : 'list-failed';
}

/** Parse an absolute `http(s):` URL, or `null` for anything else. */
function parseHttpUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
}

/** A script URL split for display, the way a network panel lists requests. */
export interface ScriptUrlParts {
  /** The file (last path segment, no query) — e.g. `jquery.min.js`. */
  readonly file: string;
  /** The query, shown muted after the file — e.g. `?ver=3.7.1`; empty when none. */
  readonly query: string;
  /**
   * Where the file lives: the directory path, prefixed by the host when the
   * script is not from the inspected page's origin (or that origin is
   * unknown) — e.g. `/wp-includes/js/jquery/`, `cdn.example.com/js/`.
   */
  readonly location: string;
}

/**
 * Split a script URL for display. A truncated full URL hides the file name
 * behind the ellipsis on narrow panels, and the inspected page's own host is
 * noise on every row, so it is dropped (the plugin slug in the path then
 * survives narrow widths). A non-http(s) or file-less URL keeps its whole
 * text as the `file`.
 *
 * @param url The script URL (page-derived; parsed, never fetched).
 * @param pageOrigin The inspected page's origin, or `null` when unknown.
 * @returns The display parts.
 */
export function splitScriptUrl(url: string, pageOrigin: string | null): ScriptUrlParts {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return { file: url, query: '', location: '' };
  const path = parsed.pathname;
  const cut = path.lastIndexOf('/');
  const file = path.slice(cut + 1);
  if (file === '') return { file: url, query: '', location: '' };
  const directory = path.slice(0, cut + 1);
  return {
    file,
    query: parsed.search,
    location: parsed.origin === pageOrigin ? directory : `${parsed.host}${directory}`
  };
}

/**
 * Characters that are syntax in a regular expression. In an exclusion they
 * are replaced by `.` (any character, so it still matches the literal) —
 * escaping is not portable: WP Rocket itself escapes `+`, `?ver` and `#`
 * before matching, so a pre-escaped `\+` would turn into a broken `\\+`.
 */
const EXCLUSION_UNSAFE = /[\\^$*+?()[\]{}|#]/g;

/**
 * The Delay JS exclusion for a script: the part of its URL that identifies
 * it and survives updates — its path (no scheme, no query: a baked-in
 * `?ver=` stops matching after the next plugin update, and the `?` is regex
 * syntax), with the host in front when the script comes from another origin.
 * A path without a file keeps its query so the pattern is not a bare `/`.
 *
 * Exclusions are regular expressions matched against the whole script tag —
 * by WP Rocket (after escaping `+`, `?ver`, `#`, as `#…#i`, where `&` in the
 * tag reads `&#038;`) and by a plain `new RegExp(…)`. The returned text
 * matches its own tag under both: it holds no regex syntax except `.`,
 * which matches itself.
 *
 * @param url The script URL.
 * @param pageOrigin The inspected page's origin, or `null` when unknown
 *   (then the host is always kept — it matches absolute `src` values).
 * @returns The exclusion text, or `null` for a non-http(s) URL.
 */
export function exclusionPattern(url: string, pageOrigin: string | null): string | null {
  const parsed = parseHttpUrl(url);
  if (parsed === null) return null;
  const path = parsed.pathname;
  const fileless = path.endsWith('/');
  const tail = fileless ? `${path}${parsed.search}` : path;
  const pattern = parsed.origin === pageOrigin && !fileless ? tail : `${parsed.host}${tail}`;
  return pattern.replace(EXCLUSION_UNSAFE, '.');
}

/** Two origins name the same script (or both the inline stack). */
function sameOrigin(left: ScriptOrigin, right: ScriptOrigin): boolean {
  if (left.kind === 'url' && right.kind === 'url') return left.url === right.url;
  return left.kind === right.kind;
}

/**
 * Carry a word's previous answer objects into its new answer: an unchanged
 * answer comes back as the very same array, and every origin that was
 * already listed keeps its object. Keyed rows then stay mounted across a
 * re-read (focus on a row's control survives a refresh); only rows that
 * really appeared or went away change.
 *
 * @param previous The answer shown before, if any.
 * @param next The freshly searched answer.
 * @returns `previous` when equal, else `next` with known origins reused.
 */
export function reconcileOrigins(
  previous: readonly ScriptOrigin[] | undefined,
  next: readonly ScriptOrigin[]
): readonly ScriptOrigin[] {
  if (previous === undefined) return next;
  if (
    previous.length === next.length &&
    previous.every((origin, index) => {
      const other = next[index];
      return other !== undefined && sameOrigin(origin, other);
    })
  ) {
    return previous;
  }
  return next.map((origin) => previous.find((known) => sameOrigin(known, origin)) ?? origin);
}
