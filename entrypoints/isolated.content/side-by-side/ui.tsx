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
import { createMemo, Show } from 'solid-js';
import type { CompareSide } from '../../../lib/side-by-side/scroll-sync';
import type { PresentationSnapshot } from '../../../lib/side-by-side/presentation-state';
import { DEVICE_SIMULATION_PROFILE } from '../../../lib/device-simulation/profiles';
import { frameStylesFor, type FrameFitRecord, type FrameStyles } from './presentation';
import { createSizeGateLatch } from './gate-latch';
import { CLOSE_ICON_PATHS, REFRESH_ICON_PATHS, StrokeIcon } from './icons';

/** The overlay's input: urls plus per-side behavior, both switches and the simulation machine's facts. */
export interface SideBySideOverlayProps {
  /** The two URLs, resolved once for the overlay's lifetime. */
  urls: () => { cached: string; bypassed: string };
  /** The overlay is visible (open). */
  open: () => boolean;
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

/**
 * One half of the compare: the label, its controls and the frame's
 * presentations. The two sides differ only in copy — data, not branching.
 */
export function SideBySideOverlay(props: SideBySideOverlayProps): JSX.Element {
  const phone = (): boolean => props.sim().presentation === 'phone';
  const cachedStyles = createMemo<FrameStyles>(() =>
    frameStylesFor(props.sim().presentation, props.simFits()['cached'] ?? null)
  );
  const bypassedStyles = createMemo<FrameStyles>(() =>
    frameStylesFor(props.sim().presentation, props.simFits()['bypassed'] ?? null)
  );
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

  return (
    <div class="sbs-overlay" classList={{ 'sbs-overlay--open': props.open() }}>
      <div class="sbs-bar">
        <span class="sbs-side-label">
          Cached
          <Show when={phone()}>
            <span class="sbs-mobile-tag">· mobile</span>
          </Show>
          <Show when={!props.psiMode() && props.syncBlocked('cached')}>
            <span class="sbs-note">not synced (different origin)</span>
          </Show>
          <Show when={!props.psiMode()}>
            <button
              type="button"
              class="sbs-button"
              title="Refresh the cached version"
              aria-label="Refresh the cached version"
              onClick={() => {
                props.refresh('cached');
              }}
            >
              <StrokeIcon paths={REFRESH_ICON_PATHS} strokeWidth={1.5} />
            </button>
          </Show>
        </span>
        <Show when={!props.psiMode()}>
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
        </Show>
        <span class="sbs-side-label">
          Not cached
          <Show when={phone()}>
            <span class="sbs-mobile-tag">· mobile</span>
          </Show>
          <Show when={!props.psiMode() && props.syncBlocked('bypassed')}>
            <span class="sbs-note">not synced (different origin)</span>
          </Show>
          <Show when={!props.psiMode()}>
            <button
              type="button"
              class="sbs-button"
              title="Refresh the not-cached version"
              aria-label="Refresh the not-cached version"
              onClick={() => {
                props.refresh('bypassed');
              }}
            >
              <StrokeIcon paths={REFRESH_ICON_PATHS} strokeWidth={1.5} />
            </button>
          </Show>
        </span>
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
              title="Cached"
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
              title="Not cached"
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
