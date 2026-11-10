/**
 * The page-style inventory: the inspected page's `style` and stylesheet
 * `link` elements as they are now (the ones a test strips), each with its
 * tag, id, class, stylesheet URL or a preview of its CSS — read on demand
 * from the page, refreshed after each applied test.
 *
 * States: idle (one action: read them), loading (skeleton rows), failed
 * (named miss + retry), empty (no styles), populated (virtual list; a cut
 * list says how many the page has).
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import FileCode from 'lucide-solid/icons/file-code';
import RotateCw from 'lucide-solid/icons/rotate-cw';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import type { PageStyleEntry, PageStylesReply } from '../../../../lib/messaging/page-styles';
import { styleIdentity } from '../../../../lib/panel/style-identity';
import { RUCSS_RESULT_STYLE_ID } from '../../../../lib/rucss-tester/run-plan';
import { cn } from '../../../../utils/cn';
import { countLabel, formatCount } from '../../../../utils/format-count';
import { PAGE_ASK_MISS_COPY } from '../page-ask-miss';
import { PAGE_FILL_SCROLLER } from '../page-frame';
import type { InventoryState } from './session';

/** The inventory's noun. */
const STYLE_NOUN = { one: 'style', other: 'styles' } as const;

/** The idle state's words. */
export const INVENTORY_IDLE = {
  title: "See this page's styles",
  description:
    'Lists every inline style and stylesheet link on the page now — the ones a test removes or keeps.'
} as const;

/**
 * The inventory's counts line.
 *
 * @param reply The inventory.
 * @returns E.g. "12 styles · 4 inline · 8 stylesheet links", with the cut stated.
 */
export function inventorySummary(reply: PageStylesReply): string {
  const inline = reply.styles.filter((style) => style.kind === 'inline').length;
  const links = reply.styles.length - inline;
  const head = countLabel(reply.total, STYLE_NOUN);
  const cut =
    reply.total > reply.styles.length ? ` (first ${formatCount(reply.styles.length)} listed)` : '';
  return `${head}${cut} · ${formatCount(inline)} inline · ${countLabel(links, { one: 'stylesheet link', other: 'stylesheet links' })}`;
}

/**
 * One inventory row.
 *
 * @param props.style The entry.
 */
function StyleRow(props: { style: PageStyleEntry }): JSX.Element {
  /** Whether this entry is the injected test result. */
  const isResult = (): boolean =>
    props.style.kind === 'inline' && props.style.id === RUCSS_RESULT_STYLE_ID;
  return (
    <div class="flex min-w-0 flex-col gap-0.5">
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge kind={props.style.kind === 'link' ? 'info' : 'neutral'}>
          {props.style.kind === 'link' ? 'link' : 'style'}
        </Badge>
        <Show when={isResult()}>
          <Badge kind="warn">Test result</Badge>
        </Show>
        <Show when={styleIdentity(props.style)}>
          {(identity) => (
            <span class="min-w-0 truncate font-mono text-2xs text-fg-primary" title={identity()}>
              {identity()}
            </span>
          )}
        </Show>
        <Show when={props.style.media}>
          {(media) => <span class="font-mono text-2xs text-fg-muted">media: {media()}</span>}
        </Show>
      </div>
      <Show
        when={props.style.kind === 'link'}
        fallback={
          <p class="flex min-w-0 gap-1.5 text-2xs">
            <span
              class="min-w-0 flex-1 truncate font-mono text-fg-secondary"
              title={props.style.preview}
            >
              {props.style.preview === '' ? 'Empty' : props.style.preview}
            </span>
            <span class="shrink-0 tabular-nums text-fg-muted">
              {countLabel(props.style.chars, { one: 'character', other: 'characters' })}
            </span>
          </p>
        }
      >
        <p
          class="min-w-0 truncate font-mono text-2xs text-fg-secondary"
          title={props.style.href === '' ? undefined : props.style.href}
        >
          {props.style.href === '' ? 'No stylesheet address' : props.style.href}
        </p>
      </Show>
    </div>
  );
}

/** Props of {@link StylesList}. */
export interface StylesListProps {
  state: InventoryState;
  /** Read (or re-read) the page's styles. */
  onInspect: () => void;
  /** The virtualizer seam (tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render the inventory in its current state.
 *
 * @param props See {@link StylesListProps}.
 */
export function StylesList(props: StylesListProps): JSX.Element {
  const ready = () => (props.state.status === 'ready' ? props.state.reply : undefined);
  const failed = () => (props.state.status === 'failed' ? props.state.miss : undefined);
  return (
    <div data-fdt="rucss-styles" class="flex min-h-0 flex-1 flex-col gap-2">
      <Switch>
        <Match when={props.state.status === 'idle'}>
          <EmptyState
            icon={<FileCode size={16} aria-hidden="true" />}
            title={INVENTORY_IDLE.title}
            description={INVENTORY_IDLE.description}
            action={
              <Button size="sm" variant="primary" data-fdt-rucss-inspect onClick={props.onInspect}>
                Inspect page styles
              </Button>
            }
          />
        </Match>
        <Match when={props.state.status === 'loading'}>
          <div class="grid grid-cols-1 gap-2" data-fdt-rucss-styles-loading>
            <Skeleton class="h-4 w-48 max-w-full" />
            <Skeleton class="h-10 w-full" />
            <Skeleton class="h-10 w-full" />
          </div>
        </Match>
        <Match when={failed()}>
          {(miss) => (
            <ErrorState
              title="Couldn't read the page's styles"
              message={PAGE_ASK_MISS_COPY[miss()]}
              onRetry={props.onInspect}
            />
          )}
        </Match>
        <Match when={ready()}>
          {(reply) => (
            <>
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p data-fdt-rucss-styles-summary class="min-w-0 flex-1 text-2xs text-fg-secondary">
                  {inventorySummary(reply())}
                </p>
                <Button size="sm" variant="secondary" onClick={props.onInspect}>
                  <RotateCw size={12} aria-hidden="true" />
                  Refresh
                </Button>
              </div>
              <Show
                when={reply().styles.length > 0}
                fallback={
                  <EmptyState
                    title="No styles on this page"
                    description="The page has no inline style or stylesheet link right now."
                  />
                }
              >
                <VirtualList
                  aria-label="Page styles"
                  count={reply().styles.length}
                  estimateSize={() => 44}
                  createVirtualizer={props.createVirtualizer}
                  class={cn(PAGE_FILL_SCROLLER, 'rounded-md border border-line-1 bg-surface-1')}
                >
                  {(item) => (
                    <Show when={reply().styles[item.index]}>
                      {(style) => (
                        <div
                          data-fdt="rucss-style-row"
                          class={cn(
                            'min-h-8 px-2 py-1.5',
                            item.index > 0 && 'border-t border-line-1'
                          )}
                        >
                          <StyleRow style={style()} />
                        </div>
                      )}
                    </Show>
                  )}
                </VirtualList>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}
