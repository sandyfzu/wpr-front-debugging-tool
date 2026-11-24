/**
 * The compare overlay: full-viewport, one iframe per side, header with the
 * side labels, their per-side refresh, the scroll-sync, mobile-comparison
 * and desktop-width switches plus close. Behavior arrives as props (the
 * owning module owns URLs, window actions and the machine); the component
 * renders state and reports which element carries which side/frame through
 * the ref callbacks.
 *
 * Presentation: the halves render through inline styles from the pure
 * helper `frameStylesFor` per machine presentation — the phone dress (a
 * 412×892 frame at the fitted scale, letterboxed), the desktop dress (a
 * 1280px-floor content box scaled into the column, its media queries live),
 * or the stylesheet's fluid boxes. The halves hold their first navigation
 * until both fits exist (`framesMayNavigate`) so a first load happens once,
 * at the rendered size.
 *
 * Motion is decoration: opening toggles a class and never waits for a
 * transition event, so reduced motion or an interrupted animation cannot
 * strand the overlay invisible.
 *
 * The size gate is a latch: `framesMayNavigate` reports the live fit
 * availability, the view unlocks the first load with it and stays
 * unlocked — a later squeezed measurement must never strip a loaded
 * frame's `src` (a full reload born from a layout transient).
 */

import type { JSX } from 'solid-js';
import { createEffect, createMemo, For, on, Show } from 'solid-js';
import { COMPARE_SIDES, type CompareSide } from '../../../lib/side-by-side/scroll-sync';
import type { PresentationSnapshot } from '../../../lib/side-by-side/presentation-state';
import { DEVICE_SIMULATION_PROFILE } from '../../../lib/device-simulation/profiles';
import {
  frameStylesFor,
  sideLabelStyleFor,
  type FrameFitRecord,
  type FrameStyleRecord,
  type FrameStyles
} from './presentation';
import { createSizeGateLatch } from './gate-latch';
import { CLOSE_ICON_PATHS, REFRESH_ICON_PATHS, StrokeIcon } from './icons';

/** The overlay's input: urls plus per-side behavior, both switches and the simulation machine's facts. */
export interface SideBySideOverlayProps {
  /** The two URLs, resolved once for the overlay's lifetime. */
  urls: () => { cached: string; bypassed: string };
  /** The overlay is visible (open). */
  open: () => boolean;
  /**
   * Lift the overlay's root above every other injected surface (the shared
   * top-layer rule); called on each open, once the root is rendered.
   */
  raiseLayer(layer: HTMLElement): void;
  /** PageSpeed Insights mode: analyses drive themselves; no close/refresh/sync/sim controls. */
  psiMode: () => boolean;
  /** Register which element carries which side (module-side refresh uses it). */
  registerFrame(side: CompareSide, frame: HTMLIFrameElement | null): void;
  /** Register the half's column element (the rescale presenter measures it). */
  registerColumn(side: CompareSide, column: HTMLElement | null): void;
  /** Refresh one side's frame. */
  refresh(side: CompareSide): void;
  /** Close the overlay (scroll restoration and the session teardown are the owner's job). */
  close(): void;
  /** Whether the scroll-sync switch is on (the persisted setting, applied live). */
  syncEnabled: () => boolean;
  /** Whether a half's document refuses access — that side renders its marker. */
  syncBlocked: (side: CompareSide) => boolean;
  /** The scroll-sync switch flipped; the module applies live and persists the choice. */
  onToggleSync(next: boolean): void;
  /** The presentation machine's facts behind the switches, the tags and the presentation. */
  sim: () => PresentationSnapshot;
  /** The per-half live fit (the rescale presenter's reports). */
  simFits: () => FrameFitRecord;
  /** The live size gate: the first dressed load waits for both fits; the view latches it (never re-locked). */
  sizeGateOpen: () => boolean;
  /** The mobile-comparison switch flipped; the machine applies, persists and reconciles. */
  onToggleSim(next: boolean): void;
  /** The desktop-width switch flipped; the machine adopts the dress and persists, without asks or reloads. */
  onToggleDesktop(next: boolean): void;
}

/** One side's words: the name over its frame (also the frame's title) and its refresh button's. */
interface SideCopy {
  /** The visible name, shared by the label and the frame's title. */
  name: string;
  /** The refresh button's tooltip and accessible name. */
  refreshLabel: string;
}

/** Each side's words; the sides differ only in this copy (rendered in {@link COMPARE_SIDES} order). */
const SIDE_COPY: Readonly<Record<CompareSide, SideCopy>> = {
  cached: { name: 'Cached', refreshLabel: 'Refresh the cached version' },
  bypassed: { name: 'Not cached', refreshLabel: 'Refresh the not-cached version' }
};

/** A side label's input: its copy plus the overlay facts it renders. */
interface SideLabelProps {
  /** Which side the label names (its column: `data-side`). */
  side: CompareSide;
  /** The side's words. */
  copy: SideCopy;
  /** The phone dress is on: the label tags the session. */
  phone: boolean;
  /** PageSpeed Insights mode: no sync marker, no refresh. */
  psiMode: boolean;
  /** The half's document refuses access (sync cannot reach it). */
  syncBlocked: boolean;
  /** Inline style keeping the label over its frame (see {@link sideLabelStyleFor}). */
  style: FrameStyleRecord;
  /** Refresh this side's frame. */
  refresh(): void;
}

/**
 * One side's label in the bar's second row, its grid column sitting over
 * its own frame: the name, the mobile tag, the sync marker and the refresh.
 *
 * @param props The label's copy and facts.
 */
function SideLabel(props: SideLabelProps): JSX.Element {
  return (
    <span class="sbs-side-label" data-side={props.side} style={props.style}>
      <span class="sbs-side-name">{props.copy.name}</span>
      <Show when={props.phone}>
        <span class="sbs-mobile-tag">· mobile</span>
      </Show>
      <Show when={!props.psiMode && props.syncBlocked}>
        <span class="sbs-note">not synced (different origin)</span>
      </Show>
      <Show when={!props.psiMode}>
        <button
          type="button"
          class="sbs-button"
          title={props.copy.refreshLabel}
          aria-label={props.copy.refreshLabel}
          onClick={() => {
            props.refresh();
          }}
        >
          <StrokeIcon paths={REFRESH_ICON_PATHS} strokeWidth={1.5} />
        </button>
      </Show>
    </span>
  );
}

/**
 * The compare overlay: the bar (the controls row, then one label per side
 * over its own frame) and the two halves' presentations.
 */
export function SideBySideOverlay(props: SideBySideOverlayProps): JSX.Element {
  const phone = (): boolean => props.sim().presentation === 'phone';
  const cachedStyles = createMemo<FrameStyles>(() =>
    frameStylesFor(props.sim().presentation, props.simFits()['cached'] ?? null)
  );
  const bypassedStyles = createMemo<FrameStyles>(() =>
    frameStylesFor(props.sim().presentation, props.simFits()['bypassed'] ?? null)
  );
  /** A side label's inline style: the phone dress sizes it to its device (pure helper). */
  const labelStyle = (side: CompareSide): FrameStyleRecord =>
    sideLabelStyleFor(props.sim().presentation, props.simFits()[side] ?? null);
  /**
   * The size gate, latched: the live gate weighs the first load, the latch
   * never re-locks afterwards (see {@link createSizeGateLatch} for the
   * geometry of the protection).
   */
  const gateSatisfied = createSizeGateLatch(
    // eslint-disable-next-line solid/reactivity -- the helper owns the tracked scope (its effect and memo)
    props.sizeGateOpen
  );
  /** The switch's failure branch text — direction-aware, empty when not failed. */
  const simFailure = createMemo<string>(() => {
    if (!props.sim().failed) return '';
    return phone()
      ? 'Mobile comparison is still active — the browser refused to disable it'
      : 'Mobile comparison could not be applied — flip it again to retry';
  });

  let layer: HTMLDivElement | undefined;
  // Every open re-enters the top layer, so the overlay paints above any
  // surface shown since (a closed overlay stays there, hidden and inert).
  createEffect(
    on(
      () => props.open(),
      (open) => {
        if (open && layer !== undefined) props.raiseLayer(layer);
      }
    )
  );

  return (
    <div ref={layer} class="sbs-overlay" classList={{ 'sbs-overlay--open': props.open() }}>
      <div class="sbs-bar" classList={{ 'sbs-bar--phone': phone() }}>
        <Show when={!props.psiMode()}>
          <div class="sbs-controls">
            <label class="sbs-switch" title="Scroll both versions together">
              <input
                type="checkbox"
                role="switch"
                class="sbs-switch-input"
                checked={props.syncEnabled()}
                aria-checked={props.syncEnabled()}
                onChange={(event) => {
                  props.onToggleSync(event.currentTarget.checked);
                }}
              />
              <span class="sbs-switch-text">Sync scroll</span>
            </label>
            <Show when={props.sim().available === true}>
              <label
                class="sbs-switch"
                title="Reload both halves as a 412×892 phone: viewport and document requests together; off restores the real requests"
              >
                <input
                  type="checkbox"
                  role="switch"
                  class="sbs-switch-input"
                  checked={phone()}
                  disabled={props.sim().busy}
                  aria-checked={phone()}
                  aria-busy={props.sim().busy}
                  onChange={(event) => {
                    props.onToggleSim(event.currentTarget.checked);
                  }}
                />
                <span class="sbs-switch-text">Mobile comparison</span>
                <Show when={phone()}>
                  <span class="sbs-mobile-tag">{DEVICE_SIMULATION_PROFILE.displayName}</span>
                </Show>
              </label>
            </Show>
            <Show when={!phone()}>
              <label
                class="sbs-switch"
                title="Render both halves at a desktop-width viewport (1280px floor, scaled to fit below it) — pages resolve their desktop media queries; the real requests never change."
              >
                <input
                  type="checkbox"
                  role="switch"
                  class="sbs-switch-input"
                  checked={props.sim().desktop}
                  aria-checked={props.sim().desktop}
                  onChange={(event) => {
                    props.onToggleDesktop(event.currentTarget.checked);
                  }}
                />
                <span class="sbs-switch-text">Desktop width</span>
              </label>
            </Show>
            <Show when={simFailure().length > 0}>
              <span class="sbs-note" role="status">
                {simFailure()}
              </span>
            </Show>
            <button
              type="button"
              class="sbs-button"
              title="Close"
              aria-label="Close the side-by-side comparison"
              onClick={() => {
                props.close();
              }}
            >
              <StrokeIcon paths={CLOSE_ICON_PATHS} strokeWidth={1.5} />
            </button>
          </div>
        </Show>
        <For each={COMPARE_SIDES}>
          {(side) => (
            <SideLabel
              side={side}
              copy={SIDE_COPY[side]}
              phone={phone()}
              psiMode={props.psiMode()}
              syncBlocked={props.syncBlocked(side)}
              style={labelStyle(side)}
              refresh={() => {
                props.refresh(side);
              }}
            />
          )}
        </For>
      </div>
      <div class="sbs-frames">
        <div
          class="sbs-half"
          classList={{ 'sbs-half--phone': phone() }}
          ref={(el) => {
            props.registerColumn('cached', el);
          }}
        >
          <div
            class="sbs-viewport"
            classList={{ 'sbs-viewport--phone': phone() }}
            style={cachedStyles().viewport}
          >
            <iframe
              class="sbs-frame"
              title={SIDE_COPY.cached.name}
              src={gateSatisfied() ? props.urls().cached : undefined}
              style={cachedStyles().frame}
              ref={(frame) => {
                props.registerFrame('cached', frame);
              }}
            />
          </div>
        </div>
        <div
          class="sbs-half"
          classList={{ 'sbs-half--phone': phone() }}
          ref={(el) => {
            props.registerColumn('bypassed', el);
          }}
        >
          <div
            class="sbs-viewport"
            classList={{ 'sbs-viewport--phone': phone() }}
            style={bypassedStyles().viewport}
          >
            <iframe
              class="sbs-frame"
              title={SIDE_COPY.bypassed.name}
              src={gateSatisfied() ? props.urls().bypassed : undefined}
              style={bypassedStyles().frame}
              ref={(frame) => {
                props.registerFrame('bypassed', frame);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
