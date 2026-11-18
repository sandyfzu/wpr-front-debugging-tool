/**
 * A resource's source-link tile for detail views: a wide tile (file icon ·
 * "Open in Sources · host" · the path, clamped to two lines · ↗) plus a square
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
 * shrinks (`min-w-0`), the host truncates, the path breaks at any
 * character (`break-all`: a URL fills both lines instead of leaving its first
 * hyphen-broken segment alone on line 1) and clamps.
 */
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import FileCode from 'lucide-solid/icons/file-code';
import type { JSX } from 'solid-js';
import { Match, Switch } from 'solid-js';
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

/** The clamped mono text both the path line and plain-text URLs use. */
const MONO_CLAMP = 'line-clamp-2 font-mono text-2xs break-all text-fg-secondary';

/**
 * The wide tile's content: icon tile, "<action> · host", the clamped path, ↗.
 *
 * @param props.label The action ("Open in Sources").
 * @param props.host The URL's host (truncated when long).
 * @param props.path The URL's path + query + fragment (two lines, then clamped).
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
        <span data-fdt="source-link-path" class={MONO_CLAMP}>
          {props.path}
        </span>
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
