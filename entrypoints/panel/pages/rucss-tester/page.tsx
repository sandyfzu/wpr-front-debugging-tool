/**
 * The RUCSS Tester page: run WP Rocket's Remove Unused CSS service on the
 * inspected page and see the result live (until the page reloads), with
 * the settings the run uses and the page's styles one tab away.
 *
 * Layout (the Test tab): a settings column (340 px, scrolling on its own)
 * beside the result column (the run bar on top, the run's state under it)
 * from `@wide`; below it one column — run bar, result, then the settings.
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders on `ready`/`refreshing`):
 * - settings loading → skeleton in the form's place, Run held;
 * - settings unreadable → the error state with Retry, Run held;
 * - ready → the sections (each folded or open, summed up in its header),
 *   the save state beside the settings heading, and the result side
 *   (never run / running / repeat question / blocked by an unsaved form /
 *   finished outcome — see `./run-panel`);
 * - a test from earlier on this page (no run of this session shows it) →
 *   the TEST MODE notice;
 * - Page styles tab → the inventory's own states (see `./styles-list`).
 *
 * The session outlives the page body (panel lifetime): leaving the route
 * mid-run keeps the run, and its answer is there on return. A data
 * refresh swaps only the payload — the form, the open sections, the run
 * and the tab stay.
 */
import type { JSX } from 'solid-js';
import ShieldExclamationPoint from 'lucide-solid/icons/shield-exclamation-point';
import {
  createComputed,
  createRoot,
  createSignal,
  onCleanup,
  Show,
  type Accessor,
  type Setter
} from 'solid-js';
import { TabPanel, Tabs } from '../../../../components/ui/tabs';
import type { OverflowWatcher } from '../../../../components/ui/overflow-watch';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { RUCSS_REQUEST_DISCLOSURE } from '../../../../lib/rucss-tester/endpoint';
import type { RucssOutcomeView } from '../../../../lib/rucss-tester/outcome-view';
import {
  RUCSS_FIELD_SECTION,
  RUCSS_SETTINGS_SECTIONS,
  type RucssSettingsSection
} from '../../../../lib/rucss-tester/settings-summary';
import { formatCount } from '../../../../utils/format-count';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { TestModeNotice } from '../test-mode-notice';
import { RunBar } from '../run-bar';
import { createSectionsState, type SectionsState } from '../settings/sections';
import { SettingsColumn } from '../settings/settings-column';
import { TOOL_AREAS, TOOL_LAYOUT, ToolColumn } from '../tool-column';
import { fieldId, pairSearchId, RucssForm } from './form';
import { realRucssTesterDeps } from './real-deps';
import { RunResult } from './run-panel';
import { createRucssTesterSession, type RucssTesterSession } from './session';
import { StylesList } from './styles-list';

/** The page's one-line intro. */
export const RUCSS_TESTER_SUBTITLE =
  "Run WP Rocket's Remove Unused CSS on this page and see the result live, until the page reloads.";

/** The page's two views. */
export type RucssTesterTab = 'test' | 'styles';

/** A session plus the view state that should survive the page body. */
export interface RucssTesterHandle {
  readonly session: RucssTesterSession;
  readonly tab: Accessor<RucssTesterTab>;
  readonly setTab: Setter<RucssTesterTab>;
  /** Which settings sections are open. */
  readonly sections: SectionsState<RucssSettingsSection>;
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
    return {
      session: create(),
      tab,
      setTab,
      sections: createSectionsState<RucssSettingsSection>((section) => section === 'request')
    };
  });
}

/**
 * The element a `review-patterns` recovery focuses, and the section holding it.
 *
 * @param view The outcome's view.
 * @returns The element id and its section.
 */
export function reviewTarget(view: RucssOutcomeView): {
  readonly id: string;
  readonly section: RucssSettingsSection;
} {
  const focus = view.focus;
  if (focus === null || focus.field === 'excludeFiles') {
    return { id: fieldId('excludeFiles'), section: RUCSS_FIELD_SECTION.excludeFiles };
  }
  if (focus.field === 'prepend') {
    return { id: fieldId('prepend'), section: RUCSS_FIELD_SECTION.prepend };
  }
  return { id: pairSearchId(focus.index), section: RUCSS_FIELD_SECTION.replacements };
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
  /** The columns' overflow seam (tests). */
  watchOverflow?: OverflowWatcher;
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
    const target = reviewTarget(view);
    handle.setTab('test');
    // A folded section shows its fields first.
    handle.sections.setOpen(target.section, true);
    queueMicrotask(() => {
      document.getElementById(target.id)?.focus();
    });
  };
  /** Show the inventory, reading it now. */
  const inspectStyles = (): void => {
    handle.setTab('styles');
    void session.inspect();
  };

  // Leaving the page unmounts the tab triggers one by one, and the tabs then
  // select the first one left — an unmount artefact, never the user's
  // choice, so it must not stick to the panel-lifetime tab.
  let unmounting = false;
  const view = (
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
            if (!unmounting) handle.setTab(value === 'styles' ? 'styles' : 'test');
          }}
          label="RUCSS Tester views"
          rootClass="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabPanel value="test" class={TOOL_LAYOUT}>
            <ToolColumn
              hook="rucss-result-column"
              area={TOOL_AREAS.result}
              label="Test result"
              watchOverflow={props.watchOverflow}
            >
              <RunBar
                page="rucss"
                running={session.run().status === 'running'}
                held={session.load().status !== 'ready'}
                onRun={() => {
                  void session.start();
                }}
                note={RUCSS_REQUEST_DISCLOSURE}
                noteIcon={ShieldExclamationPoint}
              />
              <RunResult
                session={session}
                actions={{ reloadPage, reviewPatterns, inspectStyles }}
              />
            </ToolColumn>
            <SettingsColumn
              page="rucss"
              load={session.load().status}
              save={session.save()}
              onRetry={() => {
                session.retryLoad();
              }}
              sections={RUCSS_SETTINGS_SECTIONS.length}
              watchOverflow={props.watchOverflow}
            >
              <RucssForm session={session} sections={handle.sections} />
            </SettingsColumn>
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
  // Created after the view, so disposed before it (an owner disposes its
  // computations last-first): the flag is up before any trigger unmounts.
  createComputed(() => {
    onCleanup(() => {
      unmounting = true;
    });
  });
  return view;
}
