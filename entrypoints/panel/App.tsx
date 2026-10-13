/**
 * The panel's app shell: sticky header (brand mark + the registry-driven
 * provisional flat nav) over the content region that renders the route
 * bodies and the data-state surfaces around them.
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
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  type JSX
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Rocket } from 'lucide-solid';
import { DISABLED, FOCUS_RING } from '../../components/ui/classes';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/skeleton';
import { Tooltip } from '../../components/ui/tooltip';
import { cn } from '../../utils/cn';
import { createLogger } from '../../lib/logger';
import { createHashRoute } from './router';
import { NAV_ROUTES, navRoute } from './routes';
import { PAGES } from './pages';
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

/** A nav row's plain anchor treatment (token utilities, both palettes). */
const NAV_ROW = 'flex h-7 items-center rounded px-2 text-2xs font-medium no-underline';
/** The active row's treatment. */
const NAV_ROW_ACTIVE = 'bg-surface-3 text-fg-primary';
/** The rest rows' treatment (the hover surface every interactive gets). */
const NAV_ROW_IDLE = 'text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

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

export function PanelApp(props: AppProps): JSX.Element {
  // Builds run exactly once per panel mount.
  const search = props.search ?? createSearchStore();
  const data =
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
  const router = createHashRoute();

  // The shell — and only the shell — owns the mount lifecycle: every
  // message receiver registers inside `start()` and drops at unmount, and
  // unmount also cancels the search flow (a pending debounce commit must not
  // land after the shell is gone).
  onMount(() => {
    data.start();
  });
  onCleanup(() => {
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

  return (
    <FdtDataContext.Provider value={data}>
      <SearchContext.Provider value={search}>
        <div class="flex h-dvh flex-col bg-surface-0 text-fg-primary">
          <header data-fdt="panel-header" class="shrink-0 border-b border-line-2 bg-surface-1">
            <div class="flex items-center gap-3 px-3">
              {/* The brand is not a heading: each page owns the single h1. */}
              <p class="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-fg-primary">
                <Rocket size={14} class="text-accent" aria-hidden="true" />
                WPR FDT
              </p>
              <nav aria-label="WPR FDT pages" class="flex items-center gap-0.5">
                <For each={NAV_ROUTES}>
                  {(row) => (
                    <Show
                      when={row.reserved ?? false}
                      fallback={
                        <a
                          data-fdt="nav-row"
                          href={`#/${row.id}`}
                          aria-current={router.route() === row.id ? 'page' : undefined}
                          class={cn(
                            NAV_ROW,
                            FOCUS_RING,
                            router.route() === row.id ? NAV_ROW_ACTIVE : NAV_ROW_IDLE
                          )}
                        >
                          {row.label}
                        </a>
                      }
                    >
                      <Tooltip
                        content={row.reservedNote ?? 'Reserved'}
                        disabled
                        class={cn(NAV_ROW, DISABLED, 'text-fg-muted')}
                      >
                        <span>{row.label}</span>
                      </Tooltip>
                    </Show>
                  )}
                </For>
              </nav>
            </div>
          </header>
          <main data-fdt="panel-content" class="min-h-0 flex-1 overflow-y-auto">
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
                <Match when={data.state().status === 'fetching' || data.state().status === 'idle'}>
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
          <div role="status" class="sr-only" aria-live="polite" data-fdt="panel-status">
            {statusLine()}
          </div>
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
