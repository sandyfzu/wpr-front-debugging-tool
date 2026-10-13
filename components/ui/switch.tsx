/**
 * The shared on/off toggle — one switch for every surface, keyboard-complete:
 * the 24px control toggles on click, Space/Enter on the focused control
 * toggles, the label toggles with it, and assistive tech reads state from
 * the hidden input's `role="switch"` + `aria-checked`. Selection is state,
 * never styling: color alone expresses nothing on any surface.
 */
import type { JSX } from 'solid-js';
import { createMemo, splitProps } from 'solid-js';
import { Switch as KobalteSwitch } from '@kobalte/core';
import { cn } from '../../utils/cn';
import { DISABLED } from './classes';

export interface SwitchProps {
  /** The visible label rendered beside the control; its click toggles too. */
  label?: string;
  /** Accessible name when no visible label accompanies the control. */
  'aria-label'?: string;
  /** Controlled checked state (with `onChange`). */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  /** Checked-state change callback. */
  onChange?: (checked: boolean) => void;
  /** Whether the switch is disabled. */
  disabled?: boolean;
  /** Which side the visible label sits on (default `end`: control leads). */
  labelSide?: 'start' | 'end';
  /** Extra classes on the wrapper, merged last so callers win. */
  class?: string;
}

/**
 * Render the shared toggle switch.
 *
 * Naming contract: provide `label` or `aria-label` (TSDoc'd, not thrown — it
 * fails visibly in the axe/contrast phase, not by crashing a page mid-render
 * at runtime). The hidden input stays the single keyboard focus point, so
 * focus announcements read from one place; the 24px control is the toggle
 * surface and the thumb is its visual only. State changes are instant (none
 * through a motion transition).
 *
 * Layout: Root (group) → [label · control(thumb) · label] + hidden input.
 *
 * @param props.label The visible label text; a click target alongside the control.
 * @param props['aria-label'] The name when no visible label is rendered.
 * @param props.checked Controlled state; pair with `onChange`.
 * @param props.defaultChecked Uncontrolled initial state.
 * @param props.onChange Called with the new checked state.
 * @param props.disabled Disables the control; dimmed but still hover-explained.
 * @param props.labelSide Which side the visible label sits on (`end` default).
 * @param props.class Extra classes on the wrapper.
 */
export function Switch(props: SwitchProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'label',
    'checked',
    'defaultChecked',
    'onChange',
    'disabled',
    'labelSide',
    'class'
  ]);
  const side = (): JSX.Element | null =>
    own.label !== undefined ? (
      <KobalteSwitch.Label data-fdt-switch-label class="text-fg-primary">
        {own.label}
      </KobalteSwitch.Label>
    ) : null;
  // The label-side layout choice is settled per instance; read it through a
  // memo so the read stays inside a tracked scope (the side flip is a
  // full-arrangement change, not a per-node patch).
  const sideFirst = createMemo(() => (own.labelSide ?? 'end') === 'start');
  return (
    <KobalteSwitch.Root
      data-fdt="switch"
      data-fdt-switch-labeled={own.label !== undefined ? '' : undefined}
      data-fdt-switch-side={own.labelSide ?? 'end'}
      checked={own.checked}
      defaultChecked={own.defaultChecked}
      onChange={own.onChange}
      disabled={own.disabled}
      // The focus ring rides on the root only while the hidden input actually
      // has keyboard focus (`:has(input:focus-visible)`) — the visible control
      // lights up for real keyboard focus, never for pointer clicks.
      class={cn(
        'inline-flex min-h-6 cursor-pointer select-none items-center gap-1.5 text-xs font-medium',
        'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent',
        DISABLED,
        own.class
      )}
      {...rest}
    >
      {sideFirst() ? side() : null}
      <KobalteSwitch.Control
        data-fdt-switch-track
        class={cn(
          // The 24px hit area (h-6): the control toggles on any click on it,
          // around the 28×14 pill visual.
          'inline-flex h-6 w-9 shrink-0 items-center justify-center rounded-full',
          // Dimmed but hover-explained; disabled keeps hover for tooltips.
          own.disabled ? DISABLED : 'hover:bg-surface-3 data-checked:hover:bg-surface-4'
        )}
      >
        <KobalteSwitch.Thumb
          data-fdt-switch-thumb
          class={cn(
            'inline-flex h-3.5 w-7 items-center justify-start rounded-full border border-line-2 bg-surface-3 p-0.5',
            // Checked travel: the thumb content justifies to the far side (a
            // discrete jump — no slide transition) on the accent fill.
            'data-checked:justify-end',
            'data-checked:border-accent-strong data-checked:bg-accent-strong',
            own.disabled ? undefined : 'hover:border-line-3'
          )}
        >
          <span data-fdt-switch-handle class="block size-2.5 rounded-full bg-surface-0" />
        </KobalteSwitch.Thumb>
      </KobalteSwitch.Control>
      {sideFirst() ? null : side()}
      <KobalteSwitch.Input
        class="sr-only"
        // When no visible label renders, the caller's aria-label names the
        // control; otherwise the labelledby wiring takes over (id-linked).
        aria-label={own.label === undefined ? props['aria-label'] : undefined}
      />
    </KobalteSwitch.Root>
  );
}
