/**
 * The virtual list — the one list pattern for every ≥100-row surface
 * (one mechanism per list). A thin, typed wrapper around
 * `@tanstack/solid-virtual`'s `createVirtualizer`: it owns the scroller
 * geometry (relative spacer + absolute translate-and-measure rows) once, so
 * a page declares rows as data and gets a dense, cheap list — no per-page
 * virtualization math anywhere in the port.
 */
import type { JSX } from 'solid-js';
import { For, splitProps } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import type { VirtualItem } from '@tanstack/solid-virtual';
import { cn } from '../../utils/cn';

/** The virtual row type the wrapper renders (re-exported for consumers/tests). */
export type { VirtualItem };

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
  /** Stable per-row key (row identity for measurement reuse). */
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
};

/**
 * The instance seam — default wires the library; tests inject a double
 * serving fixed virtual items (happy-dom has no layout engine, so real
 * measurement is browser-tier work; the wrapper's *contract* is testable).
 */
export type VirtualizerFactory = (options: VirtualListOptions) => VirtualizerInstance;

/** The default factory: the library's own `createVirtualizer`. */
const defaultVirtualizerFactory: VirtualizerFactory = (options) => createVirtualizer(options);

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
  /** The trusted estimate above, per index. */
  estimateSize: (index: number) => number;
  /** Rows beyond the visible window (default {@link DEFAULT_OVERSCAN}). */
  overscan?: number;
  /** Stable row identity (default: index). */
  getItemKey?: (index: number) => string | number;
  /** Row gap in px (the layout adds it between rows). */
  gap?: number;
  /** Top padding in px (from scroller top to row 0). */
  paddingStart?: number;
  /** Bottom padding in px. */
  paddingEnd?: number;
  /** The instance seam (default: the TanStack factory). */
  createVirtualizer?: VirtualizerFactory;
  /** Classes on the scroller (height caps belong here, e.g. `h-full`). */
  class?: string;
  /** The row renderer; called per virtual row with its measured geometry. */
  children: (row: VirtualItem) => JSX.Element;
};

/**
 * Render the virtualized list.
 *
 * Layout contract (verified against the installed virtual-core): a relative
 * inner divider sized `getTotalSize()` scrolls inside the wrapper's own
 * `overflow-y-auto` container; each row is absolutely positioned at its
 * `start` offset via `translateY`, sized to its (measured-refined) `size`,
 * and carries `data-index` so the TanStack measurement ref attached to it
 * keeps heights live. `estimateSize` seeds the first paint; measurement
 * corrects any estimator error afterward. The virtualizer lifecycle is
 * Solid-wired by its own adapter (its `_didMount` cleanup runs on unmount).
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
    'class',
    'children'
  ]);

  let scroller: HTMLDivElement | undefined;

  /**
   * The instance factory resolution — read through a closure so the prop read
   * stays lazy (the choice is settled once, at instance construction, which is
   * correct semantics for a bootstrap).
   */
  const factoryOf = (): VirtualizerFactory => own.createVirtualizer ?? defaultVirtualizerFactory;

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
      return own.getItemKey;
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

  return (
    <div
      ref={scroller}
      data-fdt="virtual-list"
      role={own.scrollerRole}
      class={cn('relative overflow-y-auto', own.class)}
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
        <For each={virtualizer.getVirtualItems()}>
          {(row) => (
            <div
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${String(row.start)}px)`,
                height: `${String(row.size)}px`
              }}
            >
              {own.children(row)}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
