/**
 * One row of the Stylesheets page, laid out like a JavaScript page row: the
 * type chip and state chips first (text names every state; color only
 * reinforces it), then the style itself —
 * - a link: its URL (opens in a new tab, copyable), on the chips' line from
 *   the regular tier, on its own line when compact;
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
import { CopyButton } from '../../../../components/ui/copy-button';
import { countLabel } from '../../../../utils/format-count';
import { ExternalLink } from '../page-frame';
import { StateChips } from '../resource-list/state-chip-list';
import { CRITICAL_SNAPSHOT_NOTE, CRITICAL_SNAPSHOT_TITLE, type StyleRowView } from './style-view';

/** A page value shown in mono that may break anywhere (ids and media can be long). */
const PAGE_VALUE = 'min-w-0 font-mono text-2xs break-all';

/**
 * The type chip, the state chips and the element's own facts — bare items
 * for the caller's wrapping line.
 *
 * @param props.view The row.
 */
function RowChips(props: { view: StyleRowView }): JSX.Element {
  return (
    <>
      <Badge variant="outline" class="font-medium whitespace-nowrap">
        {props.view.type === 'inline' ? 'Inline' : 'External'}
      </Badge>
      <StateChips chips={props.view.chips} />
      <Show when={props.view.type === 'inline' && props.view.identity}>
        {(identity) => (
          <span data-fdt="style-identity" class={`${PAGE_VALUE} text-fg-primary`}>
            {identity()}
          </span>
        )}
      </Show>
      <Show when={props.view.mediaDetail}>
        {(detail) => (
          <span data-fdt="style-media" class={`${PAGE_VALUE} text-fg-muted`}>
            {detail()}
          </span>
        )}
      </Show>
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
          <div class="flex flex-wrap items-center gap-1">
            <RowChips view={props.view} />
            <div class="flex min-h-6 min-w-0 basis-full items-center gap-1 @regular:ms-1 @regular:flex-1 @regular:basis-48">
              <Show
                when={props.view.href !== ''}
                fallback={<span class="text-2xs text-fg-muted">No stylesheet address</span>}
              >
                <div class="min-w-0 flex-1">
                  <ExternalLink href={props.view.href} />
                </div>
                <CopyButton
                  text={props.view.href}
                  label="Stylesheet URL"
                  showLabel={false}
                  class="shrink-0"
                />
              </Show>
            </div>
          </div>
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
