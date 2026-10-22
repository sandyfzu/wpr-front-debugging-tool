/**
 * The exclusion-builder session contract: what crosses the overlay ↔
 * background ↔ panel boundaries and what the session stores persist — the
 * exclusion set's wire bounds, the session states, the reasons interception
 * can be unavailable, and the per-document outcomes. Declared once here;
 * the set, report and invalid-row shapes themselves are the engine's
 * (`lib/exclusion-builder`), re-validated — never re-declared.
 *
 * Every guard returns the freshly rebuilt value or `null` (never throws),
 * reading own properties only (an inherited field is not a field).
 * Messages are guarded with `'reject'` (both ends ship in one build, so an
 * unknown key is drift or forgery); storage reads use `'ignore'` (a value
 * written by a newer build keeps parsing — unknown keys are dropped, never
 * carried).
 *
 * Writers: the background is the only writer of both session stores; the
 * overlay reads and saves its origin's set through the background
 * (`getSavedExclusionSet` / `saveExclusionSet`), never `local:` directly —
 * that area holds every origin's sets. An apply saves the set for the
 * sender's origin only when it answers `applying`; `invalid` and
 * `unavailable` save nothing.
 */
import type { InvalidExclusionRow } from '../exclusion-builder/errors';
import { PROBLEM_IDS } from '../exclusion-builder/pcre/problems';
import type { ExclusionRowMatch, TransformReport } from '../exclusion-builder/report';
import {
  EXCLUSION_FEATURES,
  type ExclusionFeatureId,
  type ExclusionSet,
  type ExclusionSetRows,
  type ExclusionSetToggles
} from '../exclusion-builder/set';
import { isRecord, ownValue } from '../../utils/is-record';
import { isHttpOrigin, isHttpUrl, parseUrl } from '../../utils/urls';
import { isPrintable } from './error-words';
import { numericTabId } from './sender';

/** Characters per row — declared once: the reason cap derives from it. */
const ROW_CHARS = 2048;

/**
 * Size caps of one exclusion set, shared by every boundary that carries one
 * (apply/save requests, session status, both stores). Generous for
 * hand-written exclusion lists (dozens of short rows); `totalChars` is the
 * binding cap — printable rows serialize to ≤ 3 UTF-8 bytes per char, so a
 * worst-case set stays under ~200 KiB of JSON, the figure the stores'
 * budgets build on.
 */
export const EXCLUSION_SET_LIMITS = {
  /** Rows per feature list (the editor virtualizes well below this). */
  rowsPerFeature: 500,
  /** Characters per row. */
  rowChars: ROW_CHARS,
  /** Characters summed over every row of the set. */
  totalChars: 64 * 1024,
  /**
   * Characters of one invalid-row reason: a whole row plus room for the
   * engine's own words, so even a reason that echoes its row fits
   * ({@link invalidApplyReply} truncates anything longer).
   */
  reasonChars: ROW_CHARS + 512,
  /** Characters of a session's origin (an http(s) origin — host names cap at 253). */
  originChars: 512
} as const;

/** How a guard treats keys it does not know (see the module doc). */
export type UnknownKeyPolicy = 'reject' | 'ignore';

/**
 * Why interception cannot run for a tab, with whether retrying can help —
 * the one declaring site of the unavailable causes (UI copy maps over it).
 *
 * - `attach-denied` — the browser refused the debugger attach (another
 *   client holds the tab exclusively, a transient browser refusal).
 * - `debugging-policy` — a managed-browser policy forbids debugging.
 * - `infobar-cancelled` — the user cancelled the browser's "started
 *   debugging" infobar, ending interception.
 * - `detached` — the browser ended interception for another reason while
 *   the tab lived on (the debug target went away, e.g. a renderer crash).
 * - `unsupported-page` — this page cannot be intercepted (not an http(s)
 *   top-level document, a browser-internal or store page).
 * - `unsupported-browser` — this build/browser lacks the interception API.
 * - `session-limit` — the concurrent live-session cap is reached; stopping
 *   a session in another tab frees a slot.
 */
export const INTERCEPTION_UNAVAILABLE_CAUSES = {
  'attach-denied': { retryable: true },
  'debugging-policy': { retryable: false },
  'infobar-cancelled': { retryable: true },
  detached: { retryable: true },
  'unsupported-page': { retryable: false },
  'unsupported-browser': { retryable: false },
  'session-limit': { retryable: true }
} as const satisfies Record<string, { readonly retryable: boolean }>;

/** One reason interception is unavailable (see {@link INTERCEPTION_UNAVAILABLE_CAUSES}). */
export type InterceptionUnavailableCause = keyof typeof INTERCEPTION_UNAVAILABLE_CAUSES;

/**
 * Why one intercepted document was served unmodified (the session itself
 * stays active): its body could not be read, it could not be decoded with
 * its declared charset, the rewritten text could not be encoded back into
 * that charset, the engine failed unexpectedly, or the rewrite could not be
 * delivered (`not-served`: the browser had already dropped the response —
 * its navigation abandoned or the session ended first — so whatever the
 * page shows was not served by the session). Additive: a newer
 * build's reason fails an older build's guard (its read-back drops that
 * record — never a fabricated one).
 */
export const EXCLUSION_DOCUMENT_FAILURES = [
  'body-unavailable',
  'decode-failed',
  'encode-failed',
  'engine-failed',
  'not-served'
] as const;

/** One unmodified-document reason (see {@link EXCLUSION_DOCUMENT_FAILURES}). */
export type ExclusionDocumentFailure = (typeof EXCLUSION_DOCUMENT_FAILURES)[number];

/** Upper bound of a reported engine wall-time budget (a sanity cap, not the budget). */
const MAX_BUDGET_MS = 600_000;

/**
 * What happened to the last top-level document the session intercepted.
 *
 * - `rewritten` — the engine ran; one report per transform, pipeline order.
 * - `over-budget` — the engine overran its wall-time budget; the document
 *   was served unmodified. Names the feature (and the row, when the
 *   overrun is attributable to one; `null` for a feature-wide run).
 * - `failed` — served unmodified for a {@link ExclusionDocumentFailure}.
 */
export type ExclusionDocumentOutcome = (
  | { readonly outcome: 'rewritten'; readonly reports: readonly TransformReport[] }
  | {
      readonly outcome: 'over-budget';
      readonly feature: ExclusionFeatureId;
      readonly row: string | null;
      readonly budgetMs: number;
    }
  | { readonly outcome: 'failed'; readonly reason: ExclusionDocumentFailure }
) & {
  /** Which response the outcome is for and what the session did to it (absent when the backend gives no identity). */
  readonly served?: ExclusionServedDocument;
};

/** Size caps of a {@link ExclusionServedDocument}. */
export const SERVED_DOCUMENT_LIMITS = {
  /** Characters of the document's origin + path (longer paths are cut — the digest stays exact). */
  urlPathChars: 2048,
  /** Characters of the backend's response token. */
  tokenChars: 128,
  /** Rule scripts counted as removed from one document. */
  speculationRules: 10_000
} as const;

/** What the session did about one document's speculation rules (prefetch / prerender). */
export interface ExclusionServedSpeculationRules {
  /** Rule scripts removed from the served bytes (0 when the document was served as received). */
  readonly removedFromDocument: number;
  /** Whether the response's `Speculation-Rules` header was dropped. */
  readonly headerRemoved: boolean;
  /**
   * Whether the session's page guard ran in the document: it removes every
   * rule script — inline or inserted by the page's scripts — as it appears,
   * so the document's links are never prefetched or prerendered.
   */
  readonly guarded: boolean;
}

/**
 * The identity of the response a document outcome is for, and the
 * session's own effects on it — so a surface can tell whether the page it
 * shows is the one recorded (compare `urlDigest` with the SHA-256 of
 * `location.href` without its fragment, `receivedAt` with the page's
 * wall-anchored navigation start and response window; a navigation served
 * without interception leaves an older record) and say what the session changed besides the exclusions. Never
 * holds the URL's raw query (it may carry personal data): the origin +
 * path, and a digest of the whole URL — "no raw query stored", not "query
 * private": a low-entropy query's digest can be guessed.
 *
 * Digest contract (what a surface computes to compare): `u = new
 * URL(location.href); u.hash = ''; hex = lowercase hex of SHA-256 over the
 * UTF-8 bytes of u.href` — equal to `urlDigest` for the recorded page. After
 * `history.pushState`/`replaceState` the page's URL no longer is the
 * served one, so a mismatch then means "cannot tell", not "not
 * intercepted". URLs with embedded credentials are unverified.
 */
export interface ExclusionServedDocument {
  /** The document's origin + path (no query, no fragment; cut at `SERVED_DOCUMENT_LIMITS.urlPathChars`). */
  readonly urlPath: string;
  /** SHA-256 (lowercase hex) of the document's whole URL as requested (no fragment). */
  readonly urlDigest: string;
  /** The backend's opaque token of the response (unique per intercepted response). */
  readonly token: string;
  /**
   * The tab's document order: strictly increasing with arrival, across
   * background restarts — an outcome ordered before the recorded one never
   * replaces it.
   */
  readonly order: number;
  /**
   * Wall-clock epoch ms (`Date.now()`) the response arrived at the backend
   * (the host's own clock only when the backend gave no arrival time);
   * compared with the page's wall-anchored navigation start
   * (`Date.now() − performance.now()`, never `performance.timeOrigin`) and
   * response window. `order`, not this, orders documents.
   */
  readonly receivedAt: number;
  readonly speculationRules: ExclusionServedSpeculationRules;
  /**
   * Whether the browser rendered a substituted copy of the response: its
   * security indicator, certificate, connection info and resource timing
   * then describe the copy (e.g. an https page shows as not secure, connect
   * and request timings read zero), not the network response.
   */
  readonly copy: boolean;
  /**
   * Whether the tab's service workers were bypassed (the session sends
   * every request of the tab — any origin — to the network: offline and
   * service-worker caches are off while it lasts).
   */
  readonly serviceWorkersBypassed: boolean;
}

/** A session that intercepts its tab's top-level documents until Stop or tab close. */
export interface ActiveExclusionSession {
  readonly state: 'active';
  /** The http(s) origin the session was applied from (the set's per-origin key). */
  readonly origin: string;
  /** The applied set — authoritative for this tab, whatever the editor holds. */
  readonly set: ExclusionSet;
  /** Epoch ms of the apply. */
  readonly startedAt: number;
  /** The last intercepted document's outcome; `null` until the first one lands. */
  readonly document: ExclusionDocumentOutcome | null;
}

/** A tab whose apply could not arm, or whose interception ended under it. */
export interface UnavailableExclusionSession {
  readonly state: 'unavailable';
  readonly cause: InterceptionUnavailableCause;
  /** Epoch ms the cause was observed. */
  readonly at: number;
}

/**
 * A tab's builder session as every surface sees it — the state machine's
 * observable states: `inactive` (nothing applied: absent record, or after
 * Stop), `active`, `unavailable` (the interception-unavailable warning,
 * kept until Stop or the next apply).
 */
export type ExclusionSessionStatus =
  { readonly state: 'inactive' } | ActiveExclusionSession | UnavailableExclusionSession;

/** What a session store persists per tab: any status but `inactive` (absence is inactive). */
export type ExclusionSessionRecord = ActiveExclusionSession | UnavailableExclusionSession;

/**
 * Overlay → background: a set for the sender's tab/origin (both
 * sender-resolved) — the apply and the save request.
 */
export interface ExclusionSetPayload {
  readonly set: ExclusionSet;
}

/**
 * The background's answer to an apply.
 *
 * - `applying` — interception armed; the background reloads the tab next
 *   (the reloaded overlay asks for the session status).
 * - `invalid` — the set carries invalid rows (all of them, engine-named);
 *   nothing was armed.
 * - `unavailable` — interception cannot run; nothing destructive happened.
 */
export type ExclusionApplyReply =
  | { readonly outcome: 'applying' }
  | { readonly outcome: 'invalid'; readonly invalid: readonly InvalidExclusionRow[] }
  | { readonly outcome: 'unavailable'; readonly cause: InterceptionUnavailableCause };

/**
 * Background → overlay: the sender origin's saved set (the editor's restore
 * source), `null` when it has none. Wrapped so "no set" stays a valid
 * answer, distinct from a malformed one.
 */
export interface SavedExclusionSetReply {
  readonly set: ExclusionSet | null;
}

/**
 * Why a save stored nothing: the sender is not a top-frame http(s) page,
 * the payload failed its guard, or the storage write failed.
 */
export const EXCLUSION_SAVE_FAILURES = [
  'unsupported-page',
  'invalid-request',
  'storage-failed'
] as const;

/** One save failure (see {@link EXCLUSION_SAVE_FAILURES}). */
export type ExclusionSaveFailure = (typeof EXCLUSION_SAVE_FAILURES)[number];

/**
 * The background's answer to a save: `saved` (the origin's set replaced,
 * any wire-valid set — a draft may hold rows the engine rejects, so restore
 * hands them back to fix), or `not-saved` with its reason.
 */
export type ExclusionSaveReply =
  | { readonly outcome: 'saved' }
  | { readonly outcome: 'not-saved'; readonly reason: ExclusionSaveFailure };

/** Panel → background: one tab's session (extension senders carry no runtime tab). */
export interface ExclusionSessionTabQuery {
  readonly tabId: number;
}

/** Background → panel push: one tab's session changed (scoped by the payload's tab id). */
export interface ExclusionSessionTabStatus {
  readonly tabId: number;
  readonly status: ExclusionSessionStatus;
}

/**
 * Overlay → background: how the user left the overlay (`open` panel, or
 * folded to its pill — closing counts as folded). The session tab's next
 * pages bring the overlay back the same way.
 */
export interface ExclusionOverlayPresentation {
  readonly open: boolean;
}

/**
 * Answer deadlines of the session asks, for the sender's bounded ask: an
 * apply includes the debugger attach; the others may wake a suspended
 * background first.
 */
export const EXCLUSION_SESSION_DEADLINES_MS = {
  apply: 15_000,
  stop: 5_000,
  status: 5_000,
  savedSet: 5_000,
  save: 5_000,
  openOverlay: 5_000
} as const;

/** The set's row-list keys, in registry order (registry-derived, never re-typed). */
const ROWS_KEYS: readonly (keyof ExclusionSetRows)[] = EXCLUSION_FEATURES.map(
  (feature) => feature.rowsKey
);

/** The set's toggle keys, in registry order (features without a toggle skipped). */
const TOGGLE_KEYS: readonly (keyof ExclusionSetToggles)[] = EXCLUSION_FEATURES.flatMap((feature) =>
  feature.toggleKey === null ? [] : [feature.toggleKey]
);

/**
 * Whether a record's keys pass the policy: under `'reject'` every own key
 * must be one of `allowed`; `'ignore'` lets unknown keys through (the
 * rebuild copies only known ones).
 */
function keysAllowed(
  record: Record<string, unknown>,
  allowed: readonly string[],
  policy: UnknownKeyPolicy
): boolean {
  return policy === 'ignore' || Object.keys(record).every((key) => allowed.includes(key));
}

/** A non-negative safe integer (counts, indices, epoch ms, run ids). */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Whether a value is one of the engine's feature ids (registry-derived). */
export function isFeatureId(value: unknown): value is ExclusionFeatureId {
  return EXCLUSION_FEATURES.some((feature) => feature.id === value);
}

/** A printable row within the per-row cap (empty allowed — the engine names it invalid). */
export function isWireRowText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= EXCLUSION_SET_LIMITS.rowChars && isPrintable(value)
  );
}

/** A row list plus the characters it holds. */
interface ParsedRowList {
  readonly rows: string[];
  readonly chars: number;
}

/**
 * A bounded list of row texts, rebuilt fresh; null on any violation. Lengths
 * are summed before each row's printability scan, so an over-budget list
 * bails without scanning the rest.
 *
 * @param value The untrusted list.
 * @param charBudget Characters the list may hold in total.
 */
function parseRowList(value: unknown, charBudget: number): ParsedRowList | null {
  if (!Array.isArray(value) || value.length > EXCLUSION_SET_LIMITS.rowsPerFeature) return null;
  const rows: string[] = [];
  let chars = 0;
  // `for…of` visits holes as `undefined` (which fails the check) — `every`
  // would skip a sparse array's holes and let them through.
  for (const row of value) {
    if (typeof row !== 'string') return null;
    chars += row.length;
    if (chars > charBudget || !isWireRowText(row)) return null;
    rows.push(row);
  }
  return { rows, chars };
}

/**
 * Whether a value names an interception-unavailable cause (own keys only —
 * an inherited name like `toString` is not a cause).
 */
export function isInterceptionUnavailableCause(
  value: unknown
): value is InterceptionUnavailableCause {
  return typeof value === 'string' && Object.hasOwn(INTERCEPTION_UNAVAILABLE_CAUSES, value);
}

/**
 * Parse an exclusion set: the four row lists (printable rows within the
 * per-row, per-list and whole-set caps) and the three disable booleans.
 * Row *validity* (empty rows, bad regexes) is the engine's prevalidation,
 * not this guard's — the shape crosses so the engine can name every row.
 *
 * @param input The untrusted value.
 * @param policy Unknown-key policy (see the module doc).
 * @returns A fresh set, or null on any violation.
 */
export function parseExclusionSet(input: unknown, policy: UnknownKeyPolicy): ExclusionSet | null {
  if (!isRecord(input) || !keysAllowed(input, ['rows', 'disable'], policy)) return null;
  const rowsRaw = ownValue(input, 'rows');
  const disableRaw = ownValue(input, 'disable');
  if (!isRecord(rowsRaw) || !keysAllowed(rowsRaw, ROWS_KEYS, policy)) return null;
  if (!isRecord(disableRaw) || !keysAllowed(disableRaw, TOGGLE_KEYS, policy)) return null;
  const rows: Partial<Record<keyof ExclusionSetRows, string[]>> = {};
  // The whole-set cap is a running budget: each list gets what is left.
  let charsLeft: number = EXCLUSION_SET_LIMITS.totalChars;
  for (const key of ROWS_KEYS) {
    const list = parseRowList(ownValue(rowsRaw, key), charsLeft);
    if (list === null) return null;
    charsLeft -= list.chars;
    rows[key] = list.rows;
  }
  const disable: Partial<Record<keyof ExclusionSetToggles, boolean>> = {};
  for (const key of TOGGLE_KEYS) {
    const flag = ownValue(disableRaw, key);
    if (typeof flag !== 'boolean') return null;
    disable[key] = flag;
  }
  // Every registry key was filled above (any miss returned null), so the
  // partial records are complete.
  return { rows: rows as ExclusionSetRows, disable: disable as ExclusionSetToggles };
}

/** Parse one matched-row attribution; its kind must be its feature's. */
function parseRowMatch(
  input: unknown,
  feature: ExclusionFeatureId,
  policy: UnknownKeyPolicy
): ExclusionRowMatch | null {
  if (!isRecord(input) || !keysAllowed(input, ['row', 'rowKind', 'matches'], policy)) return null;
  const row = ownValue(input, 'row');
  const rowKind = ownValue(input, 'rowKind');
  const matches = ownValue(input, 'matches');
  const spec = EXCLUSION_FEATURES.find((entry) => entry.id === feature);
  if (spec === undefined || spec.rowKind !== rowKind) return null;
  if (!isWireRowText(row) || !isCount(matches) || matches < 1) return null;
  return { row, rowKind: spec.rowKind, matches };
}

/** The keys a transform report carries. */
const REPORT_KEYS = [
  'feature',
  'featureWide',
  'candidates',
  'rewritten',
  'regionRemovals',
  'matchedRows',
  'unmatchedRows',
  'undetermined',
  'approximate'
] as const;

/**
 * A report's optional count: absent, or a positive count no larger than the
 * candidates.
 *
 * @returns The count (`undefined` when absent), or `null` when invalid.
 */
function optionalCount(value: unknown, candidates: number): number | undefined | null {
  if (value === undefined) return undefined;
  return isCount(value) && value > 0 && value <= candidates ? value : null;
}

/** A feature's rows within a set (registry-derived lookup). */
function featureRows(set: ExclusionSet, feature: ExclusionFeatureId): readonly string[] {
  const spec = EXCLUSION_FEATURES.find((entry) => entry.id === feature);
  return spec === undefined ? [] : set.rows[spec.rowsKey];
}

/**
 * Whether `rows` is a sub-multiset of `pool` — every reported row is one of
 * the set's rows, each used at most as often as the set holds it.
 */
function isSubMultiset(rows: readonly string[], pool: readonly string[]): boolean {
  const left = new Map<string, number>();
  for (const row of pool) left.set(row, (left.get(row) ?? 0) + 1);
  for (const row of rows) {
    const count = left.get(row) ?? 0;
    if (count === 0) return false;
    left.set(row, count - 1);
  }
  return true;
}

/**
 * Parse one transform report against the set it ran with — the engine's
 * invariants: a known feature, non-negative counts (`rewritten` ≤
 * `candidates`, the summed row matches ≤ `candidates` — each candidate
 * counts for its first matching row only), a feature-wide run attributes no
 * rows, and the matched + unmatched rows are drawn from that feature's set
 * rows (which also bounds the report's size by the set's).
 */
function parseTransformReport(
  input: unknown,
  set: ExclusionSet,
  policy: UnknownKeyPolicy
): TransformReport | null {
  if (!isRecord(input) || !keysAllowed(input, REPORT_KEYS, policy)) return null;
  const feature = ownValue(input, 'feature');
  const featureWide = ownValue(input, 'featureWide');
  const candidates = ownValue(input, 'candidates');
  const rewritten = ownValue(input, 'rewritten');
  const regionRemovals = ownValue(input, 'regionRemovals');
  if (!isFeatureId(feature) || typeof featureWide !== 'boolean') return null;
  if (!isCount(candidates) || !isCount(rewritten) || !isCount(regionRemovals)) return null;
  if (rewritten > candidates) return null;
  const matchedRaw = ownValue(input, 'matchedRows');
  if (!Array.isArray(matchedRaw) || matchedRaw.length > EXCLUSION_SET_LIMITS.rowsPerFeature) {
    return null;
  }
  const matchedRows: ExclusionRowMatch[] = [];
  let matchedTotal = 0;
  for (const entry of matchedRaw) {
    const match = parseRowMatch(entry, feature, policy);
    if (match === null) return null;
    matchedTotal += match.matches;
    if (matchedTotal > candidates) return null;
    matchedRows.push(match);
  }
  const unmatched = parseRowList(ownValue(input, 'unmatchedRows'), EXCLUSION_SET_LIMITS.totalChars);
  if (unmatched === null) return null;
  const unmatchedRows = unmatched.rows;
  if (featureWide && (matchedRows.length > 0 || unmatchedRows.length > 0)) return null;
  const reported = [...matchedRows.map((match) => match.row), ...unmatchedRows];
  if (!isSubMultiset(reported, featureRows(set, feature))) return null;
  const undetermined = optionalCount(ownValue(input, 'undetermined'), candidates);
  const approximate = optionalCount(ownValue(input, 'approximate'), candidates);
  if (undetermined === null || approximate === null) return null;
  return {
    feature,
    featureWide,
    candidates,
    rewritten,
    regionRemovals,
    matchedRows,
    unmatchedRows,
    ...(undetermined === undefined ? {} : { undetermined }),
    ...(approximate === undefined ? {} : { approximate })
  };
}

/** The keys of a served-document identity. */
const SERVED_KEYS = [
  'urlPath',
  'urlDigest',
  'token',
  'order',
  'receivedAt',
  'speculationRules',
  'copy',
  'serviceWorkersBypassed'
] as const;

/** The keys of a served document's speculation-rules summary. */
const SPECULATION_KEYS = ['removedFromDocument', 'headerRemoved', 'guarded'] as const;

/** Whether a value is an http(s) origin + path within the cap (no query, no fragment). */
function isUrlPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > SERVED_DOCUMENT_LIMITS.urlPathChars) return false;
  if (!isHttpUrl(value)) return false;
  const url = parseUrl(value);
  return url !== null && url.search === '' && url.hash === '' && !value.includes('?');
}

/** Parse a speculation-rules summary. */
function parseSpeculationRules(
  input: unknown,
  policy: UnknownKeyPolicy
): ExclusionServedSpeculationRules | null {
  if (!isRecord(input) || !keysAllowed(input, SPECULATION_KEYS, policy)) return null;
  const removed = ownValue(input, 'removedFromDocument');
  const headerRemoved = ownValue(input, 'headerRemoved');
  const guarded = ownValue(input, 'guarded');
  if (!isCount(removed) || removed > SERVED_DOCUMENT_LIMITS.speculationRules) return null;
  if (typeof headerRemoved !== 'boolean' || typeof guarded !== 'boolean') return null;
  return { removedFromDocument: removed, headerRemoved, guarded };
}

/**
 * Parse a served-document identity (see {@link ExclusionServedDocument}).
 *
 * @param input The untrusted value.
 * @param policy Unknown-key policy (see the module doc).
 * @returns A fresh identity, or null on any violation.
 */
export function parseServedDocument(
  input: unknown,
  policy: UnknownKeyPolicy
): ExclusionServedDocument | null {
  if (!isRecord(input) || !keysAllowed(input, SERVED_KEYS, policy)) return null;
  const urlPath = ownValue(input, 'urlPath');
  const urlDigest = ownValue(input, 'urlDigest');
  const token = ownValue(input, 'token');
  const order = ownValue(input, 'order');
  const receivedAt = ownValue(input, 'receivedAt');
  const copy = ownValue(input, 'copy');
  const bypassed = ownValue(input, 'serviceWorkersBypassed');
  if (!isUrlPath(urlPath)) return null;
  if (typeof urlDigest !== 'string' || !/^[0-9a-f]{64}$/.test(urlDigest)) return null;
  if (typeof token !== 'string' || token.length === 0) return null;
  if (token.length > SERVED_DOCUMENT_LIMITS.tokenChars || !isPrintable(token)) return null;
  if (!isCount(order) || !isCount(receivedAt)) return null;
  if (typeof copy !== 'boolean' || typeof bypassed !== 'boolean') return null;
  const speculationRules = parseSpeculationRules(ownValue(input, 'speculationRules'), policy);
  if (speculationRules === null) return null;
  return {
    urlPath,
    urlDigest,
    token,
    order,
    receivedAt,
    speculationRules,
    copy,
    serviceWorkersBypassed: bypassed
  };
}

/**
 * Attach an outcome's optional served identity (absent stays absent; a
 * malformed one fails the whole outcome).
 */
function withServed(
  outcome: ExclusionDocumentOutcome,
  input: Record<string, unknown>,
  policy: UnknownKeyPolicy
): ExclusionDocumentOutcome | null {
  const raw = ownValue(input, 'served');
  if (raw === undefined) return outcome;
  const served = parseServedDocument(raw, policy);
  return served === null ? null : { ...outcome, served };
}

/**
 * Parse a document outcome (see {@link ExclusionDocumentOutcome}) against
 * the session's set: reports and an over-budget row must come from it.
 */
function parseDocumentOutcome(
  input: unknown,
  set: ExclusionSet,
  policy: UnknownKeyPolicy
): ExclusionDocumentOutcome | null {
  if (!isRecord(input)) return null;
  switch (ownValue(input, 'outcome')) {
    case 'rewritten': {
      if (!keysAllowed(input, ['outcome', 'reports', 'served'], policy)) return null;
      const raw = ownValue(input, 'reports');
      if (!Array.isArray(raw) || raw.length > EXCLUSION_FEATURES.length) return null;
      const reports: TransformReport[] = [];
      for (const entry of raw) {
        const report = parseTransformReport(entry, set, policy);
        // At most one report per feature — the pipeline runs each once.
        if (report === null || reports.some((seen) => seen.feature === report.feature)) {
          return null;
        }
        reports.push(report);
      }
      return withServed({ outcome: 'rewritten', reports }, input, policy);
    }
    case 'over-budget': {
      if (!keysAllowed(input, ['outcome', 'feature', 'row', 'budgetMs', 'served'], policy)) {
        return null;
      }
      const feature = ownValue(input, 'feature');
      const row = ownValue(input, 'row');
      const budgetMs = ownValue(input, 'budgetMs');
      if (!isFeatureId(feature)) return null;
      if (row !== null && (!isWireRowText(row) || !featureRows(set, feature).includes(row))) {
        return null;
      }
      if (!isCount(budgetMs) || budgetMs < 1 || budgetMs > MAX_BUDGET_MS) return null;
      return withServed({ outcome: 'over-budget', feature, row, budgetMs }, input, policy);
    }
    case 'failed': {
      if (!keysAllowed(input, ['outcome', 'reason', 'served'], policy)) return null;
      const reason = ownValue(input, 'reason');
      const known = EXCLUSION_DOCUMENT_FAILURES.find((failure) => failure === reason);
      return known === undefined
        ? null
        : withServed({ outcome: 'failed', reason: known }, input, policy);
    }
    default:
      return null;
  }
}

/**
 * Parse a session record — a status other than `inactive` (what a store
 * persists per tab).
 *
 * @param input The untrusted value.
 * @param policy Unknown-key policy (see the module doc).
 * @returns A fresh record, or null on any violation (the origin must be a
 *   canonical http(s) origin within its cap).
 */
export function parseExclusionSessionRecord(
  input: unknown,
  policy: UnknownKeyPolicy
): ExclusionSessionRecord | null {
  if (!isRecord(input)) return null;
  const state = ownValue(input, 'state');
  if (state === 'unavailable') {
    if (!keysAllowed(input, ['state', 'cause', 'at'], policy)) return null;
    const cause = ownValue(input, 'cause');
    const at = ownValue(input, 'at');
    if (!isInterceptionUnavailableCause(cause) || !isCount(at)) return null;
    return { state: 'unavailable', cause, at };
  }
  if (state !== 'active') return null;
  if (!keysAllowed(input, ['state', 'origin', 'set', 'startedAt', 'document'], policy)) {
    return null;
  }
  const origin = ownValue(input, 'origin');
  const startedAt = ownValue(input, 'startedAt');
  if (typeof origin !== 'string' || origin.length > EXCLUSION_SET_LIMITS.originChars) return null;
  if (!isHttpOrigin(origin)) return null;
  if (!isCount(startedAt)) return null;
  const set = parseExclusionSet(ownValue(input, 'set'), policy);
  if (set === null) return null;
  const documentRaw = ownValue(input, 'document');
  const document = documentRaw === null ? null : parseDocumentOutcome(documentRaw, set, policy);
  if (documentRaw !== null && document === null) return null;
  return { state: 'active', origin, set, startedAt, document };
}

/**
 * Parse a session status (status ask answers, stop answers, the tab push).
 *
 * @param input The untrusted value.
 * @returns A fresh status, or null on any violation (exact keys).
 */
export function parseExclusionSessionStatus(input: unknown): ExclusionSessionStatus | null {
  if (isRecord(input) && ownValue(input, 'state') === 'inactive') {
    return Object.keys(input).length === 1 ? { state: 'inactive' } : null;
  }
  return parseExclusionSessionRecord(input, 'reject');
}

/**
 * Parse an apply or save request.
 *
 * @param input The untrusted payload.
 * @returns The request, or null on any violation (exact keys).
 */
export function parseExclusionSetPayload(input: unknown): ExclusionSetPayload | null {
  if (!isRecord(input) || !keysAllowed(input, ['set'], 'reject')) return null;
  const set = parseExclusionSet(ownValue(input, 'set'), 'reject');
  return set === null ? null : { set };
}

/**
 * Parse the saved-set answer.
 *
 * @param input The untrusted value.
 * @returns The answer (`set: null` when the origin has none), or null on
 *   any violation (exact keys).
 */
export function parseSavedExclusionSetReply(input: unknown): SavedExclusionSetReply | null {
  if (!isRecord(input) || !keysAllowed(input, ['set'], 'reject')) return null;
  const raw = ownValue(input, 'set');
  if (raw === null) return { set: null };
  const set = parseExclusionSet(raw, 'reject');
  return set === null ? null : { set };
}

/**
 * Parse a save answer.
 *
 * @param input The untrusted value.
 * @returns The answer, or null on any violation (exact keys).
 */
export function parseExclusionSaveReply(input: unknown): ExclusionSaveReply | null {
  if (!isRecord(input)) return null;
  const outcome = ownValue(input, 'outcome');
  if (outcome === 'saved') return Object.keys(input).length === 1 ? { outcome: 'saved' } : null;
  if (outcome !== 'not-saved' || !keysAllowed(input, ['outcome', 'reason'], 'reject')) return null;
  const reason = ownValue(input, 'reason');
  const known = EXCLUSION_SAVE_FAILURES.find((failure) => failure === reason);
  return known === undefined ? null : { outcome: 'not-saved', reason: known };
}

/** Parse one engine-named invalid row (its typed `problem` id is optional). */
function parseInvalidRow(input: unknown): InvalidExclusionRow | null {
  const keys = ['feature', 'index', 'row', 'reason', 'problem'];
  if (!isRecord(input) || !keysAllowed(input, keys, 'reject')) return null;
  const feature = ownValue(input, 'feature');
  const index = ownValue(input, 'index');
  const row = ownValue(input, 'row');
  const reason = ownValue(input, 'reason');
  const problem = ownValue(input, 'problem');
  if (!isFeatureId(feature) || !isCount(index) || !isWireRowText(row)) return null;
  if (index >= EXCLUSION_SET_LIMITS.rowsPerFeature) return null;
  if (typeof reason !== 'string' || reason.length < 1) return null;
  if (reason.length > EXCLUSION_SET_LIMITS.reasonChars || !isPrintable(reason)) return null;
  if (problem === undefined) return { feature, index, row, reason };
  const known = PROBLEM_IDS.find((id) => id === problem);
  return known === undefined ? null : { feature, index, row, reason, problem: known };
}

/**
 * Parse an apply answer.
 *
 * @param input The untrusted value.
 * @returns The answer, or null on any violation (exact keys; an `invalid`
 *   answer names at least one row and at most every row a set can hold).
 */
export function parseExclusionApplyReply(input: unknown): ExclusionApplyReply | null {
  if (!isRecord(input)) return null;
  switch (ownValue(input, 'outcome')) {
    case 'applying':
      return Object.keys(input).length === 1 ? { outcome: 'applying' } : null;
    case 'unavailable': {
      if (!keysAllowed(input, ['outcome', 'cause'], 'reject')) return null;
      const cause = ownValue(input, 'cause');
      return isInterceptionUnavailableCause(cause) ? { outcome: 'unavailable', cause } : null;
    }
    case 'invalid': {
      if (!keysAllowed(input, ['outcome', 'invalid'], 'reject')) return null;
      const raw = ownValue(input, 'invalid');
      const cap = EXCLUSION_SET_LIMITS.rowsPerFeature * EXCLUSION_FEATURES.length;
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > cap) return null;
      const invalid: InvalidExclusionRow[] = [];
      for (const entry of raw) {
        const row = parseInvalidRow(entry);
        if (row === null) return null;
        invalid.push(row);
      }
      return { outcome: 'invalid', invalid };
    }
    default:
      return null;
  }
}

/**
 * Truncate one reason to {@link EXCLUSION_SET_LIMITS.reasonChars}, never
 * splitting a surrogate pair (a lone half would fail the printable check).
 */
function boundReason(reason: string): string {
  const cap = EXCLUSION_SET_LIMITS.reasonChars;
  if (reason.length <= cap) return reason;
  let cut = cap - 1;
  const last = reason.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--;
  return `${reason.slice(0, cut)}…`;
}

/**
 * Build the `invalid` apply answer from the engine's prevalidation — the
 * background's one way to answer it, so every reason fits the wire cap
 * whatever the engine's wording.
 *
 * @param invalid The engine-named invalid rows (non-empty).
 * @returns The answer, reasons truncated to the cap.
 */
export function invalidApplyReply(
  invalid: readonly InvalidExclusionRow[]
): Extract<ExclusionApplyReply, { outcome: 'invalid' }> {
  return {
    outcome: 'invalid',
    invalid: invalid.map((row) => ({ ...row, reason: boundReason(row.reason) }))
  };
}

/**
 * Parse the panel's tab query. The receiver must also refuse senders that
 * carry a runtime tab — only extension pages may name a tab by payload
 * (`isExtensionPageSender`).
 *
 * @param input The untrusted payload.
 * @returns The query, or null on any violation (exact keys).
 */
export function parseExclusionSessionTabQuery(input: unknown): ExclusionSessionTabQuery | null {
  if (!isRecord(input) || !keysAllowed(input, ['tabId'], 'reject')) return null;
  const tabId = numericTabId(ownValue(input, 'tabId'));
  return tabId === null ? null : { tabId };
}

/**
 * Parse the panel push. The panel drops it from senders that carry a
 * runtime tab (only the background pushes it) and acts only when the tab
 * id is its inspected tab.
 *
 * @param input The untrusted payload.
 * @returns The push, or null on any violation (exact keys).
 */
export function parseExclusionSessionTabStatus(input: unknown): ExclusionSessionTabStatus | null {
  if (!isRecord(input) || !keysAllowed(input, ['tabId', 'status'], 'reject')) return null;
  const tabId = numericTabId(ownValue(input, 'tabId'));
  const status = parseExclusionSessionStatus(ownValue(input, 'status'));
  return tabId === null || status === null ? null : { tabId, status };
}

/**
 * Parse the overlay's presentation push (sender-resolved: the receiver
 * also requires a top-frame page sender).
 *
 * @param input The untrusted payload.
 * @returns The presentation, or null on any violation (exact keys).
 */
export function parseExclusionOverlayPresentation(
  input: unknown
): ExclusionOverlayPresentation | null {
  if (!isRecord(input) || !keysAllowed(input, ['open'], 'reject')) return null;
  const open = ownValue(input, 'open');
  return typeof open === 'boolean' ? { open } : null;
}
