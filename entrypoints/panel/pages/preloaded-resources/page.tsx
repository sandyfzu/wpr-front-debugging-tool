/**
 * The Preloaded Resources page: every link WP Rocket marked for preloading,
 * with its `as` type. Chips: all / images / fonts (other types appear under
 * all); the search narrows by URL (`href`). The feature badge reads the
 * plugin's "Preload" label. Layout, search wiring and states:
 * `ResourceListPage`; the two empty states (nothing preloaded vs a present
 * feature whose list was not collected) come from `preloadedInventory`.
 */
import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import Zap from 'lucide-solid/icons/zap';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import {
  buildPreloadedRows,
  PRELOADED_PAGE_RESOURCES,
  type PreloadedResource
} from '../../../../lib/panel/resources-view-model';
import type { PreloadedResources } from '../../../../lib/wp-rocket/types';
import { useFdtData } from '../../state/use-fdt-data';
import { ResourceListPage } from '../resource-list/resource-list';
import { ResourceLink } from '../resource-list/resource-link';
import { asTypeLabel, PRELOADED_ROW_ESTIMATE, preloadedInventory } from './preloaded-view';

/** Props of {@link PreloadedResourcesPage} — test seams only; the shell passes none. */
export interface PreloadedResourcesPageProps {
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
}

/** The report the page reads while no data is mounted (never rendered in practice). */
const NO_REPORT: PreloadedResources = { present: false };

/**
 * The Preloaded Resources route's page body.
 *
 * @param props See {@link PreloadedResourcesPageProps}.
 */
export function PreloadedResourcesPage(props: PreloadedResourcesPageProps): JSX.Element {
  const store = useFdtData();
  const report = createMemo((): PreloadedResources => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing'
      ? state.data.preloadedResources
      : NO_REPORT;
  });
  const rows = createMemo(() => buildPreloadedRows(report()));
  const inventory = createMemo(() => preloadedInventory(report()));

  return (
    <ResourceListPage
      id="preloaded-resources"
      title="Preloaded Resources"
      subtitle="Resources WP Rocket tells the browser to preload on this page."
      definition={PRELOADED_PAGE_RESOURCES}
      rows={rows()}
      featureLabel={getRealOptionName('manual_preload')}
      featurePresent={report().present}
      noun={{ one: 'resource', other: 'resources' }}
      listLabel="Preloaded resources"
      searchLabel="Search resource URLs"
      searchPlaceholder="Search resource URLs…"
      estimateSize={() => PRELOADED_ROW_ESTIMATE}
      renderRow={(row) => <PreloadedRow row={row} />}
      createVirtualizer={props.createVirtualizer}
      empty={
        <Show
          when={inventory() === 'not-collected'}
          fallback={
            <EmptyState
              class="self-center"
              icon={<Zap size={16} aria-hidden="true" />}
              title="No preloaded resources on this page"
              description="No link on this page carries WP Rocket's preload marker."
            />
          }
        >
          <EmptyState
            class="self-center"
            icon={<Zap size={16} aria-hidden="true" />}
            title="Preload inventory not collected"
            description="The preload marker was detected, but this capture carries no resource list. Reload the inspected page to capture it again."
          />
        </Show>
      }
    />
  );
}

/**
 * One preloaded resource: the `as` type chip, name and copy, the full URL beneath.
 *
 * @param props.row The resource row.
 */
function PreloadedRow(props: { row: PreloadedResource }): JSX.Element {
  return (
    <ResourceLink
      href={props.row.href}
      copyLabel="URL"
      chip={
        <Badge variant="outline" class="shrink-0 font-mono">
          <Show
            when={asTypeLabel(props.row.type)}
            fallback={
              <>
                <span aria-hidden="true">—</span>
                <span class="sr-only">No type</span>
              </>
            }
          >
            {(label) => label()}
          </Show>
        </Badge>
      }
    />
  );
}
