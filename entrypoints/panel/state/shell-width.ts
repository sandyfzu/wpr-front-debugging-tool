/**
 * The panel shell's measured inline size, as a signal: the input of the
 * shell's width rules (the top bar's fold; the sidebar's form later). Read
 * from a `ResizeObserver` on the shell element, never a viewport media
 * query: the shell is the panel, and a devtools docking or an embedding
 * window makes the viewport meaningless.
 *
 * The first observation lands in the frame's rendering steps after layout
 * and before paint, so the first painted frame already has the measured
 * width (no fold flash). Until then — and in layout-less environments —
 * the width is 0, which every rule reads as its narrowest form.
 */
import { createSignal, onCleanup, type Accessor } from 'solid-js';
import { createLogger } from '../../../lib/logger';

const log = createLogger('panel');

/** Start reporting an element's inline size; returns the stop. */
export type InlineSizeObserver = (
  element: HTMLElement,
  onWidth: (width: number) => void
) => () => void;

/**
 * The production observer: one `ResizeObserver` per call, reporting the
 * content box width (the shell has no padding, so it is the panel width).
 * Without the API (never in a supported browser) it reports nothing and
 * logs once — the rules then keep their narrow form, still usable.
 *
 * @param element The element to measure.
 * @param onWidth Receives every new width in px.
 * @returns Disconnects the observer.
 */
export const observeInlineSize: InlineSizeObserver = (element, onWidth) => {
  if (typeof ResizeObserver !== 'function') {
    log.warn('ResizeObserver is unavailable — the shell keeps its narrow layout');
    return () => undefined;
  }
  const observer = new ResizeObserver((entries) => {
    const last = entries.at(-1);
    if (last !== undefined) onWidth(last.contentRect.width);
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
};

/**
 * Clamp a reported width into the rules' domain: a finite number ≥ 0.
 * Observers only report such values; the clamp keeps a broken report from
 * reaching a rule that throws on it.
 *
 * @param width The reported width.
 * @returns The width, or 0 for a negative or non-finite report.
 */
export function sanitizeWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? width : 0;
}

/** The measured shell width plus the ref that starts measuring. */
export interface ShellWidth {
  /** The shell's inline size in px (0 until the first observation). */
  readonly width: Accessor<number>;
  /** Attach as the shell element's `ref`; re-attaching moves the observation. */
  readonly attach: (element: HTMLElement) => void;
}

/**
 * Create the shell width signal. Call inside the shell component: the
 * observation stops with its owner.
 *
 * @param observe The size observer (tests inject a double).
 * @returns The width accessor and the element ref.
 */
export function createShellWidth(observe: InlineSizeObserver = observeInlineSize): ShellWidth {
  const [width, setWidth] = createSignal(0);
  let stop: (() => void) | undefined;
  onCleanup(() => {
    stop?.();
    stop = undefined;
  });
  return {
    width,
    attach: (element) => {
      stop?.();
      stop = observe(element, (next) => {
        setWidth(sanitizeWidth(next));
      });
    }
  };
}
