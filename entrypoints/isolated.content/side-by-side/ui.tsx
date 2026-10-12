/**
 * The compare overlay: full-viewport, one iframe per side, header with the
 * side labels, their per-side refresh, the scroll-sync and mobile-comparison
 * switches plus close. Behavior arrives as props (the owning module owns
 * URLs, window actions and the simulation machine); the component renders
 * state and reports which element carries which side/frame through the ref
 * callbacks.
 *
 * Presentation: in the mobile session the halves render as scaled phone
 * frames (412×892 at the fitted scale, letterboxed) — the inline styles come
 * from the pure helper `phoneFrameStyles`; in auto the stylesheet's fluid
 * boxes rule, exactly as before. The halves hold their first navigation
 * until both fits exist (`framesMayNavigate`) so a first load happens once,
 * at the device size, under the rule the open established.
 *
 * Motion is decoration: opening toggles a class and never waits for a
 * transition event, so reduced motion or an interrupted animation cannot
 * strand the overlay invisible.
 */

import type { JSX } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import type { CompareSide } from '../../../lib/side-by-side/scroll-sync';
import type { MobileSimSnapshot } from '../../../lib/side-by-side/mobile-sim';
import { phoneFrameStyles, type FrameFitRecord, type PhoneFrameStyles } from './presentation';
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
  /** The mobile-simulation machine's facts behind the switch, suffix and presentation. */
  sim: () => MobileSimSnapshot;
  /** The per-half live fit (the rescale presenter's reports). */
  simFits: () => FrameFitRecord;
  /** Whether the halves may carry their URLs (the first phone load is held until both fits exist). */
  sizeGateOpen: () => boolean;
  /** The mobile-comparison switch flipped; the machine applies, persists and reconciles. */
  onToggleSim(next: boolean): void;
}

/**
 * One half of the compare: the label, its controls and the frame's
 * presentations. The two sides differ only in copy — data, not branching.
 */
export function SideBySideOverlay(props: SideBySideOverlayProps): JSX.Element {
  const phone = (): boolean => props.sim().presentation === 'phone';
  const cachedStyles = createMemo<PhoneFrameStyles>(() =>
    phoneFrameStyles(props.sim().presentation, props.simFits()['cached'] ?? null)
  );
  const bypassedStyles = createMemo<PhoneFrameStyles>(() =>
    phoneFrameStyles(props.sim().presentation, props.simFits()['bypassed'] ?? null)
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
              <StrokeIcon paths={REFRESH_ICON_PATHS} />
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
            <StrokeIcon paths={CLOSE_ICON_PATHS} />
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
              <StrokeIcon paths={REFRESH_ICON_PATHS} />
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
              src={props.sizeGateOpen() ? props.urls().cached : undefined}
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
              src={props.sizeGateOpen() ? props.urls().bypassed : undefined}
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
