/**
 * The command palette combobox's pure model: which row the highlight rests
 * on after a key, a re-rank or a pointer move, what the palette's live region
 * says, and how far the list scrolls to keep the highlight in view. Kept out
 * of the component so every rule is unit-tested without a DOM.
 */
import { platformName, type PlatformFacts } from '../../utils/platform';

/** The row facts the highlight rules read. */
export interface HighlightRow {
  /** The row identity (the highlight is held by id, never by index). */
  readonly id: string;
  /** Disabled rows render but are never rested on. */
  readonly disabled?: boolean;
}

/** One highlight move the field's keys request. */
export type HighlightMove = 'next' | 'previous' | 'first' | 'last';

/**
 * The first enabled row's id, or `null` when none is enabled.
 *
 * @param rows The ranked rows.
 */
export function firstEnabledId(rows: readonly HighlightRow[]): string | null {
  return rows.find((row) => row.disabled !== true)?.id ?? null;
}

/**
 * The last enabled row's id, or `null` when none is enabled.
 *
 * @param rows The ranked rows.
 */
function lastEnabledId(rows: readonly HighlightRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && row.disabled !== true) return row.id;
  }
  return null;
}

/**
 * The highlight after one move: next/previous step over disabled rows and
 * wrap at both ends; first/last jump to the enabled ends. An unset or stale
 * highlight steps from the matching end (next → first, previous → last).
 *
 * @param rows The ranked rows.
 * @param current The highlighted id, or `null`.
 * @param move The requested move.
 * @returns The new highlighted id (`null` when no row is enabled).
 */
export function moveHighlight(
  rows: readonly HighlightRow[],
  current: string | null,
  move: HighlightMove
): string | null {
  if (move === 'first') return firstEnabledId(rows);
  if (move === 'last') return lastEnabledId(rows);
  const start = rows.findIndex((row) => row.id === current);
  if (start < 0) return move === 'next' ? firstEnabledId(rows) : lastEnabledId(rows);
  const step = move === 'next' ? 1 : -1;
  for (let offset = 1; offset <= rows.length; offset += 1) {
    const index = (((start + step * offset) % rows.length) + rows.length) % rows.length;
    const row = rows[index];
    if (row !== undefined && row.disabled !== true) return row.id;
  }
  return null;
}

/**
 * The highlight after the ranked list changed. A new query re-arms the top
 * enabled row (Enter runs the best match without an arrow key); a re-rank
 * under the same query (the caller's command set refreshed) keeps the user's
 * row while it is still listed and enabled, else re-arms the top.
 *
 * @param rows The new ranked rows.
 * @param current The highlighted id before the change, or `null`.
 * @param queryChanged Whether the change came from a new query.
 */
export function highlightAfterRank(
  rows: readonly HighlightRow[],
  current: string | null,
  queryChanged: boolean
): string | null {
  if (!queryChanged && current !== null) {
    const kept = rows.find((row) => row.id === current);
    if (kept !== undefined && kept.disabled !== true) return kept.id;
  }
  return firstEnabledId(rows);
}

/** The field's keys → the highlight move each requests. */
const MOVE_KEYS: ReadonlyMap<string, HighlightMove> = new Map([
  ['ArrowDown', 'next'],
  ['ArrowUp', 'previous'],
  ['Home', 'first'],
  ['End', 'last']
]);

/** The keydown facts {@link fieldHighlightMove} reads. */
export interface FieldKeyFacts {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * The highlight move a field key requests, or `null` when the key belongs to
 * the field: with any modifier held, Arrow/Home/End select or move the text
 * caret (Shift+Home selects to the start; ⌘↑/⌘↓ on macOS and Ctrl+Home/End
 * on Windows/Linux jump the caret to the start/end).
 *
 * @param event The field's keydown.
 * @returns The requested move, or `null` when the key is the field's.
 */
export function fieldHighlightMove(event: FieldKeyFacts): HighlightMove | null {
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return null;
  return MOVE_KEYS.get(event.key) ?? null;
}

/** What changed, for the live region's next sentence. */
export type AnnouncementCause =
  /** The query changed (the ranked list is new). */
  | 'query'
  /** The keyboard moved the highlight. */
  | 'move';

/** The facts the live region's sentence is composed from. */
export interface AnnouncementFacts {
  /** The current query (quoted in the no-match line). */
  readonly query: string;
  /** How many rows the ranked list shows. */
  readonly count: number;
  /** The highlighted row's label, or `null`. */
  readonly activeLabel: string | null;
  /**
   * Whether the highlighted row is spoken too: the field's
   * `aria-activedescendant` conveys it everywhere else, but VoiceOver is
   * known to skip active-descendant changes, so Apple platforms get the
   * label in the live region as well.
   */
  readonly speakActiveRow: boolean;
}

/**
 * The empty-result line, rendered visibly and spoken by the live region:
 * the no-match line for a query, or — with nothing typed (blank) — the
 * empty command set's own line (never a quoted empty query).
 *
 * @param query The query nothing matched.
 * @returns The line to show.
 */
export function noMatchText(query: string): string {
  return query.trim() === '' ? 'No commands available' : `No commands match “${query}”`;
}

/**
 * The live region's sentence after one change, or `null` to leave it as is
 * (a polite region speaks only when its text changes).
 *
 * @param cause What changed.
 * @param facts See {@link AnnouncementFacts}.
 */
export function paletteAnnouncement(
  cause: AnnouncementCause,
  facts: AnnouncementFacts
): string | null {
  const row = facts.speakActiveRow ? facts.activeLabel : null;
  if (cause === 'move') return row;
  if (facts.count === 0) return noMatchText(facts.query);
  const count = `${String(facts.count)} ${facts.count === 1 ? 'command' : 'commands'} available`;
  return row === null ? count : `${count}, ${row}`;
}

/**
 * Whether the platform is an Apple one (macOS, iOS, iPadOS — the last
 * reports a Mac platform) — where VoiceOver runs. An assistive-technology
 * accommodation (the extra spoken row), never a capability branch.
 *
 * @param facts The navigator (or a test double).
 */
export function isApplePlatform(facts: PlatformFacts): boolean {
  return /^(mac|iphone|ipad)/i.test(platformName(facts));
}

/** A vertical box (a `DOMRect`'s top and bottom). */
export interface VerticalBox {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The list scroll delta that brings a row fully into view (`0` when it
 * already is) — scrolling only the list, never the host document (a
 * `scrollIntoView` could scroll a page the palette sits over).
 *
 * @param row The highlighted row's box.
 * @param list The list's visible box.
 */
export function scrollDeltaToReveal(row: VerticalBox, list: VerticalBox): number {
  if (row.top < list.top) return row.top - list.top;
  if (row.bottom > list.bottom) return Math.min(row.bottom - list.bottom, row.top - list.top);
  return 0;
}
