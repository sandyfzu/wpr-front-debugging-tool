/**
 * The state icon tile: a state view's icon (empty, error, unavailable) set on
 * a rounded tile in its tone, so every state reads as one family — a quiet
 * neutral tile for lists and sections, the accent tile for a tool's empty
 * result, the status tints for failures and notices. Decorative: the state's
 * words carry the meaning (K-5), so the tile is hidden from assistive tech.
 */
import type { JSX } from 'solid-js';
import { cn } from '../../utils/cn';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from './status-badge';

/** The tile's tones. */
export const STATE_ICON_TONES = ['neutral', 'accent', 'error', 'info'] as const;

/** One tone of {@link STATE_ICON_TONES}. */
export type StateIconTone = (typeof STATE_ICON_TONES)[number];

/** The tile's sizes: `md` (36 px) for in-page states, `lg` (44 px) for page-level and tool states. */
export type StateIconSize = 'md' | 'lg';

/**
 * Fill + icon color per tone. Every pair is a token pair the contrast gate
 * pins (fg-muted on surface-3, accent on accent-soft, status on its soft
 * tint); the status tones reuse the status vocabulary's own tables.
 */
export const STATE_ICON_TONE_CLASSES: Readonly<Record<StateIconTone, string>> = {
  neutral: 'bg-surface-3 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  error: `${STATUS_SOFT_CLASSES.error} ${STATUS_TEXT_CLASSES.error}`,
  info: `${STATUS_SOFT_CLASSES.info} ${STATUS_TEXT_CLASSES.info}`
};

/** Box per size (the icon inside is sized by the caller: 16 px for `md`, 22 px for `lg`). */
export const STATE_ICON_SIZE_CLASSES: Readonly<Record<StateIconSize, string>> = {
  md: 'size-9',
  lg: 'size-11'
};

/** Props of {@link StateIcon}. */
export interface StateIconProps {
  /** The tile's tone (default `neutral`). */
  tone?: StateIconTone;
  /** The tile's size (default `md`). */
  size?: StateIconSize;
  /** Extra classes, merged last so callers win (spacing). */
  class?: string;
  /** The icon element (a lucide icon, `aria-hidden`). */
  children: JSX.Element;
}

/**
 * Render the tile.
 *
 * @param props See {@link StateIconProps}.
 */
export function StateIcon(props: StateIconProps): JSX.Element {
  return (
    <span
      data-fdt="state-icon"
      aria-hidden="true"
      class={cn(
        'grid shrink-0 place-items-center rounded-lg',
        STATE_ICON_SIZE_CLASSES[props.size ?? 'md'],
        STATE_ICON_TONE_CLASSES[props.tone ?? 'neutral'],
        props.class
      )}
    >
      {props.children}
    </span>
  );
}
