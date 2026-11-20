/**
 * One options section as a card: its heading (an h2 over a one-line
 * description) and its rows inside one surface, with no hairline under the
 * heading or between rows — the rows' own spacing sets them apart.
 */
import type { JSX } from 'solid-js';
import { Card } from '../../components/ui/card';
import { cn } from '../../utils/cn';

/** Props of {@link SectionCard}. */
export interface SectionCardProps {
  /** The heading block's `data-fdt` hook (each card family keeps its own). */
  headingHook: string;
  /** The section's title (the h2). */
  title: string;
  /** The one-line description under the title. */
  description: string;
  /** Extra classes on the card frame. */
  class?: string;
  /** The section's rows. */
  children: JSX.Element;
}

/**
 * Render a section card: heading, then the rows 4 px apart.
 *
 * @param props See {@link SectionCardProps}.
 */
export function SectionCard(props: SectionCardProps): JSX.Element {
  return (
    <Card level={1} class={cn('min-w-0', props.class)}>
      <div class="flex min-w-0 flex-col gap-1">
        {/* Inset like the rows (4 px), so titles and row labels share one edge. */}
        <div data-fdt={props.headingHook} class="flex flex-col gap-0.5 px-1 pt-0.5 pb-1">
          <h2 class="text-sm font-semibold text-fg-primary">{props.title}</h2>
          <p class="text-2xs text-fg-secondary">{props.description}</p>
        </div>
        {props.children}
      </div>
    </Card>
  );
}
