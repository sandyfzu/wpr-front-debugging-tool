/**
 * The side pane's splitter: the pane's start edge, dragged (pointer) or moved
 * (keyboard) to resize the pane against the list.
 *
 * - **Pointer:** a primary press captures the pointer; moves apply once per
 *   frame (a drag never queues more layouts than frames), the release
 *   commits — only a drag that changed the width (a plain click stores
 *   nothing). A full-panel shield holds the resize cursor and keeps rows from
 *   hovering or text from selecting while the drag lasts. A cancelled or
 *   lost capture commits where the drag stood; a drag cut short by the pane
 *   closing (Esc, the panel narrowing into the drill-in) keeps the width on
 *   screen (`onSettle`), so what the user last saw is what persists.
 * - **Keyboard:** ←/→ step the pane (← grows it), Home/End jump to the
 *   narrowest/widest; each press that moves it commits.
 * - **Double-click** returns to the default width.
 *
 * Widths are whole pixels already clamped by the layout rule; the owner turns
 * them into the stored share. A window splitter (`role="separator"`, focusable,
 * valued in px) — the hit strip lies inside the pane's padding, so it never
 * covers the list's scrollbar.
 */
import type { Accessor, JSX } from 'solid-js';
import { createSignal, onCleanup, Show } from 'solid-js';
import { FOCUS_RING } from '../../../../components/ui/classes';
import {
  paneWidthAfterDrag,
  paneWidthAfterMove,
  paneWidthBounds,
  splitterMove
} from '../../../../lib/panel/detail-layout';
import { cn } from '../../../../utils/cn';

/** The splitter's accessible name. */
export const SPLITTER_LABEL = 'Resize details';

/** The splitter's hover hint (how to use it, incl. the reset). */
export const SPLITTER_HINT = 'Drag to resize · Double-click to reset';

/** Props of {@link PaneSplitter}. */
export interface PaneSplitterProps {
  /** The pane's current width (px, clamped). */
  readonly width: Accessor<number>;
  /** The list container's content width (px) the bounds derive from. */
  readonly contentWidth: Accessor<number>;
  /** Show a width while dragging (not persisted). */
  readonly onPreview: (width: number) => void;
  /** Settle on a width (drag end, a key). */
  readonly onCommit: (width: number) => void;
  /**
   * Persist the width on screen (the last preview) — a drag that the pane's
   * unmount cut short, when the list's width may already have changed, so no
   * width is recomputed.
   */
  readonly onSettle: () => void;
  /** Back to the default width. */
  readonly onReset: () => void;
  /** Frame scheduling seams (tests drive frames by hand). */
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

/** One drag in progress: where it started, where the pointer is now, whether it showed a change. */
interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  x: number;
  /** A preview showed a width other than the start one. */
  previewed: boolean;
}

/**
 * Render the splitter (absolutely placed on its positioned parent's start edge).
 *
 * @param props See {@link PaneSplitterProps}.
 */
export function PaneSplitter(props: PaneSplitterProps): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- seams are fixed per instance
  const requestFrame = props.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame =
    // eslint-disable-next-line solid/reactivity -- seams are fixed per instance
    props.cancelFrame ??
    ((handle: number) => {
      cancelAnimationFrame(handle);
    });
  const [drag, setDrag] = createSignal<Drag | null>(null);
  let frame: number | null = null;

  const bounds = () => paneWidthBounds(props.contentWidth());
  /** The width the current drag points at. */
  const dragWidth = (current: Drag): number =>
    paneWidthAfterDrag(current.startWidth, current.x - current.startX, props.contentWidth());

  const cancelPending = (): void => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  // The pane unmounting mid-drag (Esc, a narrowing into the drill-in): the
  // pending frame goes; a width a preview already showed is kept.
  onCleanup(() => {
    cancelPending();
    if (drag()?.previewed === true) props.onSettle();
  });

  /**
   * End the drag (release, cancel, lost capture) and commit where it stands —
   * only when it changed the width: a plain click on the splitter stores
   * nothing (it would pin today's width as a share for good).
   */
  const finish = (): void => {
    const current = drag();
    if (current === null) return;
    cancelPending();
    setDrag(null);
    const width = dragWidth(current);
    if (current.previewed || width !== current.startWidth) props.onCommit(width);
  };

  const onPointerDown = (event: PointerEvent & { currentTarget: HTMLElement }): void => {
    if (event.button !== 0 || drag() !== null) return;
    // No text selection, no compatibility mouse events: the press is a drag.
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (released between the press and here):
      // there is no drag to follow.
      return;
    }
    setDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: props.width(),
      x: event.clientX,
      previewed: false
    });
  };

  /** The frame's work: preview where the drag points now (if it still runs). */
  const applyFrame = (): void => {
    frame = null;
    const live = drag();
    if (live === null) return;
    const width = dragWidth(live);
    if (width !== live.startWidth) live.previewed = true;
    // Back at the start after a change still previews (the screen follows).
    if (live.previewed) props.onPreview(width);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = drag();
    if (current?.pointerId !== event.pointerId) return;
    current.x = event.clientX;
    // One layout per frame, whatever the pointer's event rate.
    frame ??= requestFrame(applyFrame);
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (drag()?.pointerId === event.pointerId) finish();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const move = splitterMove(event.key);
    if (move === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = paneWidthAfterMove(move, props.width(), props.contentWidth());
    // A key held against a bound changes nothing: nothing to store.
    if (next !== props.width()) props.onCommit(next);
  };

  return (
    <>
      <div
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        aria-label={SPLITTER_LABEL}
        aria-valuenow={props.width()}
        aria-valuemin={bounds().min}
        aria-valuemax={bounds().max}
        title={SPLITTER_HINT}
        data-fdt="detail-splitter"
        data-dragging={drag() === null ? undefined : ''}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onDblClick={() => {
          props.onReset();
        }}
        onKeyDown={onKeyDown}
        class={cn(
          // An 8 px strip over the pane's start padding; its 2 px line sits on
          // the pane's border and lights (instantly, M-3) on hover, focus, drag.
          'absolute inset-y-0 start-0 z-10 w-2 cursor-col-resize touch-none',
          "before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:content-['']",
          'hover:before:bg-accent focus-visible:before:bg-accent data-dragging:before:bg-accent',
          FOCUS_RING
        )}
      />
      <Show when={drag() !== null}>
        {/* Holds the resize cursor over the whole panel while dragging, and
            keeps rows from hovering under the moving pointer. */}
        <div data-fdt="detail-splitter-shield" class="fixed inset-0 z-50 cursor-col-resize" />
      </Show>
    </>
  );
}
