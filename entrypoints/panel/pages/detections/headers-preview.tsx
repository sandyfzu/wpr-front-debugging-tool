/**
 * The Detections page's "Response headers" section: the compact preview of
 * every captured main-frame header, caching-relevant rows first (each with
 * its plain-language hint), the rest after — through the shared headers
 * model, so this preview and the full headers page can never disagree.
 *
 * Disclosure contract: collapsed by default; the trigger is a
 * `button[aria-expanded]` inside the section's `h2`; the body mounts on the
 * first open, appears instantly (only the chevron turns) and then stays
 * mounted, so closing and re-opening keeps its scroll position and a data
 * refresh keeps it open.
 *
 * States: `pageHeaders === null` → the page omits the section entirely
 * (nothing was captured, so there is nothing to preview); an empty capture →
 * the heading plus one line saying so; otherwise the disclosure.
 *
 * Rendering: in the page's own flow — no nested scroller. The preview
 * shows up to {@link PREVIEW_ROW_LIMIT} rows (the size from which a list
 * would need virtualization); a larger capture shows its first rows —
 * caching-relevant first, so the evidence that matters is always in — plus
 * a line naming how many more exist and that the copied report carries
 * them all. Rows are keyed by group + name + occurrence, so a data refresh
 * keeps their DOM nodes.
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { Badge } from '../../../../components/ui/badge';
import { FOCUS_RING, MOTION_TURN } from '../../../../components/ui/classes';
import { KeyValue } from '../../../../components/ui/key-value';
import {
  buildHeadersViewModel,
  type HeaderRowVM,
  type HeadersViewModel
} from '../../../../lib/panel/headers-view-model';
import type { PageHeaders } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';

/** One preview row: its stable key and the header it renders. */
export interface PreviewRow {
  /** `<group>:<lowercase name>#<occurrence>` — stable across refreshes. */
  readonly key: string;
  readonly header: HeaderRowVM;
}

/** One rendered group: its label (null when a lone group needs none) and rows. */
export interface PreviewGroup {
  readonly key: 'caching' | 'other';
  readonly label: string | null;
  readonly rows: readonly PreviewRow[];
}

/** What the preview renders: the (possibly capped) groups and the counts. */
export interface PreviewModel {
  readonly groups: readonly PreviewGroup[];
  /** Rows rendered. */
  readonly shown: number;
  /** Rows captured. */
  readonly total: number;
}

/**
 * The most rows the in-flow preview renders — the size from which a list
 * would need the virtualized path; past it the preview is a preview.
 */
export const PREVIEW_ROW_LIMIT = 100;

/** The group labels (shown only when both groups have rows to tell apart). */
export const GROUP_LABELS = { caching: 'Caching', other: 'Other headers' } as const;

/** The empty-capture line. */
export const NO_HEADERS_LINE = 'No response headers were captured for this page.';

/** The capture's documented limitation, as the section's footnote. */
export const HEADERS_FOOTNOTE =
  "From the page's last full load — navigations inside a single-page app don't refresh them.";

/**
 * The line under a capped preview.
 *
 * @param shown Rows rendered.
 * @param total Rows captured.
 * @returns The sentence naming the rest and where they are.
 */
export function cappedLine(shown: number, total: number): string {
  return `Showing the first ${shown.toString()} of ${total.toString()} headers — Copy report includes all of them.`;
}

/**
 * Build the preview: caching group first, then the rest; empty groups
 * dropped; labels only when both groups are present; at most `limit` rows
 * in total, taken in that order; each row keyed stably.
 *
 * @param model The shared headers model.
 * @param limit The row cap (default {@link PREVIEW_ROW_LIMIT}).
 * @returns The groups to render and the shown/total counts.
 */
export function previewModel(model: HeadersViewModel, limit = PREVIEW_ROW_LIMIT): PreviewModel {
  const labelled = model.caching.length > 0 && model.other.length > 0;
  const total = model.caching.length + model.other.length;
  let budget = Math.max(0, limit);
  const build = (key: 'caching' | 'other', headers: readonly HeaderRowVM[]): PreviewGroup => {
    const seen = new Map<string, number>();
    const rows: PreviewRow[] = [];
    for (const header of headers) {
      if (budget === 0) break;
      budget -= 1;
      const name = header.name.toLowerCase();
      const occurrence = seen.get(name) ?? 0;
      seen.set(name, occurrence + 1);
      rows.push({ key: `${key}:${name}#${occurrence.toString()}`, header });
    }
    return { key, label: labelled ? GROUP_LABELS[key] : null, rows };
  };
  const groups = [build('caching', model.caching), build('other', model.other)].filter(
    (group) => group.rows.length > 0
  );
  const shown = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return { groups, shown, total };
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
 * @returns The list item.
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
 * @returns The section.
 */
export function HeadersPreview(props: HeadersPreviewProps): JSX.Element {
  const preview = createMemo(() => previewModel(buildHeadersViewModel(props.headers)));
  // Stable string keys drive the loops; the row/group objects are looked up
  // per key, so a refresh swaps data under the same DOM nodes.
  const groupKeys = createMemo(() => preview().groups.map((group) => group.key), undefined, {
    equals: sameKeys
  });
  const groupOf = (key: PreviewGroup['key']): PreviewGroup | undefined =>
    preview().groups.find((group) => group.key === key);
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
            <span class="sr-only"> (</span>
            <Badge class="font-normal tabular-nums">{headerCount()}</Badge>
            <span class="sr-only"> captured)</span>
          </button>
        </h2>
        {/* Expand/collapse is instant (no fade, no height animation): only
            the chevron turns. */}
        <Show when={mounted()}>
          <div
            id={bodyId}
            data-fdt="headers-preview-body"
            hidden={!open()}
            class="flex flex-col gap-1.5"
          >
            <div class="rounded-md border border-line-1 bg-surface-1 px-2.5">
              <For each={groupKeys()}>
                {(key) => {
                  const labelId = createUniqueId();
                  const group = () => groupOf(key);
                  const rowKeys = createMemo(
                    () => group()?.rows.map((row) => row.key) ?? [],
                    undefined,
                    { equals: sameKeys }
                  );
                  const rowOf = (rowKey: string): HeaderRowVM | undefined =>
                    group()?.rows.find((row) => row.key === rowKey)?.header;
                  return (
                    <div data-fdt-headers-group={key}>
                      <Show when={group()?.label}>
                        {(label) => (
                          <p id={labelId} class="pt-2 text-2xs font-medium text-fg-muted">
                            {label()}
                          </p>
                        )}
                      </Show>
                      <ul
                        aria-labelledby={group()?.label ? labelId : undefined}
                        aria-label={group()?.label ? undefined : 'Headers'}
                      >
                        <For each={rowKeys()}>
                          {(rowKey) => (
                            <Show when={rowOf(rowKey)}>
                              {(header) => <HeaderRow header={header()} />}
                            </Show>
                          )}
                        </For>
                      </ul>
                    </div>
                  );
                }}
              </For>
            </div>
            <Show when={preview().shown < preview().total}>
              <p data-fdt="headers-preview-capped" class="text-2xs text-fg-secondary">
                {cappedLine(preview().shown, preview().total)}
              </p>
            </Show>
            <p class="text-2xs text-fg-muted">{HEADERS_FOOTNOTE}</p>
          </div>
        </Show>
      </Show>
    </section>
  );
}

/**
 * Key-list equality, so a refresh with the same keys never re-runs the loops.
 *
 * @param a The previous keys.
 * @param b The next keys.
 * @returns True when both lists hold the same keys in the same order.
 */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
