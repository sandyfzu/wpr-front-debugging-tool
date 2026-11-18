/**
 * A boolean filter toggle ("Minified", "Excluded") for a list's facet bar:
 * a native `<button aria-pressed>` in the segmented look, so it sits beside
 * the single-choice segment groups as one control family. Native semantics
 * give the keyboard contract for free (Tab to reach, Enter/Space to flip);
 * the pressed state rides `aria-pressed` + `data-fdt-pressed` + the raise,
 * never color alone.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { clsx } from 'clsx';
import { FOCUS_RING } from '../../../../components/ui/classes';
import {
  SEGMENT_BASE,
  SEGMENT_COUNT,
  SEGMENTED_TRAY,
  segmentCountText,
  segmentStateClass
} from '../../../../components/ui/segmented';

/** Props of {@link ToggleChip}. */
export interface ToggleChipProps {
  /** Stable identity (the facet id), carried on the `data-fdt-toggle-chip` hook. */
  value: string;
  /** The visible text, also the button's accessible name (with the count). */
  label: string;
  /** Whether the toggle is on. */
  pressed: boolean;
  /** Called with the next state on every activation (click, Enter, Space). */
  onChange: (pressed: boolean) => void;
  /**
   * How many rows the toggle selects over (a non-negative integer), muted
   * after the label. Zero stays pressable unless `disabled` is set.
   */
  count?: number;
  /** Whether the toggle cannot be flipped now (native disabled, muted text). */
  disabled?: boolean;
  /** Pointer tooltip, e.g. why the toggle is disabled. */
  title?: string;
}

/**
 * Render a toggle chip: one segment in its own tray, raised while pressed.
 *
 * @param props.value The chip's identity (test/automation hook).
 * @param props.label The visible label.
 * @param props.pressed Whether the toggle is on.
 * @param props.onChange Receives the flipped state.
 * @param props.count Optional count shown after the label.
 * @param props.disabled Refuses activation (native disabled).
 * @param props.title Optional pointer tooltip.
 * @throws {@link Error} when `count` is not a non-negative integer (a wiring bug).
 */
export function ToggleChip(props: ToggleChipProps): JSX.Element {
  // Validated at render: a bad count throws naming the chip.
  const countText = (): string | undefined =>
    props.count === undefined ? undefined : segmentCountText(props.count, props.value);
  return (
    <span class={SEGMENTED_TRAY}>
      <button
        type="button"
        data-fdt="toggle-chip"
        data-fdt-toggle-chip={props.value}
        data-fdt-pressed={props.pressed ? '' : undefined}
        aria-pressed={props.pressed}
        disabled={props.disabled}
        title={props.title}
        onClick={() => {
          props.onChange(!props.pressed);
        }}
        class={clsx(
          SEGMENT_BASE,
          FOCUS_RING,
          segmentStateClass({ selected: props.pressed, unavailable: props.disabled === true })
        )}
      >
        {props.label}
        <Show when={countText()}>
          {(text) => (
            <span data-fdt-toggle-count class={SEGMENT_COUNT}>
              {text()}
            </span>
          )}
        </Show>
      </button>
    </span>
  );
}
