/**
 * The beacon tester's run state, under the shared run bar: running (what
 * the wait is for, bounded by the deadlines; the result tabs show its
 * skeleton) or the finished outcome with its recoveries, the issues of
 * settings that cannot run, and a line once the results measured an
 * earlier page load; nothing before the first run (the result tabs say
 * what a run produces). Every state is read from the session; nothing here
 * latches.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import type { StatusKind } from '../../../../components/ui/status-badge';
import { BEACON_TEST_ASK_DEADLINE_MS } from '../../../../lib/beacon-test/deadlines';
import {
  describeBeaconOutcome,
  describeConfigIssue,
  type BeaconOutcomeView,
  type BeaconRecovery
} from '../../../../lib/beacon-test/outcome-view';
import { formatCount } from '../../../../utils/format-count';
import { OutcomeNotice } from '../outcome-notice';
import { RecoveryButtons } from '../recovery-buttons';
import type { BeaconTesterSession, FinishedBeaconRun } from './session';

/** What a run does, beside Run (no request leaves the browser). */
export const RUN_DISCLOSURE =
  "Runs WP Rocket's beacon on the inspected page as it is now: nothing is saved to the site and the page is not changed.";

/** The running line (the bound is the panel's whole wait: loading the beacon, the run, the hops). */
export const RUNNING_COPY = `Loading the beacon into the page, then scanning it — up to ${formatCount(Math.round(BEACON_TEST_ASK_DEADLINE_MS / 1000))} s.`;

/** The line once the page reloaded or navigated after the shown run. */
export const STALE_COPY =
  'The page reloaded or changed since this test — these results describe the earlier page load. Run again to test it as it is now.';

/** The recoveries' button labels. */
export const RECOVERY_LABELS: Readonly<Record<BeaconRecovery, string>> = {
  retry: 'Run again',
  'reload-page': 'Reload page',
  'review-settings': 'Review settings'
};

/** Outcome tones → the shared status vocabulary. */
const TONE_KIND: Readonly<Record<BeaconOutcomeView['tone'], StatusKind>> = {
  ok: 'ok',
  warn: 'warn',
  error: 'error'
};

/** What the outcome's recoveries do (the page binds them). */
export interface BeaconRunActions {
  /** Reload the inspected page; absent where the context cannot. */
  readonly reloadPage?: () => void;
  /** Go to the setting an outcome names. */
  readonly reviewSettings: (view: BeaconOutcomeView) => void;
}

/** Props of {@link BeaconRunState}. */
export interface BeaconRunStateProps {
  session: BeaconTesterSession;
  actions: BeaconRunActions;
}

/**
 * The finished run's outcome block.
 *
 * @param props The finished run, the session and the actions.
 */
function OutcomeBlock(props: {
  run: FinishedBeaconRun;
  session: BeaconTesterSession;
  actions: BeaconRunActions;
}): JSX.Element {
  const view = createMemo(() => describeBeaconOutcome(props.run.outcome, props.run.draft));
  /** The refused settings' issues, else none. */
  const issues = () =>
    props.run.outcome.kind === 'invalid-config' ? props.run.outcome.issues : [];
  return (
    <OutcomeNotice
      data-fdt="beacon-outcome"
      data-fdt-beacon-outcome={props.run.outcome.kind}
      kind={TONE_KIND[view().tone]}
      title={view().title}
      message={view().message}
    >
      <Show when={issues().length > 0}>
        <ul class="flex flex-col gap-0.5 ps-5 text-2xs text-fg-secondary">
          <For each={issues()}>
            {(issue) => <li class="break-words">{describeConfigIssue(issue)}</li>}
          </For>
        </ul>
      </Show>
      <Show when={props.session.stale()}>
        <p data-fdt-beacon-stale class="ps-5 text-2xs text-fg-secondary">
          {STALE_COPY}
        </p>
      </Show>
      <RecoveryButtons
        recoveries={view().recoveries}
        labels={RECOVERY_LABELS}
        onRetry={() => {
          void props.session.start();
        }}
        reloadPage={props.actions.reloadPage}
        onReviewSettings={() => {
          props.actions.reviewSettings(view());
        }}
        hook="beacon"
      />
    </OutcomeNotice>
  );
}

/**
 * Render the run state.
 *
 * @param props See {@link BeaconRunStateProps}.
 */
export function BeaconRunState(props: BeaconRunStateProps): JSX.Element {
  /** The finished run, else `undefined`. */
  const finished = () => {
    const state = props.session.run();
    return state.status === 'finished' ? state : undefined;
  };
  return (
    <Switch>
      <Match when={props.session.run().status === 'running'}>
        <p data-fdt-beacon-running class="text-2xs text-fg-secondary">
          {RUNNING_COPY}
        </p>
      </Match>
      <Match when={finished()} keyed>
        {(run) => <OutcomeBlock run={run} session={props.session} actions={props.actions} />}
      </Match>
    </Switch>
  );
}
