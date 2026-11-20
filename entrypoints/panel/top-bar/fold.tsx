/**
 * The top bar's measured fold, wired to layout: it measures the parts'
 * natural widths and the bar's room, asks the pure rule
 * (`lib/panel/top-bar-fold.ts`) which parts fit, and lays the rest out of
 * sight for the "⋯" menu to hold.
 *
 * How a part is measured: a folded part stays mounted, laid out at its
 * natural width but out of flow and hidden (absolute, `visibility: hidden`
 * — no paint, no hit testing, no focus, out of the accessibility tree). So
 * one `ResizeObserver` sees every size change — a resize, an age tick, a new
 * badge, a font swap — inline or folded, and the bar re-decides in the
 * rendering step, before paint: no copies to keep in sync, no cached width
 * going stale, no per-frame polling. The start row's natural width is its
 * laid-out extent (overflow included) plus what its pill labels lost to
 * elision, so one measure lands on the final fold even from an overflowing
 * layout; the labels are watched too, so a squeeze that changes nothing else
 * still re-measures. A content change inside the start row (data arriving:
 * the placeholders become pills, a label's text changes) may move no watched
 * box at all — the row already fills its slot and the pills absorb it by
 * eliding — so a mutation watch re-arms the start row's size watch, which
 * reports it afresh in the same frame's rendering step. The callback only
 * reads (layout is clean at that point) and then writes once, so it never
 * thrashes layout.
 */
import { createSignal, onCleanup, type Accessor, type JSX } from 'solid-js';
import { createLogger } from '../../../lib/logger';
import {
  TOP_BAR_COMPACT_FOLDED,
  foldTopBar,
  sameTopBarFold,
  topBarFoldRoom,
  type TopBarFold,
  type TopBarFoldPart
} from '../../../lib/panel/top-bar-fold';
import { cn } from '../../../utils/cn';

const log = createLogger('panel');

/** A size watch over the bar's measured elements. */
export interface FoldSizeWatch {
  /** Start watching an element's box. */
  readonly observe: (element: Element) => void;
  /** Stop watching an element. */
  readonly unobserve: (element: Element) => void;
  /** Stop watching everything. */
  readonly disconnect: () => void;
}

/** Create a size watch that calls `onChange` after any watched box changes size. */
export type WatchFoldSizes = (onChange: () => void) => FoldSizeWatch;

/**
 * Watch an element's subtree for content changes (nodes added or removed,
 * text edited) and call `onChange` after them; returns the stop.
 */
export type WatchFoldContent = (element: Element, onChange: () => void) => () => void;

/** The bar's measured facts, read from layout (see {@link readFoldMetrics}). */
export interface FoldMetrics {
  /** The start slot's free px as laid out (negative when its content overflows). */
  readonly free: number;
  /** Each mounted part's inline cost (natural width + the gap it adds). */
  readonly widths: Readonly<Partial<Record<TopBarFoldPart, number>>>;
  /** The summed costs of the parts laid out inline. */
  readonly inlineCost: number;
  /** The "⋯" trigger's inline cost. */
  readonly menuWidth: number;
  /** Whether "⋯" is laid out inline. */
  readonly menuShown: boolean;
}

/** The elements a measure reads. */
export interface FoldElements {
  /** The start content row (its parent is the bar's start slot); null before mount. */
  readonly start: HTMLElement | null;
  /** The mounted parts. */
  readonly parts: ReadonlyMap<TopBarFoldPart, HTMLElement>;
  /** The "⋯" box; null before mount. */
  readonly menu: HTMLElement | null;
}

/** The measuring seams (tests inject doubles; layout-less environments have no sizes). */
export interface TopBarFoldSeams {
  /** The size watch. */
  readonly watch: WatchFoldSizes;
  /** The start row's content watch. */
  readonly watchContent: WatchFoldContent;
  /** The layout read. */
  readonly read: (elements: FoldElements) => FoldMetrics | null;
}

/**
 * A fold box's state attribute: what the layout shows, for the measure and
 * for tests.
 */
export const FOLD_STATE_ATTRIBUTE = 'data-fdt-fold';

/** The attribute marking a pill label whose elision the measure adds back. */
export const FOLD_ELIDE_ATTRIBUTE = 'data-fdt-fold-elide';

/** The props marking a pill label for the elision read-back (spread on the label). */
export const FOLD_ELIDE_MARK = { [FOLD_ELIDE_ATTRIBUTE]: '' } as const;

/**
 * The props stating a fold box's state (spread on the box), so JSX never
 * re-types {@link FOLD_STATE_ATTRIBUTE}.
 *
 * @param inline Whether the box shows inline.
 * @returns The state attribute, `inline` or `folded`.
 */
export function foldStateMark(inline: boolean): {
  readonly [FOLD_STATE_ATTRIBUTE]: 'inline' | 'folded';
} {
  return { [FOLD_STATE_ATTRIBUTE]: inline ? 'inline' : 'folded' };
}

/**
 * A folded box's style: laid out at its natural width, out of flow and out
 * of sight. Anchored at the bar's start corner (the bar is the positioned
 * ancestor), so it never extends a slot's scrollable overflow.
 */
const FOLDED_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  top: '0',
  'inset-inline-start': '0',
  visibility: 'hidden'
};

/**
 * The production watch: one `ResizeObserver` for the bar. Without the API
 * (never in a supported browser) it watches nothing and logs once: parts
 * then stay inline (the start slot's clip is the last safety net).
 *
 * @param onChange Called after watched boxes change size (errors are contained and logged).
 * @returns The watch.
 */
export const watchFoldSizes: WatchFoldSizes = (onChange) => {
  if (typeof ResizeObserver !== 'function') {
    log.warn('ResizeObserver is unavailable — the top bar keeps every part inline');
    return { observe: () => undefined, unobserve: () => undefined, disconnect: () => undefined };
  }
  const observer = new ResizeObserver(() => {
    try {
      onChange();
    } catch (cause) {
      log.error('Top bar fold failed to measure — the bar keeps its last fold', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    }
  });
  return {
    observe: (element) => {
      observer.observe(element);
    },
    unobserve: (element) => {
      observer.unobserve(element);
    },
    disconnect: () => {
      observer.disconnect();
    }
  };
};

/**
 * The production content watch: one `MutationObserver` over the subtree.
 * Without the API (never in a supported browser) it watches nothing and
 * logs once: the fold then re-measures on size changes only.
 *
 * @param element The watched root.
 * @param onChange Called after a batch of mutations (errors are contained and logged).
 * @returns The stop.
 */
export const watchFoldContent: WatchFoldContent = (element, onChange) => {
  if (typeof MutationObserver !== 'function') {
    log.warn('MutationObserver is unavailable — the top bar re-measures on size changes only');
    return () => undefined;
  }
  const observer = new MutationObserver(() => {
    try {
      onChange();
    } catch (cause) {
      log.error('Top bar fold failed to follow a content change — the bar keeps its last fold', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    }
  });
  observer.observe(element, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
  };
};

/**
 * A computed length in px (`normal`/`none`/empty read as `fallback`).
 *
 * @param value The computed value.
 * @param fallback The value for a non-length.
 * @returns The length in px, or `fallback`.
 */
function px(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A box's inline cost: its border-box width plus its parent's column gap
 * (every part sits beside an in-flow neighbor, so laying it out adds exactly
 * one gap; folded, it is out of flow and adds none).
 *
 * @param element The box.
 * @returns The cost in px.
 */
function inlineCost(element: HTMLElement): number {
  const parent = element.parentElement;
  const gap = parent === null ? 0 : px(getComputedStyle(parent).columnGap, 0);
  return element.getBoundingClientRect().width + gap;
}

/**
 * The px the start row's pill labels lost to elision (each up to its own
 * `max-width` cap, a designed limit rather than a squeeze), so the row's
 * natural width is known even while the floor squeezes the pills.
 *
 * @param start The start content row.
 * @returns The summed lost px (0 when nothing is elided).
 */
function elisionDeficit(start: HTMLElement): number {
  let deficit = 0;
  for (const label of start.querySelectorAll<HTMLElement>(`[${FOLD_ELIDE_ATTRIBUTE}]`)) {
    const cap = px(getComputedStyle(label).maxWidth, Number.POSITIVE_INFINITY);
    deficit += Math.max(0, Math.min(label.scrollWidth, cap) - label.clientWidth);
  }
  return deficit;
}

/**
 * Read the bar's measured facts from layout. Reads only (called where
 * layout is already clean: a `ResizeObserver` callback).
 *
 * @param elements The measured elements.
 * @returns The facts, or null while the start row or "⋯" is not mounted.
 */
export function readFoldMetrics(elements: FoldElements): FoldMetrics | null {
  const { start, menu } = elements;
  const slot = start?.parentElement ?? null;
  if (start === null || slot === null || menu === null) return null;
  const slotStyle = getComputedStyle(slot);
  const slotContent =
    slot.getBoundingClientRect().width -
    px(slotStyle.paddingLeft, 0) -
    px(slotStyle.paddingRight, 0);
  // The extent: the row's box, or the content overflowing it (scrollWidth
  // covers in-flow overflow; folded parts lay out against the bar, not the row).
  const extent = Math.max(start.getBoundingClientRect().width, start.scrollWidth);
  const natural = extent + elisionDeficit(start);
  const widths: Partial<Record<TopBarFoldPart, number>> = {};
  let inlineSum = 0;
  for (const [part, element] of elements.parts) {
    const cost = inlineCost(element);
    widths[part] = cost;
    if (element.getAttribute(FOLD_STATE_ATTRIBUTE) === 'inline') inlineSum += cost;
  }
  return {
    free: slotContent - natural,
    widths,
    inlineCost: inlineSum,
    menuWidth: inlineCost(menu),
    menuShown: menu.getAttribute(FOLD_STATE_ATTRIBUTE) === 'inline'
  };
}

/** The production seams. */
export const REAL_FOLD_SEAMS: TopBarFoldSeams = {
  watch: watchFoldSizes,
  watchContent: watchFoldContent,
  read: readFoldMetrics
};

/** The bar's fold state and the refs that feed it. */
export interface TopBarFoldControl {
  /**
   * Whether a part shows inline: never a compact bar's rule-folded part;
   * otherwise unless the last decision folded it (a part not measured yet
   * mounts inline and is decided before paint).
   */
  readonly inline: (part: TopBarFoldPart) => boolean;
  /** Whether "⋯" shows (compact bar, or anything folded). */
  readonly menu: Accessor<boolean>;
  /** Register a mounted part's box; returns its unregister. */
  readonly register: (part: TopBarFoldPart, element: HTMLElement) => () => void;
  /** The start content row's ref (its parent, the start slot, is watched too). */
  readonly attachStart: (element: HTMLElement) => void;
  /** The "⋯" box's ref. */
  readonly attachMenu: (element: HTMLElement) => void;
}

/**
 * Create the bar's fold. Call inside the bar: the watch stops with it.
 *
 * @param compact The width rule's compact form (rule-folds the secondaries).
 * @param seams The measuring seams (production by default).
 * @returns The fold state and its refs.
 */
export function createTopBarFold(
  compact: Accessor<boolean>,
  seams: TopBarFoldSeams = REAL_FOLD_SEAMS
): TopBarFoldControl {
  const [decision, setDecision] = createSignal<TopBarFold | null>(null, {
    equals: sameTopBarFold
  });
  const parts = new Map<TopBarFoldPart, HTMLElement>();
  const labels = new Set<Element>();
  let start: HTMLElement | null = null;
  let menu: HTMLElement | null = null;
  let stopContent: (() => void) | undefined;

  /**
   * Keep the watch on the start row's current pill labels: a squeeze moves
   * only their inner widths, which no other watched box may reflect.
   */
  const syncLabels = (): void => {
    if (start === null) return;
    const current = new Set<Element>(start.querySelectorAll(`[${FOLD_ELIDE_ATTRIBUTE}]`));
    for (const label of labels) {
      if (current.has(label)) continue;
      watch.unobserve(label);
      labels.delete(label);
    }
    for (const label of current) {
      if (labels.has(label)) continue;
      watch.observe(label);
      labels.add(label);
    }
  };

  /** Re-decide from the current layout (a no-op until the bar is mounted). */
  const measure = (): void => {
    syncLabels();
    const metrics = seams.read({ start, parts, menu });
    if (metrics === null) return;
    const isCompact = compact();
    setDecision(
      foldTopBar({
        room: topBarFoldRoom({ ...metrics, compact: isCompact }),
        widths: metrics.widths,
        menuWidth: metrics.menuWidth,
        compact: isCompact,
        previous: decision()
      })
    );
  };
  // A layout callback, not a reactive scope: it reads the current state on
  // purpose and writes one decision.
  // eslint-disable-next-line solid/reactivity -- see above
  const watch = seams.watch(measure);
  onCleanup(() => {
    watch.disconnect();
    stopContent?.();
  });

  /**
   * Follow a content change in the start row: watch its current labels and
   * re-arm the row's size watch, which then reports the row afresh (a new
   * observation always reports once) — so the measure runs in the rendering
   * step, on clean layout, even when no watched box changed size.
   */
  const contentChanged = (): void => {
    if (start === null) return;
    syncLabels();
    watch.unobserve(start);
    watch.observe(start);
  };

  return {
    inline: (part) =>
      !(compact() && TOP_BAR_COMPACT_FOLDED.has(part)) &&
      !(decision()?.folded.includes(part) ?? false),
    menu: () => compact() || (decision()?.menu ?? false),
    register: (part, element) => {
      parts.set(part, element);
      watch.observe(element);
      return () => {
        watch.unobserve(element);
        if (parts.get(part) === element) parts.delete(part);
      };
    },
    attachStart: (element) => {
      start = element;
      watch.observe(element);
      stopContent?.();
      stopContent = seams.watchContent(element, contentChanged);
      // The slot's own size is the room; the parent exists once the row is
      // inserted, which happens after the ref runs — so watch it on the
      // next microtask.
      queueMicrotask(() => {
        if (start === element && element.parentElement !== null)
          watch.observe(element.parentElement);
      });
    },
    attachMenu: (element) => {
      menu = element;
      watch.observe(element);
    }
  };
}

/** Props of {@link FoldBox}. */
export interface FoldBoxProps {
  /** Whether the box shows inline (else laid out out of sight, still measured). */
  readonly inline: boolean;
  /** The box's ref. */
  readonly ref: (element: HTMLElement) => void;
  /** The box's own hook. */
  readonly 'data-fdt'?: string;
  /** The part this box is (its `data-fdt-fold-part` hook); none for "⋯". */
  readonly part?: TopBarFoldPart;
  /** Extra classes (spacing inside the box counts toward its width). */
  readonly class?: string;
  /** The content. */
  readonly children: JSX.Element;
}

/**
 * A measured box: inline in the flow, or folded — laid out at its natural
 * width out of flow and out of sight.
 *
 * @param props See {@link FoldBoxProps}.
 */
export function FoldBox(props: FoldBoxProps): JSX.Element {
  return (
    <span
      ref={(element) => {
        props.ref(element);
      }}
      data-fdt={props['data-fdt']}
      {...foldStateMark(props.inline)}
      data-fdt-fold-part={props.part}
      style={props.inline ? undefined : FOLDED_STYLE}
      class={cn('flex shrink-0 items-center whitespace-nowrap', props.class)}
    >
      {props.children}
    </span>
  );
}

/** Props of {@link FoldPart}. */
export interface FoldPartProps {
  /** The bar's fold. */
  readonly fold: TopBarFoldControl;
  /** Which part this box is. */
  readonly part: TopBarFoldPart;
  /** The box's own hook. */
  readonly 'data-fdt'?: string;
  /** Extra classes (spacing inside the box counts toward its width). */
  readonly class?: string;
  /** The content. */
  readonly children: JSX.Element;
}

/**
 * One foldable part: registered with the fold while mounted, inline or
 * folded as the fold decides.
 *
 * @param props See {@link FoldPartProps}.
 */
export function FoldPart(props: FoldPartProps): JSX.Element {
  let unregister: (() => void) | undefined;
  onCleanup(() => {
    unregister?.();
  });
  return (
    <FoldBox
      inline={props.fold.inline(props.part)}
      ref={(element) => {
        unregister = props.fold.register(props.part, element);
      }}
      data-fdt={props['data-fdt']}
      part={props.part}
      class={props.class}
    >
      {props.children}
    </FoldBox>
  );
}
