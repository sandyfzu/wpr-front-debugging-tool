/**
 * The top bar's measured fold: which secondary parts show inline and which
 * live in the "⋯" menu, decided from measured natural widths — each part is
 * whole or gone, never squeezed to a stub or cut mid-glyph.
 *
 * The primary answers (WP Rocket, cache) and the bar's controls are never
 * folded; the secondary parts drop in a fixed priority order (least useful
 * first) until the rest fits. The width rule (`top-bar-layout.ts`) still
 * decides the short forms and folds the compact bar's secondaries by rule;
 * this module decides the rest from the bar's real room. Pure: the panel
 * measures, this decides.
 */

/**
 * The foldable parts, in drop order: the first one folds first. The brand
 * mark (decorative; the menu repeats the name) goes last, so a narrow bar
 * gives up its logo before its answers elide.
 */
export const TOP_BAR_FOLD_ORDER = ['address', 'server', 'cacheAge', 'freshness', 'brand'] as const;

/** One foldable part of the top bar. */
export type TopBarFoldPart = (typeof TOP_BAR_FOLD_ORDER)[number];

/** The parts a compact bar (below the width rule's threshold) folds whatever its room. */
export const TOP_BAR_COMPACT_FOLDED: ReadonlySet<TopBarFoldPart> = new Set<TopBarFoldPart>([
  'address',
  'server',
  'cacheAge',
  'freshness'
]);

/**
 * The extra room (px) a folded part needs before it returns inline. Widths
 * come from layout in fractions of a pixel (and an elided pill's natural
 * width from whole-pixel scroll sizes), so a part sitting exactly at the
 * edge could otherwise flap between inline and folded on every measure.
 */
export const TOP_BAR_FOLD_HYSTERESIS_PX = 2;

/** One fold decision. */
export interface TopBarFold {
  /** The present parts shown inline, in {@link TOP_BAR_FOLD_ORDER}. */
  readonly inline: readonly TopBarFoldPart[];
  /** The present parts held by the "⋯" menu, in {@link TOP_BAR_FOLD_ORDER}. */
  readonly folded: readonly TopBarFoldPart[];
  /** Whether the "⋯" menu shows (compact bar, or anything folded). */
  readonly menu: boolean;
}

/** The inputs of {@link foldTopBar}. */
export interface TopBarFoldInput {
  /**
   * The px the bar can spend on the non-forced present parts plus, when the
   * fold needs it, the "⋯" trigger (see {@link topBarFoldRoom}). May be
   * negative: the primaries alone overflow.
   */
  readonly room: number;
  /**
   * Each present part's inline cost (px): its natural width plus the gap it
   * adds beside its neighbor. A missing key = the part has nothing to show
   * (or is not measured yet): it is neither inline nor folded.
   */
  readonly widths: Readonly<Partial<Record<TopBarFoldPart, number>>>;
  /** The "⋯" trigger's inline cost (px, its gap included). */
  readonly menuWidth: number;
  /** The compact bar: {@link TOP_BAR_COMPACT_FOLDED} fold by rule and "⋯" always shows. */
  readonly compact: boolean;
  /**
   * The decision the measured layout reflects (null before the first one):
   * a part returns inline only with {@link TOP_BAR_FOLD_HYSTERESIS_PX} to spare.
   */
  readonly previous: TopBarFold | null;
}

/** The measured facts {@link topBarFoldRoom} turns into the fold's room. */
export interface TopBarFoldRoomInput {
  /** The start slot's free px as laid out (negative when its content overflows). */
  readonly free: number;
  /** The summed inline costs of the parts laid out inline right now. */
  readonly inlineCost: number;
  /** Whether "⋯" is laid out right now. */
  readonly menuShown: boolean;
  /** The "⋯" trigger's inline cost. */
  readonly menuWidth: number;
  /** The compact bar ("⋯" is then fixed, never the fold's to spend). */
  readonly compact: boolean;
}

/**
 * Assert a measured px value is usable.
 *
 * @param name The input's name (named in the error).
 * @param value The value.
 * @param allowNegative Whether a negative value is legal.
 * @throws {@link RangeError} When the value is not finite, or negative where that is illegal.
 */
function assertPx(name: string, value: number, allowNegative: boolean): void {
  if (!Number.isFinite(value) || (!allowNegative && value < 0)) {
    throw new RangeError(
      `topBarFold: ${name} must be a finite number${allowNegative ? '' : ' ≥ 0'}, got ${String(value)}.`
    );
  }
}

/**
 * The room the fold may spend: the free px plus what the parts and the menu
 * it laid out already take — so the same layout always yields the same room,
 * whatever the previous decision showed.
 *
 * @param input The measured facts.
 * @returns The room in px.
 * @throws {@link RangeError} When a measure is not finite (or a cost is negative).
 */
export function topBarFoldRoom(input: TopBarFoldRoomInput): number {
  assertPx('free', input.free, true);
  assertPx('inlineCost', input.inlineCost, false);
  assertPx('menuWidth', input.menuWidth, false);
  const menu = input.menuShown && !input.compact ? input.menuWidth : 0;
  return input.free + input.inlineCost + menu;
}

/**
 * Decide the fold: drop the fewest parts, in {@link TOP_BAR_FOLD_ORDER},
 * so the rest (plus "⋯" when anything folds) fits the room. A tie fits.
 * When nothing fits even with every part folded, all fold (the primaries
 * then elide inside their pills — the floor, never a cut).
 *
 * @param input See {@link TopBarFoldInput}.
 * @returns The decision.
 * @throws {@link RangeError} When the room, a width or the menu width is not a usable px value.
 */
export function foldTopBar(input: TopBarFoldInput): TopBarFold {
  assertPx('room', input.room, true);
  assertPx('menuWidth', input.menuWidth, false);
  // The present parts with their costs, in drop order.
  const present = TOP_BAR_FOLD_ORDER.flatMap((part) => {
    const width = input.widths[part];
    if (width === undefined) return [];
    assertPx(`width of "${part}"`, width, false);
    return [{ part, width }];
  });
  const forced = present.filter(({ part }) => input.compact && TOP_BAR_COMPACT_FOLDED.has(part));
  const candidates = present.filter((entry) => !forced.includes(entry));

  /** Whether folding the first `drop` candidates fits, `slack` px to spare. */
  const fits = (drop: number, slack: number): boolean => {
    const kept = candidates.slice(drop).reduce((sum, entry) => sum + entry.width, 0);
    const needsMenu = !input.compact && forced.length + drop > 0;
    return kept + (needsMenu ? input.menuWidth : 0) <= input.room - slack;
  };
  /** The fewest drops in `from`…`until` that fit, or -1 when none does. */
  const firstFit = (from: number, slack: number, until = candidates.length): number => {
    for (let drop = from; drop <= until; drop += 1) if (fits(drop, slack)) return drop;
    return -1;
  };

  const fitting = firstFit(0, 0);
  // Nothing fits: every part folds (the floor).
  const loose = fitting === -1 ? candidates.length : fitting;
  let drop = loose;
  const previous = input.previous;
  if (previous !== null) {
    // The drops the laid-out decision made, read on today's candidates: a
    // part that is new since then counts as inline (it mounts inline).
    const wasFolded = (part: TopBarFoldPart): boolean => previous.folded.includes(part);
    const before = candidates.findIndex((entry) => !wasFolded(entry.part));
    const previousDrop = before === -1 ? candidates.length : before;
    if (loose < previousDrop) {
      // Showing more than the layout does: only with the margin to spare.
      const strict = firstFit(loose, TOP_BAR_FOLD_HYSTERESIS_PX, previousDrop - 1);
      drop = strict !== -1 ? strict : fits(previousDrop, 0) ? previousDrop : loose;
    }
  }

  const folded = [...forced, ...candidates.slice(0, drop)].map((entry) => entry.part);
  return {
    inline: present.map((entry) => entry.part).filter((part) => !folded.includes(part)),
    folded: TOP_BAR_FOLD_ORDER.filter((part) => folded.includes(part)),
    menu: input.compact || folded.length > 0
  };
}

/**
 * Whether two decisions match (the panel skips a no-op update).
 *
 * @param a One decision (null = none yet).
 * @param b The other.
 * @returns True when both show and fold the same parts with the same menu.
 */
export function sameTopBarFold(a: TopBarFold | null, b: TopBarFold | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.menu === b.menu &&
    a.inline.length === b.inline.length &&
    a.folded.length === b.folded.length &&
    a.inline.every((part, index) => b.inline[index] === part) &&
    a.folded.every((part, index) => b.folded[index] === part)
  );
}
