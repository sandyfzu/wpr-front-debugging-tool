/**
 * The overlay's status glyphs: one icon per indicator glyph name, so a
 * status always shows a shape beside its word (never color alone). Icons
 * are imported one by one (never the icon barrel).
 */
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Ban from 'lucide-solid/icons/ban';
import Check from 'lucide-solid/icons/check';
import CircleDashed from 'lucide-solid/icons/circle-dashed';
import Clock from 'lucide-solid/icons/clock';
import CircleHelp from 'lucide-solid/icons/circle-question-mark';
import LoaderCircle from 'lucide-solid/icons/loader-circle';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import type { Indicator } from './copy';

/** Glyph name → icon component. */
const GLYPHS = {
  idle: CircleDashed,
  waiting: Clock,
  check: Check,
  alert: TriangleAlert,
  blocked: Ban,
  spinner: LoaderCircle,
  question: CircleHelp
} as const satisfies Record<Indicator['glyph'], unknown>;

/**
 * One status glyph, decorative (the word beside it carries the meaning).
 *
 * @param props.name The glyph.
 * @param props.size Pixel size (default 14).
 */
export function Glyph(props: { name: Indicator['glyph']; size?: number }): JSX.Element {
  return (
    <Dynamic
      component={GLYPHS[props.name]}
      size={props.size ?? 14}
      strokeWidth={2.25}
      aria-hidden="true"
      class={props.name === 'spinner' ? 'xo-spin' : undefined}
    />
  );
}
