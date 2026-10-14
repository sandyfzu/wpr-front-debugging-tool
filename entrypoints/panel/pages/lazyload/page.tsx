/**
 * The Lazyload page: every `<img>` the lazyload check classified, whether
 * WP Rocket lazyloads it, and — when it does not — the reasons found on the
 * element. Chips: all / lazyloaded / non-lazyloaded; the search narrows by
 * image URL (`src`). Layout, search wiring and states: `ResourceListPage`.
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
 * trivially safe on arbitrary hosts, so rows show the URL only.
 */
import type { JSX } from 'solid-js';
import { For, Show, createMemo } from 'solid-js';
import ImageOff from 'lucide-solid/icons/image-off';
import { Badge } from '../../../../components/ui/badge';
import { EmptyState } from '../../../../components/ui/empty-state';
import { StatusBadge } from '../../../../components/ui/status-badge';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { getRealOptionName } from '../../../../lib/options-map/get-real-option-name';
import {
  buildLazyloadRows,
  LAZYLOAD_PAGE_RESOURCES,
  type LazyloadImageResource
} from '../../../../lib/panel/resources-view-model';
import { useFdtData } from '../../state/use-fdt-data';
import { ResourceListPage } from '../resource-list/resource-list';
import { ResourceLink } from '../resource-list/resource-link';
import { exclusionReasons, lazyloadRowEstimate, lazyloadStateBadge } from './lazyload-rows';

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
  const rows = createMemo(() => {
    const detection = lazyload();
    return detection === null ? [] : buildLazyloadRows(detection);
  });

  return (
    <ResourceListPage
      id="lazyload"
      title="Lazyload"
      subtitle="Every image on the page and whether WP Rocket lazyloads it."
      definition={LAZYLOAD_PAGE_RESOURCES}
      rows={rows()}
      featureLabel={getRealOptionName('lazyload')}
      featurePresent={lazyload()?.present ?? false}
      noun={{ one: 'image', other: 'images' }}
      listLabel="Images"
      searchLabel="Search image URLs"
      searchPlaceholder="Search image URLs…"
      estimateSize={lazyloadRowEstimate}
      renderRow={(row) => <LazyloadRow row={row} />}
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
 * One image row: name, state badge, copy and the full URL; a non-lazyloaded
 * image adds its reasons on the meta line.
 *
 * @param props.row The image row.
 */
function LazyloadRow(props: { row: LazyloadImageResource }): JSX.Element {
  const state = (): ReturnType<typeof lazyloadStateBadge> => lazyloadStateBadge(props.row);
  return (
    <ResourceLink
      href={props.row.src}
      copyLabel="Image URL"
      state={
        <StatusBadge kind={state().kind} class="shrink-0">
          {state().label}
        </StatusBadge>
      }
    >
      {props.row.lazyloaded ? undefined : <ReasonsLine row={props.row} />}
    </ResourceLink>
  );
}

/**
 * A non-lazyloaded image's reasons (meta-line items, laid out by the row):
 * the tool's own exclusion marker as a distinct warn badge (text and color both differ), then the page's reasons
 * as mono outline badges, wrapping; none → a muted "No reasons found".
 *
 * @param props.row The image row.
 */
function ReasonsLine(props: { row: LazyloadImageResource }): JSX.Element {
  const split = (): ReturnType<typeof exclusionReasons> => exclusionReasons(props.row);
  return (
    <span data-fdt="lazyload-reasons" class="contents">
      <Show
        when={split().excludedByTool || split().reasons.length > 0}
        fallback={<span class="text-2xs text-fg-muted">No reasons found</span>}
      >
        <span class="text-2xs text-fg-muted">Reasons</span>
        <Show when={split().excludedByTool}>
          <Badge kind="warn" class="font-medium">
            Excluded by FDT
          </Badge>
        </Show>
        <For each={split().reasons}>
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
