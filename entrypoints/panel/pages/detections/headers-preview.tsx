/**
 * The Detections page's "Response headers" section: the compact preview of
 * every captured main-frame header, caching-relevant rows first (each with
 * its plain-language hint), the rest after — through the shared headers
 * model, so this preview and the full headers page can never disagree.
 *
 * Disclosure contract: collapsed by default; the trigger is a
 * `button[aria-expanded]` inside the section's `h2`; the body mounts on the
 * first open (fading in once) and then stays mounted, so closing and
 * re-opening keeps its scroll position and a data refresh keeps it open.
 *
 * States: `pageHeaders === null` → the page omits the section entirely
 * (nothing was captured, so there is nothing to preview); an empty capture →
 * the heading plus one line saying so; otherwise the disclosure.
 *
 * Rendering: a plain list inside one capped, keyboard-scrollable region.
 * The capture is bounded (the header contract caps it at 256 rows) and rows
 * wrap to variable heights (long values, hints) — the shared virtual list
 * pins each row to its estimated height, which clips or overlaps wrapped
 * rows, so it cannot carry this content until its rows size to content.
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { Badge } from '../../../../components/ui/badge';
import { FOCUS_RING, MOTION_REVEAL, MOTION_TURN } from '../../../../components/ui/classes';
import { KeyValue } from '../../../../components/ui/key-value';
import {
  buildHeadersViewModel,
  type HeaderRowVM,
  type HeadersViewModel
} from '../../../../lib/panel/headers-view-model';
import type { PageHeaders } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';

/** One rendered group: its label (null when a lone group needs none) and rows. */
export interface PreviewGroup {
  readonly key: 'caching' | 'other';
  readonly label: string | null;
  readonly rows: readonly HeaderRowVM[];
}

/** The group labels (shown only when both groups have rows to tell apart). */
export const GROUP_LABELS = { caching: 'Caching', other: 'Other headers' } as const;

/** The empty-capture line. */
export const NO_HEADERS_LINE = 'No response headers were captured for this page.';

/** The capture's documented limitation, as the section's footnote. */
export const HEADERS_FOOTNOTE =
  "From the page's last full load — navigations inside a single-page app don't refresh them.";

/**
 * Split the model into the rendered groups: caching first, then the rest;
 * empty groups dropped; labels only when both groups are present.
 *
 * @param model The shared headers model.
 * @returns The non-empty groups in render order.
 */
export function previewGroups(model: HeadersViewModel): PreviewGroup[] {
  const labelled = model.caching.length > 0 && model.other.length > 0;
  const groups: PreviewGroup[] = [
    { key: 'caching', label: labelled ? GROUP_LABELS.caching : null, rows: model.caching },
    { key: 'other', label: labelled ? GROUP_LABELS.other : null, rows: model.other }
  ];
  return groups.filter((group) => group.rows.length > 0);
}

/** Props of {@link HeadersPreview}. */
export interface HeadersPreviewProps {
  /** The captured main-frame headers (non-null: the page omits the section otherwise). */
  headers: PageHeaders;
}

/**
 * One header row: name above value (two columns from the regular tier),
 * the hint under the value. Names and values break anywhere (they are
 * tokens, not prose); the hint wraps as prose.
 *
 * @param props.header The typed header row.
 */
function HeaderRow(props: { header: HeaderRowVM }): JSX.Element {
  return (
    <li class="border-b border-line-1 last:border-b-0">
      <KeyValue
        term={props.header.name}
        stacked
        class="py-1.5 font-mono break-all @regular:grid @regular:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] @regular:gap-x-3"
      >
        <span class="block text-fg-primary">{props.header.value ?? '—'}</span>
        <Show when={props.header.hint}>
          {(hint) => (
            <span class="mt-0.5 block font-sans text-2xs text-fg-secondary break-normal wrap-break-word">
              {hint()}
            </span>
          )}
        </Show>
      </KeyValue>
    </li>
  );
}

/**
 * Render the preview section.
 *
 * @param props See {@link HeadersPreviewProps}.
 */
export function HeadersPreview(props: HeadersPreviewProps): JSX.Element {
  const groups = createMemo(() => previewGroups(buildHeadersViewModel(props.headers)));
  const headerCount = () => props.headers.length;
  const [open, setOpen] = createSignal(false);
  // Mount-once latch: the body joins the DOM on the first open and stays.
  const [mounted, setMounted] = createSignal(false);
  const bodyId = createUniqueId();
  const headingId = createUniqueId();

  return (
    <section data-fdt="headers-preview" aria-labelledby={headingId} class="flex flex-col gap-1.5">
      <Show
        when={headerCount() > 0}
        fallback={
          <>
            <h2 id={headingId} class="text-sm font-semibold text-fg-primary">
              Response headers
            </h2>
            <p data-fdt="headers-preview-empty" class="text-xs text-fg-secondary">
              {NO_HEADERS_LINE}
            </p>
          </>
        }
      >
        <h2 id={headingId} class="text-sm font-semibold text-fg-primary">
          <button
            type="button"
            data-fdt="headers-preview-toggle"
            aria-expanded={open()}
            aria-controls={mounted() ? bodyId : undefined}
            onClick={() => {
              setMounted(true);
              setOpen((value) => !value);
            }}
            class={cn(
              '-mx-1 inline-flex min-h-6 items-center gap-1.5 rounded px-1 hover:bg-surface-3',
              FOCUS_RING
            )}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              class={cn('shrink-0 text-fg-secondary', MOTION_TURN, open() && 'rotate-90')}
            />
            Response headers
            <Badge class="font-normal tabular-nums">
              <span class="sr-only">(</span>
              {headerCount()}
              <span class="sr-only"> captured)</span>
            </Badge>
          </button>
        </h2>
        <Show when={mounted()}>
          <div
            id={bodyId}
            data-fdt="headers-preview-body"
            hidden={!open()}
            class={cn('flex flex-col gap-1.5', MOTION_REVEAL)}
          >
            {/* The capped region scrolls on its own: focusable so keyboard
                users can scroll it (its rows hold no controls). */}
            <div
              role="region"
              aria-label="Captured response headers"
              tabindex="0"
              class={cn(
                'max-h-72 overflow-y-auto rounded-md border border-line-1 bg-surface-1 px-2.5',
                FOCUS_RING
              )}
            >
              <For each={groups()}>
                {(group) => {
                  const labelId = createUniqueId();
                  return (
                    <div data-fdt-headers-group={group.key}>
                      <Show when={group.label}>
                        {(label) => (
                          <p id={labelId} class="pt-2 text-2xs font-medium text-fg-muted">
                            {label()}
                          </p>
                        )}
                      </Show>
                      <ul
                        aria-labelledby={group.label === null ? undefined : labelId}
                        aria-label={group.label === null ? 'Headers' : undefined}
                      >
                        <For each={group.rows}>{(header) => <HeaderRow header={header} />}</For>
                      </ul>
                    </div>
                  );
                }}
              </For>
            </div>
            <p class="text-2xs text-fg-muted">{HEADERS_FOOTNOTE}</p>
          </div>
        </Show>
      </Show>
    </section>
  );
}
