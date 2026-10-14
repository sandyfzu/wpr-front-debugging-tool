/**
 * The empty view — icon, title, one-sentence explanation and an optional
 * forward action. Empty states explain rather than stare (the shortcuts
 * overlay and every list on an unpopulated page render this instead of a
 * blank void).
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  /** The explanatory icon (a muted lucide icon, e.g. `Search`). */
  icon?: JSX.Element;
  /** What this view is, in one short line (`word-count font-medium`). */
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
 * Centered and compact: the icon-and-words stack with optional action slot.
 * This is a *meaning* surface, not decoration — the description must say what
 * would appear here and how to produce it.
 *
 * @param props.icon Leading icon (rendered muted).
 * @param props.title The one-line state name.
 * @param props.description Optional sentence pointing forward.
 * @param props.action Optional action slot (usually a small `Button`).
 * @param props.class Extra classes, merged last so callers win.
 */
export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div
      data-fdt="empty-state"
      class={cn('flex flex-col items-center gap-1 py-6 text-center', props.class)}
    >
      <Show when={props.icon}>
        <div class="text-fg-muted">{props.icon}</div>
      </Show>
      <div class="text-xs font-medium text-fg-primary">{props.title}</div>
      <Show when={props.description}>
        <p class="max-w-64 text-2xs leading-snug text-fg-secondary">{props.description}</p>
      </Show>
      <Show when={props.action}>
        <div class="mt-2">{props.action}</div>
      </Show>
    </div>
  );
}
