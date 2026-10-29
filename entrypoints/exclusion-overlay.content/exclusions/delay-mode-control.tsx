/**
 * The Delay JS lane's mode control — As served · Simulated · Disabled, the
 * options the page does not allow dimmed — and the lines under it: why an
 * option is unavailable, a shown Disabled that changes nothing here, a
 * draft mode the page does not allow (shown as As served), a simulation
 * the page keeps after the session left it, and the admin-screen warning
 * (word + glyph, never blocking).
 */
import { Show, type JSX } from 'solid-js';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { ChoiceGroup, type ChoiceOption } from '../../../components/ui/choice-group';
import { DELAY_MODE_COPY } from '../copy';
import type { OverlayController } from '../controller';
import {
  DELAY_MODES,
  delayModeBlocks,
  disabledChangesNothing,
  type DelayMode,
  type DelayModeBlock
} from './delay-mode';
import type { LaneKey } from './draft';

/** The lane whose feature-wide switch is this mode control. */
export const DELAY_MODE_LANE = 'delayJs' satisfies LaneKey;

/** The id of the lines describing the control (its accessible description). */
export const DELAY_MODE_NOTES_ID = 'xo-delay-mode-notes';

/** Props of {@link DelayModeControl} and {@link DelayModeNotes}. */
export interface DelayModeProps {
  readonly controller: OverlayController;
  /** Whether controls are locked (an action is in flight). */
  readonly locked: boolean;
}

/**
 * Why the page leaves an option out (null: every option is offered).
 *
 * @param controller The overlay controller.
 */
function blockReason(controller: OverlayController): DelayModeBlock | null {
  const state = controller.delayState();
  if (state === null) return null;
  const blocks = delayModeBlocks(state);
  return blocks.simulated ?? blocks.disabled;
}

/**
 * The segmented control.
 *
 * @param props See {@link DelayModeProps}.
 */
export function DelayModeControl(props: DelayModeProps): JSX.Element {
  // One stable object per mode whose `disabled` reads the page's state live:
  // the radios under them are never rebuilt, so keyboard focus survives a
  // state change (e.g. the marker check landing).
  const blocked = (mode: DelayMode): boolean => {
    const state = props.controller.delayState();
    return state !== null && delayModeBlocks(state)[mode] !== null;
  };
  const options: readonly ChoiceOption<DelayMode>[] = DELAY_MODES.map((mode) => ({
    value: mode,
    label: DELAY_MODE_COPY.labels[mode],
    get disabled() {
      return blocked(mode);
    }
  }));
  return (
    <ChoiceGroup
      options={options}
      value={props.controller.delayMode()}
      onChange={(mode) => {
        props.controller.setDelayMode(mode);
      }}
      aria-label={DELAY_MODE_COPY.groupName}
      aria-describedby={DELAY_MODE_NOTES_ID}
      disabled={props.locked}
      class="xo-mode-choice"
    />
  );
}

/**
 * The lines under the control (rendered even when empty: the control's
 * description reference never names a missing id).
 *
 * @param props See {@link DelayModeProps}.
 */
export function DelayModeNotes(props: DelayModeProps): JSX.Element {
  const reason = (): DelayModeBlock | null => blockReason(props.controller);
  const kept = (): boolean => {
    const state = props.controller.delayState();
    // Said only with no session on: an active one re-simulates on reload.
    return (
      state?.kind === 'not-delayed' &&
      state.simulation === 'kept' &&
      props.controller.view()?.kind === 'off'
    );
  };
  return (
    <div id={DELAY_MODE_NOTES_ID} class="xo-mode-notes">
      <Show when={props.controller.adminScreen()}>
        <p class="xo-mode-warning" data-tone="warn">
          <TriangleAlert size={12} aria-hidden="true" />
          <span>{DELAY_MODE_COPY.adminScreen}</span>
        </p>
      </Show>
      <Show when={reason()}>
        {(block) => <p class="xo-lane-note">{DELAY_MODE_COPY.blocks[block()]}</p>}
      </Show>
      <Show
        when={disabledChangesNothing(props.controller.delayMode(), props.controller.delayState())}
      >
        <p class="xo-lane-note">{DELAY_MODE_COPY.disabledChangesNothing}</p>
      </Show>
      <Show when={props.controller.replacedDelayMode()}>
        {(mode) => <p class="xo-lane-note">{DELAY_MODE_COPY.replaced(mode())}</p>}
      </Show>
      <Show when={kept()}>
        <p class="xo-lane-note">{DELAY_MODE_COPY.kept}</p>
      </Show>
    </div>
  );
}
