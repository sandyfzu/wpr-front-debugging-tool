/**
 * What a nav row says beside its label: its live state when it has one,
 * else its item count — resolved against loaded page data, with every
 * registry selector contained to its own row (a throwing selector is a
 * registry bug: logged, the row renders without a note, the nav stays up).
 */
import type { StatusKind } from '../../../components/ui/status-badge';
import { createLogger } from '../../../lib/logger';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { countLabel, formatCountFloor } from '../../../utils/format-count';
import type { NavCount, NavLiveState, NavRoute } from '../routes';

const log = createLogger('panel');

/** One row's note in its two lengths. */
export interface NavRowNote {
  /** The full phrase (rail tooltip, overflow menu, description): "14 scripts". */
  readonly text: string;
  /** The labeled sidebar's right column: "14", "3/9"; null shows a tone dot. */
  readonly short: string | null;
  /** The status tone the note is painted in. */
  readonly tone: StatusKind;
}

/**
 * Run one registry selector, containing a throw to its row.
 *
 * @param row The row (named in the log).
 * @param kind Which selector (named in the log).
 * @param run The selector call.
 * @returns The selector's answer, or null when it threw.
 */
function contained<T>(row: NavRoute, kind: string, run: () => T | null): T | null {
  try {
    return run();
  } catch (cause) {
    log.error(`Nav ${kind} selector failed — the row renders without it`, {
      row: row.id,
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return null;
  }
}

/**
 * Resolve one row's live state.
 *
 * @param row The registry row.
 * @param data The live data, including null (selectors answer "no data yet" themselves).
 * @returns The state, or null when there is nothing to say or the selector failed.
 */
export function resolveLiveState(row: NavRoute, data: FdtData | null): NavLiveState | null {
  const selector = row.liveState;
  if (selector === undefined) return null;
  return contained(row, 'live-state', () => selector(data));
}

/**
 * Resolve one row's item count (loaded data only).
 *
 * @param row The registry row.
 * @param data The live data; null means no count.
 * @returns The count, or null without data, without a selector or when it failed.
 */
export function resolveCount(row: NavRoute, data: FdtData | null): NavCount | null {
  const selector = row.count;
  if (selector === undefined || data === null) return null;
  return contained(row, 'count', () => selector(data));
}

/**
 * The row's note: its live state first (the richer answer), else its count.
 *
 * @param row The registry row.
 * @param data The live data, including null.
 * @returns The note, or null when the row has nothing to say.
 */
export function resolveRowNote(row: NavRoute, data: FdtData | null): NavRowNote | null {
  const live = resolveLiveState(row, data);
  if (live !== null) return { text: live.text, short: live.short ?? null, tone: live.tone };
  const count = resolveCount(row, data);
  if (count === null) return null;
  return {
    text: countLabel(count.count, count.noun, count.partial),
    short: formatCountFloor(count.count, count.partial),
    tone: 'neutral'
  };
}

/**
 * A labeled row's hover title: the label, then the note's full phrase —
 * the whole answer for a row whose label or note had to shorten.
 *
 * @param row The registry row.
 * @param note The row's resolved note, or null.
 * @returns "Undefined References · Monitoring", or the label alone.
 */
export function rowTitle(row: NavRoute, note: NavRowNote | null): string {
  return note === null ? row.label : `${row.label} · ${note.text}`;
}
