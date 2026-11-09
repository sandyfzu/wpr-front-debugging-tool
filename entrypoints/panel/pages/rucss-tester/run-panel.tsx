/**
 * The tester's run card: what a run sends (shown before the first click),
 * the Run control, and the run's state — running (a real wait, bounded by
 * the deadlines), the repeat-run question, a run held by an unsaved form,
 * or the finished outcome with its recoveries, the copyable request
 * address, the counts and each replacement's matches (reworded once the
 * page reloaded or navigated since a run that changed it). Every state is
 * read from the session; nothing here latches.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import Play from 'lucide-solid/icons/play';
import RotateCw from 'lucide-solid/icons/rotate-cw';
import ShieldAlert from 'lucide-solid/icons/shield-alert';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { CopyButton } from '../../../../components/ui/copy-button';
import { KeyValueList } from '../../../../components/ui/key-value';
import {
  STATUS_SOFT_CLASSES,
  STATUS_TEXT_CLASSES,
  type StatusKind
} from '../../../../components/ui/status-badge';
import { RUCSS_RUN_WORST_CASE_MS } from '../../../../lib/rucss-tester/deadlines';
import { RUCSS_REQUEST_DISCLOSURE } from '../../../../lib/rucss-tester/endpoint';
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
import type { RucssTesterSession } from './session';

/** The running line (the bound is the panel's worst-case wait: start, build and apply in turn). */
export const RUNNING_COPY = `Waiting for the RUCSS service, then building and applying the CSS — up to ${formatCount(Math.round(RUCSS_RUN_WORST_CASE_MS / 1000))} s.`;

/** The held-run line (the save line above names the failure). */
export const BLOCKED_COPY =
  'The test did not start: the settings could not be saved, so it would run with old ones. Fix the problem named under the form, then run again.';

/** The recoveries' button labels. */
export const RECOVERY_LABELS: Readonly<Record<RucssRecovery, string>> = {
  retry: 'Run again',
  'reload-page': 'Reload page',
  'review-patterns': 'Review patterns',
  'inspect-styles': 'Inspect page styles'
};

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

/** Props of {@link RunPanel}. */
export interface RunPanelProps {
  session: RucssTesterSession;
  actions: RunPanelActions;
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

/**
 * The applied run's details: the counts and each replacement's matches.
 *
 * @param props.outcome The applied outcome.
 */
function AppliedDetails(props: {
  outcome: Extract<RucssTestOutcome, { kind: 'applied' }>;
}): JSX.Element {
  const summary = () => props.outcome.summary;
  return (
    <div class="flex flex-col gap-2">
      <KeyValueList
        data-fdt="rucss-summary"
        items={[
          {
            term: 'Styles removed',
            value: <span class="tabular-nums">{formatCount(summary().removed)}</span>
          },
          {
            term: 'Kept by inline markers',
            value: <span class="tabular-nums">{formatCount(summary().preserved)}</span>
          },
          {
            term: 'Kept by stylesheet patterns',
            value: <span class="tabular-nums">{formatCount(summary().excluded)}</span>
          },
          {
            term: 'Already gone',
            value: <span class="tabular-nums">{formatCount(summary().gone)}</span>
          },
          {
            term: 'CSS injected',
            value: (
              <span class="tabular-nums">
                {countLabel(summary().cssChars, { one: 'character', other: 'characters' })}
              </span>
            )
          }
        ]}
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
 * The finished run's outcome block.
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
      <Show when={applied()}>{(outcome) => <AppliedDetails outcome={outcome()} />}</Show>
      <Show when={view().requestUrl}>
        {(url) => (
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="shrink-0 text-2xs text-fg-muted">Request</span>
            <span
              data-fdt-rucss-request
              class="min-w-0 flex-1 truncate font-mono text-2xs text-fg-primary"
              title={url()}
            >
              {url()}
            </span>
            <CopyButton
              text={url()}
              label="Request address"
              ariaLabel="Copy request address"
              title="Copy the request address"
              showLabel={false}
              successTitle="Request address copied"
              size="sm"
            />
          </div>
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
  );
}

/**
 * Render the run card.
 *
 * @param props See {@link RunPanelProps}.
 */
export function RunPanel(props: RunPanelProps): JSX.Element {
  const running = (): boolean => props.session.run().status === 'running';
  const ready = (): boolean => props.session.load().status === 'ready';
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
    <Card level={1} class="p-2.5">
      <div data-fdt="rucss-run" class="flex flex-col gap-2.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="primary"
            busy={running()}
            disabled={!ready()}
            data-fdt-rucss-run
            onClick={() => {
              void props.session.start();
            }}
          >
            <Show when={!running()}>
              <Play size={12} aria-hidden="true" />
            </Show>
            {running() ? 'Running test…' : 'Run test'}
          </Button>
          <p
            data-fdt-rucss-disclosure
            class="flex min-w-0 flex-1 basis-60 items-start gap-1.5 text-2xs text-fg-secondary"
          >
            <ShieldAlert size={12} class="mt-px shrink-0 text-fg-muted" aria-hidden="true" />
            <span>{RUCSS_REQUEST_DISCLOSURE}</span>
          </p>
        </div>
        <Switch>
          <Match when={running()}>
            <p data-fdt-rucss-running class="text-2xs text-fg-secondary">
              {RUNNING_COPY}
            </p>
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
            <p data-fdt-rucss-blocked class={cn('text-2xs', STATUS_TEXT_CLASSES.error)}>
              {BLOCKED_COPY}
            </p>
          </Match>
          <Match when={finished()} keyed>
            {(state) => (
              <OutcomeBlock
                outcome={state.outcome}
                session={props.session}
                actions={props.actions}
              />
            )}
          </Match>
        </Switch>
      </div>
    </Card>
  );
}
