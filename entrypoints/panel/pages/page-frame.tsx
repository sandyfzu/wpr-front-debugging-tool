/**
 * The page seam every panel page body builds on: the frame (entrance, container
 * query root, focus target, the single `h1`), the filtered-empty view, and the
 * external link. Declared once here so page folders never re-invent them.
 */
import type { JSX } from 'solid-js';
import { createMemo, onCleanup, Show } from 'solid-js';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import SearchX from 'lucide-solid/icons/search-x';
import { Button } from '../../../components/ui/button';
import { FOCUS_RING } from '../../../components/ui/classes';
import { EmptyState } from '../../../components/ui/empty-state';
import { PageHeader } from '../../../components/ui/page-header';
import { cn } from '../../../utils/cn';
import { capTitle } from '../../../utils/cap-text';
import { isHttpUrl } from '../../../utils/urls';
import { navRoute, type RouteId } from '../routes';

/**
 * Classes for the one scroller of a `fill` frame (usually the `VirtualList`):
 * it takes the remaining height but never shrinks below 12 rem — below that,
 * the panel's content region scrolls (the frame's bottom padding included)
 * instead of the list clipping. `contain-size` keeps the list's content height
 * out of the frame's intrinsic height; without it the frame would grow to the
 * whole list and the list would never scroll itself.
 */
export const PAGE_FILL_SCROLLER = 'min-h-48 flex-1 contain-size';

/** Props of {@link PageFrame}. */
export interface PageFrameProps {
  /** The route the body renders — tags the root for focus management and tests. */
  id: RouteId;
  /** The page title, rendered as the page's only `h1`. */
  title: string;
  /** The one-line "what am I looking at" under the title. */
  subtitle?: string;
  /** The title row's actions cluster (right-aligned, wraps under the title when narrow). */
  actions?: JSX.Element;
  /**
   * Fill mode for list pages: the frame spans at least the content region's
   * height as a flex column, so header/summary/filters stay put while the child
   * carrying {@link PAGE_FILL_SCROLLER} takes the rest and scrolls. Default:
   * natural height.
   */
  fill?: boolean;
  /** The page content, laid out as a `gap-3` column of sections below the header. */
  children?: JSX.Element;
}

/**
 * Render a panel page's frame.
 *
 * The root carries the shell's mount-only `.fdt-page` entrance (pages never
 * animate their own mount) and `data-fdt-page`, which makes its `h1` the
 * route-switch focus target. The root is also the **unpadded** `@container`:
 * a page's tier variants (`@regular:`/`@wide:`, UI/UX bar L-1) read the full content-region width
 * (panel width − the ≈ 49 px icon rail), not the width left after the frame's
 * own `p-3`. The root clips its animated canvas's visual overflow so entrance
 * motion cannot add a scrollbar. The canvas retains a transform, so nothing inside a
 * page may be `position: fixed` — floating UI goes through the portaled
 * primitives.
 *
 * @param props.id The route id, written to `data-fdt-page`.
 * @param props.title The page `h1`.
 * @param props.subtitle Optional intro line.
 * @param props.actions Optional actions cluster.
 * @param props.fill Full-height flex column for list pages (default `false`).
 * @param props.children The page sections.
 */
export function PageFrame(props: PageFrameProps): JSX.Element {
  return (
    <section
      class={cn('fdt-page @container', props.fill && 'flex min-h-full flex-col')}
      data-fdt-page={props.id}
    >
      <PageCanvas id={props.id} fill={props.fill}>
        <PageHeader title={props.title} subtitle={props.subtitle} actions={props.actions} />
        {props.children}
      </PageCanvas>
    </section>
  );
}

/** Props of the shared canvas used by page bodies and their shell fallbacks. */
interface PageCanvasProps {
  /** The destination route owns the width, even before its data arrives. */
  id: RouteId;
  /** Stretch inside a full-height page frame. */
  fill?: boolean;
  /** Ready content, genuine loading placeholders, or an actionable error. */
  children?: JSX.Element;
}

/**
 * Keep every state on the route's centered, padded canvas without inventing a heading.
 * The caller keeps the unpadded query container outside this wrapper.
 * @param props Destination route, optional fill mode, and body content.
 * @returns The shared body column; changing routes updates its width in place.
 */
export function PageCanvas(props: PageCanvasProps): JSX.Element {
  return (
    <div
      data-fdt="page-body"
      class={cn(
        'mx-auto flex w-full min-w-0 flex-col gap-3 p-3',
        navRoute(props.id)?.reading ? 'max-w-4xl' : 'max-w-7xl',
        props.fill && 'flex-1'
      )}
    >
      {props.children}
    </div>
  );
}

/** Longest query (in code points) echoed verbatim in the filtered-empty sentence. */
export const NO_MATCHES_QUERY_MAX = 60;

/**
 * Build the filtered-empty sentence naming what is narrowing the list.
 *
 * Blank inputs count as unset; an over-long query is cut by code point (never
 * splitting a surrogate pair) and elided with `…`, so a pasted blob cannot
 * flood the view. Narrowing facet values (combinable filters) take the
 * chip's place, each quoted, in facet order.
 *
 * @param chipLabel The selected filter chip's label, if a non-"all" chip is active.
 * @param query The committed search query, if any.
 * @param filterLabels The narrowing facet values' labels (facet lists; blank ones ignored).
 * @returns One sentence naming the chip or facet values and/or the query.
 */
export function noMatchesSentence(
  chipLabel?: string,
  query?: string,
  filterLabels?: readonly string[]
): string {
  const filters = (filterLabels ?? []).map((label) => label.trim()).filter((label) => label !== '');
  const chip = filters.length > 0 ? filters.join('", "') : (chipLabel?.trim() ?? '');
  const noun = filters.length > 1 ? 'filters' : 'filter';
  const points = Array.from(query?.trim() ?? '');
  const shown =
    points.length > NO_MATCHES_QUERY_MAX
      ? `${points.slice(0, NO_MATCHES_QUERY_MAX).join('')}…`
      : points.join('');
  if (chip && shown) return `Nothing in "${chip}" matches "${shown}".`;
  if (chip) return `Nothing matches the "${chip}" ${noun}.`;
  if (shown) return `Nothing matches "${shown}".`;
  return 'Nothing matches the current filters.';
}

/** The ways back out of a filtered-empty view. */
export type NoMatchesAction = 'clear-search' | 'show-all' | 'clear-filters';

/**
 * Where focus goes after a {@link NoMatches} action removes the focused
 * button: the element to focus, or nothing for the default.
 */
export type NoMatchesFocusTarget = (action: NoMatchesAction) => HTMLElement | null | undefined;

/** Props of {@link NoMatches}. */
export interface NoMatchesProps {
  /** The active filter chip's label (omit for the "all" chip). */
  chipLabel?: string;
  /** The committed search query (omit or blank when no search is active). */
  query?: string;
  /** Clears the search; `Clear search` renders only with this and a non-blank `query`. */
  onClearSearch?: () => void;
  /** Resets the filter to "all"; `Show all` renders only with this and a non-blank `chipLabel`. */
  onShowAll?: () => void;
  /** The reset button's label when "Show all" alone would be vague (default "Show all"). */
  showAllLabel?: string;
  /**
   * The narrowing facet values' labels (a facet list; the chip props stay
   * unset). Named in the sentence; with {@link NoMatchesProps.onClearFilters}
   * they offer `Clear filters`.
   */
  filterLabels?: readonly string[];
  /**
   * Clears every facet **and** the search (one click back). `Clear filters`
   * renders only with this and a non-blank `filterLabels` entry, and then
   * replaces `Clear search` (it clears the query too).
   */
  onClearFilters?: () => void;
  /**
   * The focus target once an action's result removes its focused button
   * (typically: the search field after `clear-search`, the "All" chip after
   * `show-all`). Default — or when the target is missing/detached — the
   * enclosing page's `h1`.
   */
  focusAfter?: NoMatchesFocusTarget;
}

/** Props of the internal {@link NoMatchesButton}. */
interface NoMatchesButtonProps {
  /** Which way back this button is. */
  action: NoMatchesAction;
  /** The visible label (also the accessible name). */
  label: string;
  /** The page's handler for the action. */
  onActivate: () => void;
  /** The caller's focus target resolver, if any. */
  focusAfter?: NoMatchesFocusTarget;
}

/**
 * One way-back button that never drops focus to `<body>`: when it is removed
 * while focused (its click emptied the filter, so the view unmounts), it
 * first hands focus to the declared target, else the page's `h1`. Runs in
 * the owner's cleanup, which Solid executes before the nodes leave the
 * document; a handler that moved focus itself is respected.
 *
 * @param props See {@link NoMatchesButtonProps}.
 */
function NoMatchesButton(props: NoMatchesButtonProps): JSX.Element {
  let button: HTMLButtonElement | undefined;
  onCleanup(() => {
    if (!button || document.activeElement !== button) return;
    const target = props.focusAfter?.(props.action);
    const fallback = button.closest('[data-fdt-page]')?.querySelector<HTMLElement>('h1');
    (target?.isConnected ? target : fallback)?.focus();
  });
  return (
    <Button
      ref={button}
      size="sm"
      data-fdt-no-matches-action={props.action}
      onClick={() => {
        props.onActivate();
      }}
    >
      {props.label}
    </Button>
  );
}

/**
 * Render the filtered-empty state: the data exists, the current chip/query hides
 * all of it. Names what is filtering and offers the one-click ways back — each
 * only when its handler is given **and** its filter is actually set. Focus
 * follows {@link NoMatchesProps.focusAfter} when an action removes this view.
 *
 * @param props See {@link NoMatchesProps}.
 */
export function NoMatches(props: NoMatchesProps): JSX.Element {
  const canClearFilters = (): boolean =>
    props.onClearFilters !== undefined &&
    (props.filterLabels ?? []).some((label) => label.trim() !== '');
  const canClear = (): boolean =>
    !canClearFilters() && props.onClearSearch !== undefined && (props.query?.trim() ?? '') !== '';
  const canShowAll = (): boolean =>
    props.onShowAll !== undefined && (props.chipLabel?.trim() ?? '') !== '';
  // Built once (EmptyState reads each slot twice: its `Show` gate + the render).
  const icon = <SearchX size={16} aria-hidden="true" />;
  const action = createMemo((): JSX.Element | undefined =>
    canClear() || canShowAll() || canClearFilters() ? (
      <div class="flex flex-wrap justify-center gap-1.5">
        <Show when={canClearFilters()}>
          <NoMatchesButton
            action="clear-filters"
            label="Clear filters"
            onActivate={() => {
              props.onClearFilters?.();
            }}
            focusAfter={props.focusAfter}
          />
        </Show>
        <Show when={canClear()}>
          <NoMatchesButton
            action="clear-search"
            label="Clear search"
            onActivate={() => {
              props.onClearSearch?.();
            }}
            focusAfter={props.focusAfter}
          />
        </Show>
        <Show when={canShowAll()}>
          <NoMatchesButton
            action="show-all"
            label={props.showAllLabel ?? 'Show all'}
            onActivate={() => {
              props.onShowAll?.();
            }}
            focusAfter={props.focusAfter}
          />
        </Show>
      </div>
    ) : undefined
  );
  return (
    <EmptyState
      class="wrap-anywhere"
      icon={icon}
      title="No matches"
      description={noMatchesSentence(props.chipLabel, props.query, props.filterLabels)}
      action={action()}
    />
  );
}

/** Props of {@link ExternalLink}. */
export interface ExternalLinkProps {
  /** The URL — shown verbatim as the text, opened in a new tab when absolute `http(s):`. */
  href: string;
  /** Extra classes, merged last so callers win (e.g. a text size). */
  class?: string;
}

/**
 * Render a URL as an external link: mono, single-line `truncate` text, a
 * trailing icon, a new tab with `rel="noopener noreferrer"`, and
 * "(opens in a new tab)" in its accessible name.
 *
 * A bounded URL preview rides `title` on the **text span**, not the anchor,
 * avoiding a duplicate link description. The visible text and accessible name
 * retain the full URL, independently of the hover preview.
 *
 * Only absolute `http:`/`https:` URLs become links. Everything else — including
 * relative and protocol-relative values, which raw captured attributes (e.g.
 * `data-lazy-src`) can be — renders as the same text without a link: the
 * panel has no inspected-page URL to resolve them against, and page-captured
 * URLs are untrusted (`javascript:`, `data:` never reach an `href`).
 *
 * Shrinks inside flex rows (`min-w-0`); give the parent a bounded width.
 *
 * @param props See {@link ExternalLinkProps}.
 */
export function ExternalLink(props: ExternalLinkProps): JSX.Element {
  const text = (): JSX.Element => (
    <span class="truncate" title={capTitle(props.href)}>
      {props.href}
    </span>
  );
  return (
    <Show
      when={isHttpUrl(props.href)}
      fallback={
        <span
          data-fdt="external-link"
          class={cn(
            'inline-flex max-w-full min-w-0 font-mono text-xs text-fg-primary',
            props.class
          )}
        >
          {text()}
        </span>
      }
    >
      <a
        data-fdt="external-link"
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        class={cn(
          'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm font-mono text-xs text-accent hover:underline',
          FOCUS_RING,
          props.class
        )}
      >
        {text()}
        <ExternalLinkIcon size={12} class="shrink-0" aria-hidden="true" />
        <span class="sr-only"> (opens in a new tab)</span>
      </a>
    </Show>
  );
}
