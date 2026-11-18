/**
 * One Detections card: leading vocabulary icon · feature name · verdict
 * badge, with the subtitle in full underneath. Two forms, decided by the
 * page's link table, never by the card's content:
 *
 * - **static** — not focusable, never lifts (nothing to click);
 * - **link** — the whole card is an anchor to the page that explains the
 *   feature, with the hover lift and the focus ring.
 *
 * The page's layout picks the surface: `adaptive` is a row at compact and a
 * card from the regular tier up; `list` is a row at every width (hover wash,
 * inset ring, never a lift).
 *
 * A feature card adds its evidence line under the name: the source chip
 * (`Meta` / `Footprint`, its meaning spelled out for assistive tech and in
 * the native title) and, for an unsure verdict (collecting / unknown), the
 * amber why sentence — visible text, never hover-only — or, for a feature
 * declared with nothing on the page to act on, the declared-only sentence —
 * and, when the Exclusion Builder changed the feature in this tab, its modifier: an
 * at-a-glance badge (icon + short text) plus the full sentence as a visible
 * line, spoken once; likewise when the extension simulated the feature in
 * this tab (or the page's simulation marker went unverified), and the
 * amber "applied despite ?nowprocket" warning. The verdict badge stays WP
 * Rocket's served verdict.
 *
 * Tooltips appear only where data would otherwise be hidden — the Cached
 * card's absolute UTC time, the Known Platform card's matching header and
 * a declaration-only card's proof limit (mobile cache, DNS prefetch) — with
 * the subtitle text as their (focusable) trigger. A link card never
 * hosts one: a control nested inside a link is invalid and unreachable.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import CircleOff from 'lucide-solid/icons/circle-off';
import FlaskConical from 'lucide-solid/icons/flask-conical';
import ListX from 'lucide-solid/icons/list-x';
import ShieldQuestionMark from 'lucide-solid/icons/shield-question-mark';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import type { LucideIcon } from 'lucide-solid';
import { Badge } from '../../../../components/ui/badge';
import { CARD_LEVEL_CLASSES } from '../../../../components/ui/card';
import { FOCUS_RING, MOTION_LIFT } from '../../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  StatusBadge
} from '../../../../components/ui/status-badge';
import { Tooltip } from '../../../../components/ui/tooltip';
import {
  builderBadgeKind,
  SOURCE_COPY,
  type BuilderBadgeKind
} from '../../../../lib/detection/hud';
import { STATUS_LABELS } from '../../../../lib/panel/detections-summary';
import {
  hostLayersTooltip,
  type StatusItem,
  type StatusKind
} from '../../../../lib/panel/detections-view-model';
import type { SimulationFact } from '../../../../lib/wp-rocket/types';
import type { DetectionLayout } from '../../state/detections-layout';
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

/**
 * The List layout's row: the compact row at every width (no border, radius
 * or shadow of its own — the grid's grouped surface divides the rows), with
 * roomier padding from the regular tier up so a wide column still reads as
 * a list rather than a strip of cramped lines.
 */
export const STATUS_LIST_ROW_SURFACE =
  'flex h-full w-full flex-col gap-1 px-2.5 py-2 text-xs text-fg-primary @regular:px-3 @regular:py-2.5';

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

/**
 * A List-layout link row, active or quiet alike: the row hover wash and an
 * inset ring (the grouped surface's clip would cut an outset one) at every
 * width — a row never lifts.
 */
const LINK_ROW = 'hover:bg-surface-2 focus-visible:-outline-offset-2';

/**
 * The card root's surface for a layout.
 *
 * @param layout The page's layout.
 * @returns {@link STATUS_CARD_SURFACE} (adaptive) or {@link STATUS_LIST_ROW_SURFACE} (list).
 */
export function statusCardSurface(layout: DetectionLayout): string {
  return layout === 'list' ? STATUS_LIST_ROW_SURFACE : STATUS_CARD_SURFACE;
}

/**
 * A link card's interaction classes for a layout and verdict: adaptive keeps
 * the active lift / quiet wash pair, list is always the row treatment.
 *
 * @param layout The page's layout.
 * @param status The card's verdict (only `active` lifts, and only adaptive).
 * @returns The classes appended after the surface and focus ring.
 */
export function statusLinkInteraction(layout: DetectionLayout, status: StatusKind): string {
  if (layout === 'list') return LINK_ROW;
  return status === 'active' ? LINK_ACTIVE : LINK_QUIET;
}

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
  /** The page's layout (absent: `adaptive`). */
  layout?: DetectionLayout;
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

/** The modifier badge's icon per kind (the shape carries the meaning, not the color). */
const BUILDER_BADGE_ICONS: Readonly<Record<BuilderBadgeKind, LucideIcon>> = {
  off: CircleOff,
  excluded: ListX
};

/**
 * The Exclusion Builder modifier badge: icon + short text, the at-a-glance
 * cue. Hidden from assistive tech — the visible sentence beside it
 * ({@link ModifierLine}) already says it, so the card speaks it once.
 *
 * @param props.item The card (carrying `builder` and `modifierChip`).
 * @returns The badge, or nothing for a card without a builder fact.
 */
function ModifierBadge(props: { item: StatusItem }): JSX.Element {
  return (
    <Show when={props.item.builder}>
      {(fact) => (
        <Badge kind="info" class="shrink-0">
          <span
            data-fdt-card-modifier={builderBadgeKind(fact())}
            aria-hidden="true"
            class="inline-flex items-center gap-1"
          >
            <Dynamic
              component={BUILDER_BADGE_ICONS[builderBadgeKind(fact())]}
              size={11}
              class="shrink-0"
            />
            {props.item.modifierChip}
          </span>
        </Badge>
      )}
    </Show>
  );
}

/**
 * The Exclusion Builder modifier's full sentence as visible text (never
 * hover-only: keyboard and touch users read it too), laid out like the why
 * line in the card's neutral secondary text — not the info blue, which
 * above the accent "Open …" link would read as a link; the badge's icon
 * and blue chip stay the visual cue.
 *
 * @param props.item The card (carrying `modifier`).
 * @returns The line, or nothing for a card without a builder fact.
 */
function ModifierLine(props: { item: StatusItem }): JSX.Element {
  return (
    <Show when={props.item.modifier}>
      {(sentence) => (
        <p data-fdt-card-modifier-line class="min-w-0 text-fg-secondary">
          <span class="sr-only">, </span>
          {sentence()}
        </p>
      )}
    </Show>
  );
}

/** The simulation badge's icon per fact (the shape carries the meaning, not the color). */
const SIMULATION_BADGE_ICONS: Readonly<Record<SimulationFact, LucideIcon>> = {
  simulated: FlaskConical,
  unverified: ShieldQuestionMark
};

/**
 * The simulation badge's tone per fact: a verified simulation is information
 * (the info blue the overlay's "Simulated" indicator wears); an unverified
 * marker is a caution worth noticing.
 */
const SIMULATION_BADGE_TONES: Readonly<Record<SimulationFact, 'info' | 'warn'>> = {
  simulated: 'info',
  unverified: 'warn'
};

/**
 * The simulation modifier: badge (icon + short text, hidden from assistive
 * tech) and the full sentence as a visible line, spoken once — the builder
 * modifier's pattern ({@link ModifierBadge}, {@link ModifierLine}).
 *
 * @param props.item The card (carrying `simulation`, its chip and sentence).
 * @returns The badge + line, or nothing for a card without a simulation fact.
 */
function SimulationModifier(props: { item: StatusItem }): JSX.Element {
  return (
    <Show when={props.item.simulation}>
      {(fact) => (
        <>
          <Badge kind={SIMULATION_BADGE_TONES[fact()]} class="shrink-0">
            <span
              data-fdt-card-simulation={fact()}
              aria-hidden="true"
              class="inline-flex items-center gap-1"
            >
              <Dynamic component={SIMULATION_BADGE_ICONS[fact()]} size={11} class="shrink-0" />
              {props.item.simulationChip}
            </span>
          </Badge>
          <p data-fdt-card-simulation-line class="min-w-0 text-fg-secondary">
            <span class="sr-only">, </span>
            {props.item.simulationSentence}
          </p>
        </>
      )}
    </Show>
  );
}

/**
 * The bypass warning: a warn badge (alert icon + short text, hidden from
 * assistive tech) and the full sentence as a visible line, spoken once —
 * the modifiers' pattern ({@link SimulationModifier}).
 *
 * @param props.item The card (carrying `bypassWarning`).
 * @returns The badge + line, or nothing for a card without the warning.
 */
function BypassWarning(props: { item: StatusItem }): JSX.Element {
  return (
    <Show when={props.item.bypassWarning}>
      {(copy) => (
        <>
          <Badge kind="warn" class="shrink-0">
            <span
              data-fdt-card-bypass-warning
              aria-hidden="true"
              class="inline-flex items-center gap-1"
            >
              <TriangleAlert size={11} class="shrink-0" />
              {copy().chip}
            </span>
          </Badge>
          <p data-fdt-card-bypass-line class="min-w-0 text-fg-secondary">
            <span class="sr-only">, </span>
            {copy().sentence}
          </p>
        </>
      )}
    </Show>
  );
}

/**
 * The evidence line: source chip, the bypass warning, the simulation and builder modifiers
 * (badge + sentence each) and/or the unsure verdict's why. Renders nothing for a card with none (non-feature
 * cards, undecided rows whose absence is an honest "not active").
 *
 * @param props.item The card.
 * @returns The evidence line, or nothing.
 */
function CardEvidence(props: { item: StatusItem }): JSX.Element {
  const source = () =>
    props.item.source === undefined ? undefined : SOURCE_COPY[props.item.source];
  return (
    // No bypass-warning or declared-only arm: a warned card is always
    // footprint-decided and a declared-only one meta-decided, so its source
    // chip already opens the line.
    <Show
      when={
        source() !== undefined ||
        props.item.why !== undefined ||
        props.item.builder !== undefined ||
        props.item.simulation !== undefined
      }
    >
      <div
        data-fdt-card-evidence
        class={cn(UNDER_NAME, 'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs')}
      >
        <Show when={source()}>
          {(copy) => (
            <Badge variant="outline" class="shrink-0">
              <span data-fdt-card-source title={copy().tooltip}>
                <span class="sr-only">, </span>
                {copy().chip}
                <span class="sr-only">: {copy().tooltip}</span>
              </span>
            </Badge>
          )}
        </Show>
        <Show when={props.item.declaredOnly}>
          {(sentence) => (
            <p data-fdt-card-declared-line class="min-w-0 text-fg-secondary">
              <span class="sr-only">, </span>
              {sentence()}
            </p>
          )}
        </Show>
        <BypassWarning item={props.item} />
        <SimulationModifier item={props.item} />
        <ModifierBadge item={props.item} />
        <ModifierLine item={props.item} />
        <Show when={props.item.why}>
          {(why) => (
            <p data-fdt-card-why class="min-w-0 text-status-warn">
              <span class="sr-only">, </span>
              {why()}
            </p>
          )}
        </Show>
      </div>
    </Show>
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
 * The subtitle line of a static card: plain text, or — for the cards
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
  /** The captured host layers when this card carries them. */
  const hostLayers = () => {
    const current = detail();
    return current?.kind === 'host-layers' ? current : undefined;
  };
  /** A declaration-only fact and its proof limit when this card carries them. */
  const proofLimit = () => {
    const current = detail();
    return current?.kind === 'proof-limit' ? current : undefined;
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
      <Match when={hostLayers()}>
        {(found) => (
          <div data-fdt-card-subtitle class={UNDER_NAME}>
            <Tooltip content={hostLayersTooltip(found().layers)} class={TOOLTIP_SUBTITLE}>
              {props.item.subtitle}
            </Tooltip>
          </div>
        )}
      </Match>
      <Match when={proofLimit()}>
        {(fact) => (
          <div data-fdt-card-subtitle class={UNDER_NAME}>
            <Tooltip content={fact().limit} class={TOOLTIP_SUBTITLE}>
              {fact().text}
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
  const layout = (): DetectionLayout => props.layout ?? 'adaptive';
  return (
    <Show
      when={destination()}
      fallback={
        <div
          data-fdt="status-card"
          data-fdt-card-id={props.item.id}
          class={statusCardSurface(layout())}
        >
          <CardHead item={props.item} />
          <StaticSubtitle item={props.item} now={props.now} />
          <CardEvidence item={props.item} />
        </div>
      }
    >
      {(route) => (
        <a
          data-fdt="status-card"
          data-fdt-card-id={props.item.id}
          href={`#/${route().id}`}
          class={cn(
            statusCardSurface(layout()),
            'group no-underline',
            FOCUS_RING,
            statusLinkInteraction(layout(), props.item.status)
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
          <CardEvidence item={props.item} />
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
