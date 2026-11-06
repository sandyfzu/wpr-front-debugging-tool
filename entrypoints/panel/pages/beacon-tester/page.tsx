/**
 * The Beacon Tester page: run WP Rocket's beacon on the inspected page with
 * chosen settings and see what it finds — the critical image candidates
 * (LCP first) and the lazy-render elements — without saving anything to the
 * site. Loaded on first visit (its own chunk).
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders on `ready`/`refreshing`):
 * - the run card (idle / running / finished outcome with its recoveries)
 *   above three tabs: Settings and one results tab per feature;
 * - Settings: loading → skeleton in the form's place, Run held; unreadable →
 *   the error state with Retry, Run held; ready → the form;
 * - a results tab: the feature's list states (see `./results`; no results
 *   yet offers Run); a run with results opens the first feature's tab.
 *
 * The session outlives the page body (panel lifetime): leaving the route
 * mid-run keeps the run, and its answer is there on return. A data refresh
 * swaps only the payload — the form, the run and the tab stay.
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
import type { BeaconOutcomeView } from '../../../../lib/beacon-test/outcome-view';
import type { FeatureList } from '../../../../lib/beacon-test/results';
import { formatCount } from '../../../../utils/format-count';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { BeaconForm, beaconFieldId } from './form';
import { realBeaconTesterDeps } from './real-deps';
import { AboveTheFoldResults, LazyRenderResults } from './results';
import { BeaconRunPanel } from './run-panel';
import { createBeaconTesterSession, type BeaconTesterSession } from './session';

/** The page's title and one-line intro. */
export const BEACON_TESTER_TITLE = 'Beacon Tester';
export const BEACON_TESTER_SUBTITLE =
  "Run WP Rocket's beacon on this page and see what it would find: the critical images and the lazy-render elements.";

/** The settings' load failure words. */
export const LOAD_FAILED_COPY =
  "The extension's storage did not answer. Retry; if it persists, reload the DevTools panel.";

/** The page's three views. */
export type BeaconTesterTab = 'settings' | 'above-the-fold' | 'lazy-render';

/** The tabs' labels. */
export const TAB_LABELS: Readonly<Record<BeaconTesterTab, string>> = {
  settings: 'Settings',
  'above-the-fold': 'Critical images',
  'lazy-render': 'Lazy rendering'
};

/** A session plus the view state that should survive the page body. */
export interface BeaconTesterHandle {
  readonly session: BeaconTesterSession;
  readonly tab: Accessor<BeaconTesterTab>;
  readonly setTab: Setter<BeaconTesterTab>;
}

/** The panel-lifetime handle (created on the page's first mount). */
let sharedHandle: BeaconTesterHandle | null = null;

/**
 * Create a handle in its own reactive root (never disposed: it lives as
 * long as the panel document).
 *
 * @param create Builds the session.
 */
export function createBeaconTesterHandle(create: () => BeaconTesterSession): BeaconTesterHandle {
  return createRoot(() => {
    const [tab, setTab] = createSignal<BeaconTesterTab>('settings');
    return { session: create(), tab, setTab };
  });
}

/**
 * The tab a run with results opens: the first feature that ran.
 *
 * @param results The run's lists.
 * @returns The tab, or null when no feature list came back.
 */
export function firstResultsTab(results: {
  readonly aboveTheFold: FeatureList<unknown> | null;
  readonly lazyRender: FeatureList<unknown> | null;
}): BeaconTesterTab | null {
  if (results.aboveTheFold !== null) return 'above-the-fold';
  if (results.lazyRender !== null) return 'lazy-render';
  return null;
}

/**
 * A results tab's count badge.
 *
 * @param list The feature's list.
 * @returns The count (`+` when the list was cut), or undefined without a list.
 */
export function listBadge(list: FeatureList<unknown> | null | undefined): string | undefined {
  if (list?.kind !== 'ok') return undefined;
  return `${formatCount(list.items.length)}${list.truncated ? '+' : ''}`;
}

/** Props of {@link BeaconTesterPage}. */
export interface BeaconTesterPageProps {
  /** A prebuilt handle (tests); absent, the panel-lifetime one. */
  handle?: BeaconTesterHandle;
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
 * @param props See {@link BeaconTesterPageProps}.
 */
export function BeaconTesterPage(props: BeaconTesterPageProps = {}): JSX.Element {
  const store = useFdtData();
  // The handle is chosen once per mount.
  const handle =
    props.handle ??
    (sharedHandle ??= createBeaconTesterHandle(() =>
      createBeaconTesterSession(realBeaconTesterDeps({ state: store.state }))
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

  /** Whether the shell holds page data (the body renders only then). */
  const hasData = (): boolean => {
    const status = store.state().status;
    return status === 'ready' || status === 'refreshing';
  };
  const results = () => session.results();
  const running = (): boolean => session.run().status === 'running';

  /** Go to the setting an outcome names (the settings' start without one). */
  const reviewSettings = (view: BeaconOutcomeView): void => {
    handle.setTab('settings');
    queueMicrotask(() => {
      const target = document.getElementById(beaconFieldId(view.focus ?? 'features'));
      // The features target is their group: focus its first switch.
      (target?.matches('input, textarea')
        ? target
        : target?.querySelector<HTMLElement>('input')
      )?.focus();
    });
  };
  /** Run, then open the results of the first feature that ran — only when this call ran one. */
  const start = async (): Promise<void> => {
    const before = session.run();
    await session.start();
    const after = session.run();
    // An ignored start (loading settings, a run in the air) leaves the run as it was.
    const ranNow =
      after.status === 'finished' &&
      (before.status !== 'finished' || after.sequence > before.sequence);
    if (!ranNow) return;
    const shown = results();
    const tab = shown === null ? null : firstResultsTab(shown);
    if (tab !== null) handle.setTab(tab);
  };
  /** The session with `start` opening the results. */
  const view: BeaconTesterSession = { ...session, start };
  const showSettings = (): void => {
    handle.setTab('settings');
  };

  return (
    <Show when={hasData()}>
      <PageFrame
        id="beacon-tester"
        title={BEACON_TESTER_TITLE}
        subtitle={BEACON_TESTER_SUBTITLE}
        fill
      >
        <BeaconRunPanel session={view} actions={{ reloadPage, reviewSettings }} />
        <Tabs
          items={[
            { value: 'settings', label: TAB_LABELS.settings },
            {
              value: 'above-the-fold',
              label: TAB_LABELS['above-the-fold'],
              badge: listBadge(results()?.aboveTheFold)
            },
            {
              value: 'lazy-render',
              label: TAB_LABELS['lazy-render'],
              badge: listBadge(results()?.lazyRender)
            }
          ]}
          value={handle.tab()}
          onChange={(value) => {
            handle.setTab(
              value === 'above-the-fold' || value === 'lazy-render' ? value : 'settings'
            );
          }}
          label="Beacon tester views"
          // Compact panels wrap the three tabs instead of scrolling sideways.
          class="flex-wrap"
          rootClass="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabPanel value="settings" class="flex min-w-0 flex-col gap-3">
            <Switch>
              <Match when={session.load().status === 'loading'}>
                <div class="grid grid-cols-1 gap-2" data-fdt-beacon-form-loading>
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
                <BeaconForm session={session} />
              </Match>
            </Switch>
          </TabPanel>
          <TabPanel value="above-the-fold" class="flex min-h-0 flex-1 flex-col gap-2">
            <AboveTheFoldResults
              list={results()?.aboveTheFold}
              running={running()}
              ended={session.run().status === 'finished'}
              settings={session.load().status}
              onRun={() => {
                void start();
              }}
              onShowSettings={showSettings}
              createVirtualizer={props.createVirtualizer}
            />
          </TabPanel>
          <TabPanel value="lazy-render" class="flex min-h-0 flex-1 flex-col gap-2">
            <LazyRenderResults
              list={results()?.lazyRender}
              running={running()}
              ended={session.run().status === 'finished'}
              settings={session.load().status}
              onRun={() => {
                void start();
              }}
              onShowSettings={showSettings}
              createVirtualizer={props.createVirtualizer}
            />
          </TabPanel>
        </Tabs>
      </PageFrame>
    </Show>
  );
}
