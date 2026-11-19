/**
 * The tool pages' two-column layout (settings beside the result) and its
 * columns. Each column is a stack that becomes its own scroller from
 * `@wide`, painted in the canvas color so every line of text in it — the
 * ones below the fold included — sits on a background that encloses it.
 * While (and only while) it scrolls it takes a Tab stop with the focus
 * ring, so its overflow stays reachable without a pointer even when it
 * holds no control (a held Run, a skeleton).
 */
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { FOCUS_RING } from '../../../components/ui/classes';
import { watchOverflow, type OverflowWatcher } from '../../../components/ui/overflow-watch';
import { cn } from '../../../utils/cn';
import { PAGE_CANVAS } from './page-frame';

/**
 * The tool grid: one column below `@wide` (the result column first in DOM
 * order, so the run bar leads); from it the 340 px settings column beside
 * the result, the grid taking the page's remaining height (the fill
 * scroller's floor and containment, `PAGE_FILL_SCROLLER`, at this tier only)
 * so each column scrolls on its own. Columns place themselves with
 * {@link TOOL_AREAS}.
 */
export const TOOL_LAYOUT =
  'grid min-w-0 grid-cols-1 gap-4 @wide:min-h-48 @wide:flex-1 @wide:contain-size @wide:grid-cols-[21.25rem_minmax(0,1fr)] @wide:grid-rows-[minmax(0,1fr)] @wide:[grid-template-areas:"settings_result"]';

/** Each column's grid area from `@wide` (literal classes: Tailwind reads them from source). */
export const TOOL_AREAS = {
  settings: '@wide:[grid-area:settings]',
  result: '@wide:[grid-area:result]'
} as const;

/**
 * A page-scoped hook attribute, `data-fdt-<page>-<part>` (one name per page,
 * so each tool page's tests and specs keep their own selectors).
 *
 * @param page The page's hook prefix, e.g. `rucss`.
 * @param part The part, e.g. `section-toggle`.
 * @param value The attribute's value (`''` for a marker).
 * @returns The attribute, ready to spread.
 */
export function pageHook(page: string, part: string, value = ''): Record<string, string> {
  return { [`data-fdt-${page}-${part}`]: value };
}

/** Props of {@link ToolColumn}. */
export interface ToolColumnProps {
  /** The `data-fdt` hook. */
  hook: string;
  /** The column's grid area from `@wide` (a literal class, e.g. `@wide:[grid-area:result]`). */
  area: string;
  /** The accessible name (a column without a heading). */
  label?: string;
  /** The id of the column's heading (a column with one). */
  labelledBy?: string;
  /** Overflow seam (tests inject a manual watcher). */
  watchOverflow?: OverflowWatcher;
  children: JSX.Element;
}

/**
 * Render the column.
 *
 * @param props See {@link ToolColumnProps}.
 */
export function ToolColumn(props: ToolColumnProps): JSX.Element {
  const [scrollable, setScrollable] = createSignal(false);
  let box: HTMLElement | undefined;
  let content: HTMLDivElement | undefined;
  onMount(() => {
    if (box === undefined || content === undefined) return;
    // Read once: the watcher is fixed per mount.
    const watch = props.watchOverflow ?? watchOverflow;
    onCleanup(watch(box, content, setScrollable));
  });
  return (
    <section
      ref={box}
      data-fdt={props.hook}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      data-fdt-scrollable={scrollable() ? '' : undefined}
      tabindex={scrollable() ? 0 : undefined}
      class={cn(
        'min-w-0 rounded-md @wide:min-h-0 @wide:overflow-y-auto',
        PAGE_CANVAS,
        FOCUS_RING,
        props.area
      )}
    >
      {/* From @wide: at least the column's height (a `flex-1` child fills it) and a little
          room before the scrollbar, so it never touches a card's edge. */}
      <div ref={content} class="flex min-w-0 flex-col gap-2.5 @wide:min-h-full @wide:pe-1">
        {props.children}
      </div>
    </section>
  );
}
