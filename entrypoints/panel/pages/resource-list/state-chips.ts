/**
 * The resource-list rows' state chips, pure: a row's states arrive in
 * importance order (each page owns its state table), and this core keeps
 * several of them compact — at most {@link MAX_VISIBLE_STATE_CHIPS} visible,
 * the rest behind one "+N" chip whose title names them. Pages build the split
 * once per row view (never in the row renderer).
 */
import type { StatusKind } from '../../../../components/ui/status-badge';

/** One state chip on a row. */
export interface StateChip {
  /** Stable state id (test hook, keyed rendering). */
  readonly id: string;
  /** The one-word visible label. */
  readonly label: string;
  /** The status vocabulary kind. */
  readonly kind: StatusKind;
  /** A short visible qualifier drawn after the label ("WP Rocket"), when the state needs one. */
  readonly mark?: string;
  /** Hover text with the state's detail, when it has more to say than its words. */
  readonly title?: string;
}

/** The "+N" chip standing for the hidden states. */
export interface OverflowChip {
  /** "+N". */
  readonly label: string;
  /** Names every hidden state, in order. */
  readonly title: string;
}

/** A row's chips, split for rendering. */
export interface StateChipSplit {
  readonly visible: readonly StateChip[];
  /** `null` while every chip fits. */
  readonly overflow: OverflowChip | null;
}

/** At most this many state chips show on a row before the "+N" chip. */
export const MAX_VISIBLE_STATE_CHIPS = 3;

/** The split of a row without states (shared: no allocation per plain row). */
export const NO_STATE_CHIPS: StateChipSplit = { visible: [], overflow: null };

/**
 * A chip's words as one phrase: the label, then its mark in parentheses
 * ("Deferred (WP Rocket)") — the form the "+N" title lists.
 *
 * @param chip The chip.
 */
export function chipPhrase(chip: StateChip): string {
  return chip.mark === undefined ? chip.label : `${chip.label} (${chip.mark})`;
}

/**
 * Split a row's chips: the first `max` show, the rest collapse into "+N".
 *
 * @param chips The row's chips, most important first.
 * @param max The visible cap (default {@link MAX_VISIBLE_STATE_CHIPS}).
 * @returns The visible chips and the overflow chip (`null` when none is hidden).
 * @throws {@link Error} When `max` is not a positive integer — a wiring bug.
 */
export function splitStateChips(
  chips: readonly StateChip[],
  max: number = MAX_VISIBLE_STATE_CHIPS
): StateChipSplit {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`State chip cap must be a positive integer, got ${String(max)}.`);
  }
  if (chips.length === 0) return NO_STATE_CHIPS;
  if (chips.length <= max) return { visible: chips, overflow: null };
  const hidden = chips.slice(max);
  return {
    visible: chips.slice(0, max),
    overflow: {
      label: `+${String(hidden.length)}`,
      title: `Also: ${hidden.map(chipPhrase).join(', ')}`
    }
  };
}
