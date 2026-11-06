/**
 * A tool run's outcome block: the status icon and tint of its tone, a title,
 * one sentence, then the outcome's own details and recoveries (children).
 * Every tool page renders its run outcomes through it, so outcomes read the
 * same across tools; the words come from each tool's pure outcome view.
 */
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { MOTION_REVEAL } from '../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_SOFT_CLASSES,
  STATUS_TEXT_CLASSES,
  type StatusKind
} from '../../../components/ui/status-badge';
import { cn } from '../../../utils/cn';

/** Props of {@link OutcomeNotice}. */
export type OutcomeNoticeProps = {
  /** The outcome's tone (status vocabulary: icon + tint). */
  kind: StatusKind;
  title: string;
  message: string;
  /** Details and recovery buttons under the message. */
  children?: JSX.Element;
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'class'>;

/**
 * Render the block (extra attributes — `data-*` test hooks — land on its root).
 *
 * @param props See {@link OutcomeNoticeProps}.
 */
export function OutcomeNotice(props: OutcomeNoticeProps): JSX.Element {
  const [own, rest] = splitProps(props, ['kind', 'title', 'message', 'children']);
  return (
    <div
      {...rest}
      class={cn(
        'flex flex-col gap-2 rounded-md p-2.5',
        STATUS_SOFT_CLASSES[own.kind],
        MOTION_REVEAL
      )}
    >
      <div class="flex items-start gap-1.5">
        <Dynamic
          component={STATUS_ICONS[own.kind]}
          size={14}
          class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES[own.kind])}
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-col gap-0.5">
          <p class="text-xs font-semibold text-fg-primary">{own.title}</p>
          <p class="text-2xs text-fg-secondary">{own.message}</p>
        </div>
      </div>
      {own.children}
    </div>
  );
}
