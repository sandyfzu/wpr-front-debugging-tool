/**
 * The panel's navigation — the nav registry's full consumer: one typed
 * surface rendering every journey group beside the content region, in one
 * of two forms (the shell picks it): the icon rail, or the labeled sidebar.
 *
 * Notes: rows that carry a registry selector resolve it against the loaded
 * page data — their live state, else their item count. A rail row shows it
 * inside its tooltip (the shared status vocabulary's badge); a labeled row
 * shows it in its right column (the full phrase is the row's description);
 * a menu row (the overflow affordance) inline beside its label.
 *
 * Overflow: the nav never scrolls and never clips a row, in either form. A
 * measure seam reads the rendered nav's real geometry (a full-layout stub
 * in the current form carries every registry row's box, so the numbers are
 * the form's own, not hard-coded pitches) and {@link visibleRowsInRail}
 * slices the registry into the rows that fit and the rows that move to the
 * nav-end "More pages" menu. A failed measurement is contained: the nav
 * keeps the slice it has until a truthful measurement arrives. A form
 * switch re-measures at once (before the next paint).
 */
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
  onMount,
  type Accessor,
  type JSX
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { StatusBadge, StatusDot } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import { cn } from '../../../utils/cn';
import { createLogger } from '../../../lib/logger';
import type { NavForm } from '../../../lib/panel/nav-mode';
import type { FdtData } from '../../../lib/wp-rocket/types';
import {
  realRailMeasure,
  realRailWatch,
  NAV_MIRROR_ROW_ATTR,
  type RailMeasureFn,
  type RailWatchFn
} from './rail-metrics';
import { NAV_GROUPS, NAV_ROUTES, type NavGroup, type NavRoute, type RouteId } from '../routes';
import { visibleRowsInRail, type RailOverflow, type RailRowBox } from './visible-rows';
import {
  NAV_FORM_CLASSES,
  NAV_ICON_ACTIVE,
  NAV_ROW_LABEL,
  NAV_ROW_NOTE,
  navNoteToneClass,
  type NavFormClasses
} from './nav-forms';
import { createFocusCarry, type FocusCarryRef } from './focus-carry';
import { OverflowNav } from './overflow-nav';
import { resolveRowNote, rowTitle } from './row-note';

const log = createLogger('panel');

/** The nav's role name. */
const NAV_LABEL = 'WPR FDT pages';

/** The form a nav renders when the shell names none (the rail: the narrow-safe one). */
const DEFAULT_FORM: NavForm = 'rail';

/**
 * The registry rows grouped for rendering, in the registry's own group
 * order, each cluster carrying its rows in registry order. Consumers skip
 * clusters without rows (a future-phase group renders nothing — rows appear
 * additively). The registry is a module constant, so this is static data.
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
  /** The loaded page data — null outside the loaded states (no notes yet). */
  data: Accessor<FdtData | null>;
  /** The form to render (the shell's width/pin rule); absent, the rail. */
  form?: Accessor<NavForm>;
  /**
   * The measure seam (tests inject prepared geometries; absent, the real
   * DOM read is used — the only path in production).
   */
  measure?: RailMeasureFn;
  /**
   * The nav-size watch (tests drive resizes themselves; absent, the
   * ResizeObserver-based watcher is used — the only path in production).
   */
  watch?: RailWatchFn;
}

/** The slice state: which registry rows stay, which the menu reveals. */
interface RailSlice {
  /** The rows kept in the nav, registry-ordered. */
  readonly visible: readonly RailRowBox[];
  /** The rows moved to the overflow menu, registry-ordered (maybe empty). */
  readonly hidden: readonly RailRowBox[];
}

/**
 * The unmeasured nav's slice: everything visible — the first truthful
 * measurement (on mount, before paint) may slice it. The visible boxes are
 * comparison sentinels (top/height zero); the per-row gates read the hidden
 * set, which is honestly empty here.
 *
 * @returns The full-visibility slice over the registry.
 */
function fullRailSlice(): RailSlice {
  return {
    visible: NAV_ROUTES.map((row) => ({ route: row.id, top: 0, height: 0 })),
    hidden: []
  };
}

/** The nav's anatomy (both forms): a column that never scrolls. */
const NAV = 'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';

/**
 * The geometry stub's container: a zero-size clip box on the nav's content
 * origin, holding the full-layout stub (every registry row, in the current
 * form). Invisible and uninteractive everywhere (visibility + clip +
 * `aria-hidden` + plain divs, never focusable); its clipped zero box keeps
 * the nav's rendered height exactly its visible content's height.
 */
const NAV_MIRROR = 'invisible absolute left-0 top-0 h-0 w-0 overflow-clip pointer-events-none';

export interface NavRowProps {
  /** The registry row to render. */
  row: NavRoute;
  /** The current route (drives the active treatment + `aria-current`). */
  route: Accessor<RouteId>;
  /** The loaded page data driving the row's note. */
  data: Accessor<FdtData | null>;
  /** The form's class table. */
  classes: Accessor<NavFormClasses>;
  /** The row's focus carry (keeps focus on the row across a form switch). */
  focusRef: FocusCarryRef;
}

/**
 * The row's icon, accent-colored while active.
 *
 * @param props The row and whether it is active.
 */
function RowIcon(props: { row: NavRoute; active: boolean }): JSX.Element {
  return (
    <Dynamic
      component={props.row.icon}
      size={14}
      class={cn('shrink-0', props.active ? NAV_ICON_ACTIVE : '')}
      aria-hidden="true"
    />
  );
}

/**
 * One rail row: an icon-square anchor (`#/route` hash form) whose tooltip
 * answers with the full label plus the row's note, floated to the row's
 * *right* — beside the rail, never over the sibling rows below (a
 * below-placed tooltip would swallow the next row's clicks).
 *
 * @param props The row, the active route, the data and the class table.
 */
function RailRow(props: NavRowProps): JSX.Element {
  const note = createMemo(() => resolveRowNote(props.row, props.data()));
  const active = (): boolean => props.route() === props.row.id;
  const rowClasses = createMemo(() =>
    cn(props.classes().row, active() ? props.classes().rowActive : props.classes().rowIdle)
  );

  const tooltipContent = (
    <>
      <span class="font-medium">{props.row.label}</span>
      <Show when={note()}>
        {(state) => <StatusBadge kind={state().tone}>{state().text}</StatusBadge>}
      </Show>
    </>
  );

  return (
    <Tooltip
      as="a"
      href={`#/${props.row.id}`}
      ariaCurrent={active()}
      content={tooltipContent}
      placement="right"
      ref={props.focusRef}
      class={rowClasses()}
    >
      <RowIcon row={props.row} active={active()} />
      <span class="sr-only">{props.row.label}</span>
    </Tooltip>
  );
}

/**
 * One labeled row: icon, label, and the note in the right column (its short
 * form; the full phrase is the row's description). The label is the whole
 * accessible name, as on the rail.
 *
 * @param props The row, the active route, the data and the class table.
 */
function LabeledRow(props: NavRowProps): JSX.Element {
  const note = createMemo(() => resolveRowNote(props.row, props.data()));
  const active = (): boolean => props.route() === props.row.id;
  const descriptionId = createUniqueId();
  return (
    <a
      ref={props.focusRef}
      href={`#/${props.row.id}`}
      aria-current={active() ? 'page' : undefined}
      aria-describedby={note() === null ? undefined : descriptionId}
      title={rowTitle(props.row, note())}
      class={cn(
        props.classes().row,
        active() ? props.classes().rowActive : props.classes().rowIdle
      )}
    >
      <RowIcon row={props.row} active={active()} />
      <span class={NAV_ROW_LABEL}>{props.row.label}</span>
      <Show when={note()}>
        {(state) => (
          <>
            <Show
              when={state().short}
              fallback={<StatusDot kind={state().tone} class="ml-auto shrink-0" />}
            >
              {(short) => (
                <span
                  aria-hidden="true"
                  data-fdt="panel-nav-note"
                  class={cn(NAV_ROW_NOTE, navNoteToneClass(state().tone))}
                >
                  {short()}
                </span>
              )}
            </Show>
            <span id={descriptionId} hidden>
              {state().text}
            </span>
          </>
        )}
      </Show>
    </a>
  );
}

/**
 * One registry row in the current form. A form switch swaps the row's
 * element (a rail tooltip anchor ↔ a labeled anchor); the row's focus carry
 * keeps a focused row focused across the swap. The carry lives with the
 * row: a row moved to the overflow menu is disposed with its own.
 *
 * @param props The row, the active route, the data, the class table and the form.
 */
function NavRow(props: Omit<NavRowProps, 'focusRef'> & { form: Accessor<NavForm> }): JSX.Element {
  const focusRef = createFocusCarry();
  return (
    <Show
      when={props.form() === 'labeled'}
      fallback={
        <RailRow
          row={props.row}
          route={props.route}
          data={props.data}
          classes={props.classes}
          focusRef={focusRef}
        />
      }
    >
      <LabeledRow
        row={props.row}
        route={props.route}
        data={props.data}
        classes={props.classes}
        focusRef={focusRef}
      />
    </Show>
  );
}

/**
 * Render the adaptive nav — headless relative to the data layer (the shell
 * composes it): everything browser-specific flows in as accessors, so the
 * component renders identically in tests and in the panel.
 *
 * The slice lifecycle: measure once at mount (before the first paint, so a
 * short DevTools window boots into its sliced nav directly), then on every
 * nav-size change through the watch seam and on every form switch. A
 * truthful measurement slices the registry; an untruthful one is contained
 * — the nav keeps its current slice rather than re-deciding from noise.
 *
 * @param props The route, the loaded data, the form (+ optional test seams
 *   for measure and watch — production uses the real DOM ones).
 */
export function AdaptiveNav(props: AdaptiveNavProps): JSX.Element {
  // Static data: the registry is a module constant, so groups and rows
  // never re-derive (and the For-keyed rows stay identity-stable across
  // every slice change).
  const groups = groupedRoutes().filter((entry) => entry.rows.length > 0);
  const [slice, setSlice] = createSignal<RailSlice>(fullRailSlice());
  /** The hidden rows' id set (the per-row and per-group visibility gates). */
  const hiddenIds = createMemo(() => new Set(slice().hidden.map((box) => box.route)));
  const form = (): NavForm => props.form?.() ?? DEFAULT_FORM;
  const classes = createMemo(() => NAV_FORM_CLASSES[form()]);

  let railEl: HTMLElement | undefined;
  // Both seams are deliberate once-per-mount captures (the component body
  // runs once; a seam is never reactively swapped), so the
  // `solid/reactivity` warning's concern does not apply.
  //
  // eslint-disable-next-line solid/reactivity
  const measure = props.measure ?? realRailMeasure;
  // eslint-disable-next-line solid/reactivity
  const watch = props.watch ?? realRailWatch;

  /**
   * One measurement decision: read, slice, and commit only when the slice
   * changed — the nav re-renders on slice changes, never on every resize.
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
      // one. A contract break here is a bug in this module: log and keep
      // the current slice instead of taking the nav down.
      log.error('Rail slice computation failed — keeping the current slice', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
      return;
    }
    const routesOf = (boxes: readonly RailRowBox[]): string =>
      boxes.map((box) => box.route).join('·');
    const current = slice();
    if (
      routesOf(overflow.visible) === routesOf(current.visible) &&
      routesOf(overflow.hidden) === routesOf(current.hidden)
    ) {
      return;
    }
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

  // A form switch re-lays the stub out in the new form's geometry: slice
  // again right away (the DOM is already updated when the effect runs, so
  // the read sees the new layout and the next paint shows the new slice).
  createEffect(on(form, decide, { defer: true }));

  /** The overflow threshold: any hidden row — the trigger only renders then. */
  const overflowed = createMemo(() => slice().hidden.length > 0);

  return (
    <>
      <nav
        aria-label={NAV_LABEL}
        data-fdt="panel-nav"
        data-fdt-nav-form={form()}
        class={NAV}
        ref={railEl}
      >
        {/* A group whose rows are all hidden drops out (its separator or
            caption would strand over the cut). */}
        <For each={groups}>
          {({ group, rows: groupRows }) => (
            <Show when={groupRows.some((row) => !hiddenIds().has(row.id))}>
              <div data-fdt-nav-group={group} class={classes().group}>
                {/* The list's own name names the group for assistive tech;
                    the labeled caption shows it to sighted users. */}
                <Show when={classes().caption}>
                  {(caption) => (
                    <div aria-hidden="true" data-fdt="panel-nav-caption" class={caption()}>
                      {group}
                    </div>
                  )}
                </Show>
                <ul aria-label={group} class={classes().list}>
                  <For each={groupRows}>
                    {(row) => (
                      <Show when={!hiddenIds().has(row.id)}>
                        <li>
                          <NavRow
                            row={row}
                            route={props.route}
                            data={props.data}
                            classes={classes}
                            form={form}
                          />
                        </li>
                      </Show>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          )}
        </For>
        {/* The geometry stub (see NAV_MIRROR): every registry row in the
            current form's layout, captions included, outside every
            interaction and accessibility path. Deliberately without the
            real list's group hook: `[data-fdt-nav-group]` stays the real
            nav's marker; the stub rows' route attribute is what the
            measure seam reads. */}
        <div data-fdt="panel-nav-mirror" aria-hidden="true" class={NAV_MIRROR}>
          <For each={groups}>
            {({ group, rows: groupRows }) => (
              <div class={classes().group}>
                <Show when={classes().caption}>
                  {(caption) => <div class={caption()}>{group}</div>}
                </Show>
                <ul class={classes().list}>
                  <For each={groupRows}>
                    {(row) => (
                      <li>
                        <div
                          {...({ [NAV_MIRROR_ROW_ATTR]: row.id } as Record<string, string>)}
                          data-fdt="panel-nav-mirror-row"
                          class={classes().row}
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
        <OverflowNav
          hidden={() => slice().hidden}
          route={props.route}
          data={props.data}
          form={form}
        />
      </Show>
    </>
  );
}
