/**
 * The top bar's "⋯" menu: what the bar shows inline when it has the room
 * and holds here when it does not — the product name, the inspected
 * address, the data freshness, the cache age, the server answer (still a
 * link to its page) and, on a compact bar, the Exclusions action with its
 * session badge. Each row shows exactly when its part is not inline, so
 * nothing folded is out of reach. A stale freshness held here also marks
 * the trigger (a warn dot, named in its accessible name).
 *
 * The trigger box stays mounted while hidden: the bar's fold measures its
 * width to decide whether folding a part leaves room for it.
 *
 * Freshness, cache age and the identity block are plain text inside the
 * plate (answers, not actions); the server answer and the Exclusions action
 * are the menu's items, so the APG keyboard walks them.
 */
import {
  ErrorBoundary,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  type JSX
} from 'solid-js';
import Crosshair from 'lucide-solid/icons/crosshair';
import Ellipsis from 'lucide-solid/icons/ellipsis';
import Server from 'lucide-solid/icons/server';
import { BrandMark } from '../../../components/ui/brand-mark';
import {
  MENU_CONTENT_CLASSES,
  MENU_ICON_TRIGGER_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_ITEM_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES,
  Menu
} from '../../../components/ui/menu';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge, StatusDot } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import { createLogger } from '../../../lib/logger';
import type { TopBarFoldPart } from '../../../lib/panel/top-bar-fold';
import { cn } from '../../../utils/cn';
import { ANSWER_TARGETS, FreshnessAnswer, type SegmentsAccessor } from './answers';
import type { BuilderEntryModel } from './builder-entry';
import { FoldBox } from './fold';
import type { PageAddress } from './page-address';
import type { TopBarSegments } from './selectors';

const log = createLogger('panel');

/** A row the menu can hold, in plate order. */
export type TopBarMenuRow = 'address' | 'freshness' | 'cacheAge' | 'server' | 'exclusions';

/** Each row's words in the trigger's name (one declaring site). */
const ROW_WORDS: Record<TopBarMenuRow, string> = {
  address: 'address',
  freshness: 'freshness',
  cacheAge: 'cache age',
  server: 'server',
  exclusions: 'Exclusions'
};

/**
 * Join words as prose: "a", "a and b", "a, b and c".
 *
 * @param words The words.
 * @returns The prose.
 */
function joinWords(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

/**
 * The trigger's accessible name and tooltip: they list what the menu holds
 * (so the name never promises a row that is not there) and name stale data
 * when the freshness it holds is stale.
 *
 * @param rows The rows the menu holds, in plate order.
 * @param stale Whether the held freshness is past the stale window.
 * @returns The name ("More: …", or "More" when it holds only the name) and the hover text.
 */
export function topBarMenuWords(
  rows: readonly TopBarMenuRow[],
  stale: boolean
): { label: string; tooltip: string } {
  const words = rows.map((row) =>
    row === 'freshness' && stale ? 'freshness (data is stale)' : ROW_WORDS[row]
  );
  if (words.length === 0) return { label: 'More', tooltip: 'More' };
  const prose = joinWords(words);
  return {
    label: `More: ${words.join(', ')}`,
    tooltip: `${prose.charAt(0).toUpperCase()}${prose.slice(1)}`
  };
}

/**
 * The rows the menu holds: each part's row when the part is not inline and
 * has something to show; the Exclusions action on a compact bar.
 *
 * @param facts What exists and what shows inline.
 * @returns The rows, in plate order.
 */
export function topBarMenuRows(facts: {
  readonly hasAddress: boolean;
  readonly segments: TopBarSegments | null;
  readonly inline: (part: TopBarFoldPart) => boolean;
  readonly compact: boolean;
  readonly hasBuilder: boolean;
}): TopBarMenuRow[] {
  const rows: TopBarMenuRow[] = [];
  if (facts.hasAddress && !facts.inline('address')) rows.push('address');
  const answers = facts.segments;
  if (answers !== null) {
    if (!facts.inline('freshness')) rows.push('freshness');
    const cache = answers.cache;
    if (!facts.inline('cacheAge') && cache.kind === 'cached' && cache.age !== null)
      rows.push('cacheAge');
    if (!facts.inline('server')) rows.push('server');
  }
  if (facts.compact && facts.hasBuilder) rows.push('exclusions');
  return rows;
}

/** The plate's text blocks (answers, not items). */
const PLATE_TEXT = 'px-3 py-1.5 text-2xs';

/** Props of {@link TopBarMenu}. */
export interface TopBarMenuProps {
  /** The composed answers (null when they could not be composed). */
  readonly segments: () => TopBarSegments | null;
  /** The inspected page's address (null while unknown). */
  readonly address: () => PageAddress | null;
  /** The shared exclusion builder state (null once it failed: no row). */
  readonly builder: BuilderEntryModel | null;
  /** Whether the shown data is stale. */
  readonly stale: boolean;
  /** Whether the trigger shows (else it stays laid out, hidden, for measuring). */
  readonly visible: boolean;
  /** Whether a part shows inline in the bar (the menu holds it otherwise). */
  readonly inline: (part: TopBarFoldPart) => boolean;
  /** The compact bar (the name and the Exclusions action live here). */
  readonly compact: boolean;
  /** The trigger box's ref (the fold measures it). */
  readonly attach: (element: HTMLElement) => void;
}

/**
 * The server answer as the menu shows it: a link item to the Detections
 * overview when captured, otherwise its honest quiet text (never an item:
 * a valueless state ships no control).
 *
 * @param props.segments The composed answers.
 */
function ServerRow(props: { segments: SegmentsAccessor }): JSX.Element {
  const view = createMemo(() => props.segments().platform);
  const captured = createMemo(() => {
    const current = view();
    return current.kind === 'captured' ? current : undefined;
  });
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <div class={PLATE_TEXT}>
          <Skeleton class="h-4 w-24" />
        </div>
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <p class={cn(PLATE_TEXT, 'text-fg-muted')}>Server: no headers captured</p>
      </Match>
      <Match when={view().kind === 'unknown'}>
        <p class={cn(PLATE_TEXT, 'text-fg-muted')}>Server: unknown</p>
      </Match>
      <Match when={captured()}>
        {(state) => (
          <Menu.Item
            as="a"
            href={ANSWER_TARGETS.platform}
            closeOnSelect
            data-fdt="top-bar-menu-server"
            class={MENU_ITEM_CLASSES}
          >
            <Server size={14} class="shrink-0 text-fg-secondary" aria-hidden="true" />
            <Menu.ItemLabel class={MENU_ITEM_LABEL_CLASSES}>
              <span class="sr-only">Platform</span>
              <span class="min-w-0 truncate font-mono">{state().value}</span>
            </Menu.ItemLabel>
          </Menu.Item>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The labeled Exclusions action with its session badge, every state (a
 * compact bar shows its entry only for news). Held — no tab, or an open in
 * flight — it is disabled; its title explains why.
 *
 * @param props.builder The shared builder state.
 */
function ExclusionsRow(props: { builder: BuilderEntryModel }): JSX.Element {
  return (
    <Menu.Item
      disabled={props.builder.held()}
      closeOnSelect
      onSelect={() => {
        void props.builder.open();
      }}
      data-fdt="top-bar-menu-exclusions"
      title={props.builder.description()}
      class={MENU_ITEM_CLASSES}
    >
      <Crosshair size={14} class="shrink-0 text-fg-secondary" aria-hidden="true" />
      <Menu.ItemLabel class={MENU_ITEM_LABEL_CLASSES}>
        <span class="min-w-0 truncate">{props.builder.opening() ? 'Opening…' : 'Exclusions'}</span>
        <Show when={props.builder.view().badge}>
          {(badge) => (
            <StatusBadge kind={badge().kind} icon class="shrink-0">
              {badge().label}
            </StatusBadge>
          )}
        </Show>
      </Menu.ItemLabel>
    </Menu.Item>
  );
}

/**
 * The plate's answer rows (freshness, cache age, server) the menu holds.
 * Contained: they read the same composed answers as the bar, so a render
 * failure here drops to one quiet line, never the menu or its Exclusions
 * action.
 *
 * @param props.segments The composed answers.
 * @param props.rows The rows the menu holds.
 */
function AnswerRows(props: {
  segments: SegmentsAccessor;
  rows: readonly TopBarMenuRow[];
}): JSX.Element {
  /** The held cache age ("Cache generated 3 min ago"; the stamp stays in the pill's tooltip). */
  const cacheAge = createMemo(() => {
    const cache = props.segments().cache;
    return cache.kind === 'cached' && cache.age !== null ? `Cache generated ${cache.age}` : null;
  });
  return (
    <ErrorBoundary
      fallback={(cause: unknown) => {
        log.error('Top bar menu answers crashed — the menu renders its downtime line', {
          cause: cause instanceof Error ? { message: cause.message } : cause
        });
        return <p class={cn(PLATE_TEXT, 'text-fg-muted')}>Status unavailable</p>;
      }}
    >
      <Show when={props.rows.includes('freshness')}>
        <div class={PLATE_TEXT} data-fdt="top-bar-menu-freshness">
          <FreshnessAnswer view={() => props.segments().freshness} />
        </div>
      </Show>
      <Show when={props.rows.includes('cacheAge') ? cacheAge() : null}>
        {(text) => (
          <p class={cn(PLATE_TEXT, 'text-fg-secondary')} data-fdt="top-bar-menu-cache-age">
            {text()}
          </p>
        )}
      </Show>
      <Show when={props.rows.includes('server')}>
        <Menu.Separator class={MENU_SEPARATOR_CLASSES} />
        <ServerRow segments={props.segments} />
      </Show>
    </ErrorBoundary>
  );
}

/**
 * Render the "⋯" trigger and its menu. Mount it on every bar: hidden, the
 * trigger box keeps its size for the fold to measure.
 *
 * @param props See {@link TopBarMenuProps}.
 */
export function TopBarMenu(props: TopBarMenuProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  // A trigger that hides (the bar widened) closes its menu.
  createEffect(() => {
    if (!props.visible) setOpen(false);
  });
  const rows = createMemo(() =>
    topBarMenuRows({
      hasAddress: props.address() !== null,
      segments: props.segments(),
      inline: props.inline,
      compact: props.compact,
      hasBuilder: props.builder !== null
    })
  );
  const staleHeld = createMemo(() => props.stale && rows().includes('freshness'));
  const words = createMemo(() => topBarMenuWords(rows(), staleHeld()));
  return (
    <FoldBox inline={props.visible} ref={props.attach} data-fdt="top-bar-menu-box">
      <Menu.Root open={open()} onOpenChange={setOpen} modal={false} placement="bottom-end">
        <Tooltip
          as="menu-trigger"
          content={words().tooltip}
          placement="bottom"
          ariaLabel={words().label}
          ariaHasPopup="menu"
          ariaExpanded={open()}
          class={cn('relative', MENU_ICON_TRIGGER_CLASSES)}
        >
          <Ellipsis size={16} aria-hidden="true" />
          {/* The held "Stale" marker, at a glance (the name carries the words). */}
          <Show when={staleHeld()}>
            <StatusDot kind="warn" data-fdt="top-bar-menu-stale" class="absolute top-1 right-1" />
          </Show>
        </Tooltip>
        <Menu.Portal>
          <Menu.Content data-fdt="top-bar-menu" class={MENU_CONTENT_CLASSES}>
            <Show when={props.compact || !props.inline('brand') || rows().includes('address')}>
              <div class={cn(PLATE_TEXT, 'flex items-start gap-2')}>
                <BrandMark class="shrink-0" />
                <div class="min-w-0">
                  <p class="text-xs font-semibold text-fg-primary">WPR FDT</p>
                  <Show when={rows().includes('address') ? props.address() : null}>
                    {(address) => (
                      <p class="font-mono break-all text-fg-muted" title={address().url}>
                        {address().label}
                      </p>
                    )}
                  </Show>
                </div>
              </div>
            </Show>
            <Show when={props.segments()}>
              {(answers) => <AnswerRows segments={answers} rows={rows()} />}
            </Show>
            <Show when={rows().includes('exclusions') ? props.builder : null}>
              {(builder) => (
                <>
                  <Show when={!rows().includes('server')}>
                    <Menu.Separator class={MENU_SEPARATOR_CLASSES} />
                  </Show>
                  <ExclusionsRow builder={builder()} />
                </>
              )}
            </Show>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </FoldBox>
  );
}
