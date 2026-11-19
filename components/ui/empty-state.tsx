/**
 * The empty view — a toned icon tile, title, one-sentence explanation and an
 * optional forward action. Empty states explain rather than stare (every list
 * on an unpopulated page and every tool without a result render this instead
 * of a blank void).
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';
import { StateIcon, type StateIconSize, type StateIconTone } from './state-icon';

/**
 * The view's looks: `quiet` (a neutral tile — lists, sections, filtered
 * results) and `tool` (the larger accent tile a tool's empty result leads
 * with, its own feature in the panel).
 */
export type EmptyStateLook = 'quiet' | 'tool';

/** The icon tile each look sets the caller's icon on. */
export const EMPTY_STATE_TILES: Readonly<
  Record<EmptyStateLook, { tone: StateIconTone; size: StateIconSize }>
> = {
  quiet: { tone: 'neutral', size: 'md' },
  tool: { tone: 'accent', size: 'lg' }
};

export interface EmptyStateProps {
  /** The explanatory icon (a lucide icon: 16 px for `quiet`, 22 px for `tool`). */
  icon?: JSX.Element;
  /** The look (default `quiet`). */
  look?: EmptyStateLook;
  /** What this view is, in one short line. */
  title: string;
  /** The one-sentence why / what-to-do-next. */
  description?: string;
  /** Optional forward action — a `Button size="sm"` pointing at the producer. */
  action?: JSX.Element;
  /** Extra classes, merged last so callers win (vertical centering, height). */
  class?: string;
}

/**
 * Render the page/section's empty view.
 *
 * Centered and compact: the tile-and-words stack with an optional action
 * slot. This is a *meaning* surface, not decoration — the description must
 * say what would appear here and how to produce it.
 *
 * @param props.icon Leading icon (set on the look's tile).
 * @param props.look The look (default `quiet`).
 * @param props.title The one-line state name.
 * @param props.description Optional sentence pointing forward.
 * @param props.action Optional action slot (usually a small `Button`).
 * @param props.class Extra classes, merged last so callers win.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element {
  const tile = () => EMPTY_STATE_TILES[props.look ?? 'quiet'];
  return (
    <div
      data-fdt="empty-state"
      class={cn('flex flex-col items-center gap-1 py-6 text-center', props.class)}
    >
      {/* Callback form: a JSX prop is a getter, so reading it again would build it twice. */}
      <Show when={props.icon}>
        {(icon) => (
          <StateIcon tone={tile().tone} size={tile().size} class="mb-1">
            {icon()}
          </StateIcon>
        )}
      </Show>
      <div class="text-xs font-semibold text-fg-primary">{props.title}</div>
      <Show when={props.description}>
        <p class="max-w-72 text-2xs leading-snug text-fg-secondary">{props.description}</p>
      </Show>
      <Show when={props.action}>{(action) => <div class="mt-2">{action()}</div>}</Show>
    </div>
  );
}
