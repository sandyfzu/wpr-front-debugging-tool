/**
 * A resource row's identity block: the resource's name (with the row's chip,
 * state and copy control), the full URL as an external link beneath it, and
 * the row's meta line — or an honest "No URL captured" when the capture
 * carried none (an `<img>` without `src`, a `srcset`-only preload hint).
 *
 * One DOM, two arrangements (a grid whose areas change with the page's
 * container tier, UI/UX bar L-3):
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
import { CopyButton } from '../../../../components/ui/copy-button';
import { cn } from '../../../../utils/cn';
import { ExternalLink } from '../page-frame';
import { resourceName } from './resource-list-view';

/** Props of {@link ResourceLink}. */
export interface ResourceLinkProps {
  /** The captured URL (`''` when the element had none). */
  href: string;
  /** What the copy control names ("Image URL") — its toast and accessible name. */
  copyLabel: string;
  /** A chip before the name (e.g. the `as` type). */
  chip?: JSX.Element;
  /** The row's state badge (beside the name from the regular tier, on the meta line below it). */
  state?: JSX.Element;
  /** The meta line's content (e.g. exclusion reasons), wrapping. */
  children?: JSX.Element;
}

/**
 * Grid templates by which optional slots the row has (`chip` × `state`) —
 * literal class strings (the stylesheet is generated from the source text),
 * so an absent slot never leaves an empty track plus its gap.
 */
const GRID_TEMPLATES = {
  none: 'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_copy"_"url_url"_"meta_meta"]',
  chip: 'grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"chip_name_copy"_"url_url_url"_"meta_meta_meta"]',
  state:
    'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_copy"_"url_url"_"meta_meta"] @regular:grid-cols-[minmax(0,1fr)_auto_auto] @regular:[grid-template-areas:"name_state_copy"_"url_url_url"_"meta_meta_meta"]',
  both: 'grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"chip_name_copy"_"url_url_url"_"meta_meta_meta"] @regular:grid-cols-[auto_minmax(0,1fr)_auto_auto] @regular:[grid-template-areas:"chip_name_state_copy"_"url_url_url_url"_"meta_meta_meta_meta"]'
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
 * Render the identity block. The name truncates (its `title` carries it in
 * full); the URL line truncates too (the link's own `title` carries the full
 * URL); the copy control is always visible — never hover-revealed — and keeps
 * its 24 px hit area.
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
        fallback={<span class="text-xs text-fg-muted [grid-area:name]">No URL captured</span>}
      >
        <span
          data-fdt="resource-name"
          class="truncate font-mono text-xs font-medium text-fg-primary [grid-area:name]"
          title={name()}
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
      <Show when={name() !== ''}>
        <CopyButton
          text={props.href}
          label={props.copyLabel}
          showLabel={false}
          class="justify-self-end [grid-area:copy]"
        />
        <ExternalLink
          href={props.href}
          class="mt-0.5 justify-self-start text-2xs [grid-area:url]"
        />
      </Show>
    </div>
  );
}
