/**
 * The tester's result side under the shared run bar: the run's state — never run
 * (an empty card naming what a test produces once Run is available; a
 * skeleton of it while the settings load, a held line when they failed —
 * the settings column offers the Retry), running (a skeleton shaped
 * like the result, a real wait bounded by the deadlines; the service call
 * cannot be cancelled), the repeat-run question, a run held by an unsaved
 * form, or the finished outcome with its recoveries, the counts, each
 * replacement's matches and the copyable request address (reworded once
 * the page reloaded or navigated since a run that changed it). Every state
 * is read from the session; nothing here latches.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import RotateCw from 'lucide-solid/icons/rotate-cw';
import TestTubeDiagonal from 'lucide-solid/icons/test-tube-diagonal';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { CopyButton } from '../../../../components/ui/copy-button';
import { KeyValueList } from '../../../../components/ui/key-value';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  STATUS_SOFT_CLASSES,
  STATUS_TEXT_CLASSES,
  type StatusKind
} from '../../../../components/ui/status-badge';
import { RUCSS_RUN_WORST_CASE_MS } from '../../../../lib/rucss-tester/deadlines';
import {
  describeRucssOutcome,
  type RucssOutcomeView,
  type RucssRecovery
} from '../../../../lib/rucss-tester/outcome-view';
import type { RucssTestOutcome } from '../../../../lib/rucss-tester/run-test';
import {
  RUCSS_UNCONFIRMED_REPEAT_WARNING,
  rucssRepeatRunWarning
} from '../../../../lib/rucss-tester/test-mode';
import { cn } from '../../../../utils/cn';
import { countLabel, formatCount } from '../../../../utils/format-count';
import { OutcomeNotice } from '../outcome-notice';
import { ToolEmptyCard } from '../tool-empty-card';
import type { RucssTesterSession } from './session';

/** The running line (the bound is the panel's worst-case wait: start, build and apply in turn). */
export const RUNNING_COPY = `Waiting for the RUCSS service, then building and applying the CSS — up to ${formatCount(Math.round(RUCSS_RUN_WORST_CASE_MS / 1000))} s.`;

/** The held-run line (the settings heading names the save failure). */
export const BLOCKED_COPY =
  'The test did not start: the settings could not be saved, so it would run with old ones. Fix the problem named beside Settings, then run again.';

/** The result side before any run: what a test produces. */
export const RESULT_EMPTY = {
  title: 'No test run yet',
  description:
    "Run a test to get the used CSS WP Rocket's service keeps for this page, applied live until the page reloads."
} as const;

/** The result side while Run is held by settings that did not load (Retry sits under Settings). */
export const HELD_COPY = "The test can't run until its settings load. Retry them under Settings.";

/** What a finished test shows, named in the empty card (label, then what it is). */
export const RESULT_PREVIEW: readonly (readonly [label: string, value: string])[] = [
  ['Removed', 'Styles the test strips'],
  ['Kept', 'By your markers and patterns'],
  ['Applied', 'Used CSS, live on the page']
];

/** The recoveries' button labels. */
export const RECOVERY_LABELS: Readonly<Record<RucssRecovery, string>> = {
  retry: 'Run again',
  'reload-page': 'Reload page',
  'review-patterns': 'Review patterns',
  'inspect-styles': 'Inspect page styles'
};

/** An applied run's counts. */
type AppliedSummary = Extract<RucssTestOutcome, { kind: 'applied' }>['summary'];

/** Outcome tones → the shared status vocabulary. */
const TONE_KIND: Readonly<Record<RucssOutcomeView['tone'], StatusKind>> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  neutral: 'neutral'
};

/** What the run card's actions do (the page binds them). */
export interface RunPanelActions {
  /** Reload the inspected page; absent where the context cannot. */
  readonly reloadPage?: () => void;
  /** Go to the field a pattern failure names. */
  readonly reviewPatterns: (view: RucssOutcomeView) => void;
  /** Show the page-style inventory. */
  readonly inspectStyles: () => void;
}

/**
 * One recovery button (a reload where the context cannot reload is left out).
 *
 * @param props The recovery, the session and the actions.
 */
function RecoveryButton(props: {
  recovery: RucssRecovery;
  view: RucssOutcomeView;
  session: RucssTesterSession;
  actions: RunPanelActions;
  primary: boolean;
}): JSX.Element {
  /** Carry out this button's recovery. */
  const onClick = (): void => {
    switch (props.recovery) {
      case 'retry':
        void props.session.start();
        return;
      case 'reload-page':
        props.actions.reloadPage?.();
        return;
      case 'review-patterns':
        props.actions.reviewPatterns(props.view);
        return;
      case 'inspect-styles':
        props.actions.inspectStyles();
        return;
    }
  };
  return (
    <Show when={props.recovery !== 'reload-page' || props.actions.reloadPage !== undefined}>
      <Button
        size="sm"
        variant={props.primary ? 'primary' : 'secondary'}
        data-fdt-rucss-recovery={props.recovery}
        onClick={onClick}
      >
        {RECOVERY_LABELS[props.recovery]}
      </Button>
    </Show>
  );
}

/** The applied run's counts, in order (the running skeleton draws one line per row). */
const SUMMARY_ROWS: readonly {
  readonly term: string;
  readonly value: (summary: AppliedSummary) => string;
}[] = [
  { term: 'Styles removed', value: (summary) => formatCount(summary.removed) },
  { term: 'Kept by inline markers', value: (summary) => formatCount(summary.preserved) },
  { term: 'Kept by stylesheet patterns', value: (summary) => formatCount(summary.excluded) },
  { term: 'Already gone', value: (summary) => formatCount(summary.gone) },
  {
    term: 'CSS injected',
    value: (summary) => countLabel(summary.cssChars, { one: 'character', other: 'characters' })
  }
];

/**
 * The applied run's details: the counts and each replacement's matches.
 *
 * @param props.outcome The applied outcome.
 */
function AppliedDetails(props: {
  outcome: Extract<RucssTestOutcome, { kind: 'applied' }>;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-2">
      <KeyValueList
        data-fdt="rucss-summary"
        items={SUMMARY_ROWS.map((row) => ({
          term: row.term,
          value: <span class="tabular-nums">{row.value(props.outcome.summary)}</span>
        }))}
      />
      <Show when={props.outcome.applied.length > 0}>
        <ul data-fdt="rucss-pair-counts" class="flex flex-col gap-0.5 text-2xs text-fg-secondary">
          <For each={props.outcome.applied}>
            {(pair) => (
              <li>
                Replacement {formatCount(pair.index + 1)}:{' '}
                <span class="tabular-nums text-fg-primary">
                  {countLabel(pair.count, { one: 'match', other: 'matches' })}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

/**
 * The finished run's request address, copyable.
 *
 * @param props.url The address.
 */
function RequestLine(props: { url: string }): JSX.Element {
  return (
    <div class="flex min-w-0 items-center gap-1.5">
      <span class="shrink-0 text-2xs text-fg-muted">Request</span>
      <span
        data-fdt-rucss-request
        class="min-w-0 flex-1 truncate font-mono text-2xs text-fg-primary"
        title={props.url}
      >
        {props.url}
      </span>
      <CopyButton
        text={props.url}
        label="Request address"
        ariaLabel="Copy request address"
        title="Copy the request address"
        showLabel={false}
        successTitle="Request address copied"
        size="sm"
      />
    </div>
  );
}

/**
 * The finished run: one result card — the outcome notice (its words, an
 * invalid configuration's problems, the recoveries), then the applied
 * run's counts and the request address on the card itself (no box inside
 * the notice's tint).
 *
 * @param props The outcome, the session and the actions.
 */
function OutcomeBlock(props: {
  outcome: RucssTestOutcome;
  session: RucssTesterSession;
  actions: RunPanelActions;
}): JSX.Element {
  const view = createMemo(() =>
    describeRucssOutcome(props.outcome, { stale: props.session.stale() })
  );
  const kind = (): StatusKind => TONE_KIND[view().tone];
  const applied = () => (props.outcome.kind === 'applied' ? props.outcome : undefined);
  return (
    <Card>
      <div data-fdt="rucss-result" class="flex flex-col gap-3">
        <OutcomeNotice
          data-fdt="rucss-outcome"
          data-fdt-rucss-outcome={props.outcome.kind}
          data-fdt-rucss-stale={props.session.stale() ? '' : undefined}
          kind={kind()}
          title={view().title}
          message={view().message}
        >
          <Show when={props.outcome.kind === 'invalid-config' ? props.outcome : undefined}>
            {(invalid) => (
              <ul class="flex flex-col gap-0.5 ps-5 text-2xs text-fg-secondary">
                <For each={invalid().problems}>
                  {(problem) => (
                    <li class="break-words">
                      {problem.kind === 'replacement-pattern'
                        ? `Replacement ${formatCount(problem.index + 1)}: ${problem.message}`
                        : `Stylesheet pattern “${problem.line}”: ${problem.message}`}
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
          <Show when={view().recoveries.length > 0}>
            <div class="flex flex-wrap gap-1.5">
              <For each={view().recoveries}>
                {(recovery, index) => (
                  <RecoveryButton
                    recovery={recovery}
                    view={view()}
                    session={props.session}
                    actions={props.actions}
                    primary={index() === 0}
                  />
                )}
              </For>
            </div>
          </Show>
        </OutcomeNotice>
        <Show when={applied()}>{(outcome) => <AppliedDetails outcome={outcome()} />}</Show>
        <Show when={view().requestUrl}>{(url) => <RequestLine url={url()} />}</Show>
      </div>
    </Card>
  );
}

/** The result side before any run: an honest empty card naming what a test produces. */
function EmptyResult(): JSX.Element {
  return (
    <ToolEmptyCard
      hook="rucss-empty"
      icon={TestTubeDiagonal}
      title={RESULT_EMPTY.title}
      description={RESULT_EMPTY.description}
      fill
    >
      <ul class="grid w-full max-w-120 grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2 pb-6">
        <For each={RESULT_PREVIEW}>
          {([label, value]) => (
            <li class="flex flex-col gap-0.5 rounded-lg border border-line-1 bg-surface-1 p-2.5">
              <span class="text-2xs text-fg-muted">{label}</span>
              <span class="text-xs font-semibold text-fg-primary">{value}</span>
            </li>
          )}
        </For>
      </ul>
    </ToolEmptyCard>
  );
}

/**
 * The result side before any run, by the settings' load: the empty card
 * once Run is available, a skeleton of it while they load (a real wait,
 * resolved with the settings' own skeleton), the held line when they
 * failed — never "Run a test" beside a held Run.
 *
 * @param props.session The session.
 */
function IdleResult(props: { session: RucssTesterSession }): JSX.Element {
  return (
    <Switch>
      <Match when={props.session.load().status === 'ready'}>
        <EmptyResult />
      </Match>
      <Match when={props.session.load().status === 'loading'}>
        <Skeleton data-fdt-rucss-result-held="loading" class="h-40 rounded-lg @wide:flex-1" />
      </Match>
      <Match when={props.session.load().status === 'failed'}>
        <Card look="placeholder">
          <p data-fdt-rucss-result-held="failed" class="text-2xs text-fg-secondary">
            {HELD_COPY}
          </p>
        </Card>
      </Match>
    </Switch>
  );
}

/**
 * A run's wait: what it waits for, then a skeleton shaped like the result
 * (the outcome notice, the five counts, the request line). Shown only while
 * the run is in flight.
 */
function RunningResult(): JSX.Element {
  return (
    <Card>
      <div data-fdt="rucss-running" class="flex flex-col gap-3">
        <p data-fdt-rucss-running class="text-2xs text-fg-secondary">
          {RUNNING_COPY}
        </p>
        <div data-fdt-rucss-result-loading class="flex flex-col gap-3">
          <Skeleton class="h-12 rounded-md" />
          <div class="flex flex-col gap-1.5">
            <For each={SUMMARY_ROWS}>
              {() => (
                <div class="flex justify-between gap-3">
                  <Skeleton class="h-3 w-32 max-w-[60%]" />
                  <Skeleton class="h-3 w-10" />
                </div>
              )}
            </For>
          </div>
          <Skeleton class="h-3 w-3/4" />
        </div>
      </div>
    </Card>
  );
}

/** Props of {@link RunResult}. */
export interface RunResultProps {
  session: RucssTesterSession;
  actions: RunPanelActions;
}

/**
 * Render the run's state under the run bar.
 *
 * @param props See {@link RunResultProps}.
 */
export function RunResult(props: RunResultProps): JSX.Element {
  /** The finished run, else `undefined`. */
  const finished = () => {
    const state = props.session.run();
    return state.status === 'finished' ? state : undefined;
  };
  /** The repeat question's sentence: confirmed tests by count, else the unconfirmed one. */
  const repeatWarning = (): string => {
    const prior = props.session.priorTests();
    return prior.applied > 0
      ? rucssRepeatRunWarning(prior.applied)
      : RUCSS_UNCONFIRMED_REPEAT_WARNING;
  };
  return (
    <Switch fallback={<IdleResult session={props.session} />}>
      <Match when={props.session.run().status === 'running'}>
        <RunningResult />
      </Match>
      <Match when={props.session.run().status === 'confirm-repeat'}>
        <div
          data-fdt-rucss-repeat
          class={cn('flex flex-col gap-2 rounded-md p-2.5', STATUS_SOFT_CLASSES.warn)}
        >
          <p class="text-xs text-fg-primary">{repeatWarning()}</p>
          <div class="flex flex-wrap gap-1.5">
            <Show when={props.actions.reloadPage}>
              {(reload) => (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    props.session.cancelRepeat();
                    reload()();
                  }}
                >
                  <RotateCw size={12} aria-hidden="true" />
                  Reload for a clean run
                </Button>
              )}
            </Show>
            <Button
              size="sm"
              variant="secondary"
              data-fdt-rucss-run-on-top
              onClick={() => {
                void props.session.start({ force: true });
              }}
            >
              Run on top
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                props.session.cancelRepeat();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Match>
      <Match when={props.session.run().status === 'blocked'}>
        <p
          data-fdt-rucss-blocked
          class={cn(
            'rounded-md p-2.5 text-2xs',
            STATUS_SOFT_CLASSES.error,
            STATUS_TEXT_CLASSES.error
          )}
        >
          {BLOCKED_COPY}
        </p>
      </Match>
      <Match when={finished()} keyed>
        {(state) => (
          <OutcomeBlock outcome={state.outcome} session={props.session} actions={props.actions} />
        )}
      </Match>
    </Switch>
  );
}
