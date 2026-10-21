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
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { createLogger } from '../../lib/logger';
import { onMessage, sendMessage } from '../../lib/messaging';
import { mountShadowUi } from '../../components/injected-ui/mount';
import { OverlayApp } from './app';
import { createOverlayController } from './controller';
import { createPageTools } from './page-tools';
import { createMessagingSessionPort, type SessionTransport } from './session/port';
import './styles.css';

const log = createLogger('exclusion-overlay');

/** The shadow host's tag name (feature-scoped, kebab-case). */
const UI_NAME = 'wpr-fdt-exclusion-builder';

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
 * Mount the overlay into this page.
 *
 * @param ctx The content script's context.
 */
async function mountOverlay(ctx: ContentScriptContext): Promise<void> {
  let disposeView: (() => void) | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: UI_NAME,
    position: 'inline',
    // The documentElement, not the body: a page transform on <body> must
    // not become the overlay's containing block (the top layer escapes it
    // anyway; this covers browsers without popovers).
    anchor: 'html',
    append: 'last',
    isolateEvents: true,
    onMount: (container, _shadow, host) => {
      void mountShadowUi(container, () => {
        const page = createPageTools({
          doc: document,
          win: window,
          host,
          listen: (target, type, handler) => {
            ctx.addEventListener(target, type as keyof WindowEventMap, handler);
          },
          isInvalid: () => ctx.isInvalid
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
        return (
          <OverlayApp
            controller={controller}
            page={page}
            origin={window.location.origin}
            requestFrame={(run) => {
              ctx.requestAnimationFrame(run);
            }}
            listen={(target, type, handler) => {
              ctx.addEventListener(target, type as keyof WindowEventMap, handler, {
                passive: true
              });
            }}
            isInvalid={() => ctx.isInvalid}
            scrollPage={(dx, dy) => {
              window.scrollBy(dx, dy);
            }}
            onClose={() => {
              ui.remove();
            }}
          />
        );
      })
        .then((dispose) => {
          disposeView = dispose;
        })
        .catch((cause: unknown) => {
          log.error(
            'Mounting the exclusion builder failed',
            cause instanceof Error ? cause.message : cause
          );
        });
    },
    onRemove: () => {
      disposeView?.();
      disposeView = null;
    }
  });
  ui.mount();
}

export default defineContentScript({
  // Injected on demand by the background (never listed in the manifest).
  registration: 'runtime',
  matches: [...URL_PATTERNS],
  cssInjectionMode: 'ui',
  main(ctx: ContentScriptContext) {
    // The builder edits the page's own document: never inside a frame.
    if (window.top !== window) return;
    mountOverlay(ctx).catch((cause: unknown) => {
      log.error(
        'Opening the exclusion builder failed',
        cause instanceof Error ? cause.message : cause
      );
    });
  }
});
