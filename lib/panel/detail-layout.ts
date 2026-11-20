/**
 * Where a list shows its selected row's detail, and how wide: beside the list
 * (a side pane) once the list's own content box is wide enough for both,
 * otherwise as a drill-in view that replaces the list. The pane takes a share
 * of the content width (the user's dragged share, else the default), clamped
 * so neither side drops under its floor. One rule for every list page; the CSS
 * side reads the same threshold as the `@split` container variant.
 */
import { LIST_REGULAR_MIN_CONTENT_WIDTH } from './list-tier';

/** `pane`: detail beside the list; `drill`: detail replaces the list (Back returns). */
export type DetailLayout = 'pane' | 'drill';

/**
 * The narrowest side pane (px): facts and code stay readable (≈ 50 code
 * columns), the source tile keeps its host and file name.
 */
export const DETAIL_PANE_MIN_WIDTH = 350;

/**
 * The narrowest list beside a pane (px): the list's regular tier floor, so a
 * pane never squeezes the rows below the width their columns are laid out for.
 */
export const DETAIL_LIST_MIN_WIDTH = LIST_REGULAR_MIN_CONTENT_WIDTH;

/**
 * The content width (px) from which a list shows its detail as a side pane:
 * the list floor plus the pane floor (830). Below it a pane would squeeze the
 * rows under their floor, so the detail drills in instead. Mirrored by
 * `--container-split` in `assets/css/theme.css` (container conditions compile
 * to literals, so the CSS cannot read this value; a test pins the two together).
 */
export const DETAIL_PANE_MIN_CONTENT_WIDTH = DETAIL_LIST_MIN_WIDTH + DETAIL_PANE_MIN_WIDTH;

/**
 * The pane's share of the content width until the user drags it: half, so
 * the detail grows with the panel instead of staying a narrow column (the
 * code it shows needs the room as much as the list does).
 */
export const DETAIL_PANE_DEFAULT_SHARE = 0.5;

/** One keyboard step of the splitter (px): fine enough to aim, coarse enough to travel. */
export const DETAIL_PANE_KEY_STEP = 16;

/**
 * Throw when a measured width is not a real width.
 *
 * @param caller The public function's name (names the failing call).
 * @param contentWidth The width to check.
 * @throws {@link RangeError} When it is negative or not finite.
 */
function assertWidth(caller: string, contentWidth: number): void {
  if (!Number.isFinite(contentWidth) || contentWidth < 0) {
    throw new RangeError(
      `${caller}: content width must be a finite number ≥ 0, got ${String(contentWidth)}.`
    );
  }
}

/**
 * Pick the detail layout for a list's measured content width. Same comparison
 * as the CSS `@container (width >= 830px)` the `@split:` variant compiles to,
 * so script and styles never disagree at a fractional width.
 *
 * @param contentWidth The list container's content-box width in px (`0` while hidden).
 * @returns `pane` from {@link DETAIL_PANE_MIN_CONTENT_WIDTH} on, else `drill`.
 * @throws {@link RangeError} When the width is negative or not finite — a
 *   measuring bug, never a real layout.
 */
export function detailLayout(contentWidth: number): DetailLayout {
  assertWidth('detailLayout', contentWidth);
  return contentWidth >= DETAIL_PANE_MIN_CONTENT_WIDTH ? 'pane' : 'drill';
}

/** The pane widths a content width allows (px, whole pixels). */
export interface PaneWidthBounds {
  /** {@link DETAIL_PANE_MIN_WIDTH}. */
  readonly min: number;
  /** What leaves the list its floor — never under `min` (at the split width both are 350). */
  readonly max: number;
}

/**
 * The pane widths a content width allows.
 *
 * @param contentWidth The list container's content-box width in px.
 * @returns `min` = the pane floor, `max` = the content width minus the list floor.
 * @throws {@link RangeError} When the width is negative or not finite.
 */
export function paneWidthBounds(contentWidth: number): PaneWidthBounds {
  assertWidth('paneWidthBounds', contentWidth);
  const max = Math.max(DETAIL_PANE_MIN_WIDTH, Math.floor(contentWidth - DETAIL_LIST_MIN_WIDTH));
  return { min: DETAIL_PANE_MIN_WIDTH, max };
}

/**
 * Clamp a pane width to what a content width allows.
 *
 * @param width The wanted width (px; may be fractional or out of range).
 * @param contentWidth The list container's content-box width in px.
 * @returns The whole-pixel width inside {@link paneWidthBounds}.
 * @throws {@link RangeError} When either number is not finite, or the content width is negative.
 */
export function clampPaneWidth(width: number, contentWidth: number): number {
  if (!Number.isFinite(width)) {
    throw new RangeError(`clampPaneWidth: width must be finite, got ${String(width)}.`);
  }
  const { min, max } = paneWidthBounds(contentWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

/**
 * Whether a value is a usable pane share: a finite number strictly between
 * 0 and 1 (the guard for stored values, which may be anything).
 *
 * @param value Any value.
 * @returns True for a share in (0, 1).
 */
export function isPaneShare(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1;
}

/**
 * The pane's width for a content width and a share: the share of the
 * content, clamped — so the pane grows with the panel and a panel resize
 * re-clamps it without touching the stored share.
 *
 * @param contentWidth The list container's content-box width in px.
 * @param share The pane's share of it (an {@link isPaneShare} value).
 * @returns The whole-pixel width.
 * @throws {@link RangeError} When the width is negative or not finite, or the share is not a pane share.
 */
export function paneWidth(contentWidth: number, share: number): number {
  if (!isPaneShare(share)) {
    throw new RangeError(`paneWidth: share must be a number in (0, 1), got ${String(share)}.`);
  }
  return clampPaneWidth(share * contentWidth, contentWidth);
}

/**
 * The share a pane width is of its content width (what the splitter stores).
 *
 * @param width The pane width (px, already clamped).
 * @param contentWidth The list container's content-box width in px (> 0).
 * @returns The share, inside (0, 1).
 * @throws {@link RangeError} When the content width is not positive and
 *   finite, or the width is outside (0, content width).
 */
export function paneShareOf(width: number, contentWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
    throw new RangeError(
      `paneShareOf: content width must be finite and > 0, got ${String(contentWidth)}.`
    );
  }
  const share = width / contentWidth;
  if (!isPaneShare(share)) {
    throw new RangeError(
      `paneShareOf: width ${String(width)} is outside (0, ${String(contentWidth)}).`
    );
  }
  return share;
}

/** What a splitter key does to the pane width. */
export type SplitterMove = 'grow' | 'shrink' | 'min' | 'max';

/**
 * The splitter's key vocabulary (the pane sits on the right; the panel is
 * always left-to-right): ← moves the splitter left (the pane grows), →
 * right (it shrinks), Home/End jump to the narrowest/widest pane.
 *
 * @param key A `KeyboardEvent.key`.
 * @returns The move, or null for any other key.
 */
export function splitterMove(key: string): SplitterMove | null {
  switch (key) {
    case 'ArrowLeft':
      return 'grow';
    case 'ArrowRight':
      return 'shrink';
    case 'Home':
      return 'min';
    case 'End':
      return 'max';
    default:
      return null;
  }
}

/**
 * The pane width after a splitter key.
 *
 * @param move The key's move.
 * @param width The current (clamped) pane width.
 * @param contentWidth The list container's content-box width in px.
 * @returns The next whole-pixel width inside {@link paneWidthBounds}.
 * @throws {@link RangeError} When a number is not finite, or the content width is negative.
 */
export function paneWidthAfterMove(
  move: SplitterMove,
  width: number,
  contentWidth: number
): number {
  switch (move) {
    case 'grow':
      return clampPaneWidth(width + DETAIL_PANE_KEY_STEP, contentWidth);
    case 'shrink':
      return clampPaneWidth(width - DETAIL_PANE_KEY_STEP, contentWidth);
    case 'min':
      return paneWidthBounds(contentWidth).min;
    case 'max':
      return paneWidthBounds(contentWidth).max;
  }
}

/**
 * The pane width while the splitter is dragged: the width at the press, minus
 * how far the pointer moved right (the pane sits on the right), clamped.
 *
 * @param startWidth The pane width when the drag started (px).
 * @param deltaX The pointer's horizontal travel since the press (px, right = positive).
 * @param contentWidth The list container's content-box width in px (now).
 * @returns The whole-pixel width inside {@link paneWidthBounds}.
 * @throws {@link RangeError} When a number is not finite, or the content width is negative.
 */
export function paneWidthAfterDrag(
  startWidth: number,
  deltaX: number,
  contentWidth: number
): number {
  return clampPaneWidth(startWidth - deltaX, contentWidth);
}
