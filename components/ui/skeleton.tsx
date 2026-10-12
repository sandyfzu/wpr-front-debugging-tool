/**
 * The loading placeholder — a quiet pulsing block that marks *real* waits only
 * (a fetch in flight, a long computation), never an artificial delay (UX-D6:
 * results render the moment they are computed; no theater).
 *
 * `prefers-reduced-motion` is honored by the global token stylesheet, which
 * collapses all animation durations for users who opt out; state itself is
 * never animated — the arrived data replaces the placeholder without a
 * transition.
 */
import type { JSX } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../../utils/cn';

export interface SkeletonProps {
  /** Extra classes for shape/size (`h-4 w-48`, `rounded-full`, …), merged last. */
  class?: string;
}

/**
 * Render a loading block.
 *
 * Sized entirely by its classes — the default is a full-width text-line block;
 * compose grids of them for richer placeholders. Callers must only render
 * this while the awaited state is actual (a `fetching`/busy signal), not as a
 * page entrance effect.
 *
 * @param props.class Shape and size classes, merged last.
 */
export function Skeleton(props: SkeletonProps): JSX.Element {
  const [own, rest] = splitProps(props, ['class']);
  return (
    <div
      data-fdt="skeleton"
      class={cn('h-4 w-full rounded-sm bg-surface-3 animate-pulse', own.class)}
      {...rest}
    />
  );
}
