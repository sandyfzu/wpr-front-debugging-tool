/**
 * A page section kept out of the panel's start: its code lives in its own
 * chunk, loaded through the shared loader (`./chunk-loader`: early at the
 * first idle moment, or on first show) — for a section of an eager page
 * that only some sessions open.
 *
 * States: loading (skeleton rows — a real wait), failed (named, with the
 * remedy: reloading the panel document), loaded (the section, with the
 * props the page passes).
 */
import type { Component, JSX } from 'solid-js';
import { Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ErrorState } from '../../../components/ui/error-state';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  createChunkLoader,
  mountChunk,
  prefetchWhenIdle,
  reloadPanelDocument,
  type LazyChunkOptions
} from './chunk-loader';

/** The failed load's words. */
export const SECTION_LOAD_FAILED_COPY =
  "This section's code did not load — usually the extension was updated or reloaded. Reload the panel to restore it.";

/**
 * Wrap a section module's loader as a component.
 *
 * @param name Names the section in the failure log ("Runtime states").
 * @param load Imports the section module and picks its component.
 * @param options See {@link LazyChunkOptions}.
 * @returns The section component (takes the loaded component's props).
 */
export function lazySection<P extends object>(
  name: string,
  load: () => Promise<Component<P>>,
  options: LazyChunkOptions = {}
): Component<P> {
  const chunk = createChunkLoader(
    load,
    options.prefetch === undefined ? prefetchWhenIdle : options.prefetch
  );

  return (props: P): JSX.Element => {
    const { body, failed } = mountChunk(chunk, {
      failureMessage: `Loading the ${name} section failed`
    });
    return (
      <Switch
        fallback={
          <div class="grid grid-cols-1 gap-2" data-fdt-section-chunk-loading>
            <Skeleton class="h-8 w-full" />
            <Skeleton class="h-14 w-full" />
            <Skeleton class="h-14 w-full" />
          </div>
        }
      >
        <Match when={body()}>{(component) => <Dynamic component={component()} {...props} />}</Match>
        <Match when={failed()}>
          <ErrorState
            title="Couldn't load this section"
            message={SECTION_LOAD_FAILED_COPY}
            retryLabel="Reload panel"
            onRetry={options.reloadPanel ?? reloadPanelDocument}
          />
        </Match>
      </Switch>
    );
  };
}
