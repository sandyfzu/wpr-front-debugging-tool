/**
 * The Beacon Tester page: run WP Rocket's beacon on the inspected page with
 * chosen settings and see what it finds — the critical image candidates
 * (LCP first) and the lazy-render elements — without saving anything to the
 * site. Loaded on first visit (its own chunk).
 *
 * Layout: the beacon instructions row on top, then the shared tool grid —
 * a settings column (340 px, scrolling on its own) beside the result column
 * (the run bar, the run's state, then one results tab per feature) from
 * `@wide`; below it one column — run bar, run state, results, settings.
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders on `ready`/`refreshing`):
 * - the instructions row (its own states: `./instructions-card`);
 * - Settings: loading → skeleton in the form's place, Run held; unreadable →
 *   the error state with Retry, Run held; ready → the sections (each folded
 *   or open, summed up in its header) with the save state beside the heading;
 * - the run: idle / running / finished outcome with its recoveries (see
 *   `./run-panel`);
 * - a results tab: the feature's list states (see `./results`); a run with
 *   results opens the first feature's tab.
 *
 * The session outlives the page body (panel lifetime): leaving the route
 * mid-run keeps the run, and its answer is there on return. A data refresh
 * swaps only the payload — the form, the open sections, the run and the tab
 * stay.
 */
import type { JSX } from 'solid-js';
import {
  createComputed,
  createRoot,
  createSignal,
  onCleanup,
  Show,
  type Accessor,
  type Setter
} from 'solid-js';
import Info from 'lucide-solid/icons/info';
import { TabPanel, Tabs } from '../../../../components/ui/tabs';
import type { OverflowWatcher } from '../../../../components/ui/overflow-watch';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { BeaconOutcomeView } from '../../../../lib/beacon-test/outcome-view';
import type { FeatureList } from '../../../../lib/beacon-test/results';
import type { BeaconFeatureKey } from '../../../../lib/beacon-test/runner-bridge';
import {
  BEACON_FIELD_SECTION,
  BEACON_SETTINGS_SECTIONS,
  beaconSectionOpenBeforeSeed,
  type BeaconSettingsSection
} from '../../../../lib/beacon-test/settings-summary';
import { cn } from '../../../../utils/cn';
import { formatCount } from '../../../../utils/format-count';
import type { DataState } from '../../state/fdt-state-machine';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { RunBar } from '../run-bar';
import { createSectionsState, type SectionsState } from '../settings/sections';
import { SettingsColumn } from '../settings/settings-column';
import { TOOL_AREAS, TOOL_LAYOUT, ToolColumn } from '../tool-column';
import { BeaconForm, beaconFieldId } from './form';
import {
  createInstructionsTracker,
  InstructionsCard,
  type InstructionsTracker
} from './instructions-card';
import { instructionsSourceOf } from './instructions-view';
import { realBeaconTesterDeps } from './real-deps';
import { AboveTheFoldResults, LazyRenderResults } from './results';
import { BeaconRunState, RUN_DISCLOSURE } from './run-panel';
import { createBeaconTesterSession, type BeaconTesterSession } from './session';

/** The page's title and one-line intro. */
export const BEACON_TESTER_TITLE = 'Beacon Tester';
export const BEACON_TESTER_SUBTITLE =
  "Run WP Rocket's beacon on this page and see what it would find: the critical images and the lazy-render elements.";

/** The result side's two tabs, one per feature. */
export type BeaconTesterTab = 'above-the-fold' | 'lazy-render';

/** The tabs' labels. */
export const TAB_LABELS: Readonly<Record<BeaconTesterTab, string>> = {
  'above-the-fold': 'Critical images',
  'lazy-render': 'Lazy rendering'
};

/** Each tab's feature. */
const TAB_FEATURE: Readonly<Record<BeaconTesterTab, BeaconFeatureKey>> = {
  'above-the-fold': 'aboveTheFold',
  'lazy-render': 'lazyRender'
};

/**
 * Below `@wide` (one column, the page scrolling) a shown list's tabs box is
 * at least about the panel's height, so its rows are worth scrolling to; a
 * floor, never a fixed height, so at short heights the box still grows to
 * hold its own content (the tab bar, the list's bar and the fill scroller's
 * floor) instead of letting it spill over the settings stacked under it.
 * From `@wide` the column's remaining height bounds it. (The tabs grow with
 * `flex-1` from `@wide` only: below it a zero flex basis would size the
 * box to the floor alone, never to its content.)
 */
const NARROW_LIST_HEIGHT = 'min-h-[calc(100dvh-6rem)] @wide:min-h-0';

/** A session plus the view state that should survive the page body. */
export interface BeaconTesterHandle {
  readonly session: BeaconTesterSession;
  readonly tab: Accessor<BeaconTesterTab>;
  readonly setTab: Setter<BeaconTesterTab>;
  /** Which settings sections are open. */
  readonly sections: SectionsState<BeaconSettingsSection>;
  /** The instructions row's state, following the page payload. */
  readonly instructions: InstructionsTracker;
}

/** The panel-lifetime handle (created on the page's first mount). */
let sharedHandle: BeaconTesterHandle | null = null;

/**
 * Create a handle in its own reactive root (never disposed: it lives as
 * long as the panel document).
 *
 * @param create Builds the session.
 * @param pageState The shell's data state (the instructions row follows its payload).
 */
export function createBeaconTesterHandle(
  create: () => BeaconTesterSession,
  pageState: Accessor<DataState>
): BeaconTesterHandle {
  return createRoot(() => {
    const [tab, setTab] = createSignal<BeaconTesterTab>('above-the-fold');
    const instructions = createInstructionsTracker(() => instructionsSourceOf(pageState()));
    const sections = createSectionsState<BeaconSettingsSection>(beaconSectionOpenBeforeSeed);
    return { session: create(), tab, setTab, sections, instructions };
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
  /** The columns' overflow seam (tests). */
  watchOverflow?: OverflowWatcher;
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
    (sharedHandle ??= createBeaconTesterHandle(
      () => createBeaconTesterSession(realBeaconTesterDeps({ state: store.state })),
      store.state
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

  /**
   * Open a field's section, then focus the element `target` finds once it
   * renders (focus scrolls it into view: the settings may sit below the fold).
   */
  const focusSetting = (section: BeaconSettingsSection, target: () => HTMLElement | null): void => {
    handle.sections.setOpen(section, true);
    queueMicrotask(() => {
      target()?.focus();
    });
  };
  /** Go to the setting an outcome names (the features without one). */
  const reviewSettings = (view: BeaconOutcomeView): void => {
    const field = view.focus ?? 'features';
    focusSetting(BEACON_FIELD_SECTION[field], () => {
      const target = document.getElementById(beaconFieldId(field));
      // The features target is their group: focus its first switch.
      return target?.matches('input, textarea') === true
        ? target
        : (target?.querySelector<HTMLElement>('input') ?? null);
    });
  };
  /** Go to a feature's switch — or to the settings' Retry while they failed to load. */
  const showSettings = (feature: BeaconFeatureKey): void => {
    focusSetting('features', () =>
      session.load().status === 'failed'
        ? document.querySelector<HTMLElement>(
            '[data-fdt="beacon-settings"] [data-fdt="error-state"] button'
          )
        : document.querySelector<HTMLElement>(`[data-fdt-beacon-feature="${feature}"] input`)
    );
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
  /** Whether the shown tab holds a list (it then takes about the panel's height when narrow). */
  const listShown = (): boolean =>
    !running() && results()?.[TAB_FEATURE[handle.tab()]]?.kind === 'ok';
  /** Run from a results tab (an unreadable list's Run again). */
  const runFromTab = (): void => {
    void start();
  };

  // Leaving the page unmounts the tab triggers one by one, and the tabs then
  // select the first one left — an unmount artefact, never the user's
  // choice, so it must not stick to the panel-lifetime tab.
  let unmounting = false;
  const body = (
    <Show when={hasData()}>
      <PageFrame
        id="beacon-tester"
        title={BEACON_TESTER_TITLE}
        subtitle={BEACON_TESTER_SUBTITLE}
        fill
      >
        <InstructionsCard tracker={handle.instructions} />
        <div class={TOOL_LAYOUT}>
          <ToolColumn
            hook="beacon-result-column"
            area={TOOL_AREAS.result}
            label="Test results"
            watchOverflow={props.watchOverflow}
          >
            <RunBar
              page="beacon"
              running={running()}
              held={session.load().status !== 'ready'}
              onRun={() => {
                void start();
              }}
              note={RUN_DISCLOSURE}
              noteIcon={Info}
            />
            <BeaconRunState session={view} actions={{ reloadPage, reviewSettings }} />
            <Tabs
              items={[
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
                if (!unmounting) {
                  handle.setTab(value === 'lazy-render' ? 'lazy-render' : 'above-the-fold');
                }
              }}
              label="Beacon test results"
              // Compact panels wrap the tabs instead of scrolling sideways.
              class="flex-wrap"
              rootClass={cn(
                'flex min-h-0 flex-col gap-3 @wide:flex-1',
                listShown() && NARROW_LIST_HEIGHT
              )}
            >
              <TabPanel value="above-the-fold" class="flex min-h-0 flex-1 flex-col gap-2">
                <AboveTheFoldResults
                  list={results()?.aboveTheFold}
                  running={running()}
                  ended={session.run().status === 'finished'}
                  settings={session.load().status}
                  onRun={runFromTab}
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
                  onRun={runFromTab}
                  onShowSettings={showSettings}
                  createVirtualizer={props.createVirtualizer}
                />
              </TabPanel>
            </Tabs>
          </ToolColumn>
          <SettingsColumn
            page="beacon"
            load={session.load().status}
            save={session.save()}
            onRetry={() => {
              session.retryLoad();
            }}
            sections={BEACON_SETTINGS_SECTIONS.length}
            watchOverflow={props.watchOverflow}
          >
            <BeaconForm session={session} sections={handle.sections} />
          </SettingsColumn>
        </div>
      </PageFrame>
    </Show>
  );
  // Created after the view, so disposed before it (an owner disposes its
  // computations last-first): the flag is up before any trigger unmounts.
  createComputed(() => {
    onCleanup(() => {
      unmounting = true;
    });
  });
  return body;
}
