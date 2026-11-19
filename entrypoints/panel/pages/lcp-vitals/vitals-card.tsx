/**
 * The current-visit Core Web Vitals section: LCP, CLS and INP of this one
 * visit (never field data) as stat tiles — each with its value, rating and a
 * threshold meter, or why it has none — the visit's notes, and Refresh.
 * Every state is read from the session.
 *
 * States: first read pending → three skeleton tiles shaped like the read ·
 * page-unreachable (per miss, with recoveries) · read (per metric: measured /
 * unsupported / no data; restored and capped notes) · refreshing (the shown
 * read stays, Refresh busy) · a failed refresh (its notice above the kept
 * read) · stale once the page reloaded or changed.
 */
import type { LucideIcon } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, For, Index, Match, Show, Switch } from 'solid-js';
import ImageIcon from 'lucide-solid/icons/image';
import MousePointerClick from 'lucide-solid/icons/mouse-pointer-click';
import MoveVertical from 'lucide-solid/icons/move-vertical';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatTile, type StatTileTone } from '../../../../components/ui/stat-tile';
import {
  STATUS_TEXT_CLASSES,
  StatusBadge,
  type StatusKind
} from '../../../../components/ui/status-badge';
import type { VitalRating } from '../../../../lib/web-vitals/current-visit';
import type { CurrentVisitOutcome } from '../../../../lib/web-vitals/read-current-visit';
import {
  meterLegend,
  METER_BANDS,
  outcomeMeter,
  type VitalMeter
} from '../../../../lib/web-vitals/vital-meter';
import {
  describeVitalsMiss,
  RATING_LABELS,
  VISIT_SCOPE_NOTE,
  VITAL_KEYS,
  visitNotes,
  vitalRows,
  type VitalKey,
  type VitalRow,
  type VitalsRecovery
} from '../../../../lib/web-vitals/vitals-view';
import { cn } from '../../../../utils/cn';
import { OutcomeNotice } from '../outcome-notice';
import { RecoveryButtons } from '../recovery-buttons';
import type { LcpVitalsSession } from './session';

/** The line once the page reloaded or navigated after the shown read. */
export const VITALS_STALE_COPY =
  'The page reloaded or changed since this read — these values describe the earlier page load. Refresh for the current one.';

/** The recoveries' button labels. */
export const VITALS_RECOVERY_LABELS: Readonly<Record<VitalsRecovery, string>> = {
  retry: 'Refresh',
  'reload-page': 'Reload page'
};

/** The value shown for a metric the browser does not report, or one without data yet. */
export const VITAL_STATE_VALUES: Readonly<Record<'unsupported' | 'no-data', string>> = {
  unsupported: 'Not supported',
  'no-data': 'No data'
};

/** Ratings → the shared status vocabulary (icon + tint, never color alone). */
const RATING_KIND: Readonly<Record<VitalRating, StatusKind>> = {
  good: 'ok',
  'needs-improvement': 'warn',
  poor: 'error'
};

/** Each metric's tile icon: what it measures (a paint, a shift, an interaction). */
const VITAL_ICONS: Readonly<Record<VitalKey, LucideIcon>> = {
  lcp: ImageIcon,
  cls: MoveVertical,
  inp: MousePointerClick
};

/** The tile grid: one column when compact, the three side by side from `@regular`. */
const TILE_GRID = 'grid gap-2 @regular:grid-cols-3';

/** Props of {@link VitalsCard}. */
export interface VitalsCardProps {
  session: LcpVitalsSession;
  /** Reload the inspected page; absent where the context cannot. */
  reloadPage?: () => void;
}

/**
 * The threshold meter: three equal bands (the value's band in its status
 * color, the others quiet), a marker at the value, the thresholds named
 * under it. Decorative beside the rating badge, which names the band in
 * words — the bar never carries meaning by color alone.
 *
 * @param props.metric The metric (names its thresholds).
 * @param props.meter The placed value.
 */
function VitalMeterBar(props: { metric: VitalKey; meter: VitalMeter }): JSX.Element {
  return (
    <div class="flex flex-col gap-1">
      <div
        data-fdt="vital-meter"
        data-fdt-vital-band={props.meter.band}
        class="relative h-3"
        aria-hidden="true"
      >
        <div class="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 gap-0.5">
          <Index each={METER_BANDS}>
            {(band) => (
              <div
                data-fdt-meter-band={band()}
                class={cn(
                  'h-full flex-1 rounded-full',
                  band() === props.meter.band
                    ? cn('bg-current', STATUS_TEXT_CLASSES[RATING_KIND[band()]])
                    : 'bg-surface-4'
                )}
              />
            )}
          </Index>
        </div>
        {/* A short bar across the track, centred on the value; the ring (the tile's card fill,
            `Card` level 1) keeps it apart from the band. */}
        <div
          data-fdt="vital-meter-marker"
          class="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-fg-primary ring-2 ring-surface-2"
          style={{ left: `${String(props.meter.position * 100)}%` }}
        />
      </div>
      <span data-fdt-vital-legend>{meterLegend(props.metric)}</span>
    </div>
  );
}

/**
 * One metric's tile: the value with its rating badge and meter, or its state
 * (not supported / no data) in words; the row's note under it.
 *
 * @param props.row The metric's row.
 * @param props.meter Its meter (null unless measured).
 */
function VitalTile(props: { row: VitalRow; meter: VitalMeter | null }): JSX.Element {
  const measured = () => (props.row.state === 'measured' ? props.row : undefined);
  /** Rated tones while measured; the label's muted tone otherwise. */
  const tone = (): StatTileTone => {
    const row = measured();
    return row === undefined ? 'muted' : RATING_KIND[row.rating];
  };
  return (
    <div data-fdt-vital={props.row.key} data-fdt-vital-state={props.row.state} class="min-w-0">
      <StatTile
        class="h-full"
        label={`${props.row.short} · ${props.row.full}`}
        icon={VITAL_ICONS[props.row.key]}
        iconTone={tone()}
        valueRole={measured() === undefined ? 'tile' : 'stat'}
        valueTone={measured() === undefined ? 'muted' : 'primary'}
        sub={
          <div class="flex flex-col gap-1.5">
            <Show when={props.meter}>
              {(meter) => <VitalMeterBar metric={props.row.key} meter={meter()} />}
            </Show>
            <Show when={props.row.note}>
              {(note) => <span class="text-fg-secondary">{note()}</span>}
            </Show>
          </div>
        }
      >
        <Switch>
          <Match when={measured()} keyed>
            {(row) => (
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{row.value}</span>
                <StatusBadge kind={RATING_KIND[row.rating]} icon>
                  {RATING_LABELS[row.rating]}
                </StatusBadge>
              </span>
            )}
          </Match>
          <Match when={props.row.state === 'measured' ? undefined : props.row.state} keyed>
            {(state) => VITAL_STATE_VALUES[state]}
          </Match>
        </Switch>
      </StatTile>
    </div>
  );
}

/**
 * The read's tiles and notes.
 *
 * @param props.outcome The read.
 */
function VitalsRead(props: {
  outcome: Extract<CurrentVisitOutcome, { kind: 'read' }>;
}): JSX.Element {
  // Rows carry the words; the meter reads the raw value of the same outcome.
  const tiles = createMemo(() =>
    vitalRows(props.outcome.vitals).map((row) => ({
      row,
      meter: outcomeMeter(row.key, props.outcome.vitals[row.key])
    }))
  );
  return (
    <div class="flex flex-col gap-1.5">
      <div data-fdt="vitals-rows" class={TILE_GRID}>
        <For each={tiles()}>{(tile) => <VitalTile row={tile.row} meter={tile.meter} />}</For>
      </div>
      <For each={visitNotes(props.outcome)}>
        {(note) => (
          <p data-fdt-vitals-note class="text-2xs text-fg-secondary">
            {note}
          </p>
        )}
      </For>
    </div>
  );
}

/** The first read's wait: three tiles shaped like the read's (label, value, meter, legend). */
function VitalsSkeleton(): JSX.Element {
  return (
    <div data-fdt-vitals-loading class={TILE_GRID}>
      <For each={VITAL_KEYS}>
        {() => (
          <Card class="min-w-0">
            <div class="flex flex-col gap-2">
              <Skeleton class="h-3 w-32 max-w-full" />
              <Skeleton class="h-6 w-24 max-w-full" />
              <Skeleton class="h-1.5" />
              <Skeleton class="h-3 w-40 max-w-full" />
            </div>
          </Card>
        )}
      </For>
    </div>
  );
}

/**
 * Render the section.
 *
 * @param props See {@link VitalsCardProps}.
 */
export function VitalsCard(props: VitalsCardProps): JSX.Element {
  const run = () => props.session.vitals.state();
  const outcome = () => run().shown?.outcome;
  /** The read, when the page answered. */
  const read = () => {
    const current = outcome();
    return current?.kind === 'read' ? current : undefined;
  };
  /** How the latest read missed the page, when it did (a failed refresh keeps the read below). */
  const missKind = () => {
    const current = run().failure?.outcome ?? outcome();
    return current?.kind === 'page-unreachable' ? current.miss : undefined;
  };
  const miss = () => {
    const kind = missKind();
    return kind === undefined ? undefined : describeVitalsMiss(kind);
  };
  const refresh = (): void => {
    void props.session.vitals.start();
  };

  return (
    <section
      data-fdt="vitals-card"
      class="flex flex-col gap-2.5"
      aria-labelledby="vitals-card-title"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h2 id="vitals-card-title" class="text-sm font-semibold text-fg-primary">
            Core Web Vitals of this visit
          </h2>
          <p class="text-2xs text-fg-secondary">{VISIT_SCOPE_NOTE}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          busy={run().pending}
          data-fdt-vitals-refresh
          onClick={refresh}
        >
          <Show when={!run().pending}>
            <RefreshCw size={12} aria-hidden="true" />
          </Show>
          Refresh
        </Button>
      </div>
      <Show when={run().shown === null}>
        <VitalsSkeleton />
      </Show>
      <Show when={miss()} keyed>
        {(view) => (
          <OutcomeNotice
            data-fdt="vitals-outcome"
            data-fdt-vitals-miss={missKind()}
            kind="error"
            title={view.title}
            message={view.message}
          >
            <RecoveryButtons
              recoveries={view.recoveries}
              labels={VITALS_RECOVERY_LABELS}
              onRetry={refresh}
              reloadPage={props.reloadPage}
              hook="vitals"
            />
          </OutcomeNotice>
        )}
      </Show>
      <Show when={read()} keyed>
        {(current) => <VitalsRead outcome={current} />}
      </Show>
      <Show when={props.session.vitals.stale()}>
        <p data-fdt-vitals-stale class="text-2xs text-fg-secondary">
          {VITALS_STALE_COPY}
        </p>
      </Show>
    </section>
  );
}
