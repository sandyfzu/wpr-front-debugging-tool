/**
 * The Preloaded Resources page's hint pieces: the attribution chip (a row's
 * states cell and the detail) and one hint's detail body — only what the
 * capture records for a hint: who wrote it (the chip, and why in words),
 * its URL as a source-link tile (an empty `href` — a srcset-only image
 * preload — has none, and says so), and its `rel`, `as` and WP Rocket stamp.
 */
import type { Accessor, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { StatusBadge } from '../../../../components/ui/status-badge';
import type { OpenResource } from '../open-resource';
import { FactList } from '../resource-list/detail-section';
import { SourceLink } from '../resource-list/source-link';
import {
  hintFacts,
  hintFetchesFile,
  missingUrlNote,
  type AttributionChip,
  type PreloadedRowView
} from './preloaded-view';

/**
 * A hint's attribution chip: the label, then its proven feature in
 * parentheses; non-interactive, its detail in a plain `title`. In a narrow
 * states cell the words truncate (the title and the detail keep them whole).
 *
 * @param props.chip The chip.
 */
export function AttributionBadge(props: { chip: AttributionChip }): JSX.Element {
  return (
    <span data-fdt="hint-attribution" data-fdt-attribution={props.chip.id} class="contents">
      <StatusBadge kind={props.chip.kind} title={props.chip.title} class="max-w-full min-w-0">
        <span class="truncate">
          {props.chip.label}
          <Show when={props.chip.mark}>
            {(mark) => (
              <>
                {' '}
                <span data-fdt="hint-attribution-mark" class="font-normal">
                  ({mark()})
                </span>
              </>
            )}
          </Show>
        </span>
      </StatusBadge>
    </span>
  );
}

/** Props of {@link PreloadedDetail}. */
export interface PreloadedDetailProps {
  /** The selected row (live: a same-key refresh updates it in place). */
  view: Accessor<PreloadedRowView>;
  /** "Open in Sources" (null: the tile opens a new tab). */
  openResource: OpenResource | null;
}

/**
 * Render one hint's detail body.
 *
 * @param props See {@link PreloadedDetailProps}.
 */
export function PreloadedDetail(props: PreloadedDetailProps): JSX.Element {
  const row = () => props.view().row;
  return (
    <div data-fdt="hint-detail" class="flex min-w-0 flex-col gap-3.5">
      <div class="flex min-w-0 flex-col items-start gap-1.5">
        <AttributionBadge chip={props.view().attribution} />
        <p data-fdt="hint-attribution-why" class="text-2xs text-fg-secondary">
          {props.view().attribution.title}
        </p>
      </div>
      <Show
        when={row().href !== ''}
        fallback={
          <p data-fdt="hint-no-url" class="text-2xs text-fg-muted">
            {missingUrlNote(row())}
          </p>
        }
      >
        <SourceLink
          url={row().href}
          clipped={props.view().clipped}
          // An origin (preconnect, DNS prefetch) is no file the Sources panel lists.
          openResource={hintFetchesFile(row()) ? props.openResource : null}
        />
      </Show>
      <FactList facts={hintFacts(row())} hook="hint-facts" />
    </div>
  );
}
