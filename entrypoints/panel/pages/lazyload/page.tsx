/**
 * The Lazyload page: every `<img>` the lazyload check classified as one calm
 * list (file name, URL preview, two state chips + "+N"), filtered by
 * combinable facets (Lazyload × Excluded) and the search (image URL), each
 * row opening its detail (side pane from the split width, drill-in below
 * it): the URL's source-link tile, whether the image is lazyloaded and —
 * while lazyload runs on the page — the page's own exclusion reasons. Each
 * chip shows its source (WP Rocket, a verified FDT simulation, an FDT
 * exclusion, the page's own lazy markup) under one legend.
 *
 * State matrix (the shell owns loading, fetch errors and crashes; this body
 * renders on `ready`/`refreshing`): **empty** (no images: a compact empty
 * state), **filtered-empty** (`NoMatches` with Clear filters / Clear
 * search), **populated** (the list and the selected row's detail). A soft
 * refresh keeps the facets, the query and the selection (rows are keyed by
 * URL + occurrence, never position).
 *
 * **Thumbnails: not shipped (decided 2026-10-14, verified on the built
 * extension).** The ship criteria were: remote `img-src` allowed by the
 * extension-page CSP; `loading="lazy" decoding="async"
 * referrerpolicy="no-referrer"`, `http(s):`/`data:` sources only; a fixed
 * box with an error fallback; only rendered virtual rows loading. The
 * technical half holds — the built manifest declares no
 * `content_security_policy`, so the default extension-page policy
 * (`script-src`/`object-src` only) leaves `img-src` open, and the no-referrer
 * policy drops the `Referer` header. The deciding half fails: a probe from
 * the built panel page showed an `<img>` request to a host-permitted origin
 * carrying **every** cookie of that origin — `SameSite=Lax` and `Strict`
 * included — with `Sec-Fetch-Site: none`, i.e. treated as a first-party,
 * user-initiated load (the extension holds `http(s)://*` host permissions).
 * Thumbnails would therefore send the user's full session (a logged-in
 * WordPress admin's auth cookies) on every row's request, outside the
 * inspected page's own Network panel, and would fetch the very images the
 * page deliberately defers — server and CDN side effects (on-the-fly image
 * conversion, cache warming, logs) on the site under investigation. Not
 * trivially safe on arbitrary hosts, so rows and the detail show the URL only. Adding
 * `crossorigin="anonymous"` does not help: the same probe's request still
 * carried every cookie (with an `Origin: chrome-extension://…` header added),
 * so that variant is no way out either.
 */
import type { JSX } from 'solid-js';
import { createMemo } from 'solid-js';
import ImageIcon from 'lucide-solid/icons/image';
import ImageOff from 'lucide-solid/icons/image-off';
import { EmptyState } from '../../../../components/ui/empty-state';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { IMAGE_NOUN } from '../../../../lib/detection/count-nouns';
import { SHORT_LABEL_LAZYLOAD } from '../../../../lib/detection/labels';
import { runtimeOnPage } from '../../../../lib/detection/simulation-fact';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import { countLabel } from '../../../../lib/panel/list-behavior';
import { buildLazyloadRows } from '../../../../lib/panel/resources-view-model';
import type { WprDetections } from '../../../../lib/wp-rocket/types';
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
import { StateSourceLegend } from '../resource-list/state-source-legend';
import { LazyloadDetail } from './lazyload-detail';
import {
  IMAGE_KIND,
  LAZYLOAD_CHIP_SOURCES,
  LAZYLOAD_VIEW_FACETS,
  lazyloadChipFacts,
  lazyloadChipTable,
  lazyloadNotes,
  lazyloadRowViews,
  lazyloadSearchField,
  NO_LAZYLOAD_CHIP_FACTS,
  sameImageRowView,
  sameLazyloadChipFacts,
  type LazyloadRowView
} from './lazyload-rows';

/** The list's optional columns (rows and head share them): states only, images carry no size. */
const COLUMNS: ListRowColumns = { size: false, states: true };

/** The page's title and one-line intro. */
export const LAZYLOAD_TITLE = SHORT_LABEL_LAZYLOAD;
export const LAZYLOAD_SUBTITLE = 'Every image on the page and whether WP Rocket lazy loads it.';

/** Props of {@link LazyloadPage} — test seams only; the shell passes none. */
export interface LazyloadPageProps {
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
  /** "Open in Sources" seam (`null`: none); production detects DevTools' own. */
  openResource?: OpenResource | null;
}

/**
 * The detail header's copy: the image URL (none without one).
 *
 * @param view The row.
 */
function detailCopy(view: LazyloadRowView): DetailCopy | undefined {
  return view.row.src === '' ? undefined : { text: view.row.src, label: 'Image URL' };
}

/**
 * The Lazyload route's page body. One memo chain: the detection → its chip
 * facts (an unchanged set keeps the chip table) → row views; the list
 * reconciles them by key.
 *
 * @param props See {@link LazyloadPageProps}.
 */
export function LazyloadPage(props: LazyloadPageProps): JSX.Element {
  const store = useFdtData();
  const lazyload = createMemo((): WprDetections['lazyload'] | null => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing'
      ? state.data.wprDetections.lazyload
      : null;
  });
  /** The facts deciding who produced each Lazy loaded chip — an unchanged set keeps the chip table. */
  const facts = createMemo(() => lazyloadChipFacts(lazyload()), NO_LAZYLOAD_CHIP_FACTS, {
    equals: sameLazyloadChipFacts
  });
  const chipTable = createMemo(() => lazyloadChipTable(facts()));
  const views = createMemo((): readonly LazyloadRowView[] => {
    const detection = lazyload();
    if (detection === null) return [];
    return lazyloadRowViews(buildLazyloadRows(detection), chipTable(), (src) =>
      urlClipped(detection.truncated, src, PAYLOAD_LIMITS.images.src)
    );
  });
  const notes = createMemo(() => {
    const detection = lazyload();
    return detection === null ? [] : lazyloadNotes(detection);
  });
  /** Images are lazy loaded here, by WP Rocket or by a verified simulation. */
  const running = (): boolean => {
    const detection = lazyload();
    return detection !== null && runtimeOnPage(detection);
  };
  const openResource =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the seam is fixed per page
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;

  return (
    <PageFrame id="lazyload" title={LAZYLOAD_TITLE} subtitle={LAZYLOAD_SUBTITLE} fill>
      <ResourceSummary
        featureLabel={getRealOptionName('lazyload')}
        featurePresent={lazyload()?.present ?? false}
        featureSimulated={facts().simulation === 'simulated'}
        total={views().length > 0 ? countLabel(views().length, IMAGE_NOUN) : undefined}
        notes={notes()}
      />
      <CalmFilteredList
        rows={views()}
        rowKey={(view) => view.key}
        sameRow={sameImageRowView}
        facets={LAZYLOAD_VIEW_FACETS}
        searchField={lazyloadSearchField}
        noun={IMAGE_NOUN}
        listLabel="Images"
        searchLabel="Search image URLs"
        searchPlaceholder="Search image URLs…"
        rowHook="lazyload-row"
        empty={
          <EmptyState
            icon={<ImageOff size={16} aria-hidden="true" />}
            title="No images on this page"
            description="The lazyload check found no img elements to classify."
          />
        }
        head={<ListRowHead columns={COLUMNS} icon name="Image" states="WP Rocket" />}
        legend={<StateSourceLegend sources={LAZYLOAD_CHIP_SOURCES} />}
        estimateSize={(view, compact) => calmRowEstimate('two', compact, view.chips.length > 0)}
        renderRow={(view) => (
          <ListRow
            columns={COLUMNS}
            icon={ImageIcon}
            name={view.name}
            preview={view.preview}
            clipped={view.clipped}
            chips={view.rowChips}
          />
        )}
        detail={{
          kind: () => IMAGE_KIND,
          title: (view) => view.name,
          copy: detailCopy,
          body: (view) => (
            <LazyloadDetail view={view} running={running} openResource={openResource} />
          ),
          backLabel: 'Images'
        }}
        createVirtualizer={props.createVirtualizer}
      />
    </PageFrame>
  );
}
