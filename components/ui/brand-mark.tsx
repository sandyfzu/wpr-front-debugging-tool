/**
 * The brand tile: the product's 24 px mark — a rocket on the accent
 * gradient (`accent-from` → `accent-to`). Decorative: the product name
 * always rides beside it as text (visible or sr-only), so the tile is
 * hidden from assistive tech.
 */
import type { JSX } from 'solid-js';
import Rocket from 'lucide-solid/icons/rocket';
import { cn } from '../../utils/cn';

export type BrandMarkProps = {
  /** Extra classes on the tile, merged last. */
  class?: string;
};

/** The tile: 24 px, rounded, gradient fill under the on-accent glyph. */
const TILE =
  'grid size-6 shrink-0 place-items-center rounded-md bg-linear-to-br from-accent-from to-accent-to text-on-accent';

/**
 * Render the brand tile.
 *
 * @param props.class Extra classes on the tile.
 */
export function BrandMark(props: BrandMarkProps): JSX.Element {
  return (
    <span data-fdt="brand-mark" aria-hidden="true" class={cn(TILE, props.class)}>
      <Rocket size={14} aria-hidden="true" />
    </span>
  );
}
