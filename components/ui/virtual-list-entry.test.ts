/**
 * Contract tests for Tab-entry masking: the pure plan (offscreen rows masked,
 * visible/partial rows kept, focused row exempt, stand-down without a visible
 * focusable) and the wiring (mask on Tab presses, pops on focusin/scroll/
 * pointerdown/animation frame, non-Tab presses ignored, release restores
 * everything, nested lists own their own rows).
 *
 * happy-dom has no layout engine, so the wiring tests stub per-element rects
 * with snapshot helpers and drive real dispatched events.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachEntryMask, planEntryMask, type RowGeometry } from './virtual-list-entry';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** The viewport band the geometry cases below place rows inside. */
const VIEW = { top: 100, bottom: 400 };

/**
 * A row geometry snapshot that also stubs the element's own rect, so both
 * the pure plan and the element-bound wiring read the same geometry.
 *
 * @param id Row identifier (`data-index`).
 * @param top The stubbed client-space top.
 * @param bottom The stubbed client-space bottom.
 * @param focusable Whether the row carries a focusable descendant.
 */
function row(id: number, top: number, bottom: number, focusable = true): RowGeometry {
  const el = document.createElement('div');
  el.dataset.index = String(id);
  if (focusable) el.append(document.createElement('button'));
  stubRect(el, top, bottom);
  return { el, top, bottom };
}

/**
 * Stub an element's client rect for happy-dom's absent layout engine.
 *
 * @param el The element to stub.
 * @param top The stubbed client-space top.
 * @param bottom The stubbed client-space bottom.
 */
function stubRect(el: HTMLElement, top: number, bottom: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom,
    height: bottom - top
  } as DOMRect);
}

/**
 * The standard geometry pattern the cases assert on: two overscan rows above,
 * a six-row visible band (row 8 crossing the bottom edge), two overscan rows
 * below — uniform 40 px heights on a 48 px step, like a real window.
 */
const standardRows = (): RowGeometry[] => [
  row(0, 4, 44),
  row(1, 52, 92),
  row(2, 100, 140),
  row(3, 148, 188),
  row(4, 196, 236),
  row(5, 244, 284),
  row(6, 292, 332),
  row(7, 340, 380),
  row(8, 388, 428),
  row(9, 436, 476),
  row(10, 484, 524)
];

/** The row ids the standard geometry plans to mask. */
const OUTSIDE_IDS = ['0', '1', '9', '10'];

describe('planEntryMask', () => {
  it('masks whole rows outside the band and keeps intersecting rows', () => {
    const plan = planEntryMask(standardRows(), VIEW.top, VIEW.bottom, null);
    // Rows 0/1 sit fully above, 9/10 fully below; rows 2–7 are visible and
    // row 8 crosses the bottom edge (a legal target the browser reveals
    // itself), so only the whole-outside rows are suppressed.
    expect(plan.map((el) => el.dataset.index)).toEqual(OUTSIDE_IDS);
  });

  it('exempts the focused row even when it is offscreen', () => {
    // An arrow key can leave the focused control outside the band; masking
    // its row would kill focus, so it survives this press.
    const rows = standardRows();
    const focused = rows[1];
    if (!focused) throw new Error('standardRows fixture lost row 1');
    const plan = planEntryMask(rows, VIEW.top, VIEW.bottom, focused.el);
    expect(plan.map((el) => el.dataset.index)).toEqual(['0', '9', '10']);
  });

  it('stands down when no viewport-intersecting row holds a focusable', () => {
    // Every band row is pure display: the natural nearest offscreen row is
    // the correct target and the browser's own reveal must stay in charge —
    // suppressing it would focus an invisible control.
    const rows = [
      row(0, 4, 44),
      row(1, 52, 92),
      row(2, 100, 140, false),
      row(3, 148, 188, false),
      row(8, 388, 428, false),
      row(9, 436, 476),
      row(10, 484, 524)
    ];
    expect(planEntryMask(rows, VIEW.top, VIEW.bottom, null)).toEqual([]);
  });

  it('stands down for empty lists and fully-visible short lists', () => {
    expect(planEntryMask([], VIEW.top, VIEW.bottom, null)).toEqual([]);
    const visible = [row(0, 100, 140), row(1, 148, 188), row(2, 196, 236)];
    expect(planEntryMask(visible, VIEW.top, VIEW.bottom, null)).toEqual([]);
  });
});

describe('attachEntryMask', () => {
  /** The wiring test drive over one mounted list. */
  interface Wiring {
    scroller: HTMLElement;
    rows: HTMLElement[];
  }

  /**
   * Build the list structure the wiring reads (scroller > spacer > rows),
   * stub every rect and mount it on the document. The caller attaches and
   * releases itself.
   *
   * @param childRender A builder run in the host row before mounting (e.g.
   *   a nested list).
   * @param childRow The row index receiving the built content.
   */
  function buildWiring(childRender?: (row: HTMLElement) => void, childRow?: number): Wiring {
    const scroller = document.createElement('div');
    scroller.setAttribute('data-fdt', 'virtual-list');
    const spacer = document.createElement('div');
    spacer.setAttribute('data-fdt-virtual-spacer', '');
    const rows = standardRows().map((geometry) => geometry.el);
    const host = childRow === undefined ? undefined : rows[childRow];
    if (childRender && host) childRender(host);
    spacer.append(...rows);
    // happy-dom's client metrics are zero for unstyled elements; the real
    // element reports its content height — stub the borderless listing shape
    // (clientTop 0, clientHeight = the stubbed box height).
    stubRect(scroller, VIEW.top, VIEW.bottom);
    Object.defineProperty(scroller, 'clientTop', { value: 0 });
    Object.defineProperty(scroller, 'clientHeight', { value: VIEW.bottom - VIEW.top });
    scroller.append(spacer);
    document.body.append(scroller);
    return { scroller, rows };
  }

  /** One navigation keydown dispatched at the document (capture paths run). */
  function press(
    key: string,
    modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  ): void {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    );
  }

  it('measures the band from the content box, so a bordered scroller masks the seam row', () => {
    // The real list scrolls inside a 1px-rounded border: a seam row whose
    // bottom ends at the border-box top would read as "1px intersecting"
    // against the raw rect and get spared, but the rows live in the content
    // box — the band's edges are the content-rect edges. The scroller stubs
    // a real 1px-border 300px box: 1px both edges (clientTop 1; the rest of
    // the border box below the 298 client area is the bottom border).
    const scroller = document.createElement('div');
    scroller.setAttribute('data-fdt', 'virtual-list');
    const spacer = document.createElement('div');
    spacer.setAttribute('data-fdt-virtual-spacer', '');
    const seam = row(0, 60, 101);
    const band = row(1, 101, 141);
    spacer.append(seam.el, band.el);
    stubRect(scroller, 100, 400);
    Object.defineProperty(scroller, 'clientTop', { value: 1 });
    Object.defineProperty(scroller, 'clientHeight', { value: 298 });
    scroller.append(spacer);
    document.body.append(scroller);
    const release = attachEntryMask(scroller);
    press('Tab');
    // The seam row sits wholly outside the content band (its bottom is the
    // band's own top edge) — masked; the bordered read must not spare it.
    expect(seam.el.inert).toBe(true);
    expect(band.el.inert).toBe(false);
    release();
  });

  it('wires on adoption: a template-clone ref attach masks only after insertion', async () => {
    // Solid refs run on template clones before the element is adopted; the
    // document-level wiring must follow the element into its real document,
    // never wire the inert template document's event surface.
    const scroller = document.createElement('div');
    scroller.setAttribute('data-fdt', 'virtual-list');
    const spacer = document.createElement('div');
    spacer.setAttribute('data-fdt-virtual-spacer', '');
    const rows = standardRows();
    spacer.append(...rows.map((geometry) => geometry.el));
    stubRect(scroller, VIEW.top, VIEW.bottom);
    Object.defineProperty(scroller, 'clientTop', { value: 0 });
    Object.defineProperty(scroller, 'clientHeight', { value: VIEW.bottom - VIEW.top });
    scroller.append(spacer);
    const release = attachEntryMask(scroller);
    press('Tab');
    // Still detached: nothing is wired yet, nothing masks, no error.
    for (const geometry of rows) expect(geometry.el.inert).toBe(false);
    // Adoption: the pending microtask wires the live document, and the next
    // entry press masks the exact offscreen set (the standard fixture's
    // overscan rows), not merely some rows.
    document.body.append(scroller);
    await Promise.resolve();
    press('Tab');
    expect(
      rows.filter((geometry) => geometry.el.inert).map((geometry) => geometry.el.dataset.index)
    ).toEqual(OUTSIDE_IDS);
    release();
  });

  it('wires through the frame-pace timer fallback when adoption lands late', async () => {
    // The microtask arm covers the usual template-clone adoption (the pin
    // above); a portal or lazy root can adopt later, and only the frame-pace
    // retry timer wires the document then. Fake timers make the interplay
    // deterministic: vitest does not fake `queueMicrotask` (the arm runs on a
    // plain await) but does fake the wiring `setTimeout` (advanced here).
    const scroller = document.createElement('div');
    scroller.setAttribute('data-fdt', 'virtual-list');
    const spacer = document.createElement('div');
    spacer.setAttribute('data-fdt-virtual-spacer', '');
    const rows = standardRows();
    spacer.append(...rows.map((geometry) => geometry.el));
    stubRect(scroller, VIEW.top, VIEW.bottom);
    Object.defineProperty(scroller, 'clientTop', { value: 0 });
    Object.defineProperty(scroller, 'clientHeight', { value: VIEW.bottom - VIEW.top });
    scroller.append(spacer);
    vi.useFakeTimers();
    const release = attachEntryMask(scroller);
    try {
      press('Tab');
      // Detached: the microtask arm is pending, nothing is wired, nothing masks.
      for (const geometry of rows) expect(geometry.el.inert).toBe(false);
      // The arm fired without inserting and found no document, so wiring fell
      // through to the frame-pace timer (exactly one retry in flight).
      await Promise.resolve();
      expect(vi.getTimerCount(), 'the wiring retry is the only timer pending').toBe(1);
      // The retry pass runs while the element is still detached and re-arms
      // (never a pile of timers).
      vi.advanceTimersByTime(16);
      expect(vi.getTimerCount(), 'the retry re-armed while detached').toBe(1);
      // The late async boundary: insertion alone still wires nothing.
      document.body.append(scroller);
      press('Tab');
      for (const geometry of rows) expect(geometry.el.inert).toBe(false);
      // The next retry pass adopts the live document; the entry press masks.
      vi.advanceTimersByTime(16);
      expect(vi.getTimerCount(), 'wiring leaves no retry pending').toBe(0);
      press('Tab');
      expect(
        rows.filter((geometry) => geometry.el.inert).map((geometry) => geometry.el.dataset.index)
      ).toEqual(OUTSIDE_IDS);
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it('masks only on entry: a press while focus lives inside never masks', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    // The interior Tab walk starts on a band row: the next row lives in the
    // overscan ahead of the window and must stay reachable.
    idOf(wiring.rows, '2').querySelector('button')?.focus();
    press('Tab');
    for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    release();
  });

  it('masks offscreen rows on an entry press and pops on the navigation focusin', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    // Entry focus (the active control lives outside the scroller): the
    // offscreen overscan rows mask; band and crossing rows stay eligible.
    press('Tab');
    const offscreen = ['0', '9', '10'];
    const kept = ['2', '3', '4', '5', '6', '7', '8'];
    for (const id of offscreen) expect(idOf(wiring.rows, id).inert, `row ${id}`).toBe(true);
    for (const id of kept) expect(idOf(wiring.rows, id).inert, `row ${id}`).toBe(false);
    // The navigation's focusin pops the mask the same instant.
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    release();
  });

  it('pops on scroll, pointerdown, and the animation-frame fallback', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    // Fake timers pin the frame-fallback pop deterministically: vitest fakes
    // this view's `requestAnimationFrame`, so the clock advance does the pop
    // — no real-time gamble against happy-dom's tick length.
    vi.useFakeTimers();
    try {
      press('Tab');
      wiring.scroller.dispatchEvent(new Event('scroll'));
      expect(idOf(wiring.rows, '0').inert).toBe(false);
      press('Tab');
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(idOf(wiring.rows, '0').inert).toBe(false);
      // No focusin/scroll/pointerdown: one animation frame still bounds it.
      press('Tab');
      expect(idOf(wiring.rows, '0').inert).toBe(true);
      vi.advanceTimersByTime(16);
      for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it('keeps one pop frame in flight however many presses land in it', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    vi.useFakeTimers();
    try {
      press('Tab');
      expect(vi.getTimerCount(), 'the press leaves its frame pending').toBe(1);
      press('Tab');
      expect(vi.getTimerCount(), 'the second press replaced, never stacked, the frame').toBe(1);
      expect(idOf(wiring.rows, '0').inert, 'the mask is still in flight').toBe(true);
      // The one surviving frame pops both presses' masks.
      vi.advanceTimersByTime(16);
      for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it('a second press replans from clean rows: no row of the first plan stays inert', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    vi.useFakeTimers();
    try {
      press('Tab');
      expect(idOf(wiring.rows, '0').inert).toBe(true);
      // The rows moved between the presses (a scroll without its event):
      // row 0 is now in the band, so the second plan leaves it out.
      for (const [index, el] of wiring.rows.entries())
        stubRect(el, 100 + index * 10, 108 + index * 10);
      press('Tab');
      vi.advanceTimersByTime(16);
      for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it('reads focus through a shadow root: an interior press inside a shadow list never masks', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const wiring = buildWiring();
    root.append(wiring.scroller);
    const release = attachEntryMask(wiring.scroller);
    idOf(wiring.rows, '2').querySelector('button')?.focus();
    expect(root.activeElement).not.toBeNull();
    press('Tab');
    for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    release();
  });

  it('ignores non-Tab presses and modifier Tab presses', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    press('Enter');
    press('Tab', { ctrlKey: true });
    press('Tab', { metaKey: true });
    press('Tab', { altKey: true });
    for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    release();
  });

  it('stands down on a detached scroller without error', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    wiring.scroller.remove();
    press('Tab');
    for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    release();
  });

  it('release restores rows and stops future masking, callable twice', () => {
    const wiring = buildWiring();
    const release = attachEntryMask(wiring.scroller);
    press('Tab');
    expect(idOf(wiring.rows, '0').inert).toBe(true);
    release();
    for (const el of wiring.rows) expect(el.inert).toBe(false);
    press('Tab');
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    for (const el of wiring.rows) expect(el.inert, `row ${String(el.dataset.index)}`).toBe(false);
    expect(() => {
      release();
    }).not.toThrow();
  });

  it('masks only its own spacer rows; a nested list keeps its rows', () => {
    const wiring = buildWiring((hostRow) => {
      const nested = buildWiring();
      hostRow.append(nested.scroller);
    }, 4);
    const release = attachEntryMask(wiring.scroller);
    press('Tab');
    for (const id of OUTSIDE_IDS) expect(idOf(wiring.rows, id).inert, `row ${id}`).toBe(true);
    for (const id of ['2', '3', '4', '5', '6', '7', '8']) {
      expect(idOf(wiring.rows, id).inert, `row ${id}`).toBe(false);
    }
    // The nested list's rows live inside host row 4, never as the spacer's
    // direct children: the outer press cannot mask them.
    const nestedRows = Array.from(
      idOf(wiring.rows, '4').querySelectorAll<HTMLElement>('[data-index]')
    );
    expect(nestedRows.length).toBeGreaterThan(0);
    for (const el of nestedRows)
      expect(el.inert, `nested row ${String(el.dataset.index)}`).toBe(false);
    release();
  });
});

/**
 * Fetch one mounted row by id for assertion readability.
 *
 * @param rows The wiring's mounted rows.
 * @param id The `data-index` to fetch.
 * @returns The row element.
 * @throws {@link Error} When the id is not mounted (a broken test fixture).
 */
function idOf(rows: readonly HTMLElement[], id: string): HTMLElement {
  const el = rows.find((row) => row.dataset.index === id);
  if (!el) throw new Error(`row ${id} not mounted in fixture`);
  return el;
}
