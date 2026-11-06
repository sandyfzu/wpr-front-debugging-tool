/**
 * The LCP highlight: a frame drawn over the page's LCP element for
 * {@link LCP_HIGHLIGHT_MS}, asked per analysis (never remembered). The
 * element itself is never touched — no attribute, no style — so there is
 * nothing on the page to restore: the frame lives in its own shadow root
 * (the shared mount: tokens, live theme, input isolation) in the browser's
 * top layer, ignores the pointer, and re-measures the element once per
 * animation frame while it is up (bounded by its time), so it follows
 * scrolling, resizing and any layout change, and leaves on the next frame
 * after the element leaves the page; it also leaves when its time is up or
 * with the content script's context.
 */
import { Show, createSignal, type Accessor, type JSX } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { Logger } from '../../../lib/logger';
import { LCP_HIGHLIGHT_MS } from '../../../lib/lcp-analysis/deadlines';
import { createShadowSurface } from '../../../components/injected-ui/shadow-surface';
import { showInTopLayer } from '../../../components/injected-ui/top-layer';

/** The highlight's shadow host tag name. */
export const LCP_HIGHLIGHT_HOST_NAME = 'wpr-fdt-lcp-highlight';

/** The frame's box in viewport coordinates (CSS px). */
export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The frame's box for an element.
 *
 * @param element The framed element.
 * @returns Its border box in viewport coordinates, or null once it left the page.
 */
export function frameOf(element: Element): FrameRect | null {
  if (!element.isConnected) return null;
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/**
 * Whether two frame boxes are the same (null included) — so an unchanged
 * per-frame measure writes nothing to the frame's style.
 *
 * @param a One box (or none).
 * @param b The other box (or none).
 * @returns True when both are none or all four values match.
 */
export function sameFrame(a: FrameRect | null, b: FrameRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Props of {@link HighlightView}. */
export interface HighlightViewProps {
  /** The frame's box; nothing is drawn while null. */
  readonly rect: Accessor<FrameRect | null>;
  /** Receives the layer element (top-layer placement). */
  readonly registerLayer: (layer: HTMLElement) => void;
}

/**
 * Render the frame: an inert full-viewport layer holding one box.
 *
 * @param props See {@link HighlightViewProps}.
 */
export function HighlightView(props: HighlightViewProps): JSX.Element {
  return (
    <div
      class="lh-layer"
      data-fdt-tokens
      ref={(layer) => {
        props.registerLayer(layer);
      }}
    >
      <Show when={props.rect()}>
        {(rect) => (
          <div
            class="lh-frame"
            data-fdt="lcp-highlight"
            style={{
              transform: `translate(${String(rect().x)}px, ${String(rect().y)}px)`,
              width: `${String(rect().width)}px`,
              height: `${String(rect().height)}px`
            }}
          />
        )}
      </Show>
    </div>
  );
}

/** The page's LCP highlight. */
export interface LcpHighlighter {
  /**
   * Frame an element (replacing the framed one) and restart the countdown.
   *
   * @returns Whether the frame is up (false: the element left the page, the
   *   context ended, or the frame could not be mounted — logged).
   */
  show(element: Element): Promise<boolean>;
  /** Remove the frame now (no-op when none). */
  hide(): void;
}

/**
 * Create the page's highlighter. The shadow host mounts on the first show
 * and leaves the page with each hide.
 *
 * @param ctx The content script's context (UI, timers, invalidation).
 * @param log The owning module's logger.
 */
export function createLcpHighlighter(ctx: ContentScriptContext, log: Logger): LcpHighlighter {
  const [rect, setRect] = createSignal<FrameRect | null>(null, { equals: sameFrame });
  let target: Element | null = null;
  let countdown: number | null = null;
  // The pending per-frame re-measure while a frame is up; cancelled by every
  // hide. The plain window API: the context's wrapper adds one invalidation
  // listener per frame, and hide (an invalidation listener) cancels it anyway.
  let frame: number | null = null;

  const hide = (): void => {
    target = null;
    if (countdown !== null) clearTimeout(countdown);
    countdown = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    setRect(null);
    surface.hide();
  };

  /** Re-measure the element each frame; it left the page → the frame leaves too. */
  const follow = (): void => {
    frame = null;
    try {
      // An extension reload kills the context without an event: the read notices it,
      // and the invalidation hides the frame now rather than at its countdown. Inside
      // the `try`: an engine may throw on a torn-down context's read (→ hide + warn).
      if (ctx.isInvalid) return;
      const next = target === null ? null : frameOf(target);
      if (next === null) {
        hide();
        return;
      }
      setRect(next);
      frame = requestAnimationFrame(follow);
    } catch (cause) {
      log.warn('Following the LCP element failed; the highlight was removed', cause);
      hide();
    }
  };

  const surface = createShadowSurface({
    create: (hooks) =>
      createShadowRootUi(ctx, {
        name: LCP_HIGHLIGHT_HOST_NAME,
        position: 'inline',
        // The documentElement: a page transform on <body> must not become the
        // containing block (the top layer escapes it anyway).
        anchor: 'html',
        append: 'last',
        onMount: hooks.onMount,
        onRemove: hooks.onRemove
      }),
    view: () => (
      <HighlightView
        rect={rect}
        registerLayer={(layer) => {
          // Shown once connected: the top layer needs a rendered element.
          ctx.requestAnimationFrame(() => {
            showInTopLayer(layer, log);
          });
        }}
      />
    ),
    isInvalid: () => ctx.isInvalid,
    onRenderError: (cause) => {
      log.error('Mounting the LCP highlight failed', cause);
    }
  });
  ctx.onInvalidated(hide);

  const show = async (element: Element): Promise<boolean> => {
    const first = ctx.isInvalid ? null : frameOf(element);
    if (first === null) return false;
    if (countdown !== null) clearTimeout(countdown);
    target = element;
    setRect(first);
    frame ??= requestAnimationFrame(follow);
    countdown = ctx.setTimeout(hide, LCP_HIGHLIGHT_MS);
    try {
      // A hide (countdown, invalidation) or a newer show during the mount wins.
      const outcome = await surface.show(() => target === element);
      return outcome !== 'refused' && target === element;
    } catch (cause) {
      log.error('Creating the LCP highlight failed', cause);
      if (target === element) hide();
      return false;
    }
  };

  return { show, hide };
}
