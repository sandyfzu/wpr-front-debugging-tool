/**
 * Clipboard writes from the overlay, on whatever page it runs. The async
 * clipboard (`navigator.clipboard.writeText`) exists only in secure
 * contexts — an `http:` page on a non-local host has none — and a page's
 * permissions policy can refuse it; a click's selection copy
 * (`execCommand('copy')` on a field selected inside the overlay's own
 * shadow tree) still works there while the click's user activation lasts.
 * So the async write goes first and the selection copy is the fallback; the
 * outcome is honest — `copied` only when the browser said it copied.
 *
 * The selection copy fires its `copy` event inside the overlay's tree, so
 * the overlay's key guard keeps it from the page like any other copy (its
 * default — copying the selection — still runs).
 */

/** What a write ended as. */
export type ClipboardWrite = 'copied' | 'failed';

/** The async clipboard's one method the overlay uses. */
export interface AsyncClipboard {
  writeText(text: string): Promise<void>;
}

/** The outside world a write runs against (injected: tests fake it). */
export interface ClipboardDeps {
  /** The async clipboard when this page offers one, else null. */
  readonly clipboard: AsyncClipboard | null;
  /**
   * Copy through a selection; true when the browser reports the copy done.
   * May throw (a browser without the command): read as a failure.
   */
  readonly copyBySelection: (text: string) => boolean;
  /** Records why a path failed (the outcome alone is the user's feedback). */
  readonly warn: (message: string, cause?: unknown) => void;
}

/**
 * Write text to the clipboard: the async clipboard first, the selection
 * copy when it is missing or refuses.
 *
 * @param text The text to write.
 * @param deps The clipboard paths.
 * @returns `copied` when either path confirmed the write, else `failed`.
 */
export async function writeClipboard(text: string, deps: ClipboardDeps): Promise<ClipboardWrite> {
  if (deps.clipboard !== null) {
    try {
      await deps.clipboard.writeText(text);
      return 'copied';
    } catch (cause) {
      // Refused (permissions policy, lost focus): the selection copy is the
      // fallback, so this is recorded, not surfaced.
      deps.warn('Clipboard write refused; copying through a selection instead', cause);
    }
  }
  try {
    if (deps.copyBySelection(text)) return 'copied';
    deps.warn('The selection copy reported nothing copied');
  } catch (cause) {
    deps.warn('The selection copy failed', cause);
  }
  return 'failed';
}

/**
 * The page's async clipboard when it can be used here: a secure context
 * with `navigator.clipboard.writeText` present.
 *
 * @param win The page's window.
 * @returns The clipboard bound to its owner, or null.
 */
export function asyncClipboardOf(win: Window): AsyncClipboard | null {
  if (!win.isSecureContext) return null;
  // The type promises a clipboard; an insecure or locked-down page omits it.
  const clipboard = win.navigator.clipboard as Clipboard | undefined;
  if (typeof clipboard?.writeText !== 'function') return null;
  return { writeText: (text) => clipboard.writeText(text) };
}

/**
 * A selection copier inside `container` (an element of the overlay's shadow
 * tree): a read-only field holding the text is appended, focused and
 * selected, the browser's copy command runs, then the field is removed and
 * focus goes back to where it was. The field is off screen and hidden from
 * assistive technology; it lives only for the synchronous call.
 *
 * @param container Where the temporary field lives.
 * @returns The copier: true when the browser reports the copy done.
 */
export function selectionCopier(container: HTMLElement): (text: string) => boolean {
  return (text) => {
    const doc = container.ownerDocument;
    const root = container.getRootNode() as Partial<DocumentOrShadowRoot>;
    const previous = root.activeElement ?? null;
    const field = doc.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.tabIndex = -1;
    field.setAttribute('aria-hidden', 'true');
    field.className = 'xo-copy-buffer';
    container.append(field);
    try {
      field.focus({ preventScroll: true });
      field.select();
      // Deprecated, yet still the only clipboard write an insecure page
      // allows (the async clipboard is secure-context only); its boolean is
      // the browser's own verdict.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- the insecure-page fallback has no replacement
      return doc.execCommand('copy');
    } finally {
      field.remove();
      (previous as HTMLElement | null)?.focus({ preventScroll: true });
    }
  };
}

/**
 * Writes text to the clipboard; `container` is an element of the overlay's
 * tree the selection-copy fallback may use. Never rejects for a refused copy.
 */
export type ClipboardWriter = (text: string, container: HTMLElement) => Promise<ClipboardWrite>;

/**
 * The overlay's writer on a page: its async clipboard (when it has one),
 * else a selection copy inside the overlay's tree.
 *
 * @param win The page's window.
 * @param warn Records a failed path.
 */
export function pageClipboardWriter(win: Window, warn: ClipboardDeps['warn']): ClipboardWriter {
  return (text, container) =>
    writeClipboard(text, {
      clipboard: asyncClipboardOf(win),
      copyBySelection: selectionCopier(container),
      warn
    });
}
