/**
 * The RUCSS Tester page: run WP Rocket's Remove Unused CSS service on the
 * inspected page and see the result live (until the page reloads), with
 * the settings the run uses and the page's styles one tab away.
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders on `ready`/`refreshing`):
 * - settings loading → skeleton in the form's place, Run held;
 * - settings unreadable → the error state with Retry, Run held;
 * - ready → the run card (idle / running / repeat question / blocked by an
 *   unsaved form / finished outcome) above the form;
 * - a test from earlier on this page (no run of this session shows it) →
 *   the TEST MODE notice;
 * - Page styles tab → the inventory's own states (see `./styles-list`).
 *
 * The session outlives the page body (panel lifetime): leaving the route
 * mid-run keeps the run, and its answer is there on return. A data
 * refresh swaps only the payload — the form, the run and the tab stay.
 */
import type { JSX } from 'solid-js';
import {
  createRoot,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
  type Accessor,
  type Setter
} from 'solid-js';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { TabPanel, Tabs } from '../../../../components/ui/tabs';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { RucssOutcomeView } from '../../../../lib/rucss-tester/outcome-view';
import { formatCount } from '../../../../utils/format-count';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { TestModeNotice } from '../test-mode-notice';
import { fieldId, pairSearchId, RucssForm } from './form';
import { realRucssTesterDeps } from './real-deps';
import { RunPanel } from './run-panel';
import { createRucssTesterSession, type RucssTesterSession } from './session';
import { StylesList } from './styles-list';

/** The page's one-line intro. */
export const RUCSS_TESTER_SUBTITLE =
  "Run WP Rocket's Remove Unused CSS on this page and see the result live, until the page reloads.";

/** The page's two views. */
export type RucssTesterTab = 'test' | 'styles';

/** The settings' load failure words. */
export const LOAD_FAILED_COPY =
  "The extension's storage did not answer. Retry; if it persists, reload the DevTools panel.";

/** A session plus the view state that should survive the page body. */
export interface RucssTesterHandle {
  readonly session: RucssTesterSession;
  readonly tab: Accessor<RucssTesterTab>;
  readonly setTab: Setter<RucssTesterTab>;
}

/** The panel-lifetime handle (created on the page's first mount). */
let sharedHandle: RucssTesterHandle | null = null;

/**
 * Create a handle in its own reactive root (never disposed: it lives as
 * long as the panel document).
 *
 * @param create Builds the session.
 */
export function createRucssTesterHandle(create: () => RucssTesterSession): RucssTesterHandle {
  return createRoot(() => {
    const [tab, setTab] = createSignal<RucssTesterTab>('test');
    return { session: create(), tab, setTab };
  });
}

/**
 * The element a `review-patterns` recovery focuses.
 *
 * @param view The outcome's view.
 * @returns The element id.
 */
export function reviewTargetId(view: RucssOutcomeView): string {
  const focus = view.focus;
  if (focus === null || focus.field === 'excludeFiles') return fieldId('excludeFiles');
  if (focus.field === 'prepend') return fieldId('prepend');
  return pairSearchId(focus.index);
}

/** Props of {@link RucssTesterPage}. */
export interface RucssTesterPageProps {
  /** A prebuilt handle (tests); absent, the panel-lifetime one. */
  handle?: RucssTesterHandle;
  /**
   * Reloads the inspected page (tests; `null`: the context cannot); absent,
   * DevTools' own reload when available.
   */
  reloadInspectedPage?: (() => void) | null;
  /** The virtualizer seam (tests). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render the page body.
 *
 * @param props See {@link RucssTesterPageProps}.
 */
export function RucssTesterPage(props: RucssTesterPageProps = {}): JSX.Element {
  const store = useFdtData();
  // The handle is chosen once per mount.
  const handle =
    props.handle ??
    (sharedHandle ??= createRucssTesterHandle(() =>
      createRucssTesterSession(
        realRucssTesterDeps({
          state: store.state,
          reload: () => {
            store.reload();
          }
        })
      )
    ));
  const session = handle.session;
  // Read once: the context cannot change.
  const reloadPage =
    props.reloadInspectedPage === undefined
      ? inspectedReloadAction(browser)
      : (props.reloadInspectedPage ?? undefined);
  // Leaving the page writes a pending edit now (the panel may close next).
  onCleanup(() => {
    void session.flush();
  });

  /** The page data while the store holds some, else `null`. */
  const data = () => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  };
  /** Whether the page carries an earlier test that no shown run accounts for. */
  const showNotice = (): boolean => {
    const run = session.run();
    return (
      session.pageRuns() > 0 &&
      run.status !== 'confirm-repeat' &&
      !(run.status === 'finished' && run.outcome.kind === 'applied')
    );
  };
  /** Style count for the "Page styles" tab once listed. */
  const stylesBadge = (): string | undefined => {
    const state = session.inventory();
    return state.status === 'ready' ? formatCount(state.reply.total) : undefined;
  };

  /** Go to the field a pattern failure names. */
  const reviewPatterns = (view: RucssOutcomeView): void => {
    handle.setTab('test');
    queueMicrotask(() => {
      document.getElementById(reviewTargetId(view))?.focus();
    });
  };
  /** Show the inventory, reading it now. */
  const inspectStyles = (): void => {
    handle.setTab('styles');
    void session.inspect();
  };

  return (
    <Show when={data()}>
      <PageFrame id="rucss-tester" title="RUCSS Tester" subtitle={RUCSS_TESTER_SUBTITLE} fill>
        <Show when={showNotice()}>
          <TestModeNotice fact={data()?.rucssTestMode} reloadInspectedPage={reloadPage} />
        </Show>
        <Tabs
          items={[
            { value: 'test', label: 'Test' },
            { value: 'styles', label: 'Page styles', badge: stylesBadge() }
          ]}
          value={handle.tab()}
          onChange={(value) => {
            handle.setTab(value === 'styles' ? 'styles' : 'test');
          }}
          label="RUCSS tester views"
          rootClass="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabPanel value="test" class="flex min-w-0 flex-col gap-3">
            <RunPanel session={session} actions={{ reloadPage, reviewPatterns, inspectStyles }} />
            <Switch>
              <Match when={session.load().status === 'loading'}>
                <div class="grid grid-cols-1 gap-2" data-fdt-rucss-form-loading>
                  <Skeleton class="h-4 w-32 max-w-full" />
                  <Skeleton class="h-20 w-full" />
                  <Skeleton class="h-20 w-full" />
                </div>
              </Match>
              <Match when={session.load().status === 'failed'}>
                <ErrorState
                  title="Couldn't load the test settings"
                  message={LOAD_FAILED_COPY}
                  onRetry={() => {
                    session.retryLoad();
                  }}
                />
              </Match>
              <Match when={session.load().status === 'ready'}>
                <RucssForm session={session} />
              </Match>
            </Switch>
          </TabPanel>
          <TabPanel value="styles" class="flex min-h-0 flex-1 flex-col">
            <StylesList
              state={session.inventory()}
              onInspect={() => {
                void session.inspect();
              }}
              createVirtualizer={props.createVirtualizer}
            />
          </TabPanel>
        </Tabs>
      </PageFrame>
    </Show>
  );
}
