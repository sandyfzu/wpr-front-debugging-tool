/**
 * The Preloaded Resources page: the page's resource hints — preloads (by
 * `as` type), module preloads, preconnects and DNS prefetches — WP Rocket's
 * first (stamped, the feature named only where the page proves it), then
 * the unattributed rest. Chips: all / WP Rocket / unattributed, then the
 * kinds (preload images and fonts beside Preload); the search narrows by
 * URL (`href`). Layout, search wiring and states: `ResourceListPage`; the
 * two empty states (no hint vs a capture without a hint list) come from
 * `preloadedInventory`.
 */
import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import Zap from 'lucide-solid/icons/zap';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { HINT_NOUN } from '../../../../lib/detection/count-nouns';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import {
  buildPreloadedRows,
  PRELOADED_PAGE_RESOURCES,
  reportHintsTruncated,
  type PreloadedResource
} from '../../../../lib/panel/resources-view-model';
import type { PreloadedResources, WprDetections } from '../../../../lib/wp-rocket/types';
import { useFdtData } from '../../state/use-fdt-data';
import { ResourceListPage } from '../resource-list/resource-list';
import { ResourceLink } from '../resource-list/resource-link';
import { urlClipped } from '../resource-list/resource-list-view';
import { StateChips } from '../resource-list/state-chip-list';
import {
  attributionChips,
  hintKindChip,
  missingUrlLabel,
  PRELOADED_ROW_ESTIMATE,
  preloadedInventory,
  preloadedNotes,
  samePreloadedRow,
  WP_ROCKET_HINTS_LABEL,
  wpRocketHintsPresent
} from './preloaded-view';

/** Props of {@link PreloadedResourcesPage} — test seams only; the shell passes none. */
export interface PreloadedResourcesPageProps {
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
}

/** What the page reads from a mounted payload. */
interface PageInput {
  readonly report: PreloadedResources;
  readonly detections: WprDetections;
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
  const input = createMemo((): PageInput | null => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing'
      ? { report: state.data.preloadedResources, detections: state.data.wprDetections }
      : null;
  });
  const report = (): PreloadedResources => input()?.report ?? NO_REPORT;
  const rows = createMemo((): PreloadedResource[] => {
    const current = input();
    return current === null ? [] : buildPreloadedRows(current.report, current.detections);
  });
  const notes = createMemo((): string[] => {
    const current = input();
    return current === null ? [] : preloadedNotes(current.report, rows(), current.detections);
  });
  const inventory = createMemo(() => preloadedInventory(report()));
  /** The capture cut this row's URL (each list carries its own mark). */
  const clipped = (row: PreloadedResource): boolean =>
    urlClipped(reportHintsTruncated(report()), row.href, PAYLOAD_LIMITS.preloaded.href);

  return (
    <ResourceListPage
      id="preloaded-resources"
      title="Preloaded Resources"
      subtitle="Resource hints on this page (preloads, module preloads, preconnects, DNS prefetches) and which ones WP Rocket added."
      definition={PRELOADED_PAGE_RESOURCES}
      rows={rows()}
      sameRow={samePreloadedRow}
      notes={notes()}
      featureLabel={WP_ROCKET_HINTS_LABEL}
      featurePresent={wpRocketHintsPresent(rows())}
      noun={HINT_NOUN}
      listLabel="Resource hints"
      searchLabel="Search hint URLs"
      searchPlaceholder="Search hint URLs…"
      estimateSize={() => PRELOADED_ROW_ESTIMATE}
      renderRow={(row) => <PreloadedRow row={row} clipped={clipped(row)} />}
      createVirtualizer={props.createVirtualizer}
      empty={
        <Show
          when={inventory() === 'not-collected'}
          fallback={
            <EmptyState
              class="self-center"
              icon={<Zap size={16} aria-hidden="true" />}
              title="No resource hints on this page"
              description="No link on this page preloads, preconnects or DNS-prefetches anything."
            />
          }
        >
          <EmptyState
            class="self-center"
            icon={<Zap size={16} aria-hidden="true" />}
            title="Hint inventory not collected"
            description="This capture carries no hint list. Reload the inspected page to list every resource hint."
          />
        </Show>
      }
    />
  );
}

/**
 * One hint: the kind chip (`rel`, plus a preload's `as` type), name and
 * copy, the attribution chip, the full URL beneath.
 *
 * @param props.row The hint row.
 * @param props.clipped Whether the capture clipped its URL.
 */
function PreloadedRow(props: { row: PreloadedResource; clipped: boolean }): JSX.Element {
  const kind = (): ReturnType<typeof hintKindChip> => hintKindChip(props.row);
  return (
    <ResourceLink
      href={props.row.href}
      copyNoun="URL"
      clipped={props.clipped}
      missingLabel={missingUrlLabel(props.row)}
      chip={
        <Badge variant="outline" class="shrink-0 font-mono">
          <span data-fdt="hint-kind">{kind().rel}</span>
          <Show when={kind().as}>{(as) => <span class="text-fg-muted"> · {as()}</span>}</Show>
        </Badge>
      }
      state={<StateChips chips={attributionChips(props.row.attribution)} />}
    />
  );
}
