/**
 * The panel's app shell: the brand mark above the icon rail (the nav) and
 * the content region beside it that renders the route bodies and the
 * data-state surfaces around them.
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
  type JSX
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Rocket from 'lucide-solid/icons/rocket';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/skeleton';
import { Toasts } from '../../components/ui/toast';
import { createLogger } from '../../lib/logger';
import type { FdtData } from '../../lib/wp-rocket/types';
import { AdaptiveNav } from './nav/adaptive-nav';
import { createHashRoute } from './router';
import { navRoute } from './routes';
import { StatusBar } from './status-bar/status-bar';
import { PAGES } from './pages';
import { focusRouteHeading } from './palette/focus';
import { PaletteTrigger } from './palette/palette-trigger';
import { PanelOverlays } from './palette/panel-overlays';
import { createOverlayStore, type OverlayStore } from './palette/overlays';
import { registerPanelShortcuts } from './palette/shortcuts';
import {
  createFdtDataStore,
  FdtDataContext,
  SearchContext,
  type FdtDataStore
} from './state/use-fdt-data';
import { createSearchStore, type SearchStore } from './state/search';
import { devtoolsInspectedTabId, realMessagingEdges } from './state/edges';

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
};

/** The error branch's payload (the error state's fields the view reads). */
interface DataError {
  /** The user-facing cause the view renders. */
  readonly cause: string;
}

/** The shell header: the brand mark above the nav's icon rail column. */
const HEADER = 'flex shrink-0 flex-col gap-2 border-r border-line-2 bg-surface-1 p-2';

/** The brand mark: centered over the rail; its name rides the sr-only span. */
const BRAND =
  'flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-xs font-semibold text-fg-primary';

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
 * The persistent status strip: the shell's bottom edge, outside the
 * content region's scrolling — an answer never scrolls out and data never
 * pushes the panel's chrome, at every docking geometry.
 */
const BOTTOM_EDGE = 'flex min-h-0 min-w-0 flex-1 flex-col';

/** The rail-and-content row above the strip (the shell's pre-strip geometry, unchanged). */
const STACK_ROW = 'flex min-h-0 flex-1';

export function PanelApp(props: AppProps): JSX.Element {
  // All three store injections below are deliberate once-per-mount builds
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
      const edges = realMessagingEdges();
      return createFdtDataStore({
        inspectedTabId: devtoolsInspectedTabId,
        request: (tabId) => edges.request(tabId),
        receive: (receivers) => edges.receive(receivers),
        search,
        reload: () => {
          window.location.reload();
        },
        now: Date.now
      });
    })();
  // eslint-disable-next-line solid/reactivity
  const overlays = props.overlays ?? createOverlayStore();
  const router = createHashRoute();

  // The shell — and only the shell — owns the mount lifecycle: every
  // message receiver registers inside `start()`, the global keyboard
  // shortcuts arm with the same cycle, and unmount drops all of the above
  // (a pending search debounce commit must not land after the shell is
  // gone).
  let stopShortcuts: (() => void) | undefined;
  onMount(() => {
    data.start();
    stopShortcuts = registerPanelShortcuts(overlays);
  });
  onCleanup(() => {
    stopShortcuts?.();
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
  // announces the destination; bodies without one (skeleton/error) skip the
  // move. Soft refreshes never re-run this — they do not change the route,
  // so the preservation contract (scroll/focus survive a refresh) holds.
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
      case 'ready':
        return `${navRoute(router.route())?.label ?? 'Page'} loaded`;
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
        <div data-fdt="panel-shell" class="flex h-dvh bg-surface-0 text-fg-primary">
          <div data-fdt="panel-stack" class={BOTTOM_EDGE}>
            <div class={STACK_ROW}>
              <header data-fdt="panel-header" class={HEADER}>
                {/* The brand block: the mark and the palette trigger — the
                keyboard layer's mouse entry point — beside the rail's first
                row (the interim geometry; the band redesign owns the final
                shape). The brand is not a heading: each page owns the single
                h1. Its name rides the sr-only span. */}
                <div data-fdt="panel-brand-row" class="flex shrink-0 items-center gap-1.5">
                  <p class={BRAND}>
                    <Rocket size={14} class="shrink-0 text-accent" aria-hidden="true" />
                    <span class="sr-only">WPR FDT</span>
                  </p>
                  <PaletteTrigger
                    open={() => overlays.paletteOpen()}
                    toggle={() => {
                      overlays.togglePalette();
                    }}
                  />
                </div>
                <AdaptiveNav route={router.route} data={navData} />
              </header>
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
                      <div class="p-4">
                        <ErrorState
                          title="The panel came apart"
                          message="This view failed while rendering. Reloading the panel restores it — the inspected page is unaffected."
                          onRetry={props.reload ?? reloadPanelDocument}
                        />
                      </div>
                    );
                  }}
                >
                  <Switch>
                    {/* The real waits only: skeleton while nothing has arrived. */}
                    <Match
                      when={data.state().status === 'fetching' || data.state().status === 'idle'}
                    >
                      <SkeletonPage />
                    </Match>
                    {/* The error view with its retry (the phase's dead-end rule). */}
                    <Match when={errorState()} keyed>
                      {(error) => (
                        <div class="p-4">
                          <ErrorState
                            title="Couldn't load page data"
                            message={error.cause}
                            onRetry={() => {
                              data.retry();
                            }}
                          />
                        </div>
                      )}
                    </Match>
                    {/* `ready` and `refreshing` render the same body — the data
                        swap is the only change a soft refresh makes. */}
                    <Match
                      when={data.state().status === 'ready' || data.state().status === 'refreshing'}
                    >
                      <Dynamic component={PAGES[router.route()]} />
                    </Match>
                  </Switch>
                </ErrorBoundary>
              </main>
            </div>
            <StatusBar />
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
          />
          <Toasts />
        </div>
      </SearchContext.Provider>
    </FdtDataContext.Provider>
  );
}

/** The while-loading page body: three ranked skeleton blocks, nothing else. */
function SkeletonPage(): JSX.Element {
  return (
    <section class="fdt-page p-3" data-fdt-page="fetching">
      <Skeleton class="h-5 w-36" />
      <div class="mt-4 grid gap-2">
        <Skeleton class="h-14 w-full" />
        <Skeleton class="h-14 w-full" />
        <Skeleton class="h-14 w-64" />
      </div>
    </section>
  );
}

/** The devtools panel page's mount surface. */
export default PanelApp;
