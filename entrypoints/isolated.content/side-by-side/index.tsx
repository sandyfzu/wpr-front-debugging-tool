/**
 * Side-by-Side comparison: the site's cached page next to its cache-bypassed
 * version, opened from the extension's context menu or auto-opened on a
 * PageSpeed Insights page carrying this tool's site param (two pre-launched
 * analyses; the overlay's controls are hidden there — the analyses drive
 * themselves).
 *
 * The overlay lives inside a shadow root and is created on first open, so a
 * page that never opens the compare flow pays neither the component cost nor
 * the stylesheet fetch. Closing restores the page's inline `overflow` styles
 * exactly as they were captured at first open (the sticky html+body pair);
 * a re-open shows the previously loaded frames — first open assigns the
 * URLs, later ones only reveal the overlay — never fresh navigations.
 *
 * Scroll sync rides the same lifecycle: the persisted setting is re-read at
 * every open, the header switch applies live (and writes the setting), and
 * the engine tears down on close and invalidation. The engine arms only once
 * the overlay's frames exist — the open awaits the view's mount (the slots
 * register through its render) before starting, and on the analysis host no
 * sync exists at all (the two halves are analyses, not correlated pages).
 */

import { createSignal } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { onMessage } from '../../../lib/messaging/index';
import { createLogger } from '../../../lib/logger';
import { getOptions, optionsStore } from '../../../lib/storage/options';
import { isHttpUrl } from '../../../utils/urls';
import { mountShadowUi } from '../ui/mount';
import { getOverlayUrls, importedSiteUrl, psiEntryUrl } from './urls';
import { isPsiHost } from '../../../lib/side-by-side/analysis-host';
import { createScrollSyncSession } from './sync-session';
import { SideBySideOverlay } from './ui';
import type { CompareSide } from '../../../lib/side-by-side/scroll-sync';
import type { CompareUrls } from './urls';
import './side-by-side.css';

const log = createLogger('side-by-side');

/** The shadow-root host tag name handed to WXT (kebab-case, feature-scoped). */
const UI_NAME = 'wpr-fdt-side-by-side';

/**
 * Wire the compare flow into this content script. Pages that never use it
 * register only two message receivers.
 *
 * @param ctx The content script's context; everything registers through it.
 */
export function setupSideBySide(ctx: ContentScriptContext): void {
  /** Whether the overlay currently covers the page (drives its class). */
  const [isOpen, setOpen] = createSignal(false);
  /** Whether scroll sync is on for this overlay (persisted setting, applied live). */
  const [syncOn, setSyncOn] = createSignal(false);
  /** Sides whose document refused access; each renders its per-side marker while sync is on. */
  const [syncBlocked, setSyncBlocked] = createSignal<Partial<Record<CompareSide, true>>>({});
  /** The overlay's URL pair, resolved at first open and never re-resolved. */
  let urls: CompareUrls | null = null;
  /** The mounted UI handle; created at first open. */
  let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
  /** The Solid disposer, once the render has completed. */
  let disposeRoot: (() => void) | null = null;
  /**
   * The view's settled mount: the frame slots register through its render,
   * so every engine start must follow this promise — starting earlier arms
   * nothing (see the open path and the sync session's start contract).
   */
  let viewMounted: Promise<void> = Promise.resolve();
  /** Captured inline `overflow` styles of html+body, restored on close. */
  const overflow = { html: '', body: '' };
  /** Frames discovered through the component's ref callbacks. */
  const frames: Partial<Record<CompareSide, HTMLIFrameElement>> = {};

  /** The scroll-sync session: DOM halves + driver, built over the frames above. */
  const syncSession = createScrollSyncSession({
    frames: () => frames,
    onHalfBlocked: (side) => {
      setSyncBlocked((current) => ({ ...current, [side]: true }));
    },
    log
  });

  /** Start syncing (fresh probe: markers from the previous run reset). */
  const startSync = (): void => {
    setSyncBlocked({});
    syncSession.start();
  };

  const stopSync = (): void => {
    syncSession.stop();
  };

  /**
   * Persist the switch choice. Read-modify-write over the validated shape,
   * so the other option slots keep their values; a failed write degrades to
   * "not persisted" — the live toggle already applied, and the next open
   * reads the stored value again.
   */
  const persistScrollSyncSetting = async (next: boolean): Promise<void> => {
    try {
      const current = await getOptions();
      await optionsStore.setValue({
        ...current,
        features: { ...current.features, sbsScrollSync: next }
      });
    } catch (cause) {
      log.warn(
        'Persisting the scroll-sync setting failed; the choice resets on the next open',
        cause instanceof Error ? cause.message : cause
      );
    }
  };

  /**
   * The header switch: apply live, then persist. The engine starts/stops
   * with the switch — a running overlay follows without a reload.
   */
  const onToggleSync = (next: boolean): void => {
    setSyncOn(next);
    if (next) startSync();
    else stopSync();
    void persistScrollSyncSetting(next);
  };

  /**
   * The.PageSpeed Insights auto-open case: the analysis host with this
   * tool's site param, where the carried URL is a real http(s) URL (anything
   * else is a forged page state, not a flow).
   */
  const isAutoFlowPage = (): boolean => {
    const page = new URL(window.location.href);
    if (!isPsiHost(page)) return false;
    const carried = importedSiteUrl(page);
    return carried !== null && isHttpUrl(carried.href);
  };

  /**
   * Refresh one side: same-origin frames reload in place (a real reload,
   * with its network and cache semantics, keeping the frame's history);
   * cross-origin frames (the analyses) reject the reload probe, and a frame
   * whose browsing context has not been created yet has nothing to probe —
   * both get their `src` re-assigned, which always re-navigates the frame.
   * The assignment is the deliberate fallback, not an accident.
   */
  const refreshFrame = (side: CompareSide): void => {
    const frame = frames[side];
    if (frame === undefined) return;
    const renavigate = (): void => {
      frame.src = frame.src;
    };
    if (frame.contentWindow === null) {
      renavigate();
      return;
    }
    try {
      frame.contentWindow.location.reload();
    } catch {
      renavigate();
    }
  };

  /** The single open path for both the context menu and the auto-open. */
  const openOverlay = async (): Promise<void> => {
    if (isOpen()) return;
    // First open: capture the scroll baseline and resolve the URL pair once.
    if (urls === null) {
      overflow.html = document.documentElement.style.overflow;
      overflow.body = document.body.style.overflow;
      urls = getOverlayUrls(new URL(window.location.href));
    }
    // The persisted setting is read at every open (mid-life external changes
    // apply next open); a failed read degrades to off — the overlay itself
    // must not dead-end on a broken options store.
    try {
      const options = await getOptions();
      setSyncOn(options.features.sbsScrollSync);
    } catch (cause) {
      setSyncOn(false);
      log.error(
        'Reading the scroll-sync setting failed; the overlay opens with sync off',
        cause instanceof Error ? cause.message : cause
      );
    }
    await ensureUi(urls);
    // The engine must not outrun its halves: `registerFrame`'s slots fill
    // during the render that `ensureUi` started but did not await. Starting
    // from an unregistered slot attaches nothing — and the session's start
    // guard would then keep a "running" engine deaf to the halves until a
    // switch cycle re-armed it (the reported default-on regression).
    await viewMounted;
    // The analyses drive themselves — no correlated structure to sync there.
    if (syncOn() && !isAutoFlowPage()) startSync();
    show();
  };

  const show = (): void => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    setOpen(true);
  };

  const close = (): void => {
    // The engine is the open state's companion: off when the overlay hides.
    stopSync();
    document.documentElement.style.overflow = overflow.html;
    document.body.style.overflow = overflow.body;
    setOpen(false);
  };

  /** Mount the overlay (once); shadow-host cleanup is WXT's own. */
  const ensureUi = async (pair: CompareUrls): Promise<void> => {
    if (ui !== null) return;
    try {
      // The iframes stay unsandboxed (no `sandbox`/`credentialless`): the
      // feature compares real pages with their real cookies and requests,
      // so a sandboxed pair would not show what the user is comparing.
      // (Security note: the frames load the user's own session.)
      ui = await createShadowRootUi(ctx, {
        name: UI_NAME,
        position: 'inline',
        isolateEvents: true,
        onMount: (container) => {
          // The mount promise is owned, not fire-and-forget: the open path
          // awaits it before starting the sync engine (the failure branch
          // logs and continues — the overlay's UI failure is its own error).
          viewMounted = mountShadowUi(container, () => (
            <SideBySideOverlay
              urls={() => pair}
              open={isOpen}
              psiMode={isAutoFlowPage}
              registerFrame={(side, frame) => {
                // A null settles a re-render; an undefined slot means "no
                // frame" for the refresh guard.
                frames[side] = frame ?? undefined;
              }}
              refresh={refreshFrame}
              close={close}
              syncEnabled={syncOn}
              syncBlocked={(side) => syncBlocked()[side] === true}
              onToggleSync={onToggleSync}
            />
          ))
            .then((dispose) => {
              disposeRoot = dispose;
            })
            .catch((cause: unknown) => {
              log.error(
                'Mounting the side-by-side overlay view into the shadow root failed',
                cause instanceof Error ? cause.message : cause
              );
            });
        },
        onRemove: () => {
          disposeRoot?.();
          disposeRoot = null;
        }
      });
      ui.mount();
    } catch (error) {
      ui = null;
      log.error(
        'Mounting the side-by-side overlay failed',
        error instanceof Error ? error.message : error
      );
    }
  };

  ctx.onInvalidated(
    // Imperative page-lifecycle call — the reactivity lint cannot see that.
    // eslint-disable-next-line solid/reactivity
    onMessage('openSideBySide', async (): Promise<true> => {
      await openOverlay();
      return true;
    })
  );

  ctx.onInvalidated(
    onMessage('openSideBySidePerformance', (): true => {
      if (ctx.isInvalid) return true;
      // On the analysis host itself the entry is a no-op (analysis flows
      // start from a site, never from PSI).
      if (isPsiHost(new URL(window.location.href))) return true;
      const entryUrl = psiEntryUrl(new URL(window.location.href));
      if (entryUrl !== null) window.open(entryUrl, '_blank', 'noopener');
      return true;
    })
  );

  ctx.onInvalidated(
    onMessage('reportDeviceSimulationLiveness', (): true => {
      // The simulated-session sweep's reachability probe: answering proves
      // this tab's isolated world is alive. The dead-world case answers
      // nothing by construction (an extension reload removed the listener
      // with its context — exactly the ghost signal the sweep removes on).
      return true;
    })
  );

  /** The auto-open runs at the fully-rendered moment like the manual one. */
  const psiAutoOpen = (): void => {
    if (ctx.isInvalid || !isAutoFlowPage()) return;
    // Imperative page-lifecycle call (never re-driven by signals) — the
    // reactivity lint cannot see that, hence the local silences below.
    void openOverlay();
  };
  if (document.readyState === 'loading') {
    // eslint-disable-next-line solid/reactivity -- imperative page-lifecycle call
    ctx.addEventListener(window, 'DOMContentLoaded', psiAutoOpen);
  } else {
    // eslint-disable-next-line solid/reactivity -- imperative page-lifecycle call
    psiAutoOpen();
  }

  // An extension reload while the overlay is up must not leave the page
  // scroll-locked and must reset the lifecycle flag; the shadow-host
  // removal is WXT's own cleanup. The signal read is imperative (the
  // context is dead — nothing re-drives it), so the tracked-scope
  // heuristic is silenced for this one call.
  const restoreScrollOnInvalidation = (): void => {
    // The engine goes down with the context, like every other listener.
    syncSession.stop();
    if (isOpen()) {
      document.documentElement.style.overflow = overflow.html;
      document.body.style.overflow = overflow.body;
    }
    setOpen(false);
  };
  // eslint-disable-next-line solid/reactivity -- imperative teardown read
  ctx.onInvalidated(restoreScrollOnInvalidation);
}
