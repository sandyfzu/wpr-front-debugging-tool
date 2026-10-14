/**
 * One Detections card: leading vocabulary icon · feature name · verdict
 * badge, with the subtitle in full underneath. Two forms, decided by the
 * page's link table, never by the card's content:
 *
 * - **static** — not focusable, never lifts (nothing to click);
 * - **link** — the whole card is an anchor to the page that explains the
 *   feature, with the hover lift and the focus ring.
 *
 * Tooltips appear only where data would otherwise be hidden — the Cached
 * card's absolute UTC time and the Known Platform card's matching header —
 * with the subtitle text as their (focusable) trigger. A link card never
 * hosts one: a control nested inside a link is invalid and unreachable.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { CARD_LEVEL_CLASSES } from '../../../../components/ui/card';
import { FOCUS_RING, MOTION_LIFT } from '../../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  StatusBadge
} from '../../../../components/ui/status-badge';
import { Tooltip } from '../../../../components/ui/tooltip';
import { STATUS_LABELS } from '../../../../lib/panel/detections-summary';
import type { StatusItem } from '../../../../lib/panel/detections-view-model';
import { cn } from '../../../../utils/cn';
import { navRoute, type RouteId } from '../../routes';
import { cacheAgeText, STATUS_TONES } from './card-presentation';

/**
 * The surface both forms share. Compact tier: a divided row inside the
 * grid's one grouped surface (17 bordered cards stacked in a 270 px column
 * read as noise); regular tier up: a standalone card — the `Card`
 * primitive's level-1 surface/line pair (written as literal variant classes
 * so the stylesheet scanner sees them; {@link CARD_LEVEL_CLASSES} is the
 * pair's declaring site, re-exported as {@link CARD_SURFACE_PAIR} and pinned
 * equal by the page test).
 */
export const STATUS_CARD_SURFACE =
  'flex h-full w-full flex-col gap-1 px-2.5 py-2 text-xs text-fg-primary @regular:rounded-md @regular:border @regular:border-line-1 @regular:bg-surface-1 @regular:p-2.5';

/** The level-1 pair the regular-tier card mirrors (exported for the pin). */
export const CARD_SURFACE_PAIR = CARD_LEVEL_CLASSES[1];

/**
 * A link card's interaction treatment: the lift where it is a card (regular
 * tier), a row highlight where it is a row (compact tier), and an inset ring
 * at compact so the grouped surface's clip never cuts it.
 */
const LINK_ACTIVE = cn(
  MOTION_LIFT,
  '@max-regular:hover:bg-surface-2 @max-regular:hover:shadow-none @max-regular:focus-visible:-outline-offset-2'
);

/**
 * A link card for a feature that is off: still navigable (the page explains
 * why nothing is applied), but presented quietly — no lift.
 */
const LINK_QUIET = '@max-regular:focus-visible:-outline-offset-2 hover:bg-surface-2';

/** Indents the lines under the head row to the name's start (14 px icon + `gap-1.5`). */
const UNDER_NAME = 'ps-5';

/**
 * A subtitle-as-tooltip-trigger: reads as text, a dotted underline hints the
 * detail. The trigger keeps its 24 px hit area; `-my-1` only stops that
 * area from loosening the card's line rhythm.
 */
const TOOLTIP_SUBTITLE =
  '-my-1 justify-items-start text-start text-2xs text-fg-secondary underline decoration-line-3 decoration-dotted underline-offset-2 hover:text-fg-primary';

/** Props of {@link StatusCard}. */
export interface StatusCardProps {
  /** The card from the view model. */
  item: StatusItem;
  /** The page this card links to, or undefined for a static card. */
  linkTo?: RouteId;
  /** The page clock reading (epoch ms) the Cached card ages against. */
  now: number;
}

/**
 * The head row: vocabulary icon, name (wraps), verdict badge.
 *
 * @param props.item The card.
 * @returns The head row.
 */
function CardHead(props: { item: StatusItem }): JSX.Element {
  const tone = () => STATUS_TONES[props.item.status];
  return (
    <div class="flex items-start gap-1.5">
      <Dynamic
        component={STATUS_ICONS[tone()]}
        size={14}
        class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES[tone()])}
        aria-hidden="true"
      />
      <span
        data-fdt-card-name
        class={cn(
          'min-w-0 flex-1 font-medium leading-snug wrap-break-word',
          // Off features recede so the active ones scan first; the badge
          // and icon still state the verdict (never color alone).
          props.item.status === 'active' ? 'text-fg-primary' : 'text-fg-secondary'
        )}
      >
        {props.item.name}
      </span>
      {/* Spoken separators: a link card's name is its own content. */}
      <span class="sr-only">, </span>
      <StatusBadge kind={tone()} class="shrink-0">
        {STATUS_LABELS[props.item.status]}
      </StatusBadge>
    </div>
  );
}

/**
 * A subtitle's text: page-derived identifiers (versions, server values)
 * render mono, as data; everything else is the view model's own copy.
 *
 * @param props.item The card (its typed detail decides the form).
 * @param props.text The view model's subtitle copy (the fallback form).
 * @returns The subtitle content.
 */
function SubtitleText(props: { item: StatusItem; text: string }): JSX.Element {
  /** The known version string, when this card carries one. */
  const version = () => {
    const detail = props.item.detail;
    return detail?.kind === 'version' ? (detail.version ?? undefined) : undefined;
  };
  return (
    <Switch fallback={props.text}>
      <Match when={version()}>
        {(value) => (
          <>
            Version <span class="font-mono text-fg-primary">{value()}</span>
          </>
        )}
      </Match>
      <Match when={props.item.detail?.kind === 'server'}>
        <span class="font-mono break-all">{props.text}</span>
      </Match>
    </Switch>
  );
}

/**
 * The subtitle line of a static card: plain text, or — for the two cards
 * whose detail is otherwise hidden — the tooltip trigger carrying it.
 *
 * @param props.item The card.
 * @param props.now The page clock reading.
 * @returns The subtitle line, or nothing when the card has none.
 */
function StaticSubtitle(props: { item: StatusItem; now: number }): JSX.Element {
  const detail = () => props.item.detail;
  /** The cache stamp when this card carries a representable one. */
  const cachedAt = () => {
    const current = detail();
    return current?.kind === 'cached-at' && current.seconds !== null && current.formatted !== null
      ? { seconds: current.seconds, formatted: current.formatted }
      : undefined;
  };
  /** The platform match when this card carries one. */
  const platform = () => {
    const current = detail();
    return current?.kind === 'platform' ? current : undefined;
  };
  return (
    <Switch
      fallback={
        <Show when={props.item.subtitle}>
          {(subtitle) => (
            <p data-fdt-card-subtitle class={cn(UNDER_NAME, 'text-2xs text-fg-secondary')}>
              <SubtitleText item={props.item} text={subtitle()} />
            </p>
          )}
        </Show>
      }
    >
      <Match when={cachedAt()}>
        {(stamp) => (
          <div data-fdt-card-subtitle class={UNDER_NAME}>
            <Tooltip content={`Generated at ${stamp().formatted}`} class={TOOLTIP_SUBTITLE}>
              {cacheAgeText(stamp().seconds, props.now)}
            </Tooltip>
          </div>
        )}
      </Match>
      <Match when={platform()}>
        {(match) => (
          <div data-fdt-card-subtitle class={UNDER_NAME}>
            <Tooltip
              content={`Identified by the ${match().header} response header`}
              class={TOOLTIP_SUBTITLE}
            >
              {match().name}
            </Tooltip>
          </div>
        )}
      </Match>
    </Switch>
  );
}

/**
 * Render one card in its static or link form.
 *
 * @param props See {@link StatusCardProps}.
 * @returns The card (an anchor for the link form, a div otherwise).
 */
export function StatusCard(props: StatusCardProps): JSX.Element {
  /** The destination's nav row (the link form needs its label). */
  const destination = () => (props.linkTo === undefined ? undefined : navRoute(props.linkTo));
  return (
    <Show
      when={destination()}
      fallback={
        <div data-fdt="status-card" data-fdt-card-id={props.item.id} class={STATUS_CARD_SURFACE}>
          <CardHead item={props.item} />
          <StaticSubtitle item={props.item} now={props.now} />
        </div>
      }
    >
      {(route) => (
        <a
          data-fdt="status-card"
          data-fdt-card-id={props.item.id}
          href={`#/${route().id}`}
          class={cn(
            STATUS_CARD_SURFACE,
            'group no-underline',
            FOCUS_RING,
            props.item.status === 'active' ? LINK_ACTIVE : LINK_QUIET
          )}
        >
          <CardHead item={props.item} />
          <Show when={props.item.subtitle}>
            {(subtitle) => (
              <p data-fdt-card-subtitle class={cn(UNDER_NAME, 'text-2xs text-fg-secondary')}>
                <span class="sr-only">, </span>
                <SubtitleText item={props.item} text={subtitle()} />
              </p>
            )}
          </Show>
          <span
            class={cn(
              UNDER_NAME,
              'mt-auto inline-flex items-center gap-0.5 pt-0.5 text-2xs group-hover:underline',
              props.item.status === 'active' ? 'text-accent' : 'text-fg-secondary'
            )}
          >
            <span class="sr-only">, </span>
            Open {route().label}
            <ChevronRight size={12} class="shrink-0" aria-hidden="true" />
          </span>
        </a>
      )}
    </Show>
  );
}
