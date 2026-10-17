/** Retain keyboard focus when a keyed list moves, rather than replaces, a control. */

/**
 * Restore focus after an observed DOM move only if it fell back to the body.
 * Removed controls and deliberate focus changes are never followed.
 * @param container The list about to update its rendered keys.
 * @returns Cancel pending restoration when the owner updates again or disposes.
 */
export function preserveMovedFocus(container: HTMLElement): () => void {
  const document = container.ownerDocument;
  let active = document.activeElement;
  let cancelled = false;
  let moved = false;
  let observer: MutationObserver | undefined;
  /**
   * Require removal of the retained control or one of its ancestors, not a geometry update.
   * @param records Child-list changes during the synchronous render.
   */
  const recordMoves = (records: readonly MutationRecord[]): void => {
    if (active === null) return;
    moved ||= records.some((record) =>
      [...record.removedNodes].some((node) => node === active || node.contains(active))
    );
  };
  /**
   * A deliberate focus transfer supersedes restoration, even if it later blurs.
   * @param event The document's focus transfer.
   */
  const onFocus = (event: FocusEvent): void => {
    if (event.target !== active) cancel();
  };
  /** Release the short-lived listener and invalidate queued work. */
  const cancel = (): void => {
    cancelled = true;
    document.removeEventListener('focusin', onFocus, true);
    observer?.disconnect();
    observer = undefined;
    active = null;
  };
  if (active instanceof HTMLElement && container.contains(active)) {
    // One transient observer per focused list update, never one per row. Its
    // records distinguish a moved control from an intentional no-move blur.
    observer = new MutationObserver(recordMoves);
    observer.observe(container, { childList: true, subtree: true });
    // A control may stop bubbling focus events; capture still observes the transfer.
    document.addEventListener('focusin', onFocus, true);
    queueMicrotask(() => {
      recordMoves(observer?.takeRecords() ?? []);
      const target =
        !cancelled &&
        moved &&
        active instanceof HTMLElement &&
        active.isConnected &&
        container.contains(active) &&
        document.activeElement === document.body
          ? active
          : undefined;
      // The owner may keep the cancellation handle until its next update;
      // release the old row and observer before any focus handlers run.
      cancel();
      target?.focus({ preventScroll: true });
    });
  }
  return cancel;
}
