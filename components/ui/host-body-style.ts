/**
 * Undo the dialog library's close-time writes on a host page's `<body>`.
 *
 * On every layer close the library assigns the body's inline
 * `pointer-events` back to a value it only captures while a pointer-blocking
 * layer is open (never, for an injected non-modal dialog, so it assigns
 * `undefined`), then removes the body's whole `style` attribute when the
 * CSSOM counts no declarations in it — `style=""`, whitespace-only or
 * invalid-only text the page wrote. Both are writes into the page being
 * debugged, which an injected UI must never make.
 *
 * The guard reads the body right before the library's cleanup (the caller's
 * cleanup must run first, synchronously) and, a microtask later — after the
 * library's synchronous cleanup — puts back only what changed since, so the
 * page's own edits made while the dialog was open stay.
 *
 * Observable trade-off: a page `MutationObserver` on `<body>` still sees the
 * library's write and then the restore (e.g. `style` removed, then re-added —
 * two records). The library writes synchronously inside its own cleanup and
 * offers no option or later hook to skip it, so right after is the earliest
 * point to undo it; the attribute's final value is the page's own.
 */

/** What the guard compares: the raw attribute text and the inline `pointer-events`. */
export interface BodyStyleSnapshot {
  readonly attribute: string | null;
  readonly pointerEvents: string;
}

/**
 * Read the body's inline style state.
 *
 * @param body The host document's body.
 * @returns The attribute text (`null` when absent) and inline `pointer-events`.
 */
function snapshotBodyStyle(body: HTMLElement): BodyStyleSnapshot {
  return { attribute: body.getAttribute('style'), pointerEvents: body.style.pointerEvents };
}

/**
 * Restore the body's inline style where it differs from `before`: the whole
 * attribute text when it vanished, else the `pointer-events` value alone —
 * other declarations are never touched. A removed property can take the
 * attribute with it (some DOMs drop an emptied one), so presence is settled
 * last: put back when it existed before, removed again when it did not and
 * nothing is left.
 *
 * @param body The host document's body.
 * @param before The state read before the library's cleanup.
 */
export function restoreBodyStyle(body: HTMLElement, before: BodyStyleSnapshot): void {
  const after = snapshotBodyStyle(body);
  if (before.attribute !== null && after.attribute === null) {
    body.setAttribute('style', before.attribute);
    return;
  }
  if (after.pointerEvents === before.pointerEvents) return;
  if (before.pointerEvents === '') body.style.removeProperty('pointer-events');
  else body.style.pointerEvents = before.pointerEvents;
  const present = body.hasAttribute('style');
  if (before.attribute !== null && !present) body.setAttribute('style', before.attribute);
  else if (before.attribute === null && present && body.style.length === 0) {
    body.removeAttribute('style');
  }
}

/**
 * Read the body now and restore it a microtask later (after the library's
 * synchronous close work in the same cleanup pass).
 *
 * @param body The host document's body (`undefined` — a body-less document — is a no-op).
 */
export function guardBodyStyleThroughClose(body: HTMLElement | null | undefined): void {
  if (body === null || body === undefined) return;
  const before = snapshotBodyStyle(body);
  queueMicrotask(() => {
    restoreBodyStyle(body, before);
  });
}
