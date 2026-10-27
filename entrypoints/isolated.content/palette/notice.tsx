/**
 * The palette module's page notice: one self-removing, at-rest message over
 * the page — the gate-off confirmation (what happened, where to turn it
 * back on) and the palette's failures (a view that never loaded, a command
 * that did not run). It never takes focus; it announces politely, removes
 * itself after {@link NOTICE_DISMISS_MS} (held while the pointer or focus
 * is on it — the reader decides how long to read) and can be dismissed at
 * once. A newer notice replaces the shown one.
 *
 * Lives in its own shadow root (the shared mount: live theme, input
 * isolation) in the browser's top layer, so it shows above every sibling
 * surface; everything rides the content script's context.
 */
import { Show, createSignal, onMount, type Accessor, type JSX } from 'solid-js';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { Logger } from '../../../lib/logger';
import { mountShadowUi } from '../../../components/injected-ui/mount';
import { showInTopLayer } from '../../../components/injected-ui/top-layer';
import { CLOSE_ICON_PATHS, StrokeIcon } from '../ui/icons';

/** The notice's shadow host tag name. */
export const NOTICE_HOST_NAME = 'wpr-fdt-page-notice';

/** How long a notice stays when nobody holds it (ms). */
export const NOTICE_DISMISS_MS = 8000;

/** One notice: a title line and one sentence (the S-3 copy shape). */
export interface PageNotice {
  readonly title: string;
  readonly body: string;
}

/** The timer seams the dismiss timer runs on (context-owned in production). */
export interface DismissTimerDeps {
  setTimeout(run: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** A dismiss countdown that holds while the reader is on the notice. */
export interface DismissTimer {
  /** (Re)start the full countdown. */
  restart(): void;
  /** Hold (true) or release (false) — a release restarts the countdown. */
  hold(held: boolean): void;
  /** Stop for good. */
  cancel(): void;
}

/**
 * Create the dismiss countdown.
 *
 * @param deps The timer seams.
 * @param ms The countdown.
 * @param onElapsed Runs once the countdown elapsed unheld.
 */
export function createDismissTimer(
  deps: DismissTimerDeps,
  ms: number,
  onElapsed: () => void
): DismissTimer {
  let id: number | null = null;
  let held = false;
  const stop = (): void => {
    if (id !== null) deps.clearTimeout(id);
    id = null;
  };
  const start = (): void => {
    stop();
    if (held) return;
    id = deps.setTimeout(() => {
      id = null;
      onElapsed();
    }, ms);
  };
  return {
    restart: start,
    hold: (next) => {
      held = next;
      if (next) stop();
      else start();
    },
    cancel: () => {
      held = false;
      stop();
    }
  };
}

/** Props of {@link NoticeView}. */
export interface NoticeViewProps {
  /** The shown notice. */
  readonly notice: Accessor<PageNotice>;
  /** Dismiss now (the close button). */
  readonly onDismiss: () => void;
  /** The reader is on the notice (pointer or focus) — or left it. */
  readonly onHold: (held: boolean) => void;
  /** Receives the layer element (top-layer placement). */
  readonly registerLayer: (layer: HTMLElement) => void;
  /** One animation-frame request (context-owned). */
  readonly requestFrame: (run: () => void) => void;
}

/**
 * Render the notice. The live region renders empty first and fills on the
 * next frame: a region inserted together with its text is not reliably
 * announced.
 *
 * @param props See {@link NoticeViewProps}.
 */
export function NoticeView(props: NoticeViewProps): JSX.Element {
  const [announced, setAnnounced] = createSignal(false);
  onMount(() => {
    props.requestFrame(() => {
      setAnnounced(true);
    });
  });
  let pointerOn = false;
  let focusOn = false;
  const report = (): void => {
    props.onHold(pointerOn || focusOn);
  };
  return (
    <div
      class="pn-layer"
      data-fdt-tokens
      ref={(layer) => {
        props.registerLayer(layer);
      }}
    >
      <div
        class="pn-notice"
        data-fdt="page-notice"
        onPointerEnter={() => {
          pointerOn = true;
          report();
        }}
        onPointerLeave={() => {
          pointerOn = false;
          report();
        }}
        onFocusIn={() => {
          focusOn = true;
          report();
        }}
        onFocusOut={(event) => {
          // Focus moving between the notice's own controls keeps it held.
          const next = event.relatedTarget;
          focusOn = next instanceof Node && event.currentTarget.contains(next);
          report();
        }}
      >
        <div class="pn-text" role="status">
          <Show when={announced()}>
            <p class="pn-title">{props.notice().title}</p>
            <p class="pn-body">{props.notice().body}</p>
          </Show>
        </div>
        <button
          type="button"
          class="pn-close"
          aria-label="Dismiss notice"
          onClick={() => {
            props.onDismiss();
          }}
        >
          <StrokeIcon paths={CLOSE_ICON_PATHS} />
        </button>
      </div>
    </div>
  );
}

/** The page's notice slot. */
export interface NoticeHost {
  /** Show a notice (replacing the shown one). */
  show(notice: PageNotice): void;
}

/**
 * Create the page's notice slot. The shadow host mounts on the first show
 * and leaves the page when the notice is dismissed or elapses.
 *
 * @param ctx The content script's context (UI, timers, frames).
 * @param log The owning module's logger.
 */
export function createNoticeHost(ctx: ContentScriptContext, log: Logger): NoticeHost {
  const [notice, setNotice] = createSignal<PageNotice>({ title: '', body: '' });
  let ui: Awaited<ReturnType<typeof createShadowRootUi>> | null = null;
  /** A mount in flight (the stylesheet wait): later shows only swap the text. */
  let mounting = false;
  let disposeView: (() => void) | null = null;

  const remove = (): void => {
    timer.cancel();
    ui?.remove();
    ui = null;
  };
  const timer = createDismissTimer(
    {
      setTimeout: (run, ms) => ctx.setTimeout(run, ms),
      clearTimeout: (id) => {
        clearTimeout(id);
      }
    },
    NOTICE_DISMISS_MS,
    remove
  );

  const mount = async (): Promise<void> => {
    mounting = true;
    try {
      const created = await createShadowRootUi(ctx, {
        name: NOTICE_HOST_NAME,
        position: 'inline',
        // The documentElement: a page transform on <body> must not become the
        // containing block (the top layer escapes it anyway).
        anchor: 'html',
        append: 'last',
        onMount: (container, shadow) => {
          mountShadowUi(container, shadow, () => (
            <NoticeView
              notice={notice}
              onDismiss={remove}
              onHold={(held) => {
                timer.hold(held);
              }}
              registerLayer={(layer) => {
                // Shown once connected: the top layer needs a rendered element.
                ctx.requestAnimationFrame(() => {
                  showInTopLayer(layer, log);
                });
              }}
              requestFrame={(run) => {
                ctx.requestAnimationFrame(run);
              }}
            />
          ))
            .then((dispose) => {
              disposeView = dispose;
            })
            .catch((cause: unknown) => {
              log.error('Mounting the page notice failed', cause);
            });
        },
        onRemove: () => {
          disposeView?.();
          disposeView = null;
        }
      });
      if (ctx.isInvalid) return;
      ui = created;
      ui.mount();
      // The countdown starts once the notice is on the page.
      timer.restart();
    } catch (cause) {
      log.error('Creating the page notice failed', cause);
    } finally {
      mounting = false;
    }
  };

  return {
    show: (next) => {
      if (ctx.isInvalid) return;
      setNotice(next);
      if (ui !== null) timer.restart();
      // A mount in flight starts the countdown itself once it lands.
      else if (!mounting) void mount();
    }
  };
}
