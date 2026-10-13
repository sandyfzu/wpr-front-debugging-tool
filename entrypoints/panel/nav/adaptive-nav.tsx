/**
 * The panel's adaptive navigation — the nav registry's full consumer: one
 * typed surface rendering every journey group in both docking geometries.
 *
 * Morphology: the same DOM carries both forms; Tailwind container-query
 * variants over the shell's `#root` inline size switch the shapes — no JS
 * resize listeners, no second tree, nothing re-renders on resize (the
 * threshold is `nav/morphology.ts`'s one declaring site, mirrored here as
 * the `@min-[768px]:` class literals its sync guard pins).
 *
 * - ≥ 768px (docked bottom / undocked): a grouped, horizontal top tab bar —
 *   a caption per group, icon+label rows, horizontal scroll on overflow
 *   (rows never wrap, so overflow is scroll, never clipping).
 * - < 768px (docked right): a left icon rail — square icon rows under
 *   hairline group separators; each group's name is announced as the list's
 *   accessible name, and each row's full label + live state rides its
 *   tooltip (the visible naming surface for icon-only rows).
 *
 * Live state: rows that carry a registry selector resolve it against the
 * loaded page data and surface the resulting status chip beside their label
 * (the chip itself is the shared status vocabulary, so the five tones stay
 * AA-verified pairs by construction), which makes the nav an information
 * surface rather than a label list.
 */
import { For, Show, createMemo, type Accessor, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DISABLED } from '../../../components/ui/classes';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import { cn } from '../../../utils/cn';
import { createLogger } from '../../../lib/logger';
import type { FdtData } from '../../../lib/wp-rocket/types';
import {
  NAV_GROUPS,
  NAV_ROUTES,
  type NavGroup,
  type NavLiveState,
  type NavRoute,
  type RouteId
} from '../routes';

const log = createLogger('panel');

/** The nav's role name. */
const NAV_LABEL = 'WPR FDT pages';

export interface AdaptiveNavProps {
  /** The current route accessor (the shell's hash router). */
  route: Accessor<RouteId>;
  /** The loaded page data — null outside the loaded states (no live state yet). */
  data: Accessor<FdtData | null>;
}

/**
 * The registry rows grouped for rendering, in the registry's own group
 * order, each cluster carrying its rows in registry order. Consumers skip
 * clusters without rows (a future-phase group renders no caption, no
 * separator — rows appear additively).
 *
 * @returns One entry per journey group.
 */
export function groupedRoutes(): Array<{ group: NavGroup; rows: readonly NavRoute[] }> {
  return NAV_GROUPS.map((group) => ({
    group,
    rows: NAV_ROUTES.filter((row) => row.group === group)
  }));
}

/**
 * The nav's anatomy: icon-rail base (narrow docking) morphing to the top
 * tab bar. Both axes scroll — the rail vertically, the bar horizontally
 * (`overflow-y:auto` computes the other axis to `auto` as well), matching
 * the cold fact that rows grow additively with future Tools pages.
 */
const NAV = `flex min-w-0 flex-1 flex-col overflow-y-auto
  @min-[768px]:flex-row @min-[768px]:items-center`;

/**
 * One journey group: a hairline-topped cluster on the rail (never above the
 * first), a captioned cluster behind a left hairline on the bar.
 */
const GROUP = `flex flex-col border-t border-line-2 pt-1.5 first:border-t-0 first:pt-0
  @min-[768px]:flex-row @min-[768px]:items-center @min-[768px]:gap-1 @min-[768px]:border-t-0
  @min-[768px]:border-l @min-[768px]:pl-2 @min-[768px]:first:border-l-0 @min-[768px]:first:pl-0`;

/** The group's caption: rail-invisible (the list is named), bar-visible texture. */
const GROUP_CAPTION = `sr-only @min-[768px]:not-sr-only pb-0.5 text-2xs font-medium uppercase
  leading-4 tracking-widest text-fg-muted whitespace-nowrap`;

/** The group's row list, reshaped with the morphology. */
const GROUP_LIST = `flex flex-col items-center gap-1
  @min-[768px]:flex-row @min-[768px]:gap-1`;

/**
 * One nav row: a 32px square icon on the rail, an icon+label+state row on
 * the bar. Hit areas stay one shared 32px row in both forms.
 */
const ROW = `flex h-8 w-8 items-center justify-center rounded whitespace-nowrap text-2xs font-medium
  no-underline @min-[768px]:w-auto @min-[768px]:justify-start @min-[768px]:px-2.5`;

/** The active row's treatment. */
const ROW_ACTIVE = 'bg-surface-3 text-fg-primary';
/** The rest rows' treatment (the hover surface every interactive gets). */
const ROW_IDLE = 'text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

/**
 * The row's label: content-named on the rail (screen readers read it, the
 * tooltip shows it to sighted users), visible text on the bar.
 */
const ROW_LABEL = 'sr-only @min-[768px]:not-sr-only';

/** The live-state chip: tooltip-resident on the rail, inline beside the label on the bar. */
const ROW_CHIP = 'hidden @min-[768px]:flex shrink-0';

/** The disabled reserved row's treatment (inside the registry-driven tooltip). */
const ROW_RESERVED = 'text-fg-muted';

export interface NavRowProps {
  /** The registry row to render. */
  row: NavRoute;
  /** The current route (drives the active treatment + `aria-current`). */
  route: Accessor<RouteId>;
  /** The loaded page data driving the row's live state. */
  data: Accessor<FdtData | null>;
}

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

/**
 * Render one registry row as its shared two-morphology element.
 *
 * Non-reserved rows are real anchors (`#/route` hash form); reserved rows
 * are the disabled explained button. Both forms answer their tooltip with
 * the row's full label (or the reserved note) plus the live-state chip.
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
          placement="bottom"
          class={rowClasses()}
        >
          <Dynamic component={props.row.icon} size={14} class="shrink-0" aria-hidden="true" />
          <span class={ROW_LABEL}>{props.row.label}</span>
          <Show when={live()}>
            {(state) => (
              <span data-fdt="nav-live-state" class={ROW_CHIP}>
                <StatusBadge kind={state().tone}>{state().text}</StatusBadge>
              </span>
            )}
          </Show>
        </Tooltip>
      }
    >
      <Tooltip
        content={tooltipContent}
        disabled
        placement="bottom"
        class={cn(rowClasses(), ROW_RESERVED, DISABLED)}
      >
        <Dynamic component={props.row.icon} size={14} class="shrink-0" aria-hidden="true" />
        <span class={ROW_LABEL}>{props.row.label}</span>
      </Tooltip>
    </Show>
  );
}

/**
 * Render the adaptive nav — headless relative to the data layer (the shell
 * composes it): everything browser-specific flows in as accessors, so the
 * component renders identically in tests and in the panel.
 *
 * @param props The active route and the loaded page data.
 */
export function AdaptiveNav(props: AdaptiveNavProps): JSX.Element {
  return (
    <nav aria-label={NAV_LABEL} data-fdt="panel-nav" class={NAV}>
      {/* Groups whose rows all land in a later phase stay out of the DOM
          entirely — a captionless "Tools" bar cluster or a stranded rail
          separator would be noise, not scent (rows appear additively). */}
      <For each={groupedRoutes().filter((entry) => entry.rows.length > 0)}>
        {({ group, rows }) => (
          <div data-fdt-nav-group={group} class={GROUP}>
            {/* Visible group caption on the bar; the list's own name names
                the group for assistive tech in both morphologies. */}
            <span aria-hidden="true" class={GROUP_CAPTION}>
              {group}
            </span>
            <ul aria-label={group} class={GROUP_LIST}>
              <For each={rows}>
                {(row) => (
                  <li>
                    <NavRow row={row} route={props.route} data={props.data} />
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  );
}
