/**
 * The Undefined References page's pure model: the script-scan state machine,
 * the page-view resolver (which of the five state bodies renders), the
 * per-word verdict, and the page's copy builders. No Solid, no DOM, no
 * browser API — the store wires these to signals, the components render them.
 */
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../../../../lib/wp-rocket/constants';
import type { ScriptAsset, ScriptOrigin } from '../../../../lib/panel/undefined-refs';

/** Why a script scan failed — each maps to its own user-facing remedy. */
export type ScanFailure = 'list-failed' | 'timed-out' | 'context-invalidated';

/**
 * The script scan's lifecycle (reading the inspected page's scripts once, so
 * every word can be searched against them).
 *
 * - `idle` — not started (Delay JS still holds the scripts, or a new page
 *   just landed).
 * - `scanning` — a read is in flight. `previous` keeps the last good asset
 *   list during a user rescan, so results stay on screen (refresh is
 *   invisible); it is `null` on a first scan or a retry.
 * - `scanned` — the asset list every definition search runs over.
 * - `failed` — the read failed; Retry starts a fresh scan.
 * - `unsupported` — this browser cannot list the inspected page's scripts;
 *   terminal (the page still lists the words, unsearched).
 */
export type ScanState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'scanning'; readonly previous: readonly ScriptAsset[] | null }
  | { readonly kind: 'scanned'; readonly assets: readonly ScriptAsset[] }
  | { readonly kind: 'failed'; readonly failure: ScanFailure }
  | { readonly kind: 'unsupported' };

/** What can happen to a scan. */
export type ScanEvent =
  /** Start (first scan, retry, or rescan — the state decides which). */
  | { readonly type: 'start' }
  /** The in-flight read answered. */
  | { readonly type: 'settled'; readonly assets: readonly ScriptAsset[] }
  /** The in-flight read failed. */
  | { readonly type: 'failed'; readonly failure: ScanFailure }
  /** A new page's data landed: the old asset list no longer describes it. */
  | { readonly type: 'reset' };

/** The shared idle state (states are immutable, so one instance serves all). */
export const SCAN_IDLE: ScanState = { kind: 'idle' };

/** The shared unsupported state. */
export const SCAN_UNSUPPORTED: ScanState = { kind: 'unsupported' };

/**
 * The scan transition table — total and pure: every (state, event) pair has
 * a result, and a trigger that cannot apply returns the same state object
 * (callers detect "nothing happened" by identity).
 *
 * - `start` from `idle`/`failed` scans with nothing to show meanwhile; from
 *   `scanned` it is a rescan that keeps the current assets visible; while
 *   already scanning (dedupe) or `unsupported` it does nothing.
 * - `failed` during a rescan falls back to the kept assets — a failed
 *   refresh never throws away good results (the store reports it apart).
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
        return { kind: 'scanning', previous: null };
      }
      if (state.kind === 'scanned') return { kind: 'scanning', previous: state.assets };
      return state;
    case 'settled':
      return state.kind === 'scanning' ? { kind: 'scanned', assets: event.assets } : state;
    case 'failed':
      if (state.kind !== 'scanning') return state;
      return state.previous === null
        ? { kind: 'failed', failure: event.failure }
        : { kind: 'scanned', assets: state.previous };
    case 'reset':
      return state.kind === 'unsupported' || state.kind === 'idle' ? state : SCAN_IDLE;
  }
}

/**
 * The asset list definitions are answered from: the scanned list, or the
 * kept one during a rescan; `null` while there is nothing to search with.
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
  /** Words exist and the script read failed. */
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
 * 2. No words → the empty state; no scan is needed to know that, so it never
 *    waits on one. While Delay JS has not reported its scripts loaded the
 *    capture is still watching, which the empty state says.
 * 3. Words, scan failed → the error body with Retry.
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

/** One word's answer, as the card states it. */
export type WordVerdict =
  /** Possible definitions exist (`count` origins). */
  | { readonly kind: 'found'; readonly count: number }
  /** The search ran and found nothing. */
  | { readonly kind: 'not-found' }
  /** The browser redacted a cross-origin error: there is no name to search. */
  | { readonly kind: 'hidden' }
  /** This browser cannot search (no asset list). */
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
 * @param definitions The search answer, or `null` when no search ran.
 * @returns The verdict.
 */
export function wordVerdict(
  word: string,
  definitions: readonly ScriptOrigin[] | null
): WordVerdict {
  if (isCrossOriginSentinel(word)) return { kind: 'hidden' };
  if (definitions === null) return { kind: 'not-searched' };
  return definitions.length > 0
    ? { kind: 'found', count: definitions.length }
    : { kind: 'not-found' };
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
  /** Words listed. */
  readonly total: number;
  /** Words with at least one possible definition. */
  readonly withDefinition: number;
}

/**
 * Count the results summary in one pass.
 *
 * @param words The listed words.
 * @param definitionsOf The search answer per word (`null` = not searched).
 * @returns The counts.
 */
export function summarizeResults(
  words: readonly string[],
  definitionsOf: (word: string) => readonly ScriptOrigin[] | null
): ResultsSummary {
  let withDefinition = 0;
  for (const word of words) {
    if (wordVerdict(word, definitionsOf(word)).kind === 'found') withDefinition += 1;
  }
  return { total: words.length, withDefinition };
}

/**
 * The user-facing sentence naming a scan failure and its remedy.
 *
 * @param failure The failure.
 * @returns One sentence for the error body or the rescan toast.
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

/** A script URL split for display: the file (what identifies it) and where it lives. */
export interface ScriptUrlParts {
  /** The last path segment plus the query (e.g. `jquery.min.js?ver=3.7.1`). */
  readonly name: string;
  /** Host and directory path (e.g. `example.com/wp-includes/js/jquery/`); empty when unknown. */
  readonly location: string;
}

/**
 * Split a script URL into its file name and location, the way a network
 * panel lists requests: a truncated full URL would hide the file name behind
 * the ellipsis on narrow panels. A URL without a file segment, a non-http(s)
 * URL, or one that does not parse keeps its whole text as the name.
 *
 * @param url The script URL (page-derived; parsed, never fetched).
 * @returns The display parts.
 */
export function splitScriptUrl(url: string): ScriptUrlParts {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { name: url, location: '' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return { name: url, location: '' };
  const path = parsed.pathname;
  const cut = path.lastIndexOf('/');
  const file = path.slice(cut + 1);
  if (file === '') return { name: url, location: '' };
  return { name: `${file}${parsed.search}`, location: `${parsed.host}${path.slice(0, cut + 1)}` };
}
