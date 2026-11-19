/**
 * The panel's app shell: the top bar (identity, the page's answers and the
 * shell controls) above the icon rail (the nav) and the content region
 * beside it that renders the route bodies and the data-state surfaces
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
import { Skeleton } from '../../components/ui/skeleton';
import { Toasts } from '../../components/ui/toast';
import { AppearanceMenu } from '../../components/appearance-menu';
import { setAppearanceOption } from '../../lib/storage/options';
import type { Appearance } from '../../utils/theme';
import { selectTabAsks } from '../../lib/messaging/tab-asks';
import { selectTabPushConnect } from '../../lib/messaging/tab-push-client';
import { createLogger } from '../../lib/logger';
import type { FdtData } from '../../lib/wp-rocket/types';
import { panelColdStart } from './cold-start';
import { AdaptiveNav } from './nav/adaptive-nav';
import { createHashRoute } from './router';
import { navRoute, type RouteId } from './routes';
import { PageCanvas } from './pages/page-frame';
import { DATA_UNAVAILABLE_TITLE, DataUnavailable } from './data-unavailable';
import { TopBar } from './top-bar/top-bar';
import { guardAppearanceWrite } from './appearance-write';
import { realBuilderEntryDeps, type BuilderEntryDeps } from './top-bar/builder-entry';
import { readInspectedPageUrl, realInspectedEvalApi } from './report/inspected-page-url';
import { PAGES } from './pages';
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
};

/** The error branch's payload (the error state's fields the view reads). */
interface DataError {
  /** The user-facing cause the view renders. */
  readonly cause: string;
}

/**
 * The nav column: the icon rail beside the content.
 *
 * `z-10` is the column's paint priority over the content region: below the
 * panel's usable minimum nothing can absorb the loss of height, so the
 * column's overflow (its "More pages" trigger) must never paint under a
 * stacked page element and become pointer-blocked. At any normal height
 * nothing overflows and the rule is inert; the fixed overlays (dialog
 * z-40+, tooltips/menu portals z-50) rank above it unchanged. The top bar
 * carries the same priority.
 */
const HEADER = 'relative z-10 flex shrink-0 flex-col gap-2 border-r border-line-2 bg-surface-1 p-2';

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
                <div data-fdt="panel-header" class={HEADER}>
                  <AdaptiveNav route={router.route} data={navData} />
                </div>
                <main data-fdt="panel-content" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                          <ErrorState
                            pageHeading
                            title="The panel came apart"
                            message="This view failed while rendering. Reloading the panel restores it — the inspected page is unaffected."
                            onRetry={props.reload ?? reloadPanelDocument}
                          />
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
                            <ErrorState
                              pageHeading
                              title="Couldn't load page data"
                              message={error.cause}
                              onRetry={() => {
                                data.retry();
                              }}
                            />
                          </PageCanvas>
                        )}
                      </Match>
                      {/* No way to message the page here (feature-detected): an
                        explicit state naming what still works — no retry. */}
                      <Match when={unavailableReason()} keyed>
                        {(reason) => (
                          <PageCanvas id={router.route()}>
                            <DataUnavailable reason={reason} />
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
 * Name the real wait above placeholders on the destination's canvas.
 * @param props The current route; changes during boot update the canvas width.
 * @returns A visible loading title and placeholders bounded by available inline size.
 */
function SkeletonPage(props: { route: RouteId }): JSX.Element {
  return (
    <section class="fdt-page @container" data-fdt-page="fetching">
      <PageCanvas id={props.route}>
        <PageHeader title="Loading page data" />
        {/* A zero-minimum track lets the fixed short bar's max-width resolve
            against available space instead of widening the grid intrinsically. */}
        <div class="mt-1 grid grid-cols-1 gap-2">
          <Skeleton class="h-14 w-full" />
          <Skeleton class="h-14 w-full" />
          <Skeleton class="h-14 w-64 max-w-full" />
        </div>
      </PageCanvas>
    </section>
  );
}

/** The devtools panel page's mount surface. */
export default PanelApp;
