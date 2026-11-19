/**
 * A resource's source-link tile for detail views: a wide tile (file icon ·
 * "Open in Sources · host" · the path, its file name always whole · ↗) plus a square
 * companion that opens the URL in a new tab.
 *
 * What renders depends on the URL and the DevTools capability:
 * - `sources`: an absolute http(s) URL with "Open in Sources" available —
 *   tile = DevTools' Sources panel, companion = new tab;
 * - `new-tab`: same URL, no capability (Firefox) — the tile itself opens a new
 *   tab and says so; no companion (it would duplicate the tile);
 * - `clipped`: the capture cut the URL at its length cap — "Clipped" badge +
 *   text, no open action (the URL is incomplete, it would open the wrong thing);
 * - `text`: anything else (relative, `data:`, `javascript:`…) — plain mono
 *   text: page-captured URLs are untrusted and only http(s) reaches an action.
 *
 * Hover tints the tile (`surface-3`, `line-3`) and turns the arrow accent —
 * never an underline or link blue: it is a tile, not inline text. Colors
 * change instantly (M-3). Every width down to the panel floor fits: the tile
 * shrinks (`min-w-0`), the host truncates, and the path keeps its file name
 * whole ({@link splitTilePath}): only the directory before it and the query
 * after it elide — the file is the tile's identity, a clamped path cut a long
 * WordPress path before it.
 */
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import FileCode from 'lucide-solid/icons/file-code';
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Badge } from '../../../../components/ui/badge';
import { FOCUS_RING } from '../../../../components/ui/classes';
import { cn } from '../../../../utils/cn';
import { capTitle } from '../../../../utils/cap-text';
import { parseHttpUrl } from '../../../../utils/urls';
import { openInSources, type OpenResource } from '../open-resource';

/** What the tile renders for one URL (see the module doc). */
export type SourceLinkView =
  | {
      readonly kind: 'sources' | 'new-tab';
      readonly href: string;
      readonly host: string;
      readonly path: string;
    }
  | { readonly kind: 'clipped' | 'text' };

/** The views that carry an action. */
type ActionView = Extract<SourceLinkView, { href: string }>;

/** The two actionable kinds. */
type ActionKind = ActionView['kind'];

/** The tile's lead label per action (the host follows after " · "). */
export const SOURCE_LINK_LABELS = {
  sources: 'Open in Sources',
  'new-tab': 'Open in new tab'
} as const;

/** The companion's accessible name and title. */
export const NEW_TAB_LABEL = 'Open in a new tab';

/**
 * Decide what the tile renders.
 *
 * @param url The captured URL.
 * @param clipped Whether the capture cut it at its length cap.
 * @param canOpenInSources Whether DevTools' "Open in Sources" is available.
 * @returns The view; actionable views carry the parsed `href` (what both
 *   actions open) and the display `host` + `path` (path + query + fragment).
 */
export function describeSourceLink(
  url: string,
  clipped: boolean,
  canOpenInSources: boolean
): SourceLinkView {
  if (clipped) return { kind: 'clipped' };
  const parsed = parseHttpUrl(url);
  if (parsed === null) return { kind: 'text' };
  return {
    kind: canOpenInSources ? 'sources' : 'new-tab',
    href: parsed.href,
    host: parsed.host,
    path: `${parsed.pathname}${parsed.search}${parsed.hash}`
  };
}

/** A tile path in its three display parts; joined, they read the shown path. */
export interface TilePath {
  /** Everything up to and including the last `/` before the file; elides at its end. */
  readonly directory: string;
  /** The last segment (a directory URL's last one keeps its `/`); never cut. */
  readonly file: string;
  /** The query + fragment (`?ver=6.4#top`); elides at its end. */
  readonly suffix: string;
}

/**
 * Longest file name shown as is: beyond it the name's middle elides (its end,
 * extension included, stays), so a pathological name cannot grow the tile
 * past a few wrapped lines.
 */
export const TILE_FILE_MAX = 80;

/** Characters of an over-long file name kept after the ellipsis (its end + extension). */
export const TILE_FILE_TAIL = 24;

/**
 * Elide an over-long file name's middle, keeping its start and its end.
 *
 * @param file The file name.
 * @returns The name, at most {@link TILE_FILE_MAX} characters.
 */
function elideFileMiddle(file: string): string {
  if (file.length <= TILE_FILE_MAX) return file;
  const head = TILE_FILE_MAX - TILE_FILE_TAIL - 1;
  return `${file.slice(0, head)}…${file.slice(-TILE_FILE_TAIL)}`;
}

/**
 * Split a tile's path (path + query + fragment, as {@link describeSourceLink}
 * gives it) for display, so the file name survives any width.
 *
 * @param path The URL's path + query + fragment (a parsed URL's: its path
 *   holds no raw `?`/`#`).
 * @returns The parts; a directory URL (`/a/b/`) names its last segment as
 *   the file (`b/`), the root names `/`.
 */
export function splitTilePath(path: string): TilePath {
  const suffixAt = path.search(/[?#]/);
  const pathname = suffixAt === -1 ? path : path.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : path.slice(suffixAt);
  // The root (or an empty path) is its own file: nothing before it.
  if (pathname.length <= 1) return { directory: '', file: pathname, suffix };
  // A trailing `/` belongs to the last segment, so search before it.
  const cut = pathname.lastIndexOf('/', pathname.length - 2);
  return {
    directory: pathname.slice(0, cut + 1),
    file: elideFileMiddle(pathname.slice(cut + 1)),
    suffix
  };
}

/** Props of {@link SourceLink}. */
export interface SourceLinkProps {
  /** The captured URL. */
  url: string;
  /** The capture cut this URL at its length cap (badge, no open action). */
  clipped?: boolean;
  /**
   * The "Open in Sources" capability — `openResourceCapability(browser)` in
   * production; null where DevTools has none (the tile opens a new tab).
   */
  openResource: OpenResource | null;
  /** Extra classes on the root, merged last. */
  class?: string;
}

/** The tiles' shared look: bordered surface, instant hover tint, arrow turns accent. */
const TILE = cn(
  'group flex min-w-0 items-center rounded-lg border border-line-2 bg-surface-2 text-fg-secondary',
  'hover:border-line-3 hover:bg-surface-3',
  FOCUS_RING
);

/** The trailing arrow / companion icon: muted, accent while its tile is hovered. */
const TILE_ICON = 'shrink-0 text-fg-muted group-hover:text-accent';

/** The mono text look of the path line and plain-text URLs. */
const MONO_TEXT = 'font-mono text-2xs text-fg-secondary';

/** Plain-text and clipped URLs: break anywhere, two lines, then clamped. */
const MONO_CLAMP = cn('line-clamp-2 break-all', MONO_TEXT);

/**
 * The tile's path: its parts as wrapping flex items, so a path that fits
 * reads as one line and a long one puts the file on its own line — the
 * directory elides at its end (one line at most), the file breaks anywhere
 * but is never cut, the suffix fills what is left of the file's line (4ch
 * floor, else its own line) and elides.
 *
 * @param props.path The URL's path + query + fragment.
 */
function TilePathLine(props: { path: string }): JSX.Element {
  const parts = (): TilePath => splitTilePath(props.path);
  return (
    <span data-fdt="source-link-path" class={cn('flex min-w-0 flex-wrap', MONO_TEXT)}>
      <Show when={parts().directory !== ''}>
        <span data-fdt="source-link-dir" class="max-w-full min-w-0 truncate">
          {parts().directory}
        </span>
      </Show>
      <span data-fdt="source-link-file" class="max-w-full break-all">
        {parts().file}
      </span>
      <Show when={parts().suffix !== ''}>
        <span data-fdt="source-link-suffix" class="min-w-[4ch] flex-1 basis-0 truncate">
          {parts().suffix}
        </span>
      </Show>
    </span>
  );
}

/**
 * The wide tile's content: icon tile, "<action> · host", the path, ↗.
 *
 * @param props.label The action ("Open in Sources").
 * @param props.host The URL's host (truncated when long).
 * @param props.path The URL's path + query + fragment (see {@link TilePathLine}).
 */
function TileBody(props: { label: string; host: string; path: string }): JSX.Element {
  return (
    <>
      <span class="grid size-7.5 shrink-0 place-items-center rounded-md bg-surface-3 text-fg-secondary">
        <FileCode size={14} aria-hidden="true" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex min-w-0 text-2xs text-fg-muted">
          <span class="shrink-0 whitespace-pre">{`${props.label} · `}</span>
          <span data-fdt="source-link-host" class="truncate font-mono">
            {props.host}
          </span>
        </span>
        <TilePathLine path={props.path} />
      </span>
      <ArrowUpRight size={14} class={TILE_ICON} aria-hidden="true" />
    </>
  );
}

/**
 * Render the source-link tile (states: see the module doc).
 *
 * @param props See {@link SourceLinkProps}.
 */
export function SourceLink(props: SourceLinkProps): JSX.Element {
  const view = (): SourceLinkView =>
    describeSourceLink(props.url, props.clipped === true, props.openResource !== null);
  // One accessor per actionable kind, so each `Match` hands its child the narrowed view.
  const linkOf = (kind: ActionKind): ActionView | undefined => {
    const current = view();
    return current.kind === kind ? current : undefined;
  };
  const tileClass = cn(TILE, 'flex-1 gap-2.5 py-2.5 pr-2.5 pl-3 text-left');
  return (
    <div data-fdt="source-link" class={cn('flex min-w-0 items-stretch gap-1.5', props.class)}>
      <Switch>
        <Match when={linkOf('sources')}>
          {(link) => (
            <>
              <button
                type="button"
                data-fdt="source-link-open"
                data-fdt-action="sources"
                class={tileClass}
                title={capTitle(link().href)}
                onClick={() => {
                  const open = props.openResource;
                  if (open !== null) void openInSources(open, link().href);
                }}
              >
                <TileBody
                  label={SOURCE_LINK_LABELS.sources}
                  host={link().host}
                  path={link().path}
                />
              </button>
              <a
                data-fdt="source-link-new-tab"
                href={link().href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={NEW_TAB_LABEL}
                title={NEW_TAB_LABEL}
                class={cn(TILE, 'w-10 shrink-0 justify-center')}
              >
                <ExternalLinkIcon size={14} class={TILE_ICON} aria-hidden="true" />
              </a>
            </>
          )}
        </Match>
        <Match when={linkOf('new-tab')}>
          {(link) => (
            <a
              data-fdt="source-link-open"
              data-fdt-action="new-tab"
              href={link().href}
              target="_blank"
              rel="noopener noreferrer"
              class={tileClass}
              title={capTitle(link().href)}
            >
              <TileBody
                label={SOURCE_LINK_LABELS['new-tab']}
                host={link().host}
                path={link().path}
              />
            </a>
          )}
        </Match>
        <Match when={view().kind === 'clipped'}>
          <span data-fdt="source-link-clipped" class="flex min-w-0 items-start gap-1.5">
            <Badge kind="warn" class="shrink-0">
              Clipped
            </Badge>
            <span class={MONO_CLAMP} title={capTitle(props.url)}>
              {props.url}
            </span>
          </span>
        </Match>
        <Match when={view().kind === 'text'}>
          <span data-fdt="source-link-text" class={MONO_CLAMP} title={capTitle(props.url)}>
            {props.url}
          </span>
        </Match>
      </Switch>
    </div>
  );
}
