/**
 * The page seam every panel page body builds on: the frame (entrance, container
 * query root, focus target, the single `h1`), the filtered-empty view, and the
 * external link. Declared once here so page folders never re-invent them.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import SearchX from 'lucide-solid/icons/search-x';
import { Button } from '../../../components/ui/button';
import { FOCUS_RING } from '../../../components/ui/classes';
import { EmptyState } from '../../../components/ui/empty-state';
import { PageHeader } from '../../../components/ui/page-header';
import { cn } from '../../../utils/cn';
import { isHttpUrl } from '../../../utils/urls';
import type { RouteId } from '../routes';

/**
 * Classes for the one scroller of a `fill` frame (usually the `VirtualList`):
 * it takes the remaining height but never shrinks below 12 rem — below that,
 * the panel's content region scrolls instead of the list clipping.
 */
export const PAGE_FILL_SCROLLER = 'min-h-48 flex-1';

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
   * Fill mode for list pages: the frame takes the content region's full height
   * as a flex column, so header/summary/filters stay put while the child
   * carrying {@link PAGE_FILL_SCROLLER} scrolls. Default: natural height.
   */
  fill?: boolean;
  /** The page content, laid out as a `gap-3` column of sections below the header. */
  children?: JSX.Element;
}

/**
 * Render a panel page's frame.
 *
 * The root carries the shell's mount-only `.fdt-page` entrance (pages never
 * animate their own mount), is the `@container` for the page's width-based
 * layout, and its `data-fdt-page` makes its `h1` the route-switch focus target.
 * The entrance leaves a transform on the root, so nothing inside a page may be
 * `position: fixed` — floating UI goes through the portaled primitives.
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
      class={cn('fdt-page @container flex flex-col gap-3 p-3', props.fill && 'h-full')}
      data-fdt-page={props.id}
    >
      <PageHeader title={props.title} subtitle={props.subtitle} actions={props.actions} />
      {props.children}
    </section>
  );
}

/** Longest query echoed verbatim in the filtered-empty sentence; longer ones are elided. */
export const NO_MATCHES_QUERY_MAX = 60;

/**
 * Build the filtered-empty sentence naming what is narrowing the list.
 *
 * Blank inputs count as unset; an over-long query is elided with `…` so a
 * pasted blob cannot flood the view.
 *
 * @param chipLabel The selected filter chip's label, if a non-"all" chip is active.
 * @param query The committed search query, if any.
 * @returns One sentence naming the chip and/or the query.
 */
export function noMatchesSentence(chipLabel?: string, query?: string): string {
  const chip = chipLabel?.trim() ?? '';
  const raw = query?.trim() ?? '';
  const shown = raw.length > NO_MATCHES_QUERY_MAX ? `${raw.slice(0, NO_MATCHES_QUERY_MAX)}…` : raw;
  if (chip && shown) return `Nothing in "${chip}" matches "${shown}".`;
  if (chip) return `Nothing matches the "${chip}" filter.`;
  if (shown) return `Nothing matches "${shown}".`;
  return 'Nothing matches the current filters.';
}

export interface NoMatchesProps {
  /** The active filter chip's label (omit for the "all" chip). */
  chipLabel?: string;
  /** The committed search query (omit or blank when no search is active). */
  query?: string;
  /** Clears the search; renders a `Clear search` button when given. */
  onClearSearch?: () => void;
  /** Resets the filter to "all"; renders a `Show all` button when given. */
  onShowAll?: () => void;
}

/**
 * Render the filtered-empty state: the data exists, the current chip/query hides
 * all of it. Names what is filtering and offers the one-click ways back — one
 * button per handler given, none when neither is.
 *
 * @param props.chipLabel The active chip's label.
 * @param props.query The committed search query.
 * @param props.onClearSearch Handler behind `Clear search`.
 * @param props.onShowAll Handler behind `Show all`.
 */
export function NoMatches(props: NoMatchesProps): JSX.Element {
  const hasActions = (): boolean =>
    props.onClearSearch !== undefined || props.onShowAll !== undefined;
  return (
    <EmptyState
      class="wrap-anywhere"
      icon={<SearchX size={16} aria-hidden="true" />}
      title="No matches"
      description={noMatchesSentence(props.chipLabel, props.query)}
      action={
        hasActions() ? (
          <div class="flex flex-wrap justify-center gap-1.5">
            <Show when={props.onClearSearch}>
              <Button
                size="sm"
                onClick={() => {
                  props.onClearSearch?.();
                }}
              >
                Clear search
              </Button>
            </Show>
            <Show when={props.onShowAll}>
              <Button
                size="sm"
                onClick={() => {
                  props.onShowAll?.();
                }}
              >
                Show all
              </Button>
            </Show>
          </div>
        ) : undefined
      }
    />
  );
}

export interface ExternalLinkProps {
  /** The URL — shown as the link text and opened in a new tab when `http(s):`. */
  href: string;
  /** Extra classes, merged last so callers win (e.g. a text size). */
  class?: string;
}

/**
 * Render a URL as an external link: mono, single-line `truncate` text with
 * the full URL in `title`, a trailing icon, a new tab with
 * `rel="noopener noreferrer"`, and "(opens in a new tab)" in its accessible
 * name. Anything that is not an absolute `http:`/`https:` URL (relative,
 * `javascript:`, `data:`, garbage) renders as the same text without a link —
 * page-captured URLs are untrusted.
 *
 * Shrinks inside flex rows (`min-w-0`); give the parent a bounded width.
 *
 * @param props.href The URL to show and, when safe, link to.
 * @param props.class Extra classes on the root.
 */
export function ExternalLink(props: ExternalLinkProps): JSX.Element {
  const text = (): JSX.Element => <span class="truncate">{props.href}</span>;
  return (
    <Show
      when={isHttpUrl(props.href)}
      fallback={
        <span
          data-fdt="external-link"
          title={props.href}
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
        title={props.href}
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
