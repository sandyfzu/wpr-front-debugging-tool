/**
 * The exclusion builder overlay — a content script registered at runtime:
 * it is not in the manifest and never loads with a page; the background
 * injects it into a tab's top frame when the builder is opened, so its
 * code (editor, picker, engine validation) costs pages nothing until then.
 * Every open claims the page's overlay slot
 * first (`lib/exclusion-session/overlay-slot`), so a document gets one
 * overlay: a live instance is revealed, never replaced.
 *
 * Page-safety: one shadow root with its own stylesheet, rendered in the
 * top layer; key events stop at the shadow root; the page is only read
 * (scan, geometry), never written; every listener, observer and timer
 * rides the content-script context or the view's cleanup, and an
 * invalidated context (extension reload) removes the whole overlay.
 *
 * The on-page UI gate: the background injects nothing while it is off,
 * and this instance follows it from its first moment — a gate-off (a
 * write racing the injection, or a later one) ends it like a close. The
 * session goes on; the background brings the overlay back on a gate-on.
 */
import { onCleanup, onMount } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { guardInvalidationTeardown } from '../../lib/dead-context';
import { createLogger } from '../../lib/logger';
import { onMessage, sendMessage } from '../../lib/messaging';
import { mountShadowUi } from '../../components/injected-ui/mount';
import { OVERLAY_HOST_NAME } from '../../components/injected-ui/key-guard';
import { OverlayApp } from './app';
import {
  WINDOW_FRAMES,
  WINDOW_TIMERS,
  contextFrames,
  contextScheduler
} from '../../utils/context-timers';
import { createOverlayController } from './controller';
import {
  createSimulationEvidence,
  readSimulationPage,
  requestedPageUrl
} from './exclusions/simulation-page';
import { createSimulationMarkerCheck } from '../../lib/messaging/simulation-marker-verifier';
import { createPageTools } from './page-tools';
import { mountOverlay } from '../../components/injected-ui/mount-overlay';
import { startPicking } from './picker';
import { createMessagingSessionPort, type SessionTransport } from './session/port';
import type { OverlayPresentation } from '../../lib/exclusion-session/overlay-reopen';
import { readNavigationAnchor } from '../../lib/exclusion-session/navigation-anchor';
import {
  claimedPresentation,
  holdStartingOverlay,
  type StartingOverlay
} from '../../lib/exclusion-session/overlay-slot';
import { endWhenPageUiOff, pageUiGateDeps } from '../../lib/page-ui/gate-follower';
import './styles.css';

const log = createLogger('exclusion-overlay');

/** The extension's isolated world (where the overlay's slot lives). */
const ISOLATED_WORLD = globalThis as unknown as Record<string, unknown>;

/** The extension messenger as the session port's transport. */
const MESSAGING_TRANSPORT: SessionTransport = {
  send: (row, data) => sendMessage(row, data),
  listen: (handler) =>
    onMessage('exclusionSessionChanged', ({ data }) => {
      handler(data);
      return true;
    })
};

/**
 * Tell the background how the user left the overlay (the session tab's
 * next pages follow suit). Best effort: a missing receiver only means the
 * next page re-opens with the panel.
 *
 * @param open Unfolded (`true`) or folded/closed (`false`).
 */
function reportPresentation(open: boolean): void {
  sendMessage('exclusionOverlayPresented', { open }).catch((cause: unknown) => {
    log.debug('Overlay presentation not reported', cause);
  });
}

/**
 * Render the overlay's view into the mounted shadow root.
 *
 * @param ctx The content script's context (listeners, timers, abort on close).
 * @param container The UI container inside the shadow root.
 * @param shadow The shadow root (Solid delegates events there).
 * @param host The shadow host (the overlay's own input passes the picker).
 * @param presentation How a re-open starts (null: an explicit open).
 * @param slot This instance's hold on the page's overlay slot.
 * @returns The view's disposer.
 */
function renderOverlay(
  ctx: ContentScriptContext,
  container: HTMLElement,
  shadow: ShadowRoot,
  host: HTMLElement,
  presentation: OverlayPresentation | null,
  slot: StartingOverlay
): Promise<() => void> {
  const listen = (
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    passive = false
  ): void => {
    ctx.addEventListener(target, type as keyof WindowEventMap, handler, { passive, capture: true });
  };
  return mountShadowUi(container, shadow, () => {
    const schedule = contextScheduler(ctx, WINDOW_TIMERS);
    const page = createPageTools({
      doc: document,
      win: window,
      host,
      listen,
      isInvalid: () => ctx.isInvalid,
      later: (run) => {
        schedule(run, 0);
      },
      // Recorded at document_start by the isolated script (same world).
      navigationAnchor: () => readNavigationAnchor(ISOLATED_WORLD)
    });
    const simulationEvidence = createSimulationEvidence({
      read: () => readSimulationPage(document, requestedPageUrl(page.pageFacts())),
      changed: page.candidates,
      verify: createSimulationMarkerCheck({
        send: (markerId) => sendMessage('verifySimulationMarker', { markerId }),
        isInvalid: () => ctx.isInvalid,
        log
      }),
      log
    });
    const controller = createOverlayController({
      port: createMessagingSessionPort(MESSAGING_TRANSPORT, log),
      pageFacts: page.pageFacts,
      simulationEvidence,
      now: () => Date.now(),
      schedule,
      reload: () => {
        window.location.reload();
      },
      log
    });
    // Back from the back/forward cache: the session went on without this
    // document (its pushes went elsewhere) — read where it stands now.
    listen(window, 'pageshow', (event) => {
      if ((event as PageTransitionEvent).persisted) controller.resync();
    });
    onMount(() => {
      controller.start();
    });
    onCleanup(() => {
      slot.release();
      controller.dispose();
      page.dispose();
    });
    const nextFrame = contextFrames(ctx, WINDOW_FRAMES);
    const requestFrame = (run: () => void): void => {
      nextFrame(run);
    };
    return (
      <OverlayApp
        controller={controller}
        page={page}
        origin={window.location.origin}
        presentation={presentation}
        onPresented={reportPresentation}
        onRevealReady={(reveal) => {
          slot.attach(host, reveal);
        }}
        requestFrame={requestFrame}
        listen={(target, type, handler) => {
          listen(target, type, handler, true);
        }}
        isInvalid={() => ctx.isInvalid}
        startPicking={(events) =>
          startPicking(
            {
              win: window,
              host,
              resolve: (x, y) => page.pointPick(x, y),
              pointed: (x, y) => document.elementFromPoint(x, y),
              requestFrame,
              signal: ctx.signal
            },
            events
          )
        }
        // Close ends this instance's context: WXT removes the UI and every
        // listener, timer and observer registered through it goes too.
        onClose={() => {
          ctx.abort('Exclusion builder closed');
        }}
      />
    );
  });
}

export default defineContentScript({
  // Injected on demand by the background (never listed in the manifest).
  registration: 'runtime',
  matches: [...URL_PATTERNS],
  cssInjectionMode: 'ui',
  main(ctx: ContentScriptContext) {
    // First: every teardown registered below runs dead-context safe (an
    // extension reload must never put an error on the host page).
    guardInvalidationTeardown(ctx, log);
    // The builder edits the page's own document: never inside a frame.
    if (window.top !== window) return;
    // How the open that claimed the page's slot wants it to start.
    const presentation = claimedPresentation(ISOLATED_WORLD);
    // An explicit open shows the panel: the session's next pages follow it
    // (a fold or close before it no longer applies).
    if (presentation === null) reportPresentation(true);
    // Hold the page's overlay slot from now on (also while mounting): a
    // later open reveals this instance instead of injecting another one.
    const slot = holdStartingOverlay(
      ISOLATED_WORLD,
      () => ctx.isInvalid,
      () => Date.now()
    );
    ctx.onInvalidated(() => {
      slot.release();
    });
    // A gate-off ends this instance (UI, listeners, slot) without reporting
    // a fold: the session tab's remembered presentation is what comes back.
    endWhenPageUiOff(pageUiGateDeps(ctx, log), (reason) => {
      ctx.abort(reason);
    });
    const reportFailure = (cause: unknown): void => {
      // A failed mount must not hold opens up: leave the slot.
      slot.release();
      log.error(
        'Opening the exclusion builder failed',
        cause instanceof Error ? cause.message : cause
      );
    };
    mountOverlay({
      isInvalid: () => ctx.isInvalid,
      createUi: (hooks) =>
        createShadowRootUi(ctx, {
          name: OVERLAY_HOST_NAME,
          position: 'inline',
          // The documentElement, not the body: a page transform on <body>
          // must not become the overlay's containing block (the top layer
          // escapes it anyway; this covers browsers without popovers).
          anchor: 'html',
          append: 'last',
          ...hooks
        }),
      render: (container, shadow, host) =>
        renderOverlay(ctx, container, shadow, host, presentation, slot),
      onError: reportFailure
    }).catch(reportFailure);
  }
});
