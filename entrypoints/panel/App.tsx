/**
 * The panel's app shell: the top bar (identity, the page's answers and the
 * shell controls) above the nav column (labeled sidebar or icon rail) and
 * the content region beside it that renders the route bodies and the data-state surfaces
 * around them.
 *
 * Boot states are real states, not theater: `fetching` renders the skeleton,
 * `error` the retry affordance, `ready`/`refreshing` the route body — so a
 * soft refresh swaps the data under route, scroll position and focus without
 * rebuilding anything. Machine transitions announce through a visually-hidden
 * live region; the content region re-renders a whole page body per data
 * push, so it must never double as an announcement surface. The content
 * region (only) is wrapped in the crash boundary: a body that throws gets
 * its actionable card with a panel reload as the recovery — data errors keep
 * their own richer taxonomy.
 */
import {
  ErrorBoundary,
  Match,
  Switch,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  type Accessor,
  type JSX
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ErrorState } from '../../components/ui/error-state';
import { PageHeader } from '../../components/ui/page-header';
import { Toasts } from '../../components/ui/toast';
import { AppearanceMenu } from '../../components/appearance-menu';
import { setAppearanceOption } from '../../lib/storage/options';
import type { Appearance } from '../../utils/theme';
import { selectTabAsks } from '../../lib/messaging/tab-asks';
import { selectTabPushConnect } from '../../lib/messaging/tab-push-client';
import { createLogger } from '../../lib/logger';
import type { FdtData } from '../../lib/wp-rocket/types';
import { panelColdStart } from './cold-start';
import { Sidebar } from './nav/sidebar';
import { createNavPinState } from './nav/nav-pin';
import { NAV_PIN_DEFAULT, type NavPin } from '../../lib/panel/nav-mode';
import { setNavPin } from '../../lib/storage/panel-nav-pin';
import { createHashRoute } from './router';
import { navRoute, type RouteId } from './routes';
import { PageCanvas } from './pages/page-frame';
import { DATA_UNAVAILABLE_TITLE, DataUnavailable } from './data-unavailable';
import { TopBar } from './top-bar/top-bar';
import { guardAppearanceWrite } from './appearance-write';
import { realBuilderEntryDeps, type BuilderEntryDeps } from './top-bar/builder-entry';
import { readInspectedPageUrl, realInspectedEvalApi } from './report/inspected-page-url';
import { PAGES } from './pages';
import { LoadingActions, LoadingSubtitle, RouteLoading } from './pages/loading-shapes';
import { PageStateCard } from './pages/page-state-card';
import { focusRouteHeading } from './palette/focus';
import { PanelOverlays } from './palette/panel-overlays';
import { createOverlayStore, type OverlayStore } from './palette/overlays';
import { paletteKeyHint, registerPanelShortcuts } from './palette/shortcuts';
import { navigatorChordPlatform } from '../../lib/palette-chord/follow';
import {
  createPanelChordBinding,
  realPanelChordDeps,
  type PanelChordDeps
} from './palette/chord-binding';
import {
  createFdtDataStore,
  FdtDataContext,
  SearchContext,
  type FdtDataStore
} from './state/use-fdt-data';
import { createSearchStore, type SearchStore } from './state/search';
import { createDetectionsLayout, DetectionsLayoutContext } from './state/detections-layout';
import { createDetailPresence, DetailPresenceContext } from './state/detail-presence';
import { devtoolsInspectedTabId, fdtRequestEdges, realMessagingEdges } from './state/edges';
import { withRelayedPushes } from './state/relayed-pushes';
import { createHardReloadBudget } from './state/hard-reload-budget';
import { createShellWidth, type InlineSizeObserver } from './state/shell-width';
import { pageViewOf } from './state/page-view';

const log = createLogger('panel');

export type AppProps = {
  /**
   * Prebuilt search store — tests inject prepared instances; absent, the
   * shell creates the real one (the only path in production).
   */
  readonly search?: SearchStore;
  /** A prebuilt data store — same rule, with the real messaging edges. */
  readonly data?: FdtDataStore;
  /**
   * A prebuilt overlay store (the keyboard layer's open/close/focus state) —
   * tests inject prepared instances; absent, the shell creates the real one.
   */
  readonly overlays?: OverlayStore;
  /**
   * The crash boundary's recovery reload (tests stub it); absent, the panel
   * document itself reloads — the DevTools window re-attaches it.
   */
  readonly reload?: () => void;
  /**
   * The exclusion builder entry's transport (tests inject doubles); absent,
   * the real messenger over the DevTools-inspected tab.
   */
  readonly builderEntry?: BuilderEntryDeps;
  /**
   * The chosen palette chord's seams (tests inject doubles); absent, the
   * real chord store and platform report.
   */
  readonly paletteChord?: PanelChordDeps;
  /**
   * Reads the inspected page URL for the top bar (tests inject doubles);
   * absent, the DevTools eval of the inspected page.
   */
  readonly readPageUrl?: () => Promise<string | null>;
  /**
   * The stored appearance the document follows (the boot's appearance
   * follow feeds it); absent, the top bar renders no appearance menu.
   */
  readonly appearance?: Accessor<Appearance>;
  /**
   * The appearance writer (tests inject doubles); absent, the options
   * store's `setAppearanceOption`.
   */
  readonly writeAppearance?: (next: Appearance) => Promise<void>;
  /**
   * The shell's size observer (tests drive widths by hand); absent, a
   * `ResizeObserver` on the shell element.
   */
  readonly observeShellWidth?: InlineSizeObserver;
  /** The sidebar pin the boot read; absent, `auto` (the width rule). */
  readonly navPin?: NavPin;
  /** The pin writer (tests inject doubles); absent, the storage item. */
  readonly writeNavPin?: (pin: NavPin) => Promise<void>;
};

/** The error branch's payload (the error state's fields the view reads). */
interface DataError {
  /** The user-facing cause the view renders. */
  readonly cause: string;
}

/**
 * Render the panel shell.
 *
 * Everything browser-specific lives in the stores (messaging edges,
 * inspected-tab accessor, timers) injected below — this component only
 * composes the surface; unit tests hand store instances through props.
 *
 * @param props The prebuilt stores (absent in production → real edges).
 */
/**
 * The crash boundary's recovery in production: reload the panel document.
 * The DevTools window re-attaches it fresh (boot states, route hash and
 * palette all re-resolve in one step).
 */
function reloadPanelDocument(): void {
  window.location.reload();
}

/**
 * The shell's column: the top bar, then the rail-and-content row. The bar
 * sits outside the content region's scrolling — an answer never scrolls
 * out and data never pushes the panel's chrome, at every docking geometry.
 */
const STACK = 'flex min-h-0 min-w-0 flex-1 flex-col';

/** The rail-and-content row below the top bar. */
const STACK_ROW = 'flex min-h-0 flex-1';

/** The real page-URL read (best-effort; null outside DevTools). */
function readRealPageUrl(): Promise<string | null> {
  return readInspectedPageUrl(realInspectedEvalApi(), browser.runtime);
}

export function PanelApp(props: AppProps): JSX.Element {
  // All the store injections below are deliberate once-per-mount builds
  // (the component body runs once; a store is never reactively rebuilt), so
  // the `solid/reactivity` warning's concern does not apply to any of them —
  // silenced uniformly rather than by exception.
  //
  // eslint-disable-next-line solid/reactivity
  const search = props.search ?? createSearchStore();
  const data =
    // eslint-disable-next-line solid/reactivity
    props.data ??
    ((): FdtDataStore => {
      // Pushes arrive directly where the panel has the `tabs` API; elsewhere
      // (Firefox) the same receivers are also fed through the background.
      const edges = withRelayedPushes(realMessagingEdges(), {
        connect: selectTabPushConnect(browser),
        inspectedTabId: devtoolsInspectedTabId
      });
      return createFdtDataStore({
        inspectedTabId: devtoolsInspectedTabId,
        ...fdtRequestEdges(selectTabAsks(browser)),
        receive: (receivers) => edges.receive(receivers),
        search,
        reload: () => {
          window.location.reload();
        },
        hardReloadBudget: createHardReloadBudget(
          () => window.sessionStorage,
          (operation, cause) => {
            log.warn('Contract-reload budget storage unavailable — no fallback reload', {
              operation,
              cause: cause instanceof Error ? { message: cause.message } : cause
            });
          }
        ),
        now: Date.now
      });
    })();
  // eslint-disable-next-line solid/reactivity
  const overlays = props.overlays ?? createOverlayStore();
  // eslint-disable-next-line solid/reactivity
  const builderEntryDeps = props.builderEntry ?? realBuilderEntryDeps(devtoolsInspectedTabId);
  const router = createHashRoute();
  // Shell-scoped so the Detections layout survives route switches and refreshes.
  const detectionsLayout = createDetectionsLayout();
  // Shell-scoped so a page's open detail reaches the chrome; per route.
  const detailPresence = createDetailPresence(router.route);
  // eslint-disable-next-line solid/reactivity
  const paletteChord = createPanelChordBinding(props.paletteChord ?? realPanelChordDeps(log));
  // eslint-disable-next-line solid/reactivity
  const shellWidth = createShellWidth(props.observeShellWidth);
  // eslint-disable-next-line solid/reactivity
  const navPin = createNavPinState(props.navPin ?? NAV_PIN_DEFAULT, props.writeNavPin ?? setNavPin);
  // The top bar's appearance menu, writing through the shared failure guard.
  // eslint-disable-next-line solid/reactivity
  const appearance = props.appearance;
  // eslint-disable-next-line solid/reactivity
  const writeAppearance = props.writeAppearance ?? setAppearanceOption;
  const appearanceControl =
    appearance === undefined ? undefined : (
      <AppearanceMenu
        value={appearance()}
        onChange={(next) => {
          void guardAppearanceWrite(() => writeAppearance(next));
        }}
      />
    );
  /** The trigger's key hint: the resolved convention, else the navigator's. */
  const keyHint = (): string =>
    paletteKeyHint(paletteChord.binding()?.platform ?? navigatorChordPlatform(navigator));

  // The shell — and only the shell — owns the mount lifecycle: every
  // message receiver registers inside `start()`, the global keyboard
  // shortcuts arm with the same cycle, and unmount drops all of the above
  // (a pending search debounce commit must not land after the shell is
  // gone).
  let stopShortcuts: (() => void) | undefined;
  onMount(() => {
    data.start();
    stopShortcuts = registerPanelShortcuts(overlays, paletteChord.binding);
  });
  onCleanup(() => {
    stopShortcuts?.();
    paletteChord.stop();
    data.stop();
    router.stop();
    search.cancel();
  });

  // A route change resets the search state entirely (matches belong to the
  // page that produced them; the Esc rule's sibling). The boot's initial
  // route needs no reset — hence the deferred run.
  createEffect(
    on(
      router.route,
      () => {
        search.cancel();
      },
      { defer: true }
    )
  );

  // The route-switch focus rule: every route change (nav click, palette
  // navigation, deep link) moves focus to the page body's own h1, which
  // announces the destination or its real loading state. Errors outside a
  // route body skip the move. Soft refreshes leave the route unchanged, so
  // they never re-run this: scroll and focus survive the refresh.
  createEffect(
    on(
      router.route,
      () => {
        focusRouteHeading();
      },
      { defer: true }
    )
  );

  /** The content region (the one scroll container of the route bodies and states). */
  let contentRegion: HTMLElement | undefined;

  // A page-level view swap (Retry's error → loading, loading → page, …)
  // replaces the whole body: start the new view at its top, so its heading is
  // in view instead of the offset the previous view was scrolled to. A soft
  // refresh stays on the same view, so its scroll survives.
  // (A memo: `on` fires per source change, and every data push is one.)
  const pageView = createMemo(() => pageViewOf(data.state().status));
  createEffect(
    on(
      pageView,
      () => {
        if (contentRegion !== undefined) contentRegion.scrollTop = 0;
      },
      { defer: true }
    )
  );

  /** The error branch's datum, for the retry affordance (typed narrowing). */
  const errorState = createMemo((): DataError | null => {
    const current = data.state();
    return current.status === 'error' ? { cause: current.cause } : null;
  });

  /** The unavailable branch's reason (typed narrowing for the view). */
  const unavailableReason = createMemo((): string | null => {
    const current = data.state();
    return current.status === 'unavailable' ? current.reason : null;
  });

  /** The machine-state announcement (never the data pushes themselves). */
  const statusLine = createMemo((): string => {
    const current = data.state();
    switch (current.status) {
      case 'idle':
      case 'fetching':
        return 'Loading page data';
      case 'refreshing':
        return 'Refreshing page data';
      case 'error':
        return 'Page data could not load';
      case 'unavailable':
        return DATA_UNAVAILABLE_TITLE;
      case 'ready':
        return `${navRoute(router.route())?.label ?? 'Page'} loaded`;
    }
  });

  // The cold-start chain's last entry: the boot flight's first settle, in
  // whichever arm it lands (ready or error — both are genuine answers). The
  // instrument's once-guard makes the effect free to re-run per transition.
  createEffect(() => {
    const current = data.state();
    if (current.status === 'ready' || current.status === 'error') {
      panelColdStart.markFirstDataState();
    }
  });

  /**
   * The loaded page data for the nav's live-state selectors — null
   * everywhere else, so rows stay state-free until data is trustworthy.
   */
  const navData = createMemo((): FdtData | null => {
    const current = data.state();
    return current.status === 'ready' || current.status === 'refreshing' ? current.data : null;
  });

  return (
    <FdtDataContext.Provider value={data}>
      <SearchContext.Provider value={search}>
        <DetailPresenceContext.Provider value={detailPresence}>
          <div
            data-fdt="panel-shell"
            ref={shellWidth.attach}
            class="flex h-dvh bg-surface-0 text-fg-primary"
          >
            <div data-fdt="panel-stack" class={STACK}>
              <TopBar
                width={shellWidth.width}
                palette={{
                  open: () => overlays.paletteOpen(),
                  toggle: () => {
                    overlays.togglePalette();
                  },
                  keyHint
                }}
                builderEntry={builderEntryDeps}
                readPageUrl={props.readPageUrl ?? readRealPageUrl}
                appearance={appearanceControl}
              />
              <div class={STACK_ROW}>
                {/* The nav column (not a landmark itself: the top bar is the
                    page's banner; the nav inside is the navigation landmark). */}
                <Sidebar
                  route={router.route}
                  data={navData}
                  width={shellWidth.width}
                  pin={navPin}
                />
                {/* `relative`: the scroller is the containing block of the
                    out-of-flow content it holds (sr-only text, joiners), so
                    it scrolls and clips with the page. Without a positioned
                    ancestor it resolves against the viewport, and its static
                    offsets grow the document's own overflow — a second,
                    document-level scrollbar that narrows the whole shell. */}
                <main
                  ref={contentRegion}
                  data-fdt="panel-content"
                  class="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
                >
                  <ErrorBoundary
                    fallback={(error: unknown) => {
                      // The render-crash retry reloads the whole panel document
                      // (a Solid reset cannot re-create arbitrary lost state); the
                      // original error is logged here, never rendered — only the
                      // actionable reload affordance reaches the user.
                      log.error('Panel render crashed — the fallback view is up', {
                        cause: error instanceof Error ? { message: error.message } : error
                      });
                      return (
                        <PageCanvas id={router.route()}>
                          <PageStateCard>
                            <ErrorState
                              pageHeading
                              title="The panel came apart"
                              message="This view failed while rendering. Reloading the panel restores it — the inspected page is unaffected."
                              onRetry={props.reload ?? reloadPanelDocument}
                            />
                          </PageStateCard>
                        </PageCanvas>
                      );
                    }}
                  >
                    <Switch>
                      {/* The real waits only: skeleton while nothing has arrived. */}
                      <Match
                        when={data.state().status === 'fetching' || data.state().status === 'idle'}
                      >
                        <SkeletonPage route={router.route()} />
                      </Match>
                      {/* The error view with its retry (the phase's dead-end rule). */}
                      <Match when={errorState()} keyed>
                        {(error) => (
                          <PageCanvas id={router.route()}>
                            <PageStateCard>
                              <ErrorState
                                pageHeading
                                title="Couldn't load page data"
                                message={error.cause}
                                onRetry={() => {
                                  data.retry();
                                }}
                              />
                            </PageStateCard>
                          </PageCanvas>
                        )}
                      </Match>
                      {/* No way to message the page here (feature-detected): an
                        explicit state naming what still works — no retry. */}
                      <Match when={unavailableReason()} keyed>
                        {(reason) => (
                          <PageCanvas id={router.route()}>
                            <PageStateCard>
                              <DataUnavailable reason={reason} />
                            </PageStateCard>
                          </PageCanvas>
                        )}
                      </Match>
                      {/* `ready` and `refreshing` render the same body — the data
                        swap is the only change a soft refresh makes. */}
                      <Match
                        when={
                          data.state().status === 'ready' || data.state().status === 'refreshing'
                        }
                      >
                        <DetectionsLayoutContext.Provider value={detectionsLayout}>
                          <Dynamic component={PAGES[router.route()]} />
                        </DetectionsLayoutContext.Provider>
                      </Match>
                    </Switch>
                  </ErrorBoundary>
                </main>
              </div>
            </div>
            <div role="status" class="sr-only" aria-live="polite" data-fdt="panel-status">
              {statusLine()}
            </div>
            <PanelOverlays
              overlays={overlays}
              data={data}
              currentRoute={() => router.route()}
              navigate={(route) => {
                router.navigate(route);
              }}
              focusRouteHeading={focusRouteHeading}
              paletteChord={paletteChord.binding}
            />
            <Toasts />
          </div>
        </DetailPresenceContext.Provider>
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  );
}

/**
 * The boot's loading page: the real wait named in the page's h1 (its header
 * reserving the landed header's subtitle and actions lines) above the
 * destination route's loading shape, on that route's canvas — so the
 * shell's real top bar and sidebar frame a body already shaped like the
 * page that lands (the top bar shows its own placeholders until data).
 *
 * @param props The current route; changes during boot update the canvas and the shape.
 * @returns The loading page.
 */
function SkeletonPage(props: { route: RouteId }): JSX.Element {
  return (
    <section class="fdt-page @container" data-fdt-page="fetching">
      <PageCanvas id={props.route}>
        <PageHeader
          title="Loading page data"
          subtitle={<LoadingSubtitle />}
          actions={<LoadingActions route={props.route} />}
        />
        <RouteLoading route={props.route} />
      </PageCanvas>
    </section>
  );
}

/** The devtools panel page's mount surface. */
export default PanelApp;
