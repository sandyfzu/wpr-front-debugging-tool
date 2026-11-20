/**
 * The stat tile: one glanceable fact on a card — a small label (optional
 * icon), a large value, an optional supporting line and an optional link to
 * where the fact comes from. An optional leading visual (e.g. the score ring)
 * sits beside the text.
 *
 * The tile itself is never interactive: no hover, cursor or tab stop on the
 * card. Only the inner link (when given) takes clicks and focus, so a tile
 * never promises a click it doesn't keep.
 */
import type { LucideIcon } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { cn } from '../../utils/cn';
import { Card } from './card';
import { FOCUS_RING } from './classes';
import { STATUS_TEXT_CLASSES, type StatusKind } from './status-badge';

/** A text tone for the tile's icon or value: a content role or a status kind. */
export type StatTileTone = 'primary' | 'muted' | 'accent' | StatusKind;

/** Text color per tone; status kinds reuse the vocabulary's own table. */
export const STAT_TILE_TONE_CLASSES: Record<StatTileTone, string> = {
  primary: 'text-fg-primary',
  muted: 'text-fg-muted',
  accent: 'text-accent',
  ...STATUS_TEXT_CLASSES
};

/**
 * The value's type role: `stat` = the main number of a tile (20/24 px),
 * `tile` = a short textual value such as a version or a state (15/20 px).
 */
export type StatTileValueRole = 'stat' | 'tile';

/** Type classes per value role — the two tile-only sizes of the scale. */
export const STAT_TILE_VALUE_CLASSES: Record<StatTileValueRole, string> = {
  stat: 'text-stat font-semibold',
  tile: 'text-tile font-semibold'
};

/** An in-tile link to the fact's evidence (e.g. a panel route). */
export interface StatTileLink {
  /** Destination (`#/route` for a panel page). */
  href: string;
  /** Visible link text; also its accessible name. */
  label: string;
}

export interface StatTileProps {
  /** What the value is (e.g. "Page cache"). */
  label: string;
  /**
   * Keep the label out of sight (still in the text, `sr-only`) — for a tile
   * whose value already says what it is (a sentence such as "4 of 18
   * optimizations active"), where a painted label would repeat it. Default false.
   */
  hideLabel?: boolean;
  /** Icon leading the label (14 px, decorative). */
  icon?: LucideIcon;
  /** Icon tone (default `muted`, the label's own). */
  iconTone?: StatTileTone;
  /** Leading visual beside the text column (e.g. a `ScoreRing`). */
  media?: JSX.Element;
  /** Value type role (default `tile`). */
  valueRole?: StatTileValueRole;
  /** Value tone (default `primary`). */
  valueTone?: StatTileTone;
  /** Supporting line under the value (11 px, muted unless it sets its own tone). */
  sub?: JSX.Element;
  /** Optional link under the value — the tile's only interactive element. */
  link?: StatTileLink;
  /** Extra classes on the card frame (e.g. a grid span). */
  class?: string;
  /** The value. */
  children: JSX.Element;
}

/**
 * Render a stat tile.
 *
 * Layout is fluid (no fixed widths, every column `min-w-0`, long words wrap),
 * so a tile fits any grid cell down to the panel's narrowest content column;
 * the parent grid decides the columns through its container queries.
 *
 * @param props.label The value's label.
 * @param props.hideLabel Keep the label unpainted (text only).
 * @param props.icon Optional label icon.
 * @param props.iconTone The icon's tone.
 * @param props.media Optional leading visual.
 * @param props.valueRole `stat` (main number) or `tile` (short value).
 * @param props.valueTone The value's tone.
 * @param props.sub Optional supporting line.
 * @param props.link Optional evidence link.
 * @param props.class Extra classes on the card.
 * @param props.children The value.
 */
export function StatTile(props: StatTileProps): JSX.Element {
  return (
    <Card class={cn('min-w-0', props.class)}>
      <div data-fdt="stat-tile" class="flex min-w-0 items-center gap-3">
        {/* Callback form: a JSX prop is a getter, so reading it again would build it twice. */}
        <Show when={props.media}>
          {(media) => (
            <div data-fdt="stat-tile-media" class="flex shrink-0">
              {media()}
            </div>
          )}
        </Show>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <p
            data-fdt="stat-tile-label"
            class={
              props.hideLabel === true
                ? 'sr-only'
                : 'flex min-w-0 items-center gap-1.5 text-2xs font-medium text-fg-muted'
            }
          >
            <Show when={props.icon}>
              {(icon) => (
                <Dynamic
                  component={icon()}
                  size={14}
                  aria-hidden="true"
                  class={cn('shrink-0', STAT_TILE_TONE_CLASSES[props.iconTone ?? 'muted'])}
                />
              )}
            </Show>
            <span class="min-w-0 wrap-break-word">{props.label}</span>
          </p>
          <div
            data-fdt="stat-tile-value"
            class={cn(
              'min-w-0 wrap-break-word tabular-nums',
              STAT_TILE_VALUE_CLASSES[props.valueRole ?? 'tile'],
              STAT_TILE_TONE_CLASSES[props.valueTone ?? 'primary']
            )}
          >
            {props.children}
          </div>
          <Show when={props.sub}>
            {(sub) => (
              <div
                data-fdt="stat-tile-sub"
                class="min-w-0 wrap-break-word text-2xs text-fg-muted tabular-nums"
              >
                {sub()}
              </div>
            )}
          </Show>
          <Show when={props.link}>
            {(link) => (
              <a
                data-fdt="stat-tile-link"
                href={link().href}
                class={cn(
                  // min-h-6: the 24 px hit floor; self-start keeps the hit area to the text.
                  'inline-flex min-h-6 min-w-0 items-center gap-0.5 self-start rounded-sm text-2xs font-medium text-accent no-underline hover:underline',
                  FOCUS_RING
                )}
              >
                <span class="min-w-0 wrap-break-word">{link().label}</span>
                <ChevronRight size={12} class="shrink-0" aria-hidden="true" />
              </a>
            )}
          </Show>
        </div>
      </div>
    </Card>
  );
}
