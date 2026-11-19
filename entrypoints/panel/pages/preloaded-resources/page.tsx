/**
 * The Preloaded Resources page: the page's resource hints — preloads (by
 * `as` type), module preloads, preconnects and DNS prefetches — WP Rocket's
 * first (stamped, the feature named only where the page proves it), then
 * the unattributed rest, as one calm list (icon by what the hint fetches,
 * name, kind + URL preview, the attribution chip) filtered by combinable
 * facets (Source × Hint × Preload type) and the search (URL), each row
 * opening its detail (side pane from the split width, drill-in below it).
 *
 * State matrix (the shell owns loading, fetch errors and crashes; this body
 * renders on `ready`/`refreshing`): **empty** — no hint, or a capture
 * without a hint list (`preloadedInventory`), each a compact empty state;
 * **filtered-empty** (`NoMatches` with Clear filters / Clear search);
 * **populated** (the list and the selected row's detail). A soft refresh
 * keeps the facets, the query and the selection (rows are keyed by kind,
 * type, URL + occurrence, never position).
 */
import type { LucideIcon } from 'lucide-solid';
import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import File from 'lucide-solid/icons/file';
import FileCode from 'lucide-solid/icons/file-code';
import Globe from 'lucide-solid/icons/globe';
import ImageIcon from 'lucide-solid/icons/image';
import Palette from 'lucide-solid/icons/palette';
import Type from 'lucide-solid/icons/type';
import Zap from 'lucide-solid/icons/zap';
import { EmptyState } from '../../../../components/ui/empty-state';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { HINT_NOUN } from '../../../../lib/detection/count-nouns';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { countLabel } from '../../../../lib/panel/list-behavior';
import {
  buildPreloadedRows,
  reportHintsTruncated,
  type PreloadedResource
} from '../../../../lib/panel/resources-view-model';
import type { PreloadedResources, WprDetections } from '../../../../lib/wp-rocket/types';
import { useFdtData } from '../../state/use-fdt-data';
import { openResourceCapability, type OpenResource } from '../open-resource';
import { PageFrame } from '../page-frame';
import { CalmFilteredList } from '../resource-list/calm-list';
import {
  calmRowEstimate,
  ListRow,
  ListRowHead,
  type ListRowColumns
} from '../resource-list/list-row';
import type { DetailCopy } from '../resource-list/master-detail';
import { urlClipped } from '../resource-list/resource-list-view';
import { ResourceSummary } from '../resource-list/resource-summary';
import { AttributionBadge, PreloadedDetail } from './preloaded-detail';
import {
  hintKind,
  preloadedInventory,
  preloadedNotes,
  preloadedRowViews,
  preloadedSearchField,
  PRELOADED_VIEW_FACETS,
  samePreloadedView,
  WP_ROCKET_HINTS_LABEL,
  wpRocketHintsPresent,
  type HintIconId,
  type PreloadedRowView
} from './preloaded-view';

/** The list's optional columns (rows and head share them): the attribution, no size. */
const COLUMNS: ListRowColumns = { size: false, states: true };

/** Each row icon's component (one table: adding a type is one row). */
const HINT_ICONS: Readonly<Record<HintIconId, LucideIcon>> = {
  image: ImageIcon,
  font: Type,
  style: Palette,
  script: FileCode,
  origin: Globe,
  file: File
};

/** The page's title and one-line intro. */
export const PRELOADED_TITLE = 'Preloaded Resources';
export const PRELOADED_SUBTITLE =
  'Resource hints on this page (preloads, module preloads, preconnects, DNS prefetches) and which ones WP Rocket added.';

/** Props of {@link PreloadedResourcesPage} — test seams only; the shell passes none. */
export interface PreloadedResourcesPageProps {
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
  /** "Open in Sources" seam (`null`: none); production detects DevTools' own. */
  openResource?: OpenResource | null;
}

/** What the page reads from a mounted payload. */
interface PageInput {
  readonly report: PreloadedResources;
  readonly detections: WprDetections;
}

/** The report the page reads while no data is mounted (never rendered in practice). */
const NO_REPORT: PreloadedResources = { present: false };

/**
 * The detail header's copy: the hinted URL (none without one).
 *
 * @param view The row.
 */
function detailCopy(view: PreloadedRowView): DetailCopy | undefined {
  return view.row.href === '' ? undefined : { text: view.row.href, label: 'Hint URL' };
}

/**
 * The Preloaded Resources route's page body. One memo chain: the report +
 * detections → attributed rows → row views; the list reconciles them by key.
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
  const views = createMemo((): readonly PreloadedRowView[] => {
    // Each list carries its own cut mark (the hints, or a preload-only capture's).
    const truncated = reportHintsTruncated(report());
    return preloadedRowViews(rows(), (href) =>
      urlClipped(truncated, href, PAYLOAD_LIMITS.preloaded.href)
    );
  });
  const notes = createMemo((): string[] => {
    const current = input();
    return current === null ? [] : preloadedNotes(current.report, rows(), current.detections);
  });
  const inventory = createMemo(() => preloadedInventory(report()));
  const openResource =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the seam is fixed per page
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;

  return (
    <PageFrame id="preloaded-resources" title={PRELOADED_TITLE} subtitle={PRELOADED_SUBTITLE} fill>
      <ResourceSummary
        featureLabel={WP_ROCKET_HINTS_LABEL}
        featurePresent={wpRocketHintsPresent(rows())}
        total={views().length > 0 ? countLabel(views().length, HINT_NOUN) : undefined}
        notes={notes()}
      />
      <CalmFilteredList
        variant="calm"
        rows={views()}
        rowKey={(view) => view.key}
        sameRow={samePreloadedView}
        facets={PRELOADED_VIEW_FACETS}
        searchField={preloadedSearchField}
        noun={HINT_NOUN}
        listLabel="Resource hints"
        searchLabel="Search hint URLs"
        searchPlaceholder="Search hint URLs…"
        rowHook="hint-row"
        empty={
          <Show
            when={inventory() === 'not-collected'}
            fallback={
              <EmptyState
                icon={<Zap size={16} aria-hidden="true" />}
                title="No resource hints on this page"
                description="No link on this page preloads, preconnects or DNS-prefetches anything."
              />
            }
          >
            <EmptyState
              icon={<Zap size={16} aria-hidden="true" />}
              title="Hint inventory not collected"
              description="This capture carries no hint list. Reload the inspected page to list every resource hint."
            />
          </Show>
        }
        head={<ListRowHead columns={COLUMNS} icon name="Hint" states="Source" />}
        // Every row carries its attribution chip: a compact row stacks it on a third line.
        estimateSize={(_view, compact) => calmRowEstimate('two', compact, true)}
        renderRow={(view) => (
          <ListRow
            columns={COLUMNS}
            icon={HINT_ICONS[view.icon]}
            name={view.name}
            preview={view.preview}
            clipped={view.clipped}
            stateContent={<AttributionBadge chip={view.attribution} />}
          />
        )}
        detail={{
          kind: hintKind,
          title: (view) => view.name,
          copy: detailCopy,
          body: (view) => <PreloadedDetail view={view} openResource={openResource} />,
          backLabel: 'Hints'
        }}
        createVirtualizer={props.createVirtualizer}
      />
    </PageFrame>
  );
}
