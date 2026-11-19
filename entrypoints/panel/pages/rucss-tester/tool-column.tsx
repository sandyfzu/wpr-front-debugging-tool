/**
 * One column of the tester's Test tab: a stack that becomes its own
 * scroller from `@wide` (beside the other column), painted in the canvas
 * color so every line of text in it — the ones below the fold included —
 * sits on a background that encloses it. While (and only while) it scrolls
 * it takes a Tab stop with the focus ring, so its overflow stays reachable
 * without a pointer even when it holds no control (a held Run, a skeleton).
 */
import type { JSX } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { FOCUS_RING } from '../../../../components/ui/classes';
import { watchOverflow, type OverflowWatcher } from '../../../../components/ui/overflow-watch';
import { cn } from '../../../../utils/cn';
import { PAGE_CANVAS } from '../page-frame';

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
