/**
 * The exclusion builder overlay — a content script registered at runtime:
 * it is not in the manifest and never loads with a page; the background
 * injects it into a tab's top frame when the builder is opened, so its
 * code (editor, picker, engine validation) costs pages nothing until then.
 * Injecting it again replaces the running instance (its context is
 * invalidated by the newer one), so opening is idempotent.
 *
 * Page-safety: one shadow root with its own stylesheet, rendered in the
 * top layer; key events stop at the shadow root; the page is only read
 * (scan, geometry), never written; every listener, observer and timer
 * rides the content-script context or the view's cleanup, and an
 * invalidated context (extension reload) removes the whole overlay.
 */
import { onCleanup, onMount } from 'solid-js';
import { DelegatedEvents, delegateEvents } from 'solid-js/web';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { createLogger } from '../../lib/logger';
import { onMessage, sendMessage } from '../../lib/messaging';
import { mountShadowUi } from '../../components/injected-ui/mount';
import { OVERLAY_HOST_NAME } from '../../components/injected-ui/key-guard';
import { OverlayApp } from './app';
import { createOverlayController } from './controller';
import { createPageTools } from './page-tools';
import { mountOverlay } from './mount-overlay';
import { startPicking } from './picker';
import { createMessagingSessionPort, type SessionTransport } from './session/port';
import './styles.css';

const log = createLogger('exclusion-overlay');

/**
 * Events stopped at the shadow root, so the page never sees the overlay's
 * input: every event Solid delegates, plus the other input events pages
 * hook. Pages do act on them — WP Rocket's delay runtime, for one, saves
 * a page's first interactions at the window and replays them on their
 * targets once its scripts load, which would replay a click on an overlay
 * button a second time.
 */
const ISOLATED_EVENTS = [
  ...DelegatedEvents,
  'keypress',
  'wheel',
  'touchcancel',
  'pointercancel',
  'auxclick',
  'paste',
  'copy',
  'cut',
  'compositionstart',
  'compositionupdate',
  'compositionend'
];

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
 * Render the overlay's view into the mounted shadow root.
 *
 * @param ctx The content script's context (listeners, timers, abort on close).
 * @param container The UI container inside the shadow root.
 * @param shadow The shadow root (Solid delegates events there).
 * @param host The shadow host (the overlay's own input passes the picker).
 * @returns The view's disposer.
 */
function renderOverlay(
  ctx: ContentScriptContext,
  container: HTMLElement,
  shadow: ShadowRoot,
  host: HTMLElement
): Promise<() => void> {
  // Isolated events never reach the document, where Solid delegates by
  // default: delegate them at the shadow root instead.
  delegateEvents([...DelegatedEvents], shadow as unknown as Document);
  const listen = (
    target: EventTarget,
    type: string,
    handler: (event: Event) => void,
    passive = false
  ): void => {
    ctx.addEventListener(target, type as keyof WindowEventMap, handler, { passive, capture: true });
  };
  return mountShadowUi(container, () => {
    const page = createPageTools({
      doc: document,
      win: window,
      host,
      listen,
      isInvalid: () => ctx.isInvalid,
      later: (run) => {
        ctx.setTimeout(run, 0);
      }
    });
    const controller = createOverlayController({
      port: createMessagingSessionPort(MESSAGING_TRANSPORT, log),
      pageFacts: page.pageFacts,
      now: () => Date.now(),
      schedule: (run, ms) => {
        const id = ctx.setTimeout(run, ms);
        return () => {
          clearTimeout(id);
        };
      },
      reload: () => {
        window.location.reload();
      },
      log
    });
    onMount(() => {
      controller.start();
    });
    onCleanup(() => {
      controller.dispose();
      page.dispose();
    });
    const requestFrame = (run: () => void): void => {
      ctx.requestAnimationFrame(run);
    };
    return (
      <OverlayApp
        controller={controller}
        page={page}
        origin={window.location.origin}
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
    // The builder edits the page's own document: never inside a frame.
    if (window.top !== window) return;
    const reportFailure = (cause: unknown): void => {
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
          isolateEvents: ISOLATED_EVENTS,
          ...hooks
        }),
      render: (container, shadow, host) => renderOverlay(ctx, container, shadow, host),
      onError: reportFailure
    }).catch(reportFailure);
  }
});
