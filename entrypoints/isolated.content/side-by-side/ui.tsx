/**
 * The compare overlay: full-viewport, one iframe per side, header with the
 * side labels and their per-side refresh plus close. Behavior arrives as
 * props (the owning module owns URLs and window actions); the component
 * only renders and reports which element carries which side through the
 * ref callback.
 *
 * Motion is decoration: opening toggles a class and never waits for a
 * transition event, so reduced motion or an interrupted animation cannot
 * strand the overlay invisible.
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { CLOSE_ICON_PATHS, REFRESH_ICON_PATHS, StrokeIcon } from './icons';

/** Which side an iframe serves: the cached page or the cache-bypassed one. */
export type SideBySideOverlaySide = 'cached' | 'bypassed';

/** The overlay's input: urls plus per-side behavior. */
export interface SideBySideOverlayProps {
  /** The two URLs, resolved once for the overlay's lifetime. */
  urls: () => { cached: string; bypassed: string };
  /** The overlay is visible (open). */
  open: () => boolean;
  /** PageSpeed Insights mode: analyses drive themselves; no close/refresh. */
  psiMode: () => boolean;
  /** Register which element carries which side (module-side refresh uses it). */
  registerFrame(side: SideBySideOverlaySide, frame: HTMLIFrameElement | null): void;
  /** Refresh one side's frame. */
  refresh(side: SideBySideOverlaySide): void;
  /** Close the overlay (scroll restoration is the owner's job). */
  close(): void;
}

export function SideBySideOverlay(props: SideBySideOverlayProps): JSX.Element {
  return (
    <div class="sbs-overlay" classList={{ 'sbs-overlay--open': props.open() }}>
      <div class="sbs-bar">
        <span class="sbs-side-label">
          Cached
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
        <iframe
          class="sbs-frame"
          title="Cached"
          src={props.urls().cached}
          ref={(frame) => {
            props.registerFrame('cached', frame);
          }}
        />
        <iframe
          class="sbs-frame"
          title="Not cached"
          src={props.urls().bypassed}
          ref={(frame) => {
            props.registerFrame('bypassed', frame);
          }}
        />
      </div>
    </div>
  );
}
