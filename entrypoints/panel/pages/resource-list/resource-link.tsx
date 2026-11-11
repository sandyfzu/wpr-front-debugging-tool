/**
 * A resource row's identity block: the resource's name (with the row's chip,
 * state and copy control), the full URL beneath it (a muted external link —
 * or plain text with a "Clipped" badge when the capture cut it at its length
 * cap), and the row's meta line. A row without a URL says so (the caller
 * names why) and keeps the copy column, so badges stay aligned.
 *
 * One DOM, two arrangements (a grid whose areas change with the page's
 * container tier — compact rows stack their state under the name so the name
 * keeps the line's width):
 * - compact: `chip · name · copy` / `url` / `state · meta` — the name keeps
 *   the line's width, the state stacks onto the meta line;
 * - regular and up: `chip · name · state · copy` / `url` / `meta`.
 *
 * DOM order is name → state → meta → copy → link, so a screen reader hears
 * what the resource is and its state before its controls, and the tab order
 * (copy, then link) still follows the visual top-to-bottom order.
 */
import type { JSX } from 'solid-js';
import { children, Show } from 'solid-js';
import { Badge } from '../../../../components/ui/badge';
import { CopyButton } from '../../../../components/ui/copy-button';
import { cn } from '../../../../utils/cn';
import { capText, capTitle } from '../../../../utils/cap-text';
import { ExternalLink } from '../page-frame';
import { LABEL_NAME_MAX, resourceName } from './resource-list-view';

/** Props of {@link ResourceLink}. */
export interface ResourceLinkProps {
  /** The captured URL (`''` when the element had none). */
  href: string;
  /**
   * What the URL is, for the copy control ("Image URL"): its accessible name
   * and toast read "<noun> (<name>)", so each row's control is distinct.
   */
  copyNoun: string;
  /** The capture cut this URL at its length cap: shown as text, flagged, copied with a warning. */
  clipped?: boolean;
  /** What a row without a URL says (default "No URL captured"). */
  missingLabel?: string;
  /** A chip before the name (e.g. the `as` type). */
  chip?: JSX.Element;
  /** The row's state badge (beside the name from the regular tier, on the meta line below it). */
  state?: JSX.Element;
  /** The meta line's content (e.g. exclusion reasons), wrapping. */
  children?: JSX.Element;
  /**
   * `false` names the copy control by {@link ResourceLinkProps.copyNoun}
   * alone ("Script URL — copy", toast "Script URL copied") instead of the
   * per-row "<noun> (<name>)" — for a list whose copy name is already
   * established (default `true`).
   */
  copyNamesRow?: boolean;
  /** Resolve the complete text on copy (the shown URL may be a bounded capture). */
  loadCopyText?: (signal: AbortSignal) => Promise<string>;
  /** The remedy toasted when {@link ResourceLinkProps.loadCopyText} fails. */
  copyLoadFailure?: string;
}

/**
 * The copy control's name for one row: distinct per row (screen-reader
 * control lists and toasts name the resource), and a clipped URL says so in
 * both, since what lands on the clipboard is not the page's full URL.
 *
 * @param noun What the URL is ("Image URL").
 * @param name The resource's display name (capped at {@link LABEL_NAME_MAX} code points).
 * @param clipped Whether the URL was cut at its cap.
 * @returns The copy label.
 */
export function copyLabel(noun: string, name: string, clipped: boolean): string {
  // A clipped URL's name can run to thousands of characters: a control name
  // that long is unusable in a screen reader's controls list and a toast.
  const shown = capText(name, LABEL_NAME_MAX);
  return clipped ? `${noun} (${shown}, clipped)` : `${noun} (${shown})`;
}

/** The URL line's muted look: accent only on hover/focus, so names lead the row. */
const URL_LINE = 'mt-0.5 justify-self-start text-2xs [grid-area:url]';

/**
 * Grid templates by which optional slots the row has (`chip` × `state`) —
 * literal class strings (the stylesheet is generated from the source text),
 * so an absent slot never leaves an empty track plus its gap. The state
 * track is `fit-content(50%)`: an `auto` track grows to its chips' full
 * width before the name's `1fr` gets any, so a row with many chips would
 * squeeze the name to nothing; capped, the chips wrap and the name keeps
 * at least half the line.
 */
const GRID_TEMPLATES = {
  none: 'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_copy"_"url_url"_"meta_meta"]',
  chip: 'grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"chip_name_copy"_"url_url_url"_"meta_meta_meta"]',
  state:
    'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_copy"_"url_url"_"meta_meta"] @regular:grid-cols-[minmax(0,1fr)_fit-content(50%)_auto] @regular:[grid-template-areas:"name_state_copy"_"url_url_url"_"meta_meta_meta"]',
  both: 'grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"chip_name_copy"_"url_url_url"_"meta_meta_meta"] @regular:grid-cols-[auto_minmax(0,1fr)_fit-content(50%)_auto] @regular:[grid-template-areas:"chip_name_state_copy"_"url_url_url_url"_"meta_meta_meta_meta"]'
} as const;

/** Which optional slots a row fills. */
type GridTemplate = keyof typeof GRID_TEMPLATES;

/**
 * Pick the grid template for a row's filled slots.
 *
 * @param hasChip Whether the row has a leading chip.
 * @param hasState Whether the row has a state badge.
 * @returns The template key.
 */
export function gridTemplate(hasChip: boolean, hasState: boolean): GridTemplate {
  if (hasChip) return hasState ? 'both' : 'chip';
  return hasState ? 'state' : 'none';
}

/**
 * Render the identity block. The name truncates (its capped `title` carries
 * it); the URL line truncates too (the link's own `title` carries the URL);
 * the copy control is always visible — never hover-revealed — and keeps its
 * 24 px hit area.
 *
 * @param props See {@link ResourceLinkProps}.
 */
export function ResourceLink(props: ResourceLinkProps): JSX.Element {
  const name = (): string => resourceName(props.href);
  // Slots resolve once: reading a JSX prop again would build a second copy.
  const chip = children(() => props.chip);
  const state = children(() => props.state);
  const meta = children(() => props.children);
  const hasChip = (): boolean => chip.toArray().length > 0;
  const hasState = (): boolean => state.toArray().length > 0;
  return (
    <div
      data-fdt="resource-link"
      class={cn(
        // Vertical spacing rides margins, not a row gap: an empty meta row
        // then costs nothing (a gap would still separate the empty track).
        'grid items-center gap-x-2',
        GRID_TEMPLATES[gridTemplate(hasChip(), hasState())]
      )}
    >
      <Show when={hasChip()}>
        <span class="flex [grid-area:chip]">{chip()}</span>
      </Show>
      <Show
        when={name() !== ''}
        fallback={
          <span class="text-xs text-fg-muted [grid-area:name]">
            {props.missingLabel ?? 'No URL captured'}
          </span>
        }
      >
        <span
          data-fdt="resource-name"
          class="truncate font-mono text-xs font-medium text-fg-primary [grid-area:name]"
          title={capTitle(name())}
        >
          {name()}
        </span>
      </Show>
      <div
        data-fdt="resource-meta"
        class="mt-1 flex flex-wrap items-center gap-1 [grid-area:meta] empty:hidden @regular:contents"
      >
        <Show when={hasState()}>
          <span class="inline-flex @regular:[grid-area:state]">{state()}</span>
        </Show>
        <Show when={meta.toArray().length > 0}>
          <div class="contents @regular:mt-1 @regular:flex @regular:flex-wrap @regular:items-center @regular:gap-1 @regular:[grid-area:meta]">
            {meta()}
          </div>
        </Show>
      </div>
      <Show
        when={name() !== ''}
        fallback={
          // Holds the copy column so the state badge lines up with its neighbours'.
          <span data-fdt="resource-copy-placeholder" class="size-6 [grid-area:copy]" />
        }
      >
        <CopyButton
          text={props.href}
          loadText={props.loadCopyText}
          sourceFailureDescription={props.copyLoadFailure}
          label={
            props.copyNamesRow === false
              ? props.copyNoun
              : copyLabel(props.copyNoun, name(), props.clipped === true)
          }
          showLabel={false}
          class="justify-self-end [grid-area:copy]"
        />
        <Show
          when={props.clipped === true}
          fallback={
            <ExternalLink
              href={props.href}
              class={cn(URL_LINE, 'text-fg-secondary hover:text-accent focus-visible:text-accent')}
            />
          }
        >
          <span
            data-fdt="resource-url-clipped"
            class={cn(URL_LINE, 'flex max-w-full min-w-0 items-center gap-1')}
          >
            <Badge kind="warn" class="shrink-0">
              Clipped
            </Badge>
            <span class="truncate font-mono text-fg-secondary" title={capTitle(props.href)}>
              {props.href}
            </span>
          </span>
        </Show>
      </Show>
    </div>
  );
}
