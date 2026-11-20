/**
 * One image's detail body (the side pane or the drill-in view of the
 * Lazyload list): only what the capture records for an image — every state
 * chip with its source, the URL as a source-link tile (Open in Sources / a
 * new tab; nothing fetched, no thumbnail), whether it is lazyloaded, and the
 * page's own reasons it escapes lazyload (shown only while lazyload runs on
 * the page; the tool's exclusion marker is the Excluded chip, never a reason).
 */
import type { Accessor, JSX } from 'solid-js';
import { For, Match, Show, Switch, createMemo } from 'solid-js';
import { Badge } from '../../../../components/ui/badge';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import type { OpenResource } from '../open-resource';
import { DetailSection, FactList } from '../resource-list/detail-section';
import { SourceLink } from '../resource-list/source-link';
import { StateChips } from '../resource-list/state-chip-list';
import { splitStateChips } from '../resource-list/state-chips';
import { lazyloadFacts, lazyloadReasonsView, type LazyloadRowView } from './lazyload-rows';

/** Props of {@link LazyloadDetail}. */
export interface LazyloadDetailProps {
  /** The selected row (live: a same-key refresh updates it in place). */
  view: Accessor<LazyloadRowView>;
  /** Whether image lazyload runs on the page (WP Rocket's or a verified simulation's). */
  running: Accessor<boolean>;
  /** "Open in Sources" (null: the tile opens a new tab). */
  openResource: OpenResource | null;
}

/** What an image without a captured URL says in place of the tile. */
export const NO_IMAGE_URL_NOTE = 'The capture holds no URL for this image.';

/** The reasons section's line when lazyload skipped the image without a reason found. */
export const NO_REASONS_FOUND = 'No reasons found';

/** The reasons section's line when lazyload does not run on the page. */
export const REASONS_OFF_NOTE = `${getRealOptionName('lazyload')} doesn't run on this page, so no exclusion applies.`;

/**
 * Render one image's detail body.
 *
 * @param props See {@link LazyloadDetailProps}.
 */
export function LazyloadDetail(props: LazyloadDetailProps): JSX.Element {
  const row = () => props.view().row;
  const reasons = createMemo(() => lazyloadReasonsView(row(), props.running()));
  /** The page's reasons, when there are some to list. */
  const reasonList = (): readonly string[] | undefined => {
    const view = reasons();
    return view.kind === 'reasons' ? view.reasons : undefined;
  };
  return (
    <div data-fdt="lazyload-detail" class="flex min-w-0 flex-col gap-3.5">
      <Show when={props.view().chips.length > 0}>
        <div data-fdt="lazyload-detail-chips" class="flex flex-wrap items-center gap-1">
          <StateChips chips={splitStateChips(props.view().chips, props.view().chips.length)} />
        </div>
      </Show>
      <Show
        when={row().src !== ''}
        fallback={
          <p data-fdt="lazyload-no-url" class="text-2xs text-fg-muted">
            {NO_IMAGE_URL_NOTE}
          </p>
        }
      >
        <SourceLink
          url={row().src}
          clipped={props.view().clipped}
          openResource={props.openResource}
        />
      </Show>
      <FactList facts={lazyloadFacts(row())} hook="lazyload-facts" />
      <Switch>
        <Match when={reasons().kind === 'off'}>
          <p data-fdt="lazyload-reasons-off" class="text-2xs text-fg-muted">
            {REASONS_OFF_NOTE}
          </p>
        </Match>
        <Match when={reasons().kind === 'none-found' || reasons().kind === 'reasons'}>
          <DetailSection title="Exclusion reasons" hook="lazyload-reasons">
            <Show
              when={reasonList()}
              fallback={<p class="text-2xs text-fg-muted">{NO_REASONS_FOUND}</p>}
            >
              {(list) => (
                <div class="flex flex-wrap items-center gap-1">
                  <For each={list()}>
                    {(reason) => (
                      <Badge variant="outline" class="font-mono break-all">
                        {reason}
                      </Badge>
                    )}
                  </For>
                </div>
              )}
            </Show>
          </DetailSection>
        </Match>
      </Switch>
    </div>
  );
}
