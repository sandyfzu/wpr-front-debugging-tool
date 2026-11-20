/**
 * The nav's overflow affordance: the "More pages" trigger at the nav's end
 * and its APG menu of the rows that did not fit — in both nav forms.
 *
 * The rows stay full citizens in the menu: real hash links, their note
 * (live state or count) and `aria-current`. The menu is non-modal (the shell
 * stays perceivable and pointer-live) and anchors `right-start`, beside the
 * nav column, with the popper's collision handling keeping it in the window.
 * The trigger is one element carrying both the shared tooltip's and the
 * menu trigger's contracts (the hidden count rides the tooltip); the rail
 * shows its chevron alone, the labeled form adds the label and the count.
 * The affordance mounts per appearance: no overflow, no DOM and no tab stop.
 */
import { For, Show, createMemo, createSignal, type Accessor, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import {
  Menu,
  MENU_CONTENT_CLASSES,
  MENU_ITEM_CLASSES,
  MENU_ITEM_LABEL_CLASSES,
  MENU_SEPARATOR_CLASSES
} from '../../../components/ui/menu';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import type { NavForm } from '../../../lib/panel/nav-mode';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { cn } from '../../../utils/cn';
import { NAV_GROUPS, NAV_ROUTES, type NavGroup, type NavRoute, type RouteId } from '../routes';
import { NAV_FORM_CLASSES, NAV_ROW_LABEL, NAV_ROW_NOTE, navNoteToneClass } from './nav-forms';
import { resolveRowNote } from './row-note';
import type { RailRowBox } from './visible-rows';

/** The overflow trigger's accessible name — the launcher for the hidden rows. */
export const OVERFLOW_TRIGGER_LABEL = 'More pages';

/**
 * Map the hidden rows into their journey groups, in the nav's group order;
 * groups without hidden rows stay out of the menu.
 *
 * @param hidden The hidden rows (registry-ordered, as the slice hands them).
 * @returns One entry per group with hidden rows.
 */
export function hiddenGroups(
  hidden: readonly RailRowBox[]
): { group: NavGroup; rows: readonly NavRoute[] }[] {
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
  /** The loaded page data driving the item's note. */
  data: Accessor<FdtData | null>;
}

/**
 * One hidden row as a menu item: a real hash link (the browser navigates
 * while Kobalte closes the menu), its label beside its note chip, and
 * `aria-current` on the hidden active row.
 *
 * @param props The row, the active route and the loaded data.
 */
function HiddenRow(props: HiddenRowProps): JSX.Element {
  const note = createMemo(() => resolveRowNote(props.row, props.data()));
  const active = (): boolean => props.route() === props.row.id;
  return (
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
        <Show when={note()}>
          {(state) => (
            <StatusBadge kind={state().tone} class="shrink-0">
              {state().text}
            </StatusBadge>
          )}
        </Show>
      </Menu.ItemLabel>
    </Menu.Item>
  );
}

export interface OverflowNavProps {
  /** The rows the nav has overflowed, registry-ordered. */
  hidden: Accessor<readonly RailRowBox[]>;
  /** The current route (drives `aria-current` on the menu's rows). */
  route: Accessor<RouteId>;
  /** The loaded page data driving the menu rows' notes. */
  data: Accessor<FdtData | null>;
  /** The nav's form (the trigger's look). */
  form: Accessor<NavForm>;
}

/**
 * Render the overflow trigger and its menu.
 *
 * @param props The hidden rows, the route, the data and the form.
 */
export function OverflowNav(props: OverflowNavProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const classes = (): (typeof NAV_FORM_CLASSES)[NavForm] => NAV_FORM_CLASSES[props.form()];
  /** The chevron: its flip is the open state's own affordance (a state swap, not motion). */
  const chevron = (): JSX.Element => (
    <Dynamic
      component={ChevronDown}
      size={14}
      class={cn('shrink-0', open() ? 'rotate-180' : '')}
      aria-hidden="true"
    />
  );

  return (
    <Menu.Root
      open={open()}
      // Non-modal: a nav continuation, never a blocking overlay.
      modal={false}
      // Beside the nav column, like the rail tooltips; flip/slide keep it in the window.
      placement="right-start"
      onOpenChange={setOpen}
    >
      <div data-fdt="panel-nav-overflow-block" class={classes().triggerBlock}>
        {/* One trigger element in both forms (the shared tooltip's menu-trigger
            form, as every panel menu): the rail shows the chevron alone, the
            labeled form adds the label and the hidden count. */}
        <Tooltip
          as="menu-trigger"
          content={
            <>
              <span class="font-medium">{OVERFLOW_TRIGGER_LABEL}</span>
              <span class="block text-2xs text-fg-secondary">{props.hidden().length} hidden</span>
            </>
          }
          placement="right"
          // The rail's icon square is named here; the labeled row by its
          // visible label (a name that differs from the shown words fails
          // label-in-name).
          ariaLabel={props.form() === 'labeled' ? undefined : OVERFLOW_TRIGGER_LABEL}
          ariaHasPopup="menu"
          ariaExpanded={open()}
          class={cn(classes().row, classes().rowIdle)}
        >
          {chevron()}
          <Show when={props.form() === 'labeled'}>
            <span class={NAV_ROW_LABEL}>{OVERFLOW_TRIGGER_LABEL}</span>
            <span aria-hidden="true" class={cn(NAV_ROW_NOTE, navNoteToneClass('neutral'))}>
              {props.hidden().length}
            </span>
          </Show>
        </Tooltip>
      </div>
      <Menu.Portal>
        <Menu.Content data-fdt="panel-nav-overflow-menu" class={MENU_CONTENT_CLASSES}>
          {/* Separators exactly where two groups meet inside the hidden set. */}
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
