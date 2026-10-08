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
 */

import { createSignal } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { onMessage } from '../../../lib/messaging/index';
import { createLogger } from '../../../lib/logger';
import { isHttpUrl } from '../../../utils/urls';
import { mountShadowUi } from '../ui/mount';
import { getOverlayUrls, importedSiteUrl, isPsiHost, psiEntryUrl } from './urls';
import { SideBySideOverlay, type SideBySideOverlaySide } from './ui';
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
  /** The overlay's URL pair, resolved at first open and never re-resolved. */
  let urls: CompareUrls | null = null;
  /** The mounted UI handle; created at first open. */
  let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
  /** The Solid disposer, once the render has completed. */
  let disposeRoot: (() => void) | null = null;
  /** Captured inline `overflow` styles of html+body, restored on close. */
  const overflow = { html: '', body: '' };
  /** Frames discovered through the component's ref callbacks. */
  const frames: Partial<Record<SideBySideOverlaySide, HTMLIFrameElement>> = {};

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
  const refreshFrame = (side: SideBySideOverlaySide): void => {
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
    await ensureUi(urls);
    show();
  };

  const show = (): void => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    setOpen(true);
  };

  const close = (): void => {
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
          void mountShadowUi(container, () => (
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
    if (isOpen()) {
      document.documentElement.style.overflow = overflow.html;
      document.body.style.overflow = overflow.body;
    }
    setOpen(false);
  };
  // eslint-disable-next-line solid/reactivity -- imperative teardown read
  ctx.onInvalidated(restoreScrollOnInvalidation);
}
