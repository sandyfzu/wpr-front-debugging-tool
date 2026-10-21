/**
 * Tab entry into a scrolled virtual list must target what the user can see.
 *
 * A windowed list's DOM begins and ends with offscreen overscan rows, so
 * Tab/Shift+Tab entering it from outside naturally targets those rows — real
 * Chromium commits focus there and reveals them with a scrollbar jump
 * (measured: entering a deep-scrolled list scrolled it 283 px upward). The
 * fix never re-implements traversal: on an entry press (focus outside the
 * scroller at keydown), rows entirely outside the scroller's viewport are
 * briefly marked `inert`, so the browser's sequential navigation itself
 * skips them and lands on the first (or last) viewport-intersecting row's
 * control — at the untouched scroll position. Presses made while focus
 * already lives in the list are the interior Tab walk and stay unmasked: the
 * walk relies on reaching the overscan-ahead rows (each step revealed, the
 * window follows), which masking would trap at the band edge. The mask never
 * outlives the press: it pops on the resulting focusin, on any scroll, on
 * pointerdown, or after one animation frame, restoring full pointer
 * interaction and arrow-key focus.
 */
import { focusedElementOf } from './virtual-list-focus';

/**
 * What sequential navigation can land on inside a row. Element-derived:
 * `tabindex` presentational groups (the code block), inherently interactive
 * elements and editable/host anchors; `tabindex="-1"` mouse-focus-only
 * elements excluded by name.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), iframe, summary, [tabindex]:not([tabindex="-1"]), ' +
  '[contenteditable]:not([contenteditable="false"])';

/** One rendered row's offscreen geometry for mask planning (client px). */
export interface RowGeometry {
  /** The row element itself. */
  el: HTMLElement;
  /** The row's bounding-rect top. */
  top: number;
  /** The row's bounding-rect bottom. */
  bottom: number;
}

/**
 * Decide the rows to suppress for one navigation press.
 *
 * Masking stands down entirely when no viewport-intersecting row holds a
 * sequential-focus-worthy descendant: then every remaining target lives in
 * offscreen rows and the browser's own nearest-target reveal is correct —
 * suppressing it would focus an invisible control.
 *
 * @param rows The rendered rows' geometry, measured at press time.
 * @param viewTop The scroller's visible top edge (client px).
 * @param viewBottom The scroller's visible bottom edge (client px).
 * @param focusedRow The row containing the active control (exempt — an arrow
 *   key can leave it outside the viewport while focus must survive there).
 * @returns The rows to mark `inert` for this press; empty when nothing to
 *   suppress.
 */
export function planEntryMask(
  rows: readonly RowGeometry[],
  viewTop: number,
  viewBottom: number,
  focusedRow: Element | null
): readonly HTMLElement[] {
  // A part-but-not-fully visible row is a legal target (the browser reveals
  // it by a small, legitimate amount); only whole rows outside the band go.
  const intersects = (row: RowGeometry): boolean => row.bottom > viewTop && row.top < viewBottom;
  const hasVisibleFocusable = rows.some(
    (row) => intersects(row) && row.el.querySelector(FOCUSABLE_SELECTOR) !== null
  );
  if (!hasVisibleFocusable) return [];
  return rows.filter((row) => row.el !== focusedRow && !intersects(row)).map((row) => row.el);
}

/** The wiring release: detaches listeners, cancels pops, restores rows. */
export type EntryMaskHandle = () => void;

/**
 * Attach the entry masking to one list's scroller. The per-press evaluation
 * re-reads geometry (rows may re-render between presses), so no state is
 * cached.
 *
 * The scroller's element refs run on template clones before the element is
 * adopted into the live document (Solid ref contract), so the
 * document-level listeners wire only once the scroller is connected —
 * a template-copy document has no view and never dispatches real events.
 *
 * Only rows that are direct children of the scroller's spacer are masked —
 * nested lists own their own rows and their own wiring.
 *
 * Inert ownership: the wiring writes the planned rows' `inert` for one press
 * and the pop restores it flat — no delta tracking against other producers.
 * Nothing else holds these rows inert today; anything that ever would must
 * ride this wiring instead of setting the property independently.
 *
 * @param scroller The list's scroller element (`data-fdt="virtual-list"`).
 * @returns The wiring release, idempotent and safe before any press.
 */
export function attachEntryMask(scroller: HTMLElement): EntryMaskHandle {
  let released = false;
  /** Rows masked by the press in flight (released by any pop). */
  let masked: HTMLElement[] = [];
  /** The scroller's live document once adopted (null until then). */
  let doc: Document | null = null;
  /** The microtask arm (first pre-adoption settle) already queued. */
  let wiredMicrotask = false;
  /** The post-microtask retry timer (frame-pace fallback). */
  let wiringTimer: ReturnType<typeof setTimeout> | undefined;
  /** The pop scheduled against the press in flight, or undefined. */
  let popFrame: number | undefined;
  /**
   * View-local rAF scheduling for the press in flight (the scroller's
   * document may be a devtools panel or a content-script host, not the
   * module's window).
   *
   * @returns The scheduling surface, or null before adoption.
   */
  const view = (): Window | null => scroller.ownerDocument.defaultView;

  /**
   * The press-time mask: reads fresh geometry, plans, applies once.
   *
   * @param event The navigation-press event.
   */
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!scroller.isConnected) return;
    // Entry presses only. A press while focus already lives inside the list
    // is the interior Tab walk — it must keep reaching the rows beyond the
    // visible band (each step is revealed and the rendered window follows),
    // so the mask stays out of its way entirely.
    // Focus is read from the scroller's own tree: inside a shadow root the
    // document reports only the host.
    const active = focusedElementOf(scroller);
    if (active instanceof Element && scroller.contains(active)) return;
    const spacer = scroller.querySelector<HTMLElement>(':scope > [data-fdt-virtual-spacer]');
    if (!spacer) return;
    const focusedRow = active instanceof Element ? active.closest('[data-index]') : null;
    // The rows live in the scroller's content box: a list border shifts them
    // off the border-box rect (a real 1px rounded border puts the seam row
    // one pixel into the band), so the planned band edges are the
    // content-rect edges — borderTop = clientTop, borderBottom = the rest
    // of the border box below the client area.
    const box = scroller.getBoundingClientRect();
    const borderTop = scroller.clientTop;
    const borderBottom = box.height - scroller.clientHeight - borderTop;
    const geometry: RowGeometry[] = Array.from(
      spacer.querySelectorAll<HTMLElement>(':scope > [data-index]')
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, top: r.top, bottom: r.bottom };
    });
    // A press landing before the previous pop restores the previous plan
    // first: rows it masked and this plan does not must not stay inert.
    pop();
    const planned = planEntryMask(
      geometry,
      box.top + borderTop,
      box.bottom - borderBottom,
      focusedRow
    );
    for (const row of planned) row.inert = true;
    masked = [...planned];
    if (planned.length > 0) schedulePop();
  };

  /**
   * Pop in flight: restore every masked row, idempotent.
   *
   * Ownership is last-write (see {@link attachEntryMask}): `inert` is cleared
   * flat on the rows the press planned, so an external producer holding one
   * inert for unrelated reasons at press time would lose it — such a producer
   * must integrate through this wiring.
   */
  const pop = (): void => {
    for (const row of masked) row.inert = false;
    masked = [];
  };

  /**
   * One-frame bound: even without a focusin/scroll/pointerdown the mask ends.
   * A second press in the same frame cancels the pending frame and schedules
   * its own, so exactly one pop frame is ever in flight.
   */
  const schedulePop = (): void => {
    if (popFrame !== undefined) view()?.cancelAnimationFrame(popFrame);
    popFrame = view()?.requestAnimationFrame(() => {
      popFrame = undefined;
      pop();
    });
  };
  /** Combined pop listener: early pops cancel the frame they make obsolete. */
  const popNow = (): void => {
    if (popFrame !== undefined) {
      view()?.cancelAnimationFrame(popFrame);
      popFrame = undefined;
    }
    pop();
  };

  /**
   * Wire the document-level press listeners once the scroller is in its
   * live document. Element refs run on template clones before insertion and
   * the clone adopts by the end of the mount task, so one microtask usually
   * suffices; async boundary cases (portals, lazy roots) retry on a timer.
   */
  const wireDocument = (): void => {
    if (released || doc !== null) return;
    if (scroller.isConnected) {
      doc = scroller.ownerDocument;
      doc.addEventListener('keydown', onKeydown, true);
      doc.addEventListener('focusin', popNow, true);
      doc.addEventListener('pointerdown', popNow, true);
      return;
    }
    if (!wiredMicrotask) {
      wiredMicrotask = true;
      queueMicrotask(wireDocument);
      return;
    }
    if (wiringTimer === undefined) {
      wiringTimer = setTimeout(() => {
        wiringTimer = undefined;
        wireDocument();
      }, 16);
    }
  };
  wireDocument();

  scroller.addEventListener('scroll', popNow, { capture: true, passive: true });

  return () => {
    if (released) return;
    released = true;
    if (wiringTimer !== undefined) clearTimeout(wiringTimer);
    doc?.removeEventListener('keydown', onKeydown, true);
    doc?.removeEventListener('focusin', popNow, true);
    doc?.removeEventListener('pointerdown', popNow, true);
    scroller.removeEventListener('scroll', popNow, { capture: true });
    popNow();
  };
}
