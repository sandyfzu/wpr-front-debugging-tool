/**
 * The panel's navigation — the nav registry's full consumer: one typed
 * surface rendering every journey group as a left icon rail beside the
 * content region, at every window size.
 *
 * Live state: rows that carry a registry selector resolve it against the
 * loaded page data and name the resulting state — on a rail row inside its
 * tooltip (the shared status vocabulary's badge, so the tones stay
 * AA-verified pairs by construction); on a menu row (the overflow
 * affordance) inline beside the visible label.
 *
 * Overflow: the rail never scrolls and never clips a row. A measure seam
 * reads the rendered rail's real geometry (a full-layout stub carries every
 * registry row's box, so the numbers are the rail's own, not hard-coded
 * pitches) and {@link visibleRowsInRail} slices the registry into the rows
 * that fit and the rows that move to the rail-end "More pages" trigger's
 * APG menu — where they stay full citizens: real hash links, live state,
 * `aria-current`, the reserved row disabled with its note. A failed
 * measurement is contained: the rail keeps the slice it has until a
 * truthful measurement arrives.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { DISABLED } from '../../../components/ui/classes';
import {
  Menu,
  MENU_CONTENT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_ITEM_LABEL_CLASSES,
  MENU_ITEM_NOTE_CLASSES,
  MENU_ITEM_WITH_NOTE_CLASSES,
  MENU_SEPARATOR_CLASSES
} from '../../../components/ui/menu';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import { cn } from '../../../utils/cn';
import { createLogger } from '../../../lib/logger';
import type { FdtData } from '../../../lib/wp-rocket/types';
import {
  realRailMeasure,
  realRailWatch,
  NAV_MIRROR_ROW_ATTR,
  type RailMeasureFn,
  type RailWatchFn
} from './rail-metrics';
import {
  NAV_GROUPS,
  NAV_ROUTES,
  type NavGroup,
  type NavLiveState,
  type NavRoute,
  type RouteId
} from '../routes';
import { visibleRowsInRail, type RailOverflow, type RailRowBox } from './visible-rows';

const log = createLogger('panel');

/** The nav's role name. */
const NAV_LABEL = 'WPR FDT pages';

/**
 * The rail's registry rows grouped for rendering, in the registry's own
 * group order, each cluster carrying its rows in registry order. Consumers
 * skip clusters without rows (a future-phase group renders no separator —
 * rows appear additively). Computed once at component setup: the registry
 * is a module constant, so this is render-time static data.
 *
 * @returns One entry per journey group.
 */
export function groupedRoutes(): Array<{ group: NavGroup; rows: readonly NavRoute[] }> {
  return NAV_GROUPS.map((group) => ({
    group,
    rows: NAV_ROUTES.filter((row) => row.group === group)
  }));
}

export interface AdaptiveNavProps {
  /** The current route accessor (the shell's hash router). */
  route: Accessor<RouteId>;
  /** The loaded page data — null outside the loaded states (no live state yet). */
  data: Accessor<FdtData | null>;
  /**
   * The measure seam (tests inject prepared geometries; absent, the real
   * DOM read is used — the only path in production).
   */
  measure?: RailMeasureFn;
  /**
   * The rail-size watch (tests drive resizes themselves; absent, the
   * ResizeObserver-based watcher is used — the only path in production).
   */
  watch?: RailWatchFn;
}

/** The rail's slice state: which registry rows stay, which the menu reveals. */
interface RailSlice {
  /** The rows kept in the rail, registry-ordered. */
  readonly visible: readonly RailRowBox[];
  /** The rows moved to the overflow menu, registry-ordered (maybe empty). */
  readonly hidden: readonly RailRowBox[];
}

/**
 * The unmeasured rail's slice: everything visible — the component boots
 * with the full rail exactly as the registry renders it, and the first
 * truthful measurement (on mount, before paint) may slice it. The visible
 * boxes are comparison sentinels (top/height zero); the per-row gates read
 * the hidden set, which is honestly empty here.
 *
 * @returns The full-visibility slice over the registry.
 */
function fullRailSlice(): RailSlice {
  return {
    visible: NAV_ROUTES.map((row) => ({ route: row.id, top: 0, height: 0 })),
    hidden: []
  };
}

/** The rail's anatomy: the icon rail. Rows grow additively with future pages. */
const NAV = 'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';

/**
 * One journey group: a hairline-topped cluster — never above the first
 * (the shell's brand mark already anchors the rail's top). The hairline
 * keeps symmetric breathing space: `mt-1.5` above (the boundary's own
 * margin) equals the `pt-1.5` below it, so the hairline never sits flush
 * against the previous group's last row box — its hover rectangle needs
 * real air (6px each side; the boundary lead is 13px against the rows'
 * 4px in-group gap), and the same lead applies in the overflow trigger's
 * top block. First in the rail loses all three (the anchor edge is the
 * brand block's spacing).
 */
const GROUP =
  'mt-1.5 flex flex-col border-t border-line-2 pt-1.5 first:mt-0 first:border-t-0 first:pt-0';

/** The group's row list. */
const GROUP_LIST = 'flex flex-col items-center gap-1';

/**
 * One nav row: a 32px square icon. The full label rides the sr-only span
 * (screen readers) and the tooltip (sighted users).
 */
const ROW =
  'flex h-8 w-8 items-center justify-center rounded whitespace-nowrap text-2xs font-medium no-underline';

/** The active row's treatment. */
const ROW_ACTIVE = 'bg-surface-3 text-fg-primary';
/** The rest rows' treatment (the hover surface every interactive gets). */
const ROW_IDLE = 'text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

/**
 * The row's label: content-named (screen readers read it; the tooltip shows
 * it to sighted users).
 */
const ROW_LABEL = 'sr-only';

/** The disabled reserved row's treatment (inside the registry-driven tooltip). */
const ROW_RESERVED = 'text-fg-muted';

/**
 * The geometry stub's container: a zero-size clip box sitting exactly on
 * the rail's content origin, holding the full-layout stub (every registry
 * row). Its content is invisible and uninteractive everywhere (visibility +
 * clip + `aria-hidden` + plain divs, never focusable) — it exists so the
 * rail's overflow slice reads its own geometry rather than a remembered
 * pitch, while its clipped zero box keeps the rail's rendered height exactly
 * its visible content's height (nothing scrollable ever appears, and the
 * stub's boxes are excluded from the rail's scrollable overflow area the
 * same standard way any clipped subtree is).
 */
const NAV_MIRROR = 'invisible absolute left-0 top-0 h-0 w-0 overflow-clip pointer-events-none';

/**
 * The overflow trigger's wrapper: the rail's end-edge block — the same
 * hairline-topped lead every group carries, marking the affordance off
 * from the rows it completes (it only renders when rows are actually away).
 */
const NAV_TRIGGER_BLOCK = 'flex shrink-0 flex-col border-t border-line-2 pt-1.5';

/**
 * Resolve one row's live state against the loaded page data.
 *
 * A throwing registry selector is a registry bug, not the user's failure —
 * contained to its row: the log names the row, the row renders stateless
 * (its link and tooltip stay whole), and the nav can never come down with
 * its own registry's errors.
 *
 * @param row The registry row whose selector resolves (undocumented-shape
 *   callers never reach this — the nav is the registry's only consumer).
 * @param data The live data, including null (selectors handle "no data yet"
 *   on their own contract — see `NavLiveStateSelector`).
 * @returns The row's state, or null when there is nothing to say (or when
 *   the selector failed).
 */
export function resolveLiveState(row: NavRoute, data: FdtData | null): NavLiveState | null {
  const selector = row.liveState;
  if (selector === undefined) return null;
  try {
    return selector(data);
  } catch (cause) {
    log.error('Nav live-state selector failed — the row renders stateless', {
      row: row.id,
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return null;
  }
}

export interface NavRowProps {
  /** The registry row to render. */
  row: NavRoute;
  /** The current route (drives the active treatment + `aria-current`). */
  route: Accessor<RouteId>;
  /** The loaded page data driving the row's live state. */
  data: Accessor<FdtData | null>;
}

/**
 * Render one registry row as its anchor (or the reserved disabled button).
 *
 * Non-reserved rows are real anchors (`#/route` hash form); reserved rows
 * are the disabled explained button. Both forms answer their tooltip with
 * the row's full label (or the reserved note) plus the live-state chip, and
 * both float it to the row's *right* — beside the rail column, never over
 * the sibling rows below (a below-placed tooltip would sit on top of the
 * next row's hit area and swallow its clicks).
 *
 * @param props The row, the active route and the loaded data.
 */
function NavRow(props: NavRowProps): JSX.Element {
  const live = createMemo(() => resolveLiveState(props.row, props.data()));
  const active = (): boolean => props.route() === props.row.id;
  /** The row's shared treatment (the active swap rides route changes). */
  const rowClasses = createMemo(() => cn(ROW, active() ? ROW_ACTIVE : ROW_IDLE));

  const tooltipContent = (
    <>
      <span class="font-medium">{props.row.reservedNote ?? props.row.label}</span>
      <Show when={live()}>
        {(state) => <StatusBadge kind={state().tone}>{state().text}</StatusBadge>}
      </Show>
    </>
  );

  return (
    <Show
      when={props.row.reserved ?? false}
      fallback={
        <Tooltip
          as="a"
          href={`#/${props.row.id}`}
          ariaCurrent={active()}
          content={tooltipContent}
          placement="right"
          class={rowClasses()}
        >
          <Dynamic component={props.row.icon} size={14} class="shrink-0" aria-hidden="true" />
          <span class={ROW_LABEL}>{props.row.label}</span>
        </Tooltip>
      }
    >
      <Tooltip
        content={tooltipContent}
        disabled
        placement="right"
        // No idle hover: the reserved row keeps its resting look under the pointer.
        class={cn(ROW, ROW_RESERVED, DISABLED)}
      >
        <Dynamic component={props.row.icon} size={14} class="shrink-0" aria-hidden="true" />
        <span class={ROW_LABEL}>{props.row.label}</span>
      </Tooltip>
    </Show>
  );
}

/**
 * Map the hidden registry rows into their journey groups, in the nav's own
 * group order; groups without hidden rows stay out of the menu entirely
 * (the rail's own rendering rule, carried on).
 *
 * @param hidden The hidden rows (registry-ordered, as the slice hands them).
 * @returns One entry per group with hidden rows.
 */
function hiddenGroups(hidden: readonly RailRowBox[]): {
  group: NavGroup;
  rows: readonly NavRoute[];
}[] {
  const hiddenIds = new Set(hidden.map((box) => box.route));
  return NAV_GROUPS.map((group) => ({
    group,
    rows: NAV_ROUTES.filter((row) => row.group === group && hiddenIds.has(row.id))
  })).filter((entry) => entry.rows.length > 0);
}

export interface HiddenRowProps {
  /** The registry row the menu item carries. */
  row: NavRoute;
  /** The current route (drives `aria-current` on the hidden active row). */
  route: Accessor<RouteId>;
  /** The loaded page data driving the item's live-state chip. */
  data: Accessor<FdtData | null>;
}

/**
 * Render one hidden registry row as a menu item: a real hash link (the
 * rail's own href form; the browser navigates while Kobalte closes the
 * menu on selection), the row's visible label beside its live-state chip,
 * and `aria-current` riding the hidden active row. The reserved row renders
 * disabled with its note as the item's description line — the
 * disabled-but-explained pattern, menu-carried (the rail's version carries
 * it in the tooltip).
 *
 * @param props The row, the active route and the loaded data.
 */
function HiddenRow(props: HiddenRowProps): JSX.Element {
  const live = createMemo(() => resolveLiveState(props.row, props.data()));
  const active = (): boolean => props.route() === props.row.id;
  return (
    <Show
      when={props.row.reserved ?? false}
      fallback={
        <Menu.Item
          as="a"
          href={`#/${props.row.id}`}
          aria-current={active() ? 'page' : undefined}
          closeOnSelect
          data-fdt="nav-overflow-item"
          class={MENU_ITEM_CLASSES}
        >
          <Dynamic component={props.row.icon} size={14} class="shrink-0" aria-hidden="true" />
          <Menu.ItemLabel class={MENU_ITEM_LABEL_CLASSES}>
            <span class="min-w-0 truncate">{props.row.label}</span>
            <Show when={live()}>
              {(state) => (
                <StatusBadge kind={state().tone} class="shrink-0">
                  {state().text}
                </StatusBadge>
              )}
            </Show>
          </Menu.ItemLabel>
        </Menu.Item>
      }
    >
      <Menu.Item
        disabled
        data-fdt="nav-overflow-item"
        class={cn(MENU_ITEM_CLASSES, MENU_ITEM_WITH_NOTE_CLASSES, ROW_RESERVED, DISABLED)}
      >
        <Dynamic component={props.row.icon} size={14} class="shrink-0" aria-hidden="true" />
        <Menu.ItemLabel class={MENU_ITEM_LABEL_CLASSES}>{props.row.label}</Menu.ItemLabel>
        <Menu.ItemDescription class={MENU_ITEM_NOTE_CLASSES}>
          {props.row.reservedNote}
        </Menu.ItemDescription>
      </Menu.Item>
    </Show>
  );
}

/** The overflow trigger's accessible name — the rail's launcher for the hidden rows. */
export const OVERFLOW_TRIGGER_LABEL = 'More pages';

export interface RailOverflowNavProps {
  /** The rows the rail has overflowed, registry-ordered. */
  hidden: Accessor<readonly RailRowBox[]>;
  /** The current route (drives `aria-current` on the menu's rows). */
  route: Accessor<RouteId>;
  /** The loaded page data driving the menu rows' live state. */
  data: Accessor<FdtData | null>;
}

/**
 * The rail's overflow affordance: the rail-end "More pages" trigger and its
 * APG menu of the hidden rows.
 *
 * The trigger is the shared tooltip's menu-trigger form — one physical
 * element carrying the tooltip's attribution contract *and* Kobalte's menu
 * trigger contract (keyboard open, collision-aware anchor, `aria-haspopup`,
 * `aria-expanded`, `aria-controls`); the tooltip hides itself when its
 * trigger is clicked, so the two never stack visually. The menu is
 * non-modal (the shell around it stays perceivable and pointer-live) and
 * anchors `right-start` — beside the rail column like every rail tooltip —
 * with the popper's collision handling keeping it inside the window at the
 * rail's bottom edge.
 *
 * The whole affordance mounts per appearance: no overflow, no DOM (and no
 * tab stop); each appearance owns a fresh open state.
 */
function RailOverflowNav(props: RailOverflowNavProps): JSX.Element {
  const [open, setOpen] = createSignal(false);

  return (
    <Menu.Root
      open={open()}
      // Non-modal: the rail below stays perceivable while the flyout is up —
      // a nav continuation, never a blocking overlay.
      modal={false}
      // Right-start = beside the rail column (the rail tooltips' own side);
      // flip/slide keep it inside the window at the rail's bottom edge.
      placement="right-start"
      onOpenChange={setOpen}
    >
      <div data-fdt="panel-nav-overflow-block" class={NAV_TRIGGER_BLOCK}>
        <Tooltip
          as="menu-trigger"
          content={
            <>
              <span class="font-medium">{OVERFLOW_TRIGGER_LABEL}</span>
              <span class="block text-2xs text-fg-secondary">{props.hidden().length} hidden</span>
            </>
          }
          placement="right"
          ariaLabel={OVERFLOW_TRIGGER_LABEL}
          ariaHasPopup="menu"
          ariaExpanded={open()}
          class={cn(ROW, ROW_IDLE)}
        >
          {/* The chevron's direction is the open state's own affordance: the
              instant flip is a state swap, not an animation. */}
          <Dynamic
            component={ChevronDown}
            size={14}
            class={cn('shrink-0', open() ? 'rotate-180' : '')}
            aria-hidden="true"
          />
        </Tooltip>
      </div>
      <Menu.Portal>
        <Menu.Content data-fdt="panel-nav-overflow-menu" class={MENU_CONTENT_CLASSES}>
          {/* The groups the hidden rows span, in the nav's own group order;
              separators appear exactly where two groups meet inside the
              hidden set — the rail's hairline grammar carried on. */}
          <For each={hiddenGroups(props.hidden())}>
            {({ rows }, groupIndex) => (
              <>
                <Show when={groupIndex() > 0}>
                  <Menu.Separator class={MENU_SEPARATOR_CLASSES} />
                </Show>
                <For each={rows}>
                  {(row) => <HiddenRow row={row} route={props.route} data={props.data} />}
                </For>
              </>
            )}
          </For>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Render the adaptive nav — headless relative to the data layer (the shell
 * composes it): everything browser-specific flows in as accessors, so the
 * component renders identically in tests and in the panel.
 *
 * The rail's own slice lifecycle: measure once at mount (before the first
 * paint, so a short DevTools window boots into its sliced rail directly),
 * then re-measure on every rail-size change through the watch seam. A
 * truthful measurement slices the registry; an untruthful one (no stub,
 * degenerate boxes, a zero-height rail) is contained — the rail keeps its
 * current slice rather than re-deciding from noise.
 *
 * @param props The active route and the loaded page data (+ optional test
 *   seams for measure and watch — production uses the real DOM ones).
 */
export function AdaptiveNav(props: AdaptiveNavProps): JSX.Element {
  // Render-time static data: the registry is a module constant, so groups
  // and rows never re-derive (and the row elements keyed by For stay
  // identity-stable across every slice change).
  const groups = groupedRoutes().filter((entry) => entry.rows.length > 0);
  const [slice, setSlice] = createSignal<RailSlice>(fullRailSlice());
  /** The hidden rows' id set (the per-row and per-group visibility gates). */
  const hiddenIds = createMemo(() => new Set(slice().hidden.map((box) => box.route)));

  let railEl: HTMLElement | undefined;
  // Both seams are deliberate once-per-mount captures (the component body
  // runs once; a seam is never reactively swapped), so the
  // `solid/reactivity` warning's concern does not apply — silenced uniformly
  // rather than by exception, the same pattern the shell's injection uses.
  //
  // eslint-disable-next-line solid/reactivity
  const measure = props.measure ?? realRailMeasure;
  // eslint-disable-next-line solid/reactivity
  const watch = props.watch ?? realRailWatch;

  /**
   * One measurement decision: read, slice, and commit only when the slice
   * changed — the rail re-renders on slice changes, never on every resize
   * tick.
   */
  const decide = (): void => {
    if (railEl === undefined) return;
    const measured = measure(railEl);
    // Nothing truthful measured: keep the current slice (a failed read must
    // never be the reason rows vanish).
    if (measured === null) return;
    let overflow: RailOverflow;
    try {
      overflow = visibleRowsInRail(measured.rows, measured.availableHeight);
    } catch (cause) {
      // The seam is the generous boundary; the computation is the strict
      // one. A contract break here is a bug in this module, so it logs and
      // keeps the current slice instead of taking the nav down.
      log.error('Rail slice computation failed — keeping the current slice', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
      return;
    }
    const nextVisible = overflow.visible.map((box) => box.route).join('·');
    const nextHidden = overflow.hidden.map((box) => box.route).join('·');
    const currentVisible = slice()
      .visible.map((box) => box.route)
      .join('·');
    const currentHidden = slice()
      .hidden.map((box) => box.route)
      .join('·');
    if (nextVisible === currentVisible && nextHidden === currentHidden) return;
    setSlice({ visible: overflow.visible, hidden: overflow.hidden });
  };

  onMount(() => {
    if (railEl === undefined) {
      log.warn('Rail measurement skipped — the rail element ref was not bound');
      return;
    }
    decide();
    const stop = watch(railEl, decide);
    onCleanup(() => {
      stop();
    });
  });

  /** The overflow threshold: any hidden row — the trigger only renders then. */
  const overflowed = createMemo(() => slice().hidden.length > 0);

  return (
    <>
      <nav aria-label={NAV_LABEL} data-fdt="panel-nav" class={NAV} ref={railEl}>
        {/* Groups whose rows all land in a later phase stay out of the DOM
            entirely — a stranded "Tools" separator over nothing would be
            noise, not scent (rows appear additively). A group whose rows
            are all hidden drops out too (its separator would strand over
            the cut). */}
        <For each={groups}>
          {({ group, rows: groupRows }) => (
            <Show when={groupRows.some((row) => !hiddenIds().has(row.id))}>
              <div data-fdt-nav-group={group} class={GROUP}>
                {/* The list's own accessible name names the group for assistive
                    tech; the rail shows no visible caption (icon-only rows). */}
                <ul aria-label={group} class={GROUP_LIST}>
                  <For each={groupRows}>
                    {(row) => (
                      <Show when={!hiddenIds().has(row.id)}>
                        <li>
                          <NavRow row={row} route={props.route} data={props.data} />
                        </li>
                      </Show>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          )}
        </For>
        {/* The geometry stub (see NAV_MIRROR): every registry row, in the
            rail's own layout, invisible and outside every interaction and
            accessibility path — this is the measurement the slice is
            computed from. Deliberately without the real list's group hook:
            `[data-fdt-nav-group]` stays the real rail's marker; the stub
            rows' own route attribute is what the measure seam reads. */}
        <div data-fdt="panel-nav-mirror" aria-hidden="true" class={NAV_MIRROR}>
          <For each={groups}>
            {({ rows: groupRows }) => (
              <div class={GROUP}>
                <ul class={GROUP_LIST}>
                  <For each={groupRows}>
                    {(row) => (
                      <li>
                        <div
                          {...({ [NAV_MIRROR_ROW_ATTR]: row.id } as Record<string, string>)}
                          data-fdt="panel-nav-mirror-row"
                          class={ROW}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            )}
          </For>
        </div>
      </nav>
      <Show when={overflowed()}>
        <RailOverflowNav hidden={() => slice().hidden} route={props.route} data={props.data} />
      </Show>
    </>
  );
}
