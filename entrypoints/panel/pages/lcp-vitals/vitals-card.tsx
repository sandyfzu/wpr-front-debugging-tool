/**
 * The current-visit Core Web Vitals card: LCP, CLS and INP of this one visit
 * (never field data), each with its value and rating or why it has none, the
 * visit's notes, and Refresh. Every state is read from the session.
 *
 * States: first read pending → a skeleton shaped like the three rows ·
 * page-unreachable (per miss, with recoveries) · read (per metric: measured /
 * unsupported / no data; restored and capped notes) · refreshing (the shown
 * read stays, Refresh busy) · stale once the page reloaded.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge, type StatusKind } from '../../../../components/ui/status-badge';
import type { VitalRating } from '../../../../lib/web-vitals/current-visit';
import type { CurrentVisitOutcome } from '../../../../lib/web-vitals/read-current-visit';
import {
  describeVitalsMiss,
  RATING_LABELS,
  VISIT_SCOPE_NOTE,
  visitNotes,
  vitalRows,
  type VitalRow,
  type VitalsRecovery
} from '../../../../lib/web-vitals/vitals-view';
import { OutcomeNotice } from '../outcome-notice';
import { RecoveryButtons } from './recovery-buttons';
import type { LcpVitalsSession } from './session';

/** The line once the page reloaded or navigated after the shown read. */
export const VITALS_STALE_COPY =
  'The page reloaded since this read — these values describe the earlier visit. Refresh for the current one.';

/** The recoveries' button labels. */
export const VITALS_RECOVERY_LABELS: Readonly<Record<VitalsRecovery, string>> = {
  retry: 'Refresh',
  'reload-page': 'Reload page'
};

/** Ratings → the shared status vocabulary (icon + tint, never color alone). */
const RATING_KIND: Readonly<Record<VitalRating, StatusKind>> = {
  good: 'ok',
  'needs-improvement': 'warn',
  poor: 'error'
};

/** Props of {@link VitalsCard}. */
export interface VitalsCardProps {
  session: LcpVitalsSession;
  /** Reload the inspected page; absent where the context cannot. */
  reloadPage?: () => void;
}

/**
 * One metric's row: name, value with its rating (or the state), the note.
 *
 * @param props The row.
 */
function VitalLine(props: { row: VitalRow }): JSX.Element {
  return (
    <div
      data-fdt-vital={props.row.key}
      data-fdt-vital-state={props.row.state}
      class="flex min-h-8 flex-col justify-center gap-0.5 border-b border-line-1 py-1.5 last:border-b-0"
    >
      <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span class="min-w-0 text-xs text-fg-primary">
          <span class="font-semibold">{props.row.short}</span>{' '}
          <span class="text-fg-secondary">{props.row.full}</span>
        </span>
        <Switch>
          <Match when={props.row.state === 'measured' ? props.row : undefined} keyed>
            {(row) => (
              <span class="flex shrink-0 items-center gap-2">
                <span class="text-xs font-semibold text-fg-primary tabular-nums">{row.value}</span>
                <StatusBadge kind={RATING_KIND[row.rating]} icon>
                  {RATING_LABELS[row.rating]}
                </StatusBadge>
              </span>
            )}
          </Match>
          <Match when={props.row.state === 'unsupported'}>
            <Badge class="shrink-0">Not supported</Badge>
          </Match>
          <Match when={props.row.state === 'no-data'}>
            <Badge variant="outline" class="shrink-0">
              No data
            </Badge>
          </Match>
        </Switch>
      </div>
      <Show when={props.row.note}>
        {(note) => <span class="text-2xs text-fg-secondary">{note()}</span>}
      </Show>
    </div>
  );
}

/**
 * The read's metrics and notes.
 *
 * @param props The read.
 */
function VitalsRead(props: {
  outcome: Extract<CurrentVisitOutcome, { kind: 'read' }>;
}): JSX.Element {
  const rows = createMemo(() => vitalRows(props.outcome.vitals));
  return (
    <div class="flex flex-col gap-1.5">
      <div data-fdt="vitals-rows" class="flex flex-col">
        <For each={rows()}>{(row) => <VitalLine row={row} />}</For>
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

/**
 * Render the card.
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
  /** How the read missed the page, when it did. */
  const missKind = () => {
    const current = outcome();
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
    <Card level={1} class="p-2.5">
      <section
        data-fdt="vitals-card"
        class="flex flex-col gap-2.5"
        aria-labelledby="vitals-card-title"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="vitals-card-title" class="text-sm font-semibold text-fg-primary">
            Core Web Vitals of this visit
          </h2>
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
        <p class="text-2xs text-fg-secondary">{VISIT_SCOPE_NOTE}</p>
        <Switch>
          <Match when={run().shown === null}>
            <div data-fdt-vitals-loading class="flex flex-col gap-2">
              <Skeleton class="h-6 w-full" />
              <Skeleton class="h-6 w-full" />
              <Skeleton class="h-6 w-full" />
            </div>
          </Match>
          <Match when={miss()} keyed>
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
          </Match>
          <Match when={read()} keyed>
            {(current) => <VitalsRead outcome={current} />}
          </Match>
        </Switch>
        <Show when={props.session.vitals.stale()}>
          <p data-fdt-vitals-stale class="text-2xs text-fg-secondary">
            {VITALS_STALE_COPY}
          </p>
        </Show>
      </section>
    </Card>
  );
}
