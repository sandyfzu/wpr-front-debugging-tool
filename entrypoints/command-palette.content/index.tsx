/**
 * The on-page command palette's view — a content script registered at
 * runtime: not in the manifest, never loaded with a page; the background
 * injects it into the tab's top frame on the palette's first open (asked by
 * the isolated script's palette module), so its code (the combobox, the
 * dialog) costs pages nothing until then.
 *
 * It finds the module through the palette bridge in the shared isolated
 * world, hands over its handle (open / dispose) and mounts; a page without
 * a live module (or a module that refuses — the gate turned off meanwhile)
 * gets nothing. Later opens only re-show the mounted view. Closing returns
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
import { createLogger } from '../../lib/logger';
import {
  readPaletteBridge,
  type IsolatedWorld,
  type PaletteBridge,
  type PaletteViewHandle
} from '../../lib/page-commands/palette-bridge';
import { mountShadowUi } from '../../components/injected-ui/mount';
import { mountOverlay } from '../../components/injected-ui/mount-overlay';
import { COMMAND_PALETTE_HOST_NAME } from '../../components/injected-ui/key-guard';
import { PaletteApp } from './app';
import './styles.css';

const log = createLogger('command-palette');

/** The extension's isolated world (where the palette bridge lives). */
const ISOLATED_WORLD = globalThis as unknown as IsolatedWorld;

/** The page's focused element, if it can take focus back (not the body, not ours). */
function pageFocus(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  if (active.localName === COMMAND_PALETTE_HOST_NAME) return null;
  return active;
}

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
      returnFocus = pageFocus();
      setOpen(true);
    },
    dispose: () => {
      ctx.abort('Command palette removed');
    }
  };

  ctx.onInvalidated(() => {
    try {
      bridge.detach(handle);
    } catch (cause) {
      // A dead module throws here; the view is going away either way.
      log.debug('Detaching from the palette module failed', cause);
    }
  });

  if (!bridge.attach(handle)) {
    // The module refused (the gate turned off while the view loaded).
    ctx.abort('Command palette refused');
    return;
  }

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
          rows={() => bridge.rows()}
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
    onError: (cause) => {
      log.error('Mounting the command palette failed', cause);
      ctx.abort('Command palette mount failed');
    }
  }).catch((cause: unknown) => {
    log.error('Mounting the command palette failed', cause);
    ctx.abort('Command palette mount failed');
  });
}

export default defineContentScript({
  // Injected on demand by the background (never listed in the manifest).
  registration: 'runtime',
  matches: [...URL_PATTERNS],
  cssInjectionMode: 'ui',
  main(ctx: ContentScriptContext) {
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
