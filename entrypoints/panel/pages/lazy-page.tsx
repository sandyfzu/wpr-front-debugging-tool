/**
 * Page bodies kept out of the panel's start: pages that only some sessions
 * open (tools) live in their own chunk, fetched once the panel is idle after
 * boot or on the first visit, whichever comes first (`./chunk-loader`) — so
 * the start pays nothing and a visit rarely waits. A plain signal holds the
 * loaded body (no Suspense runtime in the panel's eager bundle).
 *
 * States: loading (the route's titled frame with skeleton sections — a real
 * wait; focus on its heading moves to the page's own once it lands), failed
 * (named, with the remedy: reloading the panel document, which re-resolves
 * the extension's files), loaded (the page body).
 */
import type { Component, JSX } from 'solid-js';
import { Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ErrorState } from '../../../components/ui/error-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { navRoute, type RouteId } from '../routes';
import {
  createChunkLoader,
  mountChunk,
  prefetchWhenIdle,
  reloadPanelDocument,
  type LazyChunkOptions
} from './chunk-loader';
import { PageFrame } from './page-frame';

/** The failed load's words. */
export const PAGE_LOAD_FAILED_COPY =
  "This page's code did not load — usually the extension was updated or reloaded. Reload the panel to restore it.";

/**
 * Wrap a page module's loader as a route body.
 *
 * @param id The route (its label titles the loading and failed frames).
 * @param load Imports the page module and picks its body.
 * @param options See {@link LazyChunkOptions}.
 * @returns The route body.
 */
export function lazyPage(
  id: RouteId,
  load: () => Promise<Component>,
  options: LazyChunkOptions = {}
): Component {
  // One fetch per panel document: a later visit renders the loaded body at once.
  const chunk = createChunkLoader(
    load,
    options.prefetch === undefined ? prefetchWhenIdle : options.prefetch
  );

  return (): JSX.Element => {
    let loadingFrame: HTMLDivElement | undefined;
    const { body, failed } = mountChunk(chunk, {
      failureMessage: `Loading the ${id} page failed`,
      onLoad: (_component, show) => {
        // The route-switch focus sat on the loading frame's heading: hand it on.
        const hadFocus = loadingFrame?.contains(document.activeElement) === true;
        show();
        if (hadFocus) document.querySelector<HTMLElement>(`[data-fdt-page="${id}"] h1`)?.focus();
      }
    });
    const title = navRoute(id)?.label ?? '';
    return (
      <Switch
        fallback={
          <div ref={loadingFrame} class="contents">
            <PageFrame id={id} title={title}>
              <div class="grid grid-cols-1 gap-2" data-fdt-page-chunk-loading>
                <Skeleton class="h-14 w-full" />
                <Skeleton class="h-14 w-full" />
              </div>
            </PageFrame>
          </div>
        }
      >
        <Match when={body()}>{(component) => <Dynamic component={component()} />}</Match>
        <Match when={failed()}>
          <PageFrame id={id} title={title}>
            <ErrorState
              title="Couldn't load this page"
              message={PAGE_LOAD_FAILED_COPY}
              retryLabel="Reload panel"
              onRetry={options.reloadPanel ?? reloadPanelDocument}
            />
          </PageFrame>
        </Match>
      </Switch>
    );
  };
}
