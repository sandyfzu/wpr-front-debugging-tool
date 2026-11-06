/**
 * The beacon tester's run card: what a run does (shown before the first
 * click), the Run control, and the run's state — running (a real wait,
 * bounded by the deadlines) or the finished outcome with its recoveries,
 * the issues of settings that cannot run, and a line once the results
 * measured an earlier page load. Every state is read from the session;
 * nothing here latches.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import Info from 'lucide-solid/icons/info';
import Play from 'lucide-solid/icons/play';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
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
import type { BeaconTesterSession, FinishedBeaconRun } from './session';

/** What a run does, next to Run (no request leaves the browser). */
export const RUN_DISCLOSURE =
  "Runs WP Rocket's beacon on the inspected page as it is now: nothing is saved to the site and the page is not changed.";

/** The running line (the bound is the panel's whole wait: loading the beacon, the run, the hops). */
export const RUNNING_COPY = `Loading the beacon into the page, then scanning it — up to ${formatCount(Math.round(BEACON_TEST_ASK_DEADLINE_MS / 1000))} s.`;

/** The line once the page reloaded or navigated after the shown run. */
export const STALE_COPY =
  'The page reloaded since this test — these results describe the earlier load. Run again to test it as it is now.';

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

/** What the run card's actions do (the page binds them). */
export interface BeaconRunActions {
  /** Reload the inspected page; absent where the context cannot. */
  readonly reloadPage?: () => void;
  /** Go to the setting an outcome names. */
  readonly reviewSettings: (view: BeaconOutcomeView) => void;
}

/** Props of {@link BeaconRunPanel}. */
export interface BeaconRunPanelProps {
  session: BeaconTesterSession;
  actions: BeaconRunActions;
}

/**
 * One recovery button (a reload where the context cannot reload is left out).
 *
 * @param props The recovery, its view, the session and the actions.
 */
function RecoveryButton(props: {
  recovery: BeaconRecovery;
  view: BeaconOutcomeView;
  session: BeaconTesterSession;
  actions: BeaconRunActions;
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
      case 'review-settings':
        props.actions.reviewSettings(props.view);
        return;
    }
  };
  return (
    <Show when={props.recovery !== 'reload-page' || props.actions.reloadPage !== undefined}>
      <Button
        size="sm"
        variant={props.primary ? 'primary' : 'secondary'}
        data-fdt-beacon-recovery={props.recovery}
        onClick={onClick}
      >
        {RECOVERY_LABELS[props.recovery]}
      </Button>
    </Show>
  );
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
 * @param props See {@link BeaconRunPanelProps}.
 */
export function BeaconRunPanel(props: BeaconRunPanelProps): JSX.Element {
  const running = (): boolean => props.session.run().status === 'running';
  const ready = (): boolean => props.session.load().status === 'ready';
  /** The finished run, else `undefined`. */
  const finished = () => {
    const state = props.session.run();
    return state.status === 'finished' ? state : undefined;
  };
  return (
    <Card level={1} class="p-2.5">
      <div data-fdt="beacon-run" class="flex flex-col gap-2.5">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="primary"
            busy={running()}
            disabled={!ready()}
            data-fdt-beacon-run
            onClick={() => {
              void props.session.start();
            }}
          >
            <Show when={!running()}>
              <Play size={12} aria-hidden="true" />
            </Show>
            {running() ? 'Running test…' : 'Run test'}
          </Button>
          <p class="flex min-w-0 flex-1 basis-60 items-start gap-1.5 text-2xs text-fg-secondary">
            <Info size={12} class="mt-px shrink-0 text-fg-muted" aria-hidden="true" />
            <span>{RUN_DISCLOSURE}</span>
          </p>
        </div>
        <Switch>
          <Match when={running()}>
            <p data-fdt-beacon-running class="text-2xs text-fg-secondary">
              {RUNNING_COPY}
            </p>
          </Match>
          <Match when={finished()} keyed>
            {(run) => <OutcomeBlock run={run} session={props.session} actions={props.actions} />}
          </Match>
        </Switch>
      </div>
    </Card>
  );
}
