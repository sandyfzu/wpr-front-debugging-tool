/**
 * The virtual list — the one list pattern for every ≥100-row surface
 * (one mechanism per list). A thin, typed wrapper around
 * `@tanstack/solid-virtual`'s `createVirtualizer`: it owns the scroller
 * geometry (relative spacer + absolute translate-and-measure rows) once, so
 * a page declares rows as data and gets a dense, cheap list — no per-page
 * virtualization math anywhere in the port.
 */
import type { Accessor, JSX } from 'solid-js';
import { createComputed, createEffect, createMemo, For, on, onCleanup, splitProps } from 'solid-js';
import type { EntryMaskHandle } from './virtual-list-entry';
import { createVirtualizer } from '@tanstack/solid-virtual';
import type { VirtualItem } from '@tanstack/solid-virtual';
import { createLogger } from '../../lib/logger';
import { attachEntryMask } from './virtual-list-entry';
import { focusedElementOf, preserveMovedFocus } from './virtual-list-focus';
import { snapshotKeys, type KeySnapshot } from './virtual-list-keys';

/** The virtual row type the wrapper renders (re-exported for consumers/tests). */
export type { VirtualItem };

/** Dev diagnostics for caller contract violations (duplicate keys). */
const log = createLogger('virtual-list');

/** Extra rows rendered beyond the visible window (the default `overscan`). */
const DEFAULT_OVERSCAN = 3;

/**
 * The option set the wrapper configures TanStack's virtualizer with — the
 * wrapper's contract expressed structurally (kept independent of the
 * `VirtualizerOptions` unions so test doubles need only this shape).
 */
export interface VirtualListOptions {
  /** The row count (a page's filtered length). */
  count: number;
  /**
   * Estimated row height in px — the seed for scroll-window math until real
   * measurement (via `measureElement`) refines it.
   */
  estimateSize: (index: number) => number;
  /** The scroller element getter (the wrapper's own container, `null` pre-mount). */
  getScrollElement: () => HTMLDivElement | null;
  /** Rows rendered beyond the visible window. */
  overscan: number;
  /** Stable, unique per-row key (row identity for measurement reuse). */
  getItemKey?: (index: number) => string | number;
  /** Row gap inside the layout stack (px). */
  gap?: number;
  /** Padding from the scroller top to row 0 (px). */
  paddingStart?: number;
  /** Padding from the last row to the scroller bottom (px). */
  paddingEnd?: number;
}

/** The instance surface the wrapper consumes from its virtualizer. */
export type VirtualizerInstance = {
  /** The rows inside the current render window (in order). */
  getVirtualItems: () => VirtualItem[];
  /** The total laid-out height in px (spacer sizing). */
  getTotalSize: () => number;
  /**
   * Keep one row's measured height in the cache; the wrapper binds every row
   * element through a ref.
   *
   * @param node The row element carrying `data-index`.
   */
  measureElement: (node: HTMLElement | null) => void;
  /**
   * The core's typed index scroll, consumed by the {@link VirtualListProps.scrollTo}
   * requests — instant (the core's `behavior: 'auto'`), aligned to the nearest
   * edge for a row partly or wholly outside the viewport, and a no-op for a
   * fully visible row. The real instance always provides it; layout-free test
   * doubles may omit it (then a request lands nothing).
   *
   * @param index The row index (clamped into `count` by the core).
   * @param options Alignment (`'auto'` is the nearest-edge semantics above).
   */
  scrollToIndex?: (
    index: number,
    options?: { align?: 'auto' | 'start' | 'end' | 'center' }
  ) => void;
};

/**
 * One scroll request: which virtual row to land on. The row's identity is its
 * index in the list the *consumer* renders (the same index space
 * `children(row)` runs in), so a request names a row the list knows.
 */
export interface VirtualScrollRequest {
  /** Zero-based virtual row index. */
  readonly index: number;
}

/**
 * The instance seam — default wires the library; tests inject a double
 * serving fixed virtual items (happy-dom has no layout engine, so real
 * measurement is browser-tier work; the wrapper's *contract* is testable).
 */
export type VirtualizerFactory = (options: VirtualListOptions) => VirtualizerInstance;

/** The default factory: the library's own `createVirtualizer`. */
const defaultVirtualizerFactory: VirtualizerFactory = (options) => createVirtualizer(options);

/**
 * Name the duplicate keys of a window (dev only): the map keeps one item
 * per key, so every duplicate silently drops a row.
 *
 * @param items The window's items.
 */
function warnDuplicateKeys(items: readonly VirtualItem[]): void {
  const seen = new Set<VirtualItem['key']>();
  const duplicates = new Set<VirtualItem['key']>();
  for (const item of items) (seen.has(item.key) ? duplicates : seen).add(item.key);
  log.warn(
    `duplicate row keys ${[...duplicates].map(String).join(', ')} — rows are dropped; getItemKey must be unique`
  );
}

export type VirtualListProps = {
  /**
   * The scroller's ARIA role, for surfaces that are semantically a list.
   * Deliberately unset by default: this wrapper's rows are the caller's
   * content (often cards), which are `listitem`s only when the caller says
   * so — a `role="list"` over non-listitem children is an invalid ARIA tree,
   * strictly worse than none. Opt in with `list` only when your row renderer
   * emits `role="listitem"`; use `feed` for stream-style surfaces whose rows
   * self-describe.
   */
  scrollerRole?: 'list' | 'feed';
  /** Accessible name of the scroller (e.g. "Delayed scripts") — the list's content in one phrase. */
  'aria-label'?: string;
  /** The row count. */
  count: number;
  /**
   * Seed row height in px, per index — scroll math only until the row's
   * content is measured; never a rendered height (rows size to content).
   */
  estimateSize: (index: number) => number;
  /** Rows beyond the visible window (default {@link DEFAULT_OVERSCAN}). */
  overscan?: number;
  /**
   * Stable, unique row identity (default: index). Pass it for any list that
   * filters, sorts or prepends: a rendered row element and its measured size
   * follow the key, so surviving rows keep their element and size — and
   * focus, unless a reorder moves their DOM node (DOM order stays the visual
   * order, i.e. the tab and reading order). Duplicate keys drop rows (dev
   * builds warn).
   */
  getItemKey?: (index: number) => string | number;
  /** Row gap in px (the layout adds it between rows). */
  gap?: number;
  /** Top padding in px (from scroller top to row 0). */
  paddingStart?: number;
  /** Bottom padding in px. */
  paddingEnd?: number;
  /** The instance seam (default: the TanStack factory). */
  createVirtualizer?: VirtualizerFactory;
  /**
   * The row a scroll request keeps in view, or `null` without one. Each
   * request scrolls once, when it *changes* (a fresh request object per
   * event; the consumer builds requests, e.g. the panel search's active
   * match): instant, nearest-edge alignment (`behavior: 'auto'`), and no
   * movement at all for a fully visible row — reactive scrolls never
   * re-fire for an unchanged request, so list refreshes and user scrolling
   * do not animate under a live request.
   *
   * A request that already exists when the list mounts is not a scroll
   * order: mount geometry is unmeasured (seed estimates), so an anchor would
   * land by estimate and visibly re-land when measurement corrects. The
   * deliberate contract — a page remounting under a live find (the
   * refresh/retry lifecycle) re-reports the count and renders the marker at
   * the cursor's row but never auto-anchors; the user keeps the page they
   * asked for, and the next find event's fresh request is the scroll.
   */
  scrollTo?: Accessor<VirtualScrollRequest | null>;
  /** Classes on the scroller (height caps belong here, e.g. `h-full`). */
  class?: string;
  /**
   * The row renderer; called per virtual row with its measured geometry. The
   * rendered content sets the row's height (expanding it re-flows the list).
   */
  children: (row: VirtualItem) => JSX.Element;
};

/**
 * Render the virtualized list.
 *
 * Layout contract (verified against the installed virtual-core): a relative
 * inner divider sized `getTotalSize()` scrolls inside the wrapper's own
 * `overflow-y-auto` container; each row is absolutely positioned at its
 * `start` offset via `translateY` and carries `data-index`. Rows get **no
 * height**: they size to their content, and the measurement ref observes
 * each row's border box, so variable-height rows (wrapped text, an expanded
 * code block) re-measure on any resize and push later rows down — a pinned
 * height would make the observer read the estimate back and let content
 * overflow into the next row. Sizes are cached rounded to whole px, so a
 * fractional-height row may overlap the next by ≤ 0.5 px (invisible).
 * `estimateSize` seeds only the scroll math before a row's first measurement
 * (corrected before paint). When a row entirely above the viewport changes
 * size, the virtualizer compensates `scrollTop` so the visible rows stay put
 * — except while the user scrolls backward (the library skips it then, to
 * avoid a jump cascade). Fixed-height lists need nothing extra: their row
 * content sets the height.
 *
 * Row identity: one element per **key** for its whole life. The core caches
 * sizes and observed elements by key, while the adapter's item store is
 * keyed by index — an element bound to an index would carry a stale key
 * after a filter (never re-measured) and could make the core drop a live
 * element's observer. Keying elements by key keeps both in step: a refresh
 * with the same keys remounts nothing (DOM and focus survive), a key that
 * moves index keeps its element and size (only `data-index` and the offset
 * update; focus survives unless a reorder moves the DOM node — DOM order is
 * kept equal to visual order, the tab and reading order), and a new key gets
 * a fresh, measured element. The virtualizer lifecycle
 * is Solid-wired by its own adapter (its `_didMount` cleanup runs on
 * unmount).
 *
 * Tab entry: the wrapper masks rows entirely outside its viewport for the
 * duration of one Tab/Shift+Tab press, so browser navigation lands on the
 * first or last visible row's control instead of an offscreen overscan row
 * (see `./virtual-list-entry`).
 *
 * Rows render exactly what the caller's `children` maps per row — this
 * wrapper owns geometry only, never data shape.
 *
 * @param props.count The row count.
 * @param props.scrollerRole Optional list/feed role for the scroller (default: none — see the prop's note).
 * @param props['aria-label'] The scroller's accessible name (default: none).
 * @param props.estimateSize Per-index seed height (px).
 * @param props.overscan Buffer rows beyond the window (default 3).
 * @param props.getItemKey Stable row identity (default index).
 * @param props.gap Row gap (px).
 * @param props.paddingStart Scroller-top padding (px).
 * @param props.paddingEnd Bottom padding (px).
 * @param props.createVirtualizer Instance seam.
 * @param props.scrollTo The row a scroll request lands on (see the prop's doc).
 * @param props.class Classes on the scroller.
 * @param props.children Row renderer per virtual row.
 * @returns The rendered scroller.
 */
export function VirtualList(props: VirtualListProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'scrollerRole',
    'count',
    'estimateSize',
    'overscan',
    'getItemKey',
    'gap',
    'paddingStart',
    'paddingEnd',
    'createVirtualizer',
    'scrollTo',
    'class',
    'children'
  ]);

  let scroller: HTMLDivElement | undefined;
  let releaseEntryMask: EntryMaskHandle | undefined;
  onCleanup(() => releaseEntryMask?.());

  /**
   * The instance factory resolution — read through a closure so the prop read
   * stays lazy (the choice is settled once, at instance construction, which is
   * correct semantics for a bootstrap).
   */
  const factoryOf = (): VirtualizerFactory => own.createVirtualizer ?? defaultVirtualizerFactory;

  // The caller's keys, re-issued under a new function identity whenever they
  // change: the core re-keys its rows only when `count` or the key function's
  // identity changes, so rows swapped at an equal count would keep their old
  // keys (and the list would render rows no longer listed). Reading every key
  // here tracks the caller's rows; unchanged keys keep the same snapshot.
  const itemKeys = createMemo<KeySnapshot | undefined>((previous) => {
    const keyOf = own.getItemKey;
    return keyOf === undefined ? undefined : snapshotKeys(previous, keyOf, own.count);
  });

  // Options are a lazy getter object: reads happen when the virtualizer pulls
  // them (inside the adapter's own update cycle), so count/filter changes
  // re-flow without recreating the instance — and the props stay reactive
  // through the getter (a plain literal would snapshot once).
  // eslint-disable-next-line solid/reactivity -- bootstrap: the factory settles once at instance construction (re-selection per read is meaningless for a single instance)
  const virtualizer = factoryOf()({
    get count() {
      return own.count;
    },
    get estimateSize() {
      return own.estimateSize;
    },
    getScrollElement: () => scroller ?? null,
    get overscan() {
      return own.overscan ?? DEFAULT_OVERSCAN;
    },
    get getItemKey() {
      return itemKeys()?.at;
    },
    get gap() {
      return own.gap;
    },
    get paddingStart() {
      return own.paddingStart;
    },
    get paddingEnd() {
      return own.paddingEnd;
    }
  });

  // The scroll requests: one instant, nearest-edge write per fresh request
  // (an updated index), per the `scrollTo` prop's contract. The deferred `on`
  // is that contract's mechanics — a request present at mount is not a
  // scroll order (only events after the mount are) — and the core clamps
  // the index.
  createEffect(
    on(
      () => own.scrollTo?.() ?? null,
      (request) => {
        if (request !== null) virtualizer.scrollToIndex?.(request.index);
      },
      { defer: true }
    )
  );

  /**
   * Hand a new row element to measurement. Solid runs `ref` before it
   * applies a row's attributes, while the core resolves a measured element's
   * index from `data-index` (no index → never observed), so the index is
   * stamped first; the reactive `data-index` binding keeps it current after.
   *
   * @param el The freshly created row element.
   * @param index The row's virtual index.
   */
  const bindRow = (el: HTMLDivElement, index: number): void => {
    el.setAttribute('data-index', String(index));
    virtualizer.measureElement(el);
  };

  /**
   * The rendered window by key. Its values are the adapter's store items, so
   * geometry reads stay fine-grained; the map itself changes only when the
   * window's keys change (scroll, filter).
   */
  const rowByKey = createMemo(() => {
    const items = virtualizer.getVirtualItems();
    const byKey = new Map(items.map((item) => [item.key, item] as const));
    if (import.meta.env.DEV && byKey.size < items.length) warnDuplicateKeys(items);
    return byKey;
  });
  /** The window's keys in order — primitives, so `For` maps one element per key. */
  const windowKeys = createMemo(() => [...rowByKey().keys()]);
  let cancelFocusRestore: (() => void) | undefined;
  onCleanup(() => cancelFocusRestore?.());

  // Capture before For moves keyed DOM nodes: insertBefore drops native focus
  // even when the control survives. Restore only a retained control, never a replacement.
  createComputed(
    on(
      windowKeys,
      () => {
        if (scroller !== undefined && scroller.contains(focusedElementOf(scroller))) {
          cancelFocusRestore?.();
          cancelFocusRestore = preserveMovedFocus(scroller);
        }
      },
      { defer: true }
    )
  );

  /**
   * A live row view for one key: reads the item currently holding that key,
   * keeping the last one while the key leaves the window (its element is
   * being disposed in the same update).
   *
   * @param key The row key the element is bound to.
   * @returns A {@link VirtualItem} whose fields track that key's item.
   * @throws {@link Error} When the key is not in the window at creation (a
   *   broken invariant: keys come from the same map).
   */
  const rowView = (key: VirtualItem['key']): VirtualItem => {
    const initialItem = rowByKey().get(key);
    if (!initialItem) {
      throw new Error(`[WPR FDT] virtual-list: key ${String(key)} is not in the window`);
    }
    // Owned by the row's `For` scope, so it is disposed with the element.
    // `?? prev` is a guard: `For` disposes a departing key's row before this
    // memo re-runs (observed), but if it ever re-ran first, the row keeps its
    // last geometry instead of reading `undefined`.
    const current = createMemo<VirtualItem>((prev) => rowByKey().get(key) ?? prev, initialItem);
    return {
      key,
      get index() {
        return current().index;
      },
      get start() {
        return current().start;
      },
      get end() {
        return current().end;
      },
      get size() {
        return current().size;
      },
      get lane() {
        return current().lane;
      }
    };
  };

  return (
    <div
      ref={(el) => {
        scroller = el;
        releaseEntryMask = attachEntryMask(el);
      }}
      data-fdt="virtual-list"
      role={own.scrollerRole}
      // A plain join, not a class merge: the wrapper's two utilities never
      // conflict with a caller's (callers own sizing/borders), and a merge
      // library would ride along into every consumer, Tailwind or not.
      class={
        own.class === undefined
          ? 'relative overflow-y-auto'
          : `relative overflow-y-auto ${own.class}`
      }
      {...rest}
    >
      <div
        data-fdt-virtual-spacer
        style={{
          height: `${String(virtualizer.getTotalSize())}px`,
          position: 'relative',
          width: '100%'
        }}
      >
        <For each={windowKeys()}>
          {(key) => {
            // eslint-disable-next-line solid/reactivity -- the view is a stable object of reactive getters (created once per keyed element); its fields are read live
            const row = rowView(key);
            return (
              <div
                data-index={row.index}
                ref={(el) => {
                  bindRow(el, row.index);
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  // No height: the row sizes to its content so the measurement
                  // ref (border-box ResizeObserver) reads the real height and
                  // re-flows siblings when it changes (wrap, expand/collapse).
                  transform: `translateY(${String(row.start)}px)`
                }}
              >
                {own.children(row)}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
