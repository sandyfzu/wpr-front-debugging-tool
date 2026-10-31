/**
 * A mode lane's control — As served · Simulated, and Disabled where the
 * feature has a feature-wide disable; the options the page does not allow
 * dimmed — and the lines under it: why an option is
 * unavailable, a shown Disabled that changes nothing here, a draft mode
 * the page does not allow (still shown, dimmed), a simulation the page keeps
 * after the session left it, and the admin-screen warning (word + glyph,
 * never blocking; under the first mode control only — it concerns the page).
 */
import { Show, createMemo, type JSX } from 'solid-js';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { ChoiceGroup, type ChoiceOption } from '../../../components/ui/choice-group';
import { MODE_LANE_COPY, type LaneModeCopy } from '../copy';
import type { OverlayController } from '../controller';
import {
  ADMIN_WARNING_LANE,
  disabledChangesNothing,
  laneModes,
  type ModeBlock,
  type SimulationLane,
  type SimulationMode
} from './simulation-mode';

/**
 * The id of a lane's lines describing its control (its accessible description).
 *
 * @param lane The mode lane.
 */
export function modeNotesId(lane: SimulationLane): string {
  return `xo-mode-notes-${lane}`;
}

/** Props of {@link SimulationModeControl} and {@link SimulationModeNotes}. */
export interface SimulationModeProps {
  readonly controller: OverlayController;
  /** The mode lane. */
  readonly lane: SimulationLane;
  /** Whether controls are locked (an action is in flight). */
  readonly locked: boolean;
}

/**
 * Why the page leaves an option out (null: every option is offered).
 *
 * @param controller The overlay controller.
 * @param lane The mode lane.
 */
function blockReason(controller: OverlayController, lane: SimulationLane): ModeBlock | null {
  const blocks = controller.laneBlocks(lane);
  return blocks === null ? null : (blocks.simulated ?? blocks.disabled);
}

/**
 * The segmented control.
 *
 * @param props See {@link SimulationModeProps}.
 */
export function SimulationModeControl(props: SimulationModeProps): JSX.Element {
  const copy = (): LaneModeCopy => MODE_LANE_COPY[props.lane];
  // One stable object per mode whose `disabled` reads the page's state live:
  // the radios under them are never rebuilt, so keyboard focus survives a
  // state change (e.g. the marker check landing).
  const blocked = (mode: SimulationMode): boolean => {
    const blocks = props.controller.laneBlocks(props.lane);
    return blocks !== null && blocks[mode] !== null;
  };
  // Rebuilt only if the lane itself changed (it never does in place).
  const options = createMemo((): readonly ChoiceOption<SimulationMode>[] =>
    laneModes(props.lane).map((mode) => ({
      value: mode,
      get label() {
        return copy().labels[mode];
      },
      get disabled() {
        return blocked(mode);
      }
    }))
  );
  return (
    <ChoiceGroup
      options={options()}
      value={props.controller.laneMode(props.lane)}
      onChange={(mode) => {
        props.controller.setLaneMode(props.lane, mode);
      }}
      aria-label={copy().groupName}
      aria-describedby={modeNotesId(props.lane)}
      // Locked like the overlay's other held controls: reachable, said why.
      held={props.locked ? copy().held : undefined}
      class="xo-mode-choice"
    />
  );
}

/**
 * The lines under the control (rendered even when empty: the control's
 * description reference never names a missing id).
 *
 * @param props See {@link SimulationModeProps}.
 */
export function SimulationModeNotes(props: SimulationModeProps): JSX.Element {
  const copy = (): LaneModeCopy => MODE_LANE_COPY[props.lane];
  const reason = (): ModeBlock | null => blockReason(props.controller, props.lane);
  const kept = (): boolean => {
    const state = props.controller.laneState(props.lane);
    // Said only with no session on: an active one re-simulates on reload.
    return (
      state?.kind === 'not-served' &&
      state.simulation === 'kept' &&
      props.controller.view()?.kind === 'off'
    );
  };
  return (
    <div id={modeNotesId(props.lane)} class="xo-mode-notes">
      <Show when={props.lane === ADMIN_WARNING_LANE && props.controller.adminScreen()}>
        <p class="xo-mode-warning" data-tone="warn">
          <TriangleAlert size={12} aria-hidden="true" />
          <span>{copy().adminScreen}</span>
        </p>
      </Show>
      <Show when={reason()}>{(block) => <p class="xo-lane-note">{copy().blocks[block()]}</p>}</Show>
      <Show
        when={disabledChangesNothing(
          props.controller.laneMode(props.lane),
          props.controller.laneState(props.lane)
        )}
      >
        <p class="xo-lane-note">{copy().disabledChangesNothing}</p>
      </Show>
      <Show when={props.controller.blockedLaneMode(props.lane)}>
        {(block) => <p class="xo-lane-note">{copy().blockedDraft(block())}</p>}
      </Show>
      <Show when={kept()}>
        <p class="xo-lane-note">{copy().kept}</p>
      </Show>
    </div>
  );
}
