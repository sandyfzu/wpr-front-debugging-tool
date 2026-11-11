/**
 * One row of the Stylesheets page, laid out like a JavaScript page row (text
 * names every state; color only reinforces it) —
 * - a link: the shared resource identity — file name and copy, the full
 *   URL beneath (opens in a new tab), the type and state chips beside the
 *   name from the regular tier and on their own line when compact;
 * - an inline style: its `#id.class` and size beside the chips, then a
 *   one-line preview of its CSS;
 * - the snapshot-only critical row: the note that WP Rocket removed it (the
 *   snapshot carries no CSS).
 * Rows are virtual and hold no state. Page values (ids, media, URLs) break
 * or truncate rather than push the row sideways.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Badge } from '../../../../components/ui/badge';
import { countLabel } from '../../../../utils/format-count';
import { ResourceLink } from '../resource-list/resource-link';
import { StateChips } from '../resource-list/state-chip-list';
import { CRITICAL_SNAPSHOT_NOTE, CRITICAL_SNAPSHOT_TITLE, type StyleRowView } from './style-view';

/** A page value shown in mono that may break anywhere (ids and media can be long). */
const PAGE_VALUE = 'min-w-0 font-mono text-2xs break-all';

/**
 * The type chip: what the row is ("Inline" / "External"), leading every row.
 *
 * @param props.view The row.
 */
function TypeChip(props: { view: StyleRowView }): JSX.Element {
  return (
    <Badge variant="outline" class="font-medium whitespace-nowrap">
      {props.view.type === 'inline' ? 'Inline' : 'External'}
    </Badge>
  );
}

/**
 * The element's media ("media: print"), when it says anything.
 *
 * @param props.view The row.
 */
function MediaDetail(props: { view: StyleRowView }): JSX.Element {
  return (
    <Show when={props.view.mediaDetail}>
      {(detail) => (
        <span data-fdt="style-media" class={`${PAGE_VALUE} text-fg-muted`}>
          {detail()}
        </span>
      )}
    </Show>
  );
}

/**
 * The chips line of a row without a URL (inline, snapshot): type, states,
 * an inline style's `#id.class`, then the media — bare items for the
 * caller's wrapping line.
 *
 * @param props.view The row.
 */
function RowChips(props: { view: StyleRowView }): JSX.Element {
  return (
    <>
      <TypeChip view={props.view} />
      <StateChips chips={props.view.chips} />
      <Show when={props.view.type === 'inline' && props.view.identity}>
        {(identity) => (
          <span data-fdt="style-identity" class={`${PAGE_VALUE} text-fg-primary`}>
            {identity()}
          </span>
        )}
      </Show>
      <MediaDetail view={props.view} />
    </>
  );
}

/**
 * Render one row's content (the list wraps it in its `listitem`).
 *
 * @param props.view The row.
 */
export function StyleRow(props: { view: StyleRowView }): JSX.Element {
  return (
    <div
      data-fdt="style-row"
      data-fdt-style-type={props.view.type}
      data-fdt-style-source={props.view.source}
      class="flex min-w-0 flex-col gap-1"
    >
      <Switch>
        <Match when={props.view.type === 'external'}>
          <ResourceLink
            href={props.view.href}
            copyNoun="Stylesheet URL"
            copyNamesRow={false}
            missingLabel="No stylesheet address"
            state={
              <span class="flex min-w-0 flex-wrap items-center gap-1">
                <TypeChip view={props.view} />
                <StateChips chips={props.view.chips} />
                <MediaDetail view={props.view} />
              </span>
            }
          />
        </Match>
        <Match when={props.view.source === 'snapshot'}>
          <div class="flex flex-wrap items-center gap-1">
            <RowChips view={props.view} />
          </div>
          <p
            data-fdt="style-snapshot-note"
            title={CRITICAL_SNAPSHOT_TITLE}
            class="text-2xs text-fg-secondary"
          >
            {CRITICAL_SNAPSHOT_NOTE}
          </p>
        </Match>
        <Match when={props.view.type === 'inline'}>
          <div class="flex flex-wrap items-center gap-1">
            <RowChips view={props.view} />
            <span class="ms-auto ps-1 text-2xs whitespace-nowrap text-fg-muted tabular-nums">
              {countLabel(props.view.chars, { one: 'character', other: 'characters' })}
            </span>
          </div>
          <p
            data-fdt="style-preview"
            class="min-w-0 truncate font-mono text-2xs text-fg-secondary"
            title={props.view.preview === '' ? undefined : props.view.preview}
          >
            {props.view.preview === '' ? 'Empty' : props.view.preview}
          </p>
        </Match>
      </Switch>
    </div>
  );
}
