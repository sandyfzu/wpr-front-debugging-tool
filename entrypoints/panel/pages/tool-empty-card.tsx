/**
 * A tool page's honest empty result: a dashed card with the tool's icon on
 * an accent tile, what is missing and what a run produces, an optional
 * action and an optional preview of the result (e.g. "what you get" tiles).
 * Painted in the canvas color, not transparent: the same look, but its text
 * sits on a background that encloses it, so contrast stays computable below
 * the fold.
 */
import type { JSX } from 'solid-js';
import { children, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { LucideIcon } from 'lucide-solid';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { cn } from '../../../utils/cn';

/** Props of {@link ToolEmptyCard}. */
export interface ToolEmptyCardProps {
  /** The `data-fdt` hook. */
  hook: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** An action under the words (usually a small `Button`). */
  action?: JSX.Element;
  /** Fill the result column's remaining height from `@wide`. */
  fill?: boolean;
  /** A preview of the result, under the words. */
  children?: JSX.Element;
}

/**
 * Render the card.
 *
 * @param props See {@link ToolEmptyCardProps}.
 */
export function ToolEmptyCard(props: ToolEmptyCardProps): JSX.Element {
  // Resolved once: reading `props.children` twice would build the preview twice.
  const preview = children(() => props.children);
  return (
    <Card
      look="placeholder"
      class={cn('flex flex-col justify-center', props.fill && '@wide:flex-1')}
    >
      <div data-fdt={props.hook} class="flex flex-col items-center gap-3">
        <EmptyState
          class={cn('gap-2', preview() !== undefined && 'pb-0')}
          icon={
            <span class="grid size-11 place-items-center rounded-lg bg-accent-soft text-accent">
              <Dynamic component={props.icon} size={22} aria-hidden="true" />
            </span>
          }
          title={props.title}
          description={props.description}
          action={props.action}
        />
        <Show when={preview()}>{preview()}</Show>
      </div>
    </Card>
  );
}
