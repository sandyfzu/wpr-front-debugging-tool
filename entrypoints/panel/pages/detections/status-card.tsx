/**
 * One Detections entry — the same anatomy in every layout, only its grid
 * and surface change ({@link entryClass}): status icon · name with its note
 * lines · state (an Active / Collecting / Unknown pill, or a quiet "Off") ·
 * the owning page's link when the link table names one. Grouped and List
 * paint it as a calm row; Cards as a card from the regular tier up.
 *
 * The entry itself is never a control: the link is its one tab stop, so
 * tooltip subtitles (the Cached row's absolute time, the Known Platform
 * row's matching header, host layers, a declaration-only row's proof limit)
 * work on every row.
 *
 * Note lines: the subtitle (versions and server values mono, as data), then
 * the evidence line — the source chip (`Meta` / `Footprint`, its meaning
 * spelled out for assistive tech and in the native title; under a group
 * header that already states the group's norm, only a row that differs
 * shows one), the declared-only sentence, the amber "applied despite
 * ?nowprocket" warning, the simulation and Exclusion Builder modifiers
 * (an at-a-glance badge plus the full sentence as a visible line, spoken
 * once) and an unsure verdict's amber why. The state stays WP Rocket's
 * served verdict: a feature the builder turned off reads Active with its
 * "Disabled in this tab" line.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import CircleOff from 'lucide-solid/icons/circle-off';
import Clock from 'lucide-solid/icons/clock';
import FlaskConical from 'lucide-solid/icons/flask-conical';
import ListX from 'lucide-solid/icons/list-x';
import ShieldQuestionMark from 'lucide-solid/icons/shield-question-mark';
import TriangleExclamationPoint from 'lucide-solid/icons/triangle-exclamation-point';
import type { LucideIcon } from 'lucide-solid';
import { Badge } from '../../../../components/ui/badge';
import { FOCUS_RING } from '../../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  StatusBadge
} from '../../../../components/ui/status-badge';
import { Tooltip } from '../../../../components/ui/tooltip';
import {
  builderBadgeKind,
  SOURCE_COPY,
  type BuilderBadgeKind,
  type SourceCopy
} from '../../../../lib/detection/hud';
import {
  hostLayersTooltip,
  type StatusItem,
  type StatusKind
} from '../../../../lib/panel/detections-view-model';
import type { SimulationFact } from '../../../../lib/wp-rocket/types';
import type { DetectionLayout } from '../../state/detections-layout';
import { cn } from '../../../../utils/cn';
import { navRoute, type RouteId } from '../../routes';
import { cacheAgeText, ENTRY_STATE_LABELS, STATUS_TONES } from './card-presentation';
import { entryClass } from './entry-layout';

/**
 * The status icon per verdict: the vocabulary's shapes, except collecting
 * reads as a clock (waiting on beacon data), never the alert triangle an
 * unknown verdict keeps.
 */
export const ENTRY_ICONS: Readonly<Record<StatusKind, LucideIcon>> = {
  active: STATUS_ICONS.ok,
  collecting: Clock,
  unknown: STATUS_ICONS.warn,
  'not-active': STATUS_ICONS.neutral
};

/**
 * A subtitle-as-tooltip-trigger: reads as text, a dotted underline hints the
 * detail. The trigger keeps its 24 px hit area; `-my-1` only stops that
 * area from loosening the row's line rhythm.
 */
const TOOLTIP_SUBTITLE =
  '-my-1 justify-items-start text-start text-2xs text-fg-secondary underline decoration-line-3 decoration-dotted underline-offset-2 hover:text-fg-primary';

/**
 * The page link: accent text with a 24 px hit floor (T-3), never wrapping;
 * the negative inline margin keeps its text aligned with the name above.
 */
const ENTRY_LINK = cn(
  '-mx-1 inline-flex min-h-6 items-center gap-0.5 rounded-sm px-1 text-2xs font-medium whitespace-nowrap text-accent no-underline hover:underline',
  FOCUS_RING
);

/** Props of {@link StatusCard}. */
export interface StatusCardProps {
  /** The entry from the view model. */
  item: StatusItem;
  /** The page this entry links to, or undefined for none. */
  linkTo?: RouteId;
  /** The page clock reading (epoch ms) the Cached row ages against. */
  now: number;
  /** The page's layout (absent: `grouped`). */
  layout?: DetectionLayout;
  /**
   * Whether the entry shows its own source chip (absent: true). False under
   * a group whose header states the same source (see `showsOwnSource`).
   */
  showSource?: boolean;
}

/**
 * The verdict's state cell: a pill for the states worth noticing, the quiet
 * word for "off" (no pill: twelve off features would be twelve chips of noise).
 *
 * @param props.status The entry's verdict.
 * @returns The state cell.
 */
function EntryState(props: { status: StatusKind }): JSX.Element {
  return (
    <span data-fdt-card-state={props.status} class="flex min-w-18 justify-end [grid-area:state]">
      <span class="sr-only">, </span>
      <Show
        when={props.status !== 'not-active'}
        fallback={
          <span class="text-2xs leading-4.5 text-fg-muted">{ENTRY_STATE_LABELS[props.status]}</span>
        }
      >
        <StatusBadge kind={STATUS_TONES[props.status]} class="shrink-0 rounded-full">
          {ENTRY_STATE_LABELS[props.status]}
        </StatusBadge>
      </Show>
    </span>
  );
}

/**
 * A source chip: the short word, its meaning in the native title and for
 * assistive tech. `group` scope is the header's norm chip (the source every
 * row of the group carries).
 *
 * @param props.copy The source's copy.
 * @param props.scope `entry` (a row's own chip) or `group` (the header's norm).
 * @returns The chip.
 */
export function SourceChip(props: { copy: SourceCopy; scope?: 'entry' | 'group' }): JSX.Element {
  const group = (): boolean => props.scope === 'group';
  const title = (): string =>
    group() ? `${props.copy.tooltip} Applies to every row here.` : props.copy.tooltip;
  return (
    <Badge variant="outline" class="shrink-0">
      <span
        data-fdt-card-source={group() ? undefined : ''}
        data-fdt-group-source={group() ? '' : undefined}
        title={title()}
      >
        <span class="sr-only">, </span>
        {props.copy.chip}
        <span class="sr-only">: {title()}</span>
      </span>
    </Badge>
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
              <TriangleExclamationPoint size={11} class="shrink-0" />
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
 * Whether an entry has evidence to show: a visible source chip, a
 * declared-only, bypass, simulation or builder line, or an unsure why.
 *
 * @param item The entry.
 * @param showSource Whether its own source chip renders (see {@link StatusCardProps.showSource}).
 * @returns True when {@link CardEvidence} renders.
 */
export function hasEvidence(item: StatusItem, showSource: boolean): boolean {
  return (
    (showSource && item.source !== undefined) ||
    item.declaredOnly !== undefined ||
    item.bypassWarning !== undefined ||
    item.simulation !== undefined ||
    item.builder !== undefined ||
    item.why !== undefined
  );
}

/**
 * The evidence line: source chip (when shown), the declared-only line, the
 * bypass warning, the simulation and builder modifiers (badge + sentence
 * each) and/or the unsure verdict's why. Renders nothing for an entry with
 * none (non-feature rows, undecided rows whose absence is an honest "off").
 *
 * @param props.item The entry.
 * @param props.showSource Whether the entry's own source chip renders.
 * @returns The evidence line, or nothing.
 */
function CardEvidence(props: { item: StatusItem; showSource: boolean }): JSX.Element {
  const source = () =>
    props.showSource && props.item.source !== undefined
      ? SOURCE_COPY[props.item.source]
      : undefined;
  return (
    <Show when={hasEvidence(props.item, props.showSource)}>
      <div data-fdt-card-evidence class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs">
        <Show when={source()}>{(copy) => <SourceChip copy={copy()} />}</Show>
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
            <p data-fdt-card-subtitle class="text-2xs text-fg-secondary">
              <SubtitleText item={props.item} text={subtitle()} />
            </p>
          )}
        </Show>
      }
    >
      <Match when={cachedAt()}>
        {(stamp) => (
          <div data-fdt-card-subtitle>
            <Tooltip content={`Generated at ${stamp().formatted}`} class={TOOLTIP_SUBTITLE}>
              {cacheAgeText(stamp().seconds, props.now)}
            </Tooltip>
          </div>
        )}
      </Match>
      <Match when={platform()}>
        {(match) => (
          <div data-fdt-card-subtitle>
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
          <div data-fdt-card-subtitle>
            <Tooltip content={hostLayersTooltip(found().layers)} class={TOOLTIP_SUBTITLE}>
              {props.item.subtitle}
            </Tooltip>
          </div>
        )}
      </Match>
      <Match when={proofLimit()}>
        {(fact) => (
          <div data-fdt-card-subtitle>
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
 * Whether an entry shows a note line under its name.
 *
 * @param item The entry.
 * @param showSource Whether its own source chip renders.
 * @returns True when a subtitle or the evidence line renders.
 */
export function hasNoteLine(item: StatusItem, showSource: boolean): boolean {
  return item.subtitle !== undefined || hasEvidence(item, showSource);
}

/**
 * Render one entry.
 *
 * @param props See {@link StatusCardProps}.
 * @returns The entry (a `div`; its link, when any, is the only control).
 */
export function StatusCard(props: StatusCardProps): JSX.Element {
  /** The destination's nav row (the link needs its label). */
  const destination = () => (props.linkTo === undefined ? undefined : navRoute(props.linkTo));
  const showSource = (): boolean => props.showSource ?? true;
  const tone = () => STATUS_TONES[props.item.status];
  return (
    <div
      data-fdt="status-card"
      data-fdt-card-id={props.item.id}
      data-fdt-card-source-kind={props.item.source}
      class={entryClass({
        layout: props.layout ?? 'grouped',
        hasLink: destination() !== undefined,
        twoLine: hasNoteLine(props.item, showSource())
      })}
    >
      <Dynamic
        component={ENTRY_ICONS[props.item.status]}
        size={14}
        class={cn('mt-px shrink-0 [grid-area:icon]', STATUS_TEXT_CLASSES[tone()])}
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-col gap-1 [grid-area:main]">
        <span
          data-fdt-card-name
          class={cn(
            'leading-snug wrap-break-word',
            // Off features recede so the ones in play scan first; the state
            // and icon still say it (never color alone).
            props.item.status === 'not-active'
              ? 'font-medium text-fg-secondary'
              : 'font-semibold text-fg-primary'
          )}
        >
          {props.item.name}
        </span>
        <StaticSubtitle item={props.item} now={props.now} />
        <CardEvidence item={props.item} showSource={showSource()} />
      </div>
      <EntryState status={props.item.status} />
      <Show when={destination()}>
        {(route) => (
          <a
            data-fdt-card-link
            href={`#/${route().id}`}
            class={cn(ENTRY_LINK, 'self-start [grid-area:link]')}
          >
            <span class="sr-only">Open </span>
            {route().label}
            {/* Named per row: several rows link the same page. */}
            <span class="sr-only">, {props.item.name}</span>
            <ChevronRight size={12} class="shrink-0" aria-hidden="true" />
          </a>
        )}
      </Show>
    </div>
  );
}
