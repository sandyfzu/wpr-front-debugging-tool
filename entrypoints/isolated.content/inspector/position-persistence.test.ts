/**
 * The widget's persisted drag position, wired for real (a real content-script
 * context, the real view and mount, the positions item in fake storage):
 * a moved drop stores the translate once, cancels and click-length presses
 * never write, a capture loss stores the clamped commit, a mount restores
 * the stored translate and re-clamps it for the current viewport and shape,
 * a corrupt or failed read rests at the anchor, and a failed save leaves
 * the page untouched.
 *
 * happy-dom has no layout, so a small layout model stands in for the
 * stylesheet contract the drag seams read: a fixed zero-size chrome at the
 * bottom-right 16/16 anchor carrying the `--ins-drag-x/y` translate, and the
 * pill/card hanging off its corner (offsetParent = the chrome).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  DETECTION_WIDGET_POSITIONS_KEY,
  detectionWidgetPositionsStore
} from '../../../lib/storage/detection-widget-positions';
import { INSPECTOR_UI_NAME } from './strip-state';
import { setupInspectorWidget } from './index';

/** The positions item's key in the local area (no `local:` prefix). */
const POSITIONS = DETECTION_WIDGET_POSITIONS_KEY.slice('local:'.length);
/** The stylesheet anchor inset and the containment air margin. */
const ANCHOR = 16;
const MARGIN = 4;

/** The layout model's mutable inputs. */
const layout = {
  viewport: { width: 1280, height: 800 },
  pill: { width: 200, height: 22 },
  card: { width: 352, height: 400 }
};

/** The chrome's applied translate, read back from its custom properties. */
function translateOf(chrome: Element): { x: number; y: number } {
  const style = (chrome as HTMLElement).style;
  return {
    x: Number.parseFloat(style.getPropertyValue('--ins-drag-x')) || 0,
    y: Number.parseFloat(style.getPropertyValue('--ins-drag-y')) || 0
  };
}

/** The modelled size of a widget shape (pill or card), null for anything else. */
function shapeSize(element: Element): { width: number; height: number } | null {
  if (element.classList.contains('ins-pill')) return layout.pill;
  if (element.classList.contains('ins-card')) return layout.card;
  return null;
}

/** The modelled viewport rect of the chrome or one of its shapes. */
function modelRect(element: Element): DOMRect {
  const chrome = element.closest('.ins-chrome');
  if (chrome === null) return new DOMRect(0, 0, 0, 0);
  const { x, y } = translateOf(chrome);
  const corner = {
    left: layout.viewport.width - ANCHOR + x,
    top: layout.viewport.height - ANCHOR + y
  };
  const size = shapeSize(element);
  if (size === null) return new DOMRect(corner.left, corner.top, 0, 0);
  return new DOMRect(corner.left - size.width, corner.top - size.height, size.width, size.height);
}

/** Install the layout model on the element prototypes and the root element. */
function installLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return modelRect(this);
  });
  const getter = (
    name: 'offsetLeft' | 'offsetTop' | 'offsetWidth' | 'offsetHeight',
    read: (element: HTMLElement) => number
  ): void => {
    vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(function (this: HTMLElement) {
      return read(this);
    });
  };
  getter('offsetLeft', (el) => -(shapeSize(el)?.width ?? 0));
  getter('offsetTop', (el) => -(shapeSize(el)?.height ?? 0));
  getter('offsetWidth', (el) => shapeSize(el)?.width ?? 0);
  getter('offsetHeight', (el) => shapeSize(el)?.height ?? 0);
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement): Element | null {
      return shapeSize(this) === null ? null : this.closest('.ins-chrome');
    }
  });
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    get: () => layout.viewport.width
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => layout.viewport.height
  });
}

/** Remove the model's own-property stand-ins (the spies restore themselves). */
function uninstallLayout(): void {
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
}

let ctx: ContentScriptContext;
let seq = 0;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakeBrowser.reset();
  layout.viewport = { width: 1280, height: 800 };
  layout.pill = { width: 200, height: 22 };
  layout.card = { width: 352, height: 400 };
  installLayout();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'test',
    version: '1.0.0'
  });
  // No page-data hub runs here: the widget logs its documented failure copy.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  seq += 1;
  ctx = new ContentScriptContext(`inspector-position-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  uninstallLayout();
});

/** The mounted widget's shadow root, once its chrome rendered. */
async function shadow(): Promise<ShadowRoot> {
  return vi.waitFor(() => {
    const root = document.querySelector(INSPECTOR_UI_NAME)?.shadowRoot ?? null;
    if (root?.querySelector('.ins-chrome') == null) throw new Error('not rendered yet');
    return root;
  });
}

/** Boot the widget on this page and wait for its first render. */
async function boot(): Promise<ShadowRoot> {
  setupInspectorWidget(ctx);
  return shadow();
}

/** One required element inside the widget. */
function part(root: ShadowRoot, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`the widget part ${selector} is missing`);
  return element;
}

/** Forge the trust flag (the wiring acts on user input only). */
function trusted<E extends Event>(event: E): E {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

/** Dispatch one trusted pointer event. */
function pointer(
  target: Element,
  type: string,
  point: { x: number; y: number },
  init: { pointerId?: number; button?: number } = {}
): void {
  target.dispatchEvent(
    trusted(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        clientX: point.x,
        clientY: point.y,
        pointerId: init.pointerId ?? 1,
        button: init.button ?? 0
      })
    )
  );
}

/** The center of one element's modelled box. */
function center(element: Element): { x: number; y: number } {
  const rect = modelRect(element);
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Press the pill and move it by `delta` (still held). */
function pressAndMove(pill: Element, delta: { x: number; y: number }, pointerId = 1): void {
  const start = center(pill);
  pointer(pill, 'pointerdown', start, { pointerId });
  pointer(pill, 'pointermove', { x: start.x + delta.x, y: start.y + delta.y }, { pointerId });
}

/** The stored positions map (the local area's raw value). */
async function storedPositions(): Promise<unknown> {
  return (await fakeBrowser.storage.local.get(POSITIONS))[POSITIONS];
}

/** Let queued storage work run (the save is fire-and-forget by design). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

const ORIGIN = (): string => window.location.origin;

/** The four genuinely canceling ends of a live drag, wired as the user triggers them. */
const CANCEL_PATHS: [string, (root: ShadowRoot, pill: Element) => void][] = [
  [
    'Escape',
    (_root: ShadowRoot, pill: Element): void => {
      pill.dispatchEvent(
        trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
      );
    }
  ],
  [
    'a right-press (contextmenu)',
    (_root: ShadowRoot, pill: Element): void => {
      pill.dispatchEvent(trusted(new MouseEvent('contextmenu', { bubbles: true, button: 2 })));
    }
  ],
  [
    'an OS pointercancel',
    (_root: ShadowRoot, pill: Element): void => {
      pointer(pill, 'pointercancel', { x: 0, y: 0 });
    }
  ],
  [
    'a second pointer',
    (_root: ShadowRoot, pill: Element): void => {
      pointer(pill, 'pointerdown', { x: 0, y: 0 }, { pointerId: 2 });
    }
  ]
];

describe('persisting the drop', () => {
  it('a moved drop stores the translate once (release, then its capture loss)', async () => {
    const root = await boot();
    const pill = part(root, '.ins-pill');
    const writes = vi.spyOn(fakeBrowser.storage.local, 'set');
    pressAndMove(pill, { x: -200, y: -100 });
    pointer(pill, 'pointerup', { x: 0, y: 0 });
    pointer(pill, 'lostpointercapture', { x: 0, y: 0 });
    await flush();
    expect(await storedPositions()).toEqual({ [ORIGIN()]: { x: -200, y: -100, used: 1 } });
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('a capture loss mid-drag stores the clamped commit', async () => {
    const root = await boot();
    const pill = part(root, '.ins-pill');
    pressAndMove(pill, { x: -5000, y: 0 });
    pointer(pill, 'lostpointercapture', { x: 0, y: 0 });
    await flush();
    // Left edge at the margin: anchor-left (1280 − 16 − 200) → 4.
    expect(await storedPositions()).toEqual({
      [ORIGIN()]: { x: MARGIN - (1280 - ANCHOR - 200), y: 0, used: 1 }
    });
  });

  it('a press under the 5 px slop is a click: nothing stored', async () => {
    const root = await boot();
    const pill = part(root, '.ins-pill');
    pressAndMove(pill, { x: 2, y: 2 });
    pointer(pill, 'pointerup', { x: 0, y: 0 });
    await flush();
    expect(await storedPositions()).toBeUndefined();
  });

  it.each(CANCEL_PATHS)(
    '%s restores the pre-drag position and never writes',
    async (_name, cancel) => {
      const root = await boot();
      const pill = part(root, '.ins-pill');
      const chrome = part(root, '.ins-chrome');
      pressAndMove(pill, { x: -300, y: -200 });
      expect(translateOf(chrome)).toEqual({ x: -300, y: -200 });
      cancel(root, pill);
      // The drag's own pointer releasing after the cancel commits nothing.
      pointer(pill, 'pointerup', { x: 0, y: 0 });
      pointer(pill, 'lostpointercapture', { x: 0, y: 0 });
      await flush();
      expect(translateOf(chrome)).toEqual({ x: 0, y: 0 });
      expect(await storedPositions()).toBeUndefined();
    }
  );

  it('a failed save is logged and leaves the dropped widget where it stands', async () => {
    const root = await boot();
    const pill = part(root, '.ins-pill');
    const chrome = part(root, '.ins-chrome');
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));
    pressAndMove(pill, { x: -120, y: -60 });
    pointer(pill, 'pointerup', { x: 0, y: 0 });
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[WPR FDT] [inspector] Saving the widget\u2019s dragged position'),
        expect.objectContaining({ position: { x: -120, y: -60 } })
      );
    });
    expect(translateOf(chrome)).toEqual({ x: -120, y: -60 });
    expect(chrome.classList.contains('ins-dragging')).toBe(false);
  });

  it('after a card-handle drag (persisted), the first keyboard Enter still opens the card', async () => {
    const root = await boot();
    const pill = part(root, '.ins-pill');
    pill.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, detail: 1 })));
    await vi.waitFor(() => {
      expect(part(root, '.ins-chrome').classList.contains('ins-open')).toBe(true);
    });
    const head = part(root, '.ins-card-head');
    const start = center(part(root, '.ins-card'));
    pointer(head, 'pointerdown', start);
    pointer(head, 'pointermove', { x: start.x - 40, y: start.y - 30 });
    pointer(head, 'pointerup', { x: 0, y: 0 });
    // The captured release click lands on the card (consumer-less): the
    // suppression stays armed for the pointer path only.
    part(root, '.ins-card').dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true, detail: 1 }))
    );
    await flush();
    expect(await storedPositions()).toEqual({ [ORIGIN()]: { x: -40, y: -30, used: 1 } });
    head.dispatchEvent(
      trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
    );
    expect(part(root, '.ins-chrome').classList.contains('ins-open')).toBe(false);
    // Enter on the focused pill dispatches a detail-0 click.
    pill.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(part(root, '.ins-chrome').classList.contains('ins-open')).toBe(true);
  });
});

/**
 * Hold the page's one stored-position read until `release()` (later reads —
 * the save's own — run free), so a test can act while the read is in flight.
 */
function holdPositionRead(): { release: () => void } {
  const realRead = detectionWidgetPositionsStore.getValue.bind(detectionWidgetPositionsStore);
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(detectionWidgetPositionsStore, 'getValue')
    .mockImplementationOnce(async () => {
      await held;
      return realRead();
    })
    .mockImplementation(realRead);
  return { release };
}

describe('restoring on mount', () => {
  it('a stored translate is applied with the first render, without a re-settle leg', async () => {
    await fakeBrowser.storage.local.set({ [POSITIONS]: { [ORIGIN()]: { x: -300, y: -200 } } });
    setupInspectorWidget(ctx);
    const chrome = part(await shadow(), '.ins-chrome');
    await vi.waitFor(() => {
      expect(translateOf(chrome)).toEqual({ x: -300, y: -200 });
    });
    expect(chrome.classList.contains('ins-resettle')).toBe(false);
  });

  it('a smaller viewport re-clamps the restored translate fully inside, instantly', async () => {
    layout.viewport = { width: 640, height: 480 };
    await fakeBrowser.storage.local.set({ [POSITIONS]: { [ORIGIN()]: { x: -1200, y: -700 } } });
    const writes = vi.spyOn(fakeBrowser.storage.local, 'set');
    setupInspectorWidget(ctx);
    const root = await shadow();
    const chrome = part(root, '.ins-chrome');
    await vi.waitFor(() => {
      expect(translateOf(chrome)).toEqual({
        x: MARGIN - (640 - ANCHOR - 200),
        y: MARGIN - (480 - ANCHOR - 22)
      });
    });
    const pill = modelRect(part(root, '.ins-pill'));
    expect(pill.left).toBe(MARGIN);
    expect(pill.top).toBe(MARGIN);
    expect(chrome.classList.contains('ins-resettle')).toBe(false);
    // A restore is a read: the stored hint is not rewritten by the clamp.
    expect(writes).not.toHaveBeenCalled();
  });

  it('opening the card re-clamps a restored top-edge position for the grown shape', async () => {
    const topY = MARGIN - (800 - ANCHOR - 22);
    await fakeBrowser.storage.local.set({ [POSITIONS]: { [ORIGIN()]: { x: -400, y: topY } } });
    setupInspectorWidget(ctx);
    const root = await shadow();
    const chrome = part(root, '.ins-chrome');
    await vi.waitFor(() => {
      expect(translateOf(chrome)).toEqual({ x: -400, y: topY });
    });
    part(root, '.ins-pill').dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true, detail: 1 }))
    );
    await vi.waitFor(() => {
      expect(modelRect(part(root, '.ins-card')).top).toBe(MARGIN);
    });
  });

  it('a corrupt stored entry rests at the anchor', async () => {
    await fakeBrowser.storage.local.set({
      [POSITIONS]: { [ORIGIN()]: { x: 'left', y: Number.NaN } }
    });
    setupInspectorWidget(ctx);
    const root = await shadow();
    await flush();
    const chrome = part(root, '.ins-chrome');
    expect(chrome.style.getPropertyValue('--ins-drag-x')).toBe('');
    expect(chrome.style.getPropertyValue('--ins-drag-y')).toBe('');
  });

  it('a failed read is logged and rests at the anchor; the widget still mounts and drags', async () => {
    vi.spyOn(detectionWidgetPositionsStore, 'getValue').mockRejectedValue(
      new Error('storage down')
    );
    setupInspectorWidget(ctx);
    const root = await shadow();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Reading the widget\u2019s stored position failed'),
        expect.any(Error)
      );
    });
    const chrome = part(root, '.ins-chrome');
    expect(chrome.style.getPropertyValue('--ins-drag-x')).toBe('');
    pressAndMove(part(root, '.ins-pill'), { x: -50, y: -50 });
    expect(translateOf(chrome)).toEqual({ x: -50, y: -50 });
  });

  it('a drop made while the read is in flight wins over the late stored value', async () => {
    await fakeBrowser.storage.local.set({ [POSITIONS]: { [ORIGIN()]: { x: -900, y: -500 } } });
    const realRead = detectionWidgetPositionsStore.getValue.bind(detectionWidgetPositionsStore);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The page's read is held until the drop landed; later reads (the save's) run free.
    vi.spyOn(detectionWidgetPositionsStore, 'getValue')
      .mockImplementationOnce(async () => {
        await held;
        return realRead();
      })
      .mockImplementation(realRead);
    const root = await boot();
    const pill = part(root, '.ins-pill');
    const chrome = part(root, '.ins-chrome');
    pressAndMove(pill, { x: -100, y: -40 });
    pointer(pill, 'pointerup', { x: 0, y: 0 });
    release();
    await flush();
    expect(translateOf(chrome)).toEqual({ x: -100, y: -40 });
  });

  it.each(CANCEL_PATHS)(
    'a drag canceled by %s while the read is in flight still lets the late restore land',
    async (_name, cancel) => {
      await fakeBrowser.storage.local.set({ [POSITIONS]: { [ORIGIN()]: { x: -300, y: -200 } } });
      const read = holdPositionRead();
      const root = await boot();
      const pill = part(root, '.ins-pill');
      const chrome = part(root, '.ins-chrome');
      pressAndMove(pill, { x: -100, y: -40 });
      cancel(root, pill);
      pointer(pill, 'pointerup', { x: 0, y: 0 });
      expect(translateOf(chrome)).toEqual({ x: 0, y: 0 });
      read.release();
      await vi.waitFor(() => {
        expect(translateOf(chrome)).toEqual({ x: -300, y: -200 });
      });
    }
  );

  it('a read landing mid-drag is refused, not deferred: the drag keeps the chrome', async () => {
    await fakeBrowser.storage.local.set({ [POSITIONS]: { [ORIGIN()]: { x: -300, y: -200 } } });
    const read = holdPositionRead();
    const root = await boot();
    const pill = part(root, '.ins-pill');
    const chrome = part(root, '.ins-chrome');
    pressAndMove(pill, { x: -100, y: -40 });
    read.release();
    await flush();
    expect(translateOf(chrome)).toEqual({ x: -100, y: -40 });
    // Canceling afterwards restores the pre-drag anchor; the refused hint stays unapplied.
    pointer(pill, 'pointercancel', { x: 0, y: 0 });
    await flush();
    expect(translateOf(chrome)).toEqual({ x: 0, y: 0 });
  });

  it('a hide → show re-mounts where this page last dropped it', async () => {
    const root = await boot();
    const pill = part(root, '.ins-pill');
    pressAndMove(pill, { x: -250, y: -150 });
    pointer(pill, 'pointerup', { x: 0, y: 0 });
    await flush();
    const sites = 'detection-widget-sites';
    await fakeBrowser.storage.sync.set({ [sites]: { [ORIGIN()]: { enabled: false } } });
    await vi.waitFor(() => {
      expect(document.querySelector(INSPECTOR_UI_NAME)).toBeNull();
    });
    await fakeBrowser.storage.sync.set({ [sites]: { [ORIGIN()]: { enabled: true } } });
    const again = await shadow();
    await vi.waitFor(() => {
      expect(translateOf(part(again, '.ins-chrome'))).toEqual({ x: -250, y: -150 });
    });
  });
});
