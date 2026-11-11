/**
 * The Lazyload page: every `<img>` the lazyload check classified, whether
 * WP Rocket lazyloads it, and — when the feature is detected — exclusion
 * evidence for images it does not lazyload. Each row's state chip shows
 * its source (WP Rocket, a verified FDT simulation, an FDT exclusion, the
 * page's own lazy markup) under
 * one legend. Filters: all / lazyloaded / non-lazyloaded / excluded; the
 * search narrows by image URL (`src`). Layout, search wiring and states:
 * `ResourceListPage`.
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
 * trivially safe on arbitrary hosts, so rows show the URL only. Adding
 * `crossorigin="anonymous"` does not help: the same probe's request still
 * carried every cookie (with an `Origin: chrome-extension://…` header added),
 * so that variant is no way out either.
 */
import type { JSX } from 'solid-js';
import { For, Show, createMemo } from 'solid-js';
import ImageOff from 'lucide-solid/icons/image-off';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { IMAGE_NOUN } from '../../../../lib/detection/count-nouns';
import { runtimeOnPage } from '../../../../lib/detection/simulation-fact';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import {
  buildLazyloadRows,
  LAZYLOAD_PAGE_RESOURCES,
  type LazyloadImageResource
} from '../../../../lib/panel/resources-view-model';
import type { WprDetections } from '../../../../lib/wp-rocket/types';
import { useFdtData } from '../../state/use-fdt-data';
import { ResourceListPage } from '../resource-list/resource-list';
import { ResourceLink } from '../resource-list/resource-link';
import { urlClipped } from '../resource-list/resource-list-view';
import { StateChips } from '../resource-list/state-chip-list';
import { StateSourceLegend } from '../resource-list/state-source-legend';
import {
  exclusionReasons,
  LAZYLOAD_CHIP_SOURCES,
  lazyloadChipFacts,
  lazyloadChipTable,
  lazyloadNotes,
  lazyloadRowEstimate,
  lazyloadRowView,
  NO_LAZYLOAD_CHIP_FACTS,
  sameImageRowView,
  sameLazyloadChipFacts,
  showLazyloadReasons,
  type LazyloadRowView
} from './lazyload-rows';

/**
 * The summary notes for a detection, or none while no data is mounted.
 *
 * @param lazyload The detection, if loaded.
 * @returns The notes.
 */
function notesFor(lazyload: WprDetections['lazyload'] | null): string[] {
  return lazyload === null ? [] : lazyloadNotes(lazyload);
}

/** Props of {@link LazyloadPage} — test seams only; the shell passes none. */
export interface LazyloadPageProps {
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * The Lazyload route's page body.
 *
 * @param props See {@link LazyloadPageProps}.
 */
export function LazyloadPage(props: LazyloadPageProps): JSX.Element {
  const store = useFdtData();
  const lazyload = createMemo(() => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing'
      ? state.data.wprDetections.lazyload
      : null;
  });
  /** The facts deciding who produced each Lazyloaded chip — an unchanged set keeps the chip table. */
  const facts = createMemo(() => lazyloadChipFacts(lazyload()), NO_LAZYLOAD_CHIP_FACTS, {
    equals: sameLazyloadChipFacts
  });
  const chipTable = createMemo(() => lazyloadChipTable(facts()));
  /** Row views: each row's chips built once here, never in the row renderer. */
  const rows = createMemo(() => {
    const detection = lazyload();
    if (detection === null) return [];
    const table = chipTable();
    return buildLazyloadRows(detection).map((row) => lazyloadRowView(row, table));
  });
  /** A verified simulation, not WP Rocket, lazy loads the page. */
  const simulated = (): boolean => facts().simulation === 'simulated';
  /** Images are lazy loaded here, by WP Rocket or by a verified simulation. */
  const lazyloading = (): boolean => {
    const row = lazyload();
    return row !== null && runtimeOnPage(row);
  };

  return (
    <ResourceListPage
      id="lazyload"
      title="Lazyload"
      subtitle="Every image on the page and whether WP Rocket lazyloads it."
      definition={LAZYLOAD_PAGE_RESOURCES}
      rows={rows()}
      sameRow={sameImageRowView}
      notes={notesFor(lazyload())}
      featureLabel={getRealOptionName('lazyload')}
      featurePresent={lazyload()?.present ?? false}
      featureSimulated={simulated()}
      noun={IMAGE_NOUN}
      listLabel="Images"
      searchLabel="Search image URLs"
      searchPlaceholder="Search image URLs…"
      estimateSize={(row) => lazyloadRowEstimate(row, lazyloading())}
      renderRow={(row) => (
        <LazyloadRow
          row={row}
          featurePresent={lazyloading()}
          clipped={urlClipped(lazyload()?.truncated, row.src, PAYLOAD_LIMITS.images.src)}
        />
      )}
      legend={<StateSourceLegend sources={LAZYLOAD_CHIP_SOURCES} />}
      createVirtualizer={props.createVirtualizer}
      empty={
        <EmptyState
          class="self-center"
          icon={<ImageOff size={16} aria-hidden="true" />}
          title="No images on this page"
          description="The lazyload check found no img elements to classify."
        />
      }
    />
  );
}

/**
 * One image row: name, state chip, copy and the full URL; a non-lazyloaded
 * image adds its reasons on the meta line only when lazyload runs on the page.
 *
 * @param props.row The row view (its chips already built).
 * @param props.featurePresent Whether image lazyload runs on the page (WP Rocket's or a verified simulation's).
 * @param props.clipped Whether the capture clipped its URL.
 */
function LazyloadRow(props: {
  row: LazyloadRowView;
  featurePresent: boolean;
  clipped: boolean;
}): JSX.Element {
  return (
    <ResourceLink
      href={props.row.src}
      copyNoun="Image URL"
      clipped={props.clipped}
      state={
        props.row.chips.visible.length > 0 ? (
          <span class="flex flex-wrap items-center gap-1">
            <StateChips chips={props.row.chips} />
          </span>
        ) : undefined
      }
    >
      <Show when={showLazyloadReasons(props.row, props.featurePresent)}>
        <ReasonsLine row={props.row} />
      </Show>
    </ResourceLink>
  );
}

/**
 * A non-lazyloaded image's page reasons (meta-line items, laid out by the
 * row) as mono outline badges, wrapping; none → a muted "No reasons found".
 * The tool's own marker is the row's Excluded chip, never a reason here.
 *
 * @param props.row The image row.
 */
function ReasonsLine(props: { row: LazyloadImageResource }): JSX.Element {
  const reasons = (): readonly string[] => exclusionReasons(props.row).reasons;
  return (
    <span data-fdt="lazyload-reasons" class="contents">
      <Show
        when={reasons().length > 0}
        fallback={<span class="text-2xs text-fg-muted">No reasons found</span>}
      >
        <span class="text-2xs text-fg-muted">Reasons</span>
        <For each={reasons()}>
          {(reason) => (
            <Badge variant="outline" class="font-mono break-all">
              {reason}
            </Badge>
          )}
        </For>
      </Show>
    </span>
  );
}
