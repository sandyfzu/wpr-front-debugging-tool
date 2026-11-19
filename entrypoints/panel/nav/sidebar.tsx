/**
 * The shell's nav column: decides the nav's form (labeled sidebar or icon
 * rail) from the shell width, the user's pin and the page's detail presence,
 * and holds the collapse/expand button at its bottom.
 *
 * The form switch is instant (no width animation); the nav re-slices its
 * overflow in the same frame. Below the top bar's full-width threshold every
 * pin renders the rail, so the button is absent there (nothing to toggle).
 */
import { Show, createMemo, type Accessor, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import PanelLeftClose from 'lucide-solid/icons/panel-left-close';
import PanelLeftOpen from 'lucide-solid/icons/panel-left-open';
import { Tooltip } from '../../../components/ui/tooltip';
import {
  navMode,
  navToggleAvailable,
  toggledNavPin,
  type NavForm,
  type NavModeInput
} from '../../../lib/panel/nav-mode';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { cn } from '../../../utils/cn';
import type { RouteId } from '../routes';
import { useDetailPresence } from '../state/detail-presence';
import { AdaptiveNav } from './adaptive-nav';
import { createFocusCarry } from './focus-carry';
import { NAV_FORM_CLASSES, NAV_ROW_LABEL } from './nav-forms';
import type { NavPinState } from './nav-pin';
import type { RailMeasureFn, RailWatchFn } from './rail-metrics';

/** The toggle's name per form: what a press does. */
export const NAV_TOGGLE_LABELS: Readonly<Record<NavForm, string>> = {
  labeled: 'Collapse sidebar',
  rail: 'Expand sidebar'
};

/**
 * The column (both forms): the nav, its overflow block and the toggle
 * stacked; `z-10` keeps the column painting over the content region (below
 * the panel's usable minimum the "More pages" trigger must stay
 * pointer-reachable, never under a stacked page element); the fixed
 * overlays (dialog z-40+, tooltip/menu portals z-50) rank above it.
 */
const COLUMN = 'relative z-10 flex shrink-0 flex-col gap-2 border-r border-line-2 bg-surface-1';

/** The toggle's block per form (the rail centers its square). */
const TOGGLE_BLOCK: Readonly<Record<NavForm, string>> = {
  labeled: 'flex shrink-0 flex-col',
  rail: 'flex shrink-0 flex-col items-center'
};

export interface SidebarProps {
  /** The current route (the shell's hash router). */
  route: Accessor<RouteId>;
  /** The loaded page data (null outside the loaded states). */
  data: Accessor<FdtData | null>;
  /** The shell's measured width in px (0 until measured: the rail). */
  width: Accessor<number>;
  /** The session pin (read at boot, written by the toggle). */
  pin: NavPinState;
  /** The nav's measure seam (tests only). */
  measure?: RailMeasureFn;
  /** The nav's size-watch seam (tests only). */
  watch?: RailWatchFn;
}

/**
 * Render the nav column. Must render inside the shell's detail-presence
 * provider (the automatic fold reads it).
 *
 * @param props The route, data, shell width, pin (+ the nav's test seams).
 */
export function Sidebar(props: SidebarProps): JSX.Element {
  const presence = useDetailPresence();
  const input = (): NavModeInput => ({
    shellWidth: props.width(),
    pinned: props.pin.pin(),
    detailOpen: presence.detailOpen()
  });
  const form = createMemo(() => navMode(input()));
  const toggleShown = createMemo(() => navToggleAvailable(props.width()));
  const toggle = (): void => {
    props.pin.set(toggledNavPin(input()));
  };

  return (
    <div
      data-fdt="panel-header"
      data-fdt-nav-form={form()}
      class={cn(COLUMN, NAV_FORM_CLASSES[form()].column)}
    >
      <AdaptiveNav
        route={props.route}
        data={props.data}
        form={form}
        measure={props.measure}
        watch={props.watch}
      />
      <Show when={toggleShown()}>
        <div data-fdt="panel-nav-toggle-block" class={TOGGLE_BLOCK[form()]}>
          <NavToggle form={form} onToggle={toggle} />
        </div>
      </Show>
    </div>
  );
}

/**
 * The collapse/expand button: a labeled row in the sidebar, an icon square
 * answering a tooltip on the rail (its name is the action either way). A
 * press swaps the button's element; the focus carry keeps a focused button
 * focused across the swap (a keyboard press can toggle back at once).
 *
 * @param props The current form and the press handler.
 */
function NavToggle(props: { form: Accessor<NavForm>; onToggle: () => void }): JSX.Element {
  const classes = (): (typeof NAV_FORM_CLASSES)[NavForm] => NAV_FORM_CLASSES[props.form()];
  const label = (): string => NAV_TOGGLE_LABELS[props.form()];
  const focusRef = createFocusCarry();
  return (
    <Show
      when={props.form() === 'labeled'}
      fallback={
        <Tooltip
          content={label()}
          placement="right"
          ariaLabel={label()}
          ref={focusRef}
          onClick={() => {
            props.onToggle();
          }}
          class={cn(classes().row, classes().rowIdle)}
        >
          <Dynamic component={PanelLeftOpen} size={14} class="shrink-0" aria-hidden="true" />
        </Tooltip>
      }
    >
      <button
        ref={focusRef}
        type="button"
        onClick={() => {
          props.onToggle();
        }}
        class={cn(classes().row, classes().rowIdle)}
      >
        <Dynamic component={PanelLeftClose} size={14} class="shrink-0" aria-hidden="true" />
        <span class={NAV_ROW_LABEL}>{label()}</span>
      </button>
    </Show>
  );
}
