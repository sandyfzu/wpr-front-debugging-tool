/**
 * THE panel's sub-navigation pattern (UX-D10): every multi-view page uses
 * these tabs and never a bespoke per-page mechanism.
 *
 * Wraps Kobalte's APG tabs (roving `tabindex`, arrow-key navigation) in
 * *automatic* activation — sub-views are cheap to render, so moving focus with
 * the arrows switches the view immediately, as the WAI-ARIA APG recommends
 * for this surface.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Tabs as KobalteTabs } from '@kobalte/core';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

/** One sub-view a `Tabs` switches between, declared by its owning page. */
export interface TabItem {
  /** Stable key carried to `onChange` and connecting trigger↔panel. */
  value: string;
  /** The visible label. */
  label: string;
  /** Whether the view exists but is not reachable right now. */
  disabled?: boolean;
  /** Optional live-state hint rendered next to the label (a count, a state). */
  badge?: string;
}

export interface TabsProps {
  /** The sub-views in registry order — the first enabled one is the default. */
  items: TabItem[];
  /** Controlled selected value (with `onChange`). */
  value?: string;
  /** Uncontrolled initial value (defaults to the first enabled item). */
  defaultValue?: string;
  /** Selected-value change callback. */
  onChange?: (value: string) => void;
  /** Accessible name of the tab list (required context for the APG pattern). */
  label?: string;
  /** Extra classes on the tab list (layout/width), merged last. */
  class?: string;
  /** Extra classes on the root (the bar + panels wrapper), e.g. to let a panel fill a column. */
  rootClass?: string;
  /** The tab panels, rendered inside the root so `TabPanel` connects. */
  children: JSX.Element;
}

/**
 * The tab row: one quiet hairline under text tabs spaced 16 px apart — the
 * selected tab's accent underline is the only emphasis (no fills, no boxes).
 */
const TAB_LIST_CLASSES = 'flex w-full items-end gap-4 border-b border-line-1';

/**
 * Base + state classes of a trigger — an underline tab: 32 px tall, the label
 * nearly flush (2 px) so the spacing between tabs carries the rhythm; selected
 * = primary text over a 2 px accent rule that overlaps the row's hairline.
 */
const TAB_TRIGGER_CLASSES = cn(
  'inline-flex h-8 items-center gap-1.5 -mb-px px-0.5 whitespace-nowrap text-xs font-medium border-b-2 border-transparent',
  'data-selected:border-accent data-selected:text-fg-primary'
);

/**
 * An enabled trigger: muted at rest, primary text on hover — color only, no
 * hover fill (the row stays calm); never applied to a disabled trigger.
 */
const TAB_TRIGGER_ENABLED = 'text-fg-muted hover:text-fg-primary';

/**
 * Disabled treatment: muted, but without the pointer-events kill other
 * surfaces use — disabled tabs stay hover-reachable so a tooltip can explain
 * why the view is reserved. At rest it shares the enabled muted color, so
 * the dimming tells the two apart; a hover color change on a disabled
 * control would lie about its state, so the enabled fragment stays off.
 */
const TAB_TRIGGER_DISABLED = 'text-fg-muted opacity-60';

/**
 * Render the shared tab bar and mount the panels inside its root.
 *
 * Controlled (`value` + `onChange`) or uncontrolled (`defaultValue`) — both
 * stay in sync with the pages' own stores. The selected trigger styles via
 * Kobalte's `data-selected` attribute; its underline overlaps the list's
 * bottom border so the indicator reads as one continuous rule.
 *
 * @param props.items The sub-views, in registry order.
 * @param props.value Controlled selection.
 * @param props.defaultValue Uncontrolled initial selection.
 * @param props.onChange Called with the newly selected value.
 * @param props.label Accessible name for the `tablist` element.
 * @param props.class Extra classes on the list container.
 * @param props.rootClass Extra classes on the root wrapper.
 * @param props.children The `<TabPanel value=…>` elements inside the root.
 */
export function Tabs(props: TabsProps): JSX.Element {
  return (
    <KobalteTabs.Root
      value={props.value}
      // Explicit default so the selected key is deterministic and independent
      // of collection-registration timing (the first enabled item per the APG
      // start state); Kobalte's own self-select only fires once the collection
      // populates, and our wrapper controls that moment instead.
      defaultValue={
        props.value ?? props.defaultValue ?? props.items.find((tab) => !tab.disabled)?.value
      }
      onChange={props.onChange}
      activationMode="automatic"
      class={props.rootClass}
    >
      <KobalteTabs.List aria-label={props.label} class={cn(TAB_LIST_CLASSES, props.class)}>
        <For each={props.items}>
          {(item) => (
            <KobalteTabs.Trigger
              data-fdt-tab={item.value}
              value={item.value}
              disabled={item.disabled}
              class={cn(
                TAB_TRIGGER_CLASSES,
                item.disabled ? TAB_TRIGGER_DISABLED : TAB_TRIGGER_ENABLED,
                FOCUS_RING
              )}
            >
              {item.label}
              <Show when={item.badge}>
                <span data-fdt-tab-badge class="text-2xs font-normal text-fg-muted">
                  {item.badge}
                </span>
              </Show>
            </KobalteTabs.Trigger>
          )}
        </For>
      </KobalteTabs.List>
      {props.children}
    </KobalteTabs.Root>
  );
}

export interface TabPanelProps {
  /** The connected tab's value. */
  value: string;
  /** Extra classes, merged last so callers win. */
  class?: string;
  /** The panel content — unmounted while its tab is not selected. */
  children: JSX.Element;
}

/**
 * Render one tab panel.
 *
 * Inherits Kobalte's `tabpanel` semantics (`role`, `aria-labelledby`
 * connection, panel focusability) — this wrapper adds only the keyboard-focus
 * ring; pages own their inner layout.
 *
 * @param props.value The connected tab value.
 * @param props.class Extra classes (page-defined padding/layout).
 * @param props.children The panel content.
 */
export function TabPanel(props: TabPanelProps): JSX.Element {
  return (
    <KobalteTabs.Content value={props.value} class={cn(FOCUS_RING, props.class)}>
      {props.children}
    </KobalteTabs.Content>
  );
}
