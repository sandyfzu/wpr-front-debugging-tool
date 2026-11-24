/**
 * The on-page command palette's view — a content script registered at
 * runtime: not in the manifest, never loaded with a page; the background
 * injects it into the tab's top frame on the palette's first open (asked by
 * the isolated script's palette module), so its code (the combobox, the
 * dialog) costs pages nothing until then.
 *
 * It finds the module through the palette bridge in the shared isolated
 * world, hands over its handle (open / dispose) and mounts; a page without
 * a live module (or a module that refuses — the gate turned off meanwhile,
 * or no open waits for a view) gets nothing, and a failed mount reports
 * itself so the module tells the user. It lists the rows itself, from the
 * vocabulary and the page's own URL. Later opens only re-show the mounted view. Closing returns
 * focus to what the page had focused before the open; a run closes first,
 * then the module runs the command.
 *
 * Page-safety: one shadow root with its own stylesheet, in the top layer;
 * input events stop at the shadow root and the isolated script's key guard
 * keeps typed keys from the page's window-capture shortcuts; the dialog is
 * non-modal toward the page (no aria-hiding, scroll lock or pointer block);
 * every listener and timer rides the context, and an invalidated context
 * (gate off, extension reload) removes the whole view.
 */
import { createSignal } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import { guardInvalidationTeardown } from '../../lib/dead-context';
import { QUIET_START, installRestartGuard } from '../../lib/content-script-restart';
import { createLogger } from '../../lib/logger';
import {
  readChordHint,
  readPaletteBridge,
  type IsolatedWorld,
  type PaletteBridge,
  type PaletteViewHandle
} from '../../lib/page-commands/palette-bridge';
import { mountShadowUi } from '../../components/injected-ui/mount';
import { mountOverlay } from '../../components/injected-ui/mount-overlay';
import { COMMAND_PALETTE_HOST_NAME } from '../../components/injected-ui/key-guard';
import { pageCommandFacts, paletteRowViews } from '../../lib/page-commands/palette-rows';
import { PaletteApp } from './app';
import { returnFocusTarget } from './return-focus';
import './styles.css';

const log = createLogger('command-palette');

/** The extension's isolated world (where the palette bridge lives). */
const ISOLATED_WORLD = globalThis as unknown as IsolatedWorld;

/**
 * Bind the view to its module and mount it.
 *
 * @param ctx This injection's context.
 * @param bridge The live module's bridge.
 */
function startView(ctx: ContentScriptContext, bridge: PaletteBridge): void {
  const [open, setOpen] = createSignal(false);
  /** Where focus goes back when the palette closes. */
  let returnFocus: HTMLElement | null = null;
  /** Set when the mount failed: the departure then tells the module the open never showed. */
  let mountFailed = false;

  const close = (restoreFocus: boolean): void => {
    if (!open()) return;
    setOpen(false);
    const target = returnFocus;
    returnFocus = null;
    if (restoreFocus && target?.isConnected === true) target.focus({ preventScroll: true });
  };

  const handle: PaletteViewHandle = {
    open: () => {
      if (ctx.isInvalid) return;
      // An open of an open palette keeps its state (and its return target).
      if (open()) return;
      returnFocus = returnFocusTarget(document);
      setOpen(true);
    },
    dispose: () => {
      ctx.abort('Command palette removed');
    }
  };

  ctx.onInvalidated(() => {
    try {
      bridge.detach(handle, mountFailed ? 'failed' : 'ended');
    } catch (cause) {
      // A dead module throws here; the view is going away either way.
      log.debug('Detaching from the palette module failed', cause);
    }
  });

  if (!bridge.attach(handle)) {
    // The module refused: the gate turned off while the view loaded, or no
    // open waits for a view (a stale or misdirected injection).
    ctx.abort('Command palette refused');
    return;
  }

  /** Mount failed: tear the view down (the departure reports the failure). */
  const failMount = (cause: unknown): void => {
    log.error('Mounting the command palette failed', cause);
    mountFailed = true;
    ctx.abort('Command palette mount failed');
  };

  mountOverlay({
    isInvalid: () => ctx.isInvalid,
    createUi: (hooks) =>
      createShadowRootUi(ctx, {
        name: COMMAND_PALETTE_HOST_NAME,
        position: 'inline',
        // The documentElement: a page transform on <body> must not become
        // the containing block (the top layer escapes it anyway).
        anchor: 'html',
        append: 'last',
        ...hooks
      }),
    render: (container, shadow) =>
      mountShadowUi(container, shadow, () => (
        <PaletteApp
          open={open}
          rows={() => paletteRowViews(pageCommandFacts(new URL(window.location.href)))}
          chordHint={() => readChordHint(bridge)}
          onRun={(id) => {
            // Focus goes back first: a command that opens a surface (the
            // compare overlay, the builder) then takes it from there.
            close(true);
            bridge.run(id);
          }}
          onDismiss={() => {
            close(true);
          }}
          log={log}
        />
      )),
    onError: failMount
  }).catch(failMount);
}

export default defineContentScript({
  // No start broadcast to the page's `message` listeners (it names our id).
  ...QUIET_START,
  // Injected on demand by the background (never listed in the manifest).
  registration: 'runtime',
  matches: [...URL_PATTERNS],
  cssInjectionMode: 'ui',
  main(ctx: ContentScriptContext) {
    // First: every teardown registered below runs dead-context safe (an
    // extension reload must never put an error on the host page).
    guardInvalidationTeardown(ctx, log);
    // Then, before the page can run again: only a dead extension context or a
    // newer start of this script in our own world may end it, never the page.
    installRestartGuard(ctx, log);
    // The palette acts on the page as a whole: never inside a frame.
    if (window.top !== window) return;
    const bridge = readPaletteBridge(ISOLATED_WORLD);
    if (bridge === null) {
      log.warn('No live palette module on this page — the view stays out');
      return;
    }
    startView(ctx, bridge);
  }
});
