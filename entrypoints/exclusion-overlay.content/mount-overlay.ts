/**
 * The overlay's mount lifecycle, separate from WXT's UI factory so its
 * races are testable: creating the shadow-root UI awaits the stylesheet,
 * and a newer injection can invalidate this instance's context during that
 * wait. WXT registers its removal on the context only after the wait — an
 * abort that already happened never fires it — so this instance must check
 * the context itself after every await, or a dead second overlay mounts.
 */

/** The UI handle WXT's factory returns (the parts used here). */
export interface OverlayUi {
  mount(): void;
  remove(): void;
}

/** The view's render, returning its disposer once mounted. */
export type RenderView = (
  container: HTMLElement,
  shadow: ShadowRoot,
  host: HTMLElement
) => Promise<() => void>;

/** What the lifecycle needs. */
export interface MountOverlayDeps {
  /** Whether this instance's content-script context is dead (superseded, closed, extension reloaded). */
  readonly isInvalid: () => boolean;
  /** Create the shadow-root UI with the given hooks (WXT's factory in production). */
  createUi(hooks: {
    onMount(container: HTMLElement, shadow: ShadowRoot, host: HTMLElement): void;
    onRemove(): void;
  }): Promise<OverlayUi>;
  readonly render: RenderView;
  /** Reports a render failure. */
  readonly onError: (cause: unknown) => void;
}

/**
 * Mount the overlay unless this instance was superseded meanwhile.
 *
 * @param deps The lifecycle seams.
 * @returns `mounted`, or `superseded` when the context died before the mount.
 */
export async function mountOverlay(deps: MountOverlayDeps): Promise<'mounted' | 'superseded'> {
  if (deps.isInvalid()) return 'superseded';
  let disposeView: (() => void) | null = null;
  let removed = false;
  const ui = await deps.createUi({
    onMount: (container, shadow, host) => {
      if (deps.isInvalid()) return;
      deps
        .render(container, shadow, host)
        .then((dispose) => {
          // Removed (or superseded) while the view was mounting: undo it.
          if (removed || deps.isInvalid()) dispose();
          else disposeView = dispose;
        })
        .catch(deps.onError);
    },
    onRemove: () => {
      removed = true;
      disposeView?.();
      disposeView = null;
    }
  });
  if (deps.isInvalid()) {
    // Superseded during the stylesheet wait: the newer instance owns the page.
    ui.remove();
    return 'superseded';
  }
  ui.mount();
  return 'mounted';
}
