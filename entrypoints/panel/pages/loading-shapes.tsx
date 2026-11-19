/**
 * Loading shapes: the placeholder body a route shows while its data (the
 * boot's first fetch) or its code (a lazy page's chunk) is on the way,
 * shaped like the page that will land (S-1: a real wait only, never a
 * timer). One shape per nav journey group, so a new route inherits its
 * group's shape and a new group is one row in {@link LOADING_SHAPES}:
 * Overview = the Detections tiles + grouped cards, Inspect and Diagnose =
 * a calm list (toolbar, two-line rows), Tools = the run card over the empty
 * result card.
 *
 * The page header above the body reserves the landed header's lines too
 * ({@link LoadingSubtitle}, {@link LoadingActions}), so the body's top does
 * not jump when the page lands.
 *
 * Every placeholder is a `Skeleton` (the pulse reduced motion stills) laid
 * on the same surfaces the page uses — raised cards for card content, the
 * canvas for list rows — and bounded by its column (`max-w-full`), so no
 * width ever scrolls sideways. Decorative: the page heading above names
 * the wait.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Card } from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../utils/cn';
import { OverviewSkeleton } from './detections/overview-tiles';
import { hasHeaderActions, navRoute, type NavGroup, type RouteId } from '../routes';

/** A text-line placeholder: a short pill, its width from the caller. */
const LINE = 'h-2.5 max-w-full rounded-full';

/** The row count a list shape shows (enough to read as a list at any height). */
export const LIST_SHAPE_ROWS = 6;

/** The row count each grouped card of the Detections shape shows. */
export const GROUP_SHAPE_ROWS = 4;

/**
 * One placeholder line.
 *
 * @param props.class Its width (and any height override).
 */
function Line(props: { class: string }): JSX.Element {
  return <Skeleton class={cn(LINE, props.class)} />;
}

/**
 * The Detections page's shape: the overview tiles, the filter tray, then
 * two grouped cards (side by side from the wide tier, as the page's groups).
 */
function OverviewShape(): JSX.Element {
  return (
    <>
      <OverviewSkeleton />
      <Skeleton class="h-7 w-64 max-w-full rounded-lg" />
      <div class="grid grid-cols-1 items-start gap-3 @wide:grid-cols-2">
        <For each={[0, 1]}>
          {() => (
            <Card>
              <div class="flex flex-col gap-4 px-1 py-1">
                <Line class="h-3 w-32" />
                <For each={Array.from({ length: GROUP_SHAPE_ROWS })}>
                  {() => (
                    <div class="flex items-center gap-2.5">
                      <Skeleton class="size-4 max-w-full shrink-0 rounded-full" />
                      <Line class="w-44" />
                    </div>
                  )}
                </For>
              </div>
            </Card>
          )}
        </For>
      </div>
    </>
  );
}

/**
 * A list page's shape: the toolbar (a facet tray, the search field), then
 * calm two-line rows on the canvas — icon tile, name, preview line.
 */
function ListShape(): JSX.Element {
  return (
    <>
      <div class="flex flex-wrap items-center gap-2">
        <Skeleton class="h-7 w-48 max-w-full rounded-lg" />
        <Skeleton class="h-7 w-56 max-w-full rounded-control @regular:ms-auto" />
      </div>
      <div class="flex flex-col gap-1">
        <For each={Array.from({ length: LIST_SHAPE_ROWS })}>
          {() => (
            <div class="flex min-h-[58px] items-center gap-3 px-3.5">
              <Skeleton class="size-7 max-w-full shrink-0 rounded-md" />
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <Line class="h-3 w-40" />
                <Line class="w-full @regular:w-96" />
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

/**
 * A tool page's shape: the run card (the button and its one-line note)
 * over the dashed empty-result card (tile, title, sentence).
 */
function ToolShape(): JSX.Element {
  return (
    <>
      <Card>
        <div class="flex items-center gap-3">
          <Skeleton class="h-7 w-24 max-w-full shrink-0 rounded-control" />
          <Line class="w-full @regular:w-96" />
        </div>
      </Card>
      <Card look="placeholder">
        <div class="flex min-h-48 flex-col items-center justify-center gap-2.5">
          <Skeleton class="size-11 max-w-full rounded-lg" />
          <Line class="h-3 w-32" />
          <Line class="w-56" />
        </div>
      </Card>
    </>
  );
}

/**
 * The page header's subtitle placeholder (every page has a one-sentence
 * subtitle): two text lines while the header wraps it under the title
 * (compact), one beside the title from the regular tier — the sentence's
 * usual run. Each line is a pill centered in a 16 px line box (the
 * subtitle's `text-xs` leading), so the reserved height matches the text's.
 * While compact its width is the page's line (the page container's width
 * less the canvas's `p-3`; the canvas cap sits far above the compact tier):
 * a text sentence shrinks to the line it wraps onto, a fixed-width block
 * would not, and a percentage of the shrink-to-fit header slot resolves
 * to nothing.
 */
export function LoadingSubtitle(): JSX.Element {
  return (
    <div
      data-fdt="loading-subtitle"
      aria-hidden="true"
      class="flex w-[calc(100cqw-1.5rem)] max-w-full flex-col gap-1.5 py-[3px] @regular:w-72"
    >
      <Line class="w-full" />
      <Line class="w-2/3 @regular:hidden" />
    </div>
  );
}

/** Props of {@link LoadingActions}. */
export interface LoadingActionsProps {
  /** The route that will land (only a route with header actions reserves a cluster). */
  route: RouteId;
}

/**
 * The page header's actions placeholder: one small button's box (24 px, the
 * `sm` button) for a route whose header has actions, nothing otherwise.
 *
 * @param props See {@link LoadingActionsProps}.
 */
export function LoadingActions(props: LoadingActionsProps): JSX.Element {
  return (
    <Show when={hasHeaderActions(props.route)}>
      <Skeleton class="h-6 w-24 max-w-full rounded-control" />
    </Show>
  );
}

/** Each journey group's shape (the compiler checks every group has one). */
export const LOADING_SHAPES: Readonly<Record<NavGroup, () => JSX.Element>> = {
  Overview: OverviewShape,
  Inspect: ListShape,
  Diagnose: ListShape,
  Tools: ToolShape
};

/**
 * Pick a route's shape: its nav group's, the list shape for a route outside
 * the nav (the commonest page kind).
 *
 * @param route The route that will land.
 * @returns The shape component.
 */
export function loadingShapeFor(route: RouteId): () => JSX.Element {
  return LOADING_SHAPES[navRoute(route)?.group ?? 'Inspect'];
}

/** Props of {@link RouteLoading}. */
export interface RouteLoadingProps {
  /** The route that will land (its group picks the shape; a change swaps it). */
  route: RouteId;
}

/**
 * Render the route's loading body (decorative: `aria-hidden`).
 *
 * @param props See {@link RouteLoadingProps}.
 */
export function RouteLoading(props: RouteLoadingProps): JSX.Element {
  return (
    <div
      data-fdt="route-loading"
      data-fdt-loading-shape={navRoute(props.route)?.group ?? 'Inspect'}
      aria-hidden="true"
      class="flex flex-col gap-3"
    >
      <Dynamic component={loadingShapeFor(props.route)} />
    </div>
  );
}
