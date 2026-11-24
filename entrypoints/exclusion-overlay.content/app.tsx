/**
 * The overlay's view: a tool shell (header with the session indicator,
 * dock/collapse/close; the session banners; the active mode's panels from
 * the mode registry (`./modes`); footer session actions), plus its
 * collapsed pill, the picking bar and the page highlight — all in one
 * top-layer element. Reads the controller and the page tools; owns only
 * view state (open, dock side, picking, the highlight).
 *
 * State matrix (each arm renders its own words and a way forward):
 * loading (skeleton) · load failed (error + Retry) · nothing applied
 * (empty-draft guidance) · populated draft · applying/stopping (controls
 * held) · reloading · reload overdue (notice: Reload, Stop, keep editing) ·
 * applied (counts per lane and row) · applied with no-match rows ·
 * served unmodified · interception unavailable (cause + remedy, Retry when
 * transient) · not intercepted · can't verify · loaded without the
 * session's result (Reload; Stop / Re-apply in the footer) · a feature absent from the
 * page (per lane) · the last action's notice · paused under a page modal
 * dialog.
 *
 * Presentation: an explicit open starts on the panel with focus on its
 * heading; a re-open on a session tab's next page starts the way the user
 * left the last one (panel or pill) and never takes focus from the page.
 * Folding, unfolding and closing are reported (`onPresented`) so the next
 * page follows suit.
 *
 * Keyboard: Escape cancels picking (wherever focus is), else collapses to
 * the pill; the pill reopens to the heading; while picking, Tab stays on
 * the picking bar. Buttons that an action holds are `aria-disabled`, never
 * `disabled`, so focus never falls out of the overlay.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  type JSX
} from 'solid-js';
import Crosshair from 'lucide-solid/icons/crosshair';
import Minus from 'lucide-solid/icons/minus';
import PanelLeft from 'lucide-solid/icons/panel-left';
import PanelRight from 'lucide-solid/icons/panel-right';
import Play from 'lucide-solid/icons/play';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import Square from 'lucide-solid/icons/square';
import X from 'lucide-solid/icons/x';
import { BannerView } from './banner';
import {
  noticeBanner,
  stateBanner,
  withoutRepeatedActions,
  type BannerAction
} from './banner-model';
import { DRAFT_TOO_LARGE_WORDS, TOOL_TITLE, sessionIndicator } from './copy';
import { draftTooLarge, footerLine as footerLineFor } from './footer-line';
import type { OverlayController } from './controller';
import { LANE_ORDER } from './exclusions/draft';
import { Glyph, SimulatedIndicator } from './glyph';
import { retryFocus } from './focus-retry';
import { createAnnouncer } from './announcer';
import {
  OVERLAY_MODES,
  type HighlightTarget,
  type OverlayMode,
  type OverlayModeContext,
  type PickEvents
} from './modes';
import { viewportRect, type PageTools, type PointedPick } from './page-tools';
import type { PickerEvents } from './picker';
import type { VirtualizerFactory } from '../../components/ui/virtual-list';
import { createLogger } from '../../lib/logger';
import { showInTopLayer } from '../../components/injected-ui/top-layer';
import { COMMAND_PALETTE_HOST_NAME } from '../../components/injected-ui/key-guard';
import type { OverlayPresentation } from '../../lib/exclusion-session/overlay-reopen';

const log = createLogger('exclusion-overlay');

/** Space kept between the highlight label and the box (px). */
const LABEL_GAP_PX = 4;
/** The highlight label's height (px) — decides whether it fits above the box. */
const LABEL_HEIGHT_PX = 22;
/** Frames a focus move is attempted on before it gives up (see `focusSoon`). */
const FOCUS_TRIES = 3;

/** Props of {@link OverlayApp}. */
export interface OverlayAppProps {
  readonly controller: OverlayController;
  readonly page: PageTools;
  /** One animation-frame request (context-owned). */
  readonly requestFrame: (run: () => void) => void;
  /** Listen on a page target (scroll/resize for the highlight), released with the context. */
  readonly listen: (target: EventTarget, type: string, handler: () => void) => void;
  /** The page's origin, shown under the title. */
  readonly origin: string;
  /** Close the overlay (ends its content-script context). */
  readonly onClose: () => void;
  /**
   * How a re-open starts (null or absent: an explicit open — the panel,
   * focused).
   */
  readonly presentation?: OverlayPresentation | null;
  /** The user folded (`false`, also on close) or unfolded (`true`) the overlay. */
  readonly onPresented?: (open: boolean) => void;
  /**
   * Receives the overlay's reveal (unfold + focus the heading; an explicit
   * open of a live overlay calls it instead of replacing the overlay).
   */
  readonly onRevealReady?: (reveal: () => void) => void;
  /** Start picking on the page; returns the stop. */
  readonly startPicking: (events: PickerEvents<PointedPick>) => () => void;
  /** Whether the extension context is gone (reading it tears a dead overlay down). */
  readonly isInvalid: () => boolean;
  /** The lists' virtualizer seam (tests render every row; default: the library). */
  readonly createVirtualizer?: VirtualizerFactory;
  /** The tool mode shown (default: the registry's first). */
  readonly mode?: OverlayMode;
}

/** The host part of an origin (the scheme only costs width). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * The overlay.
 *
 * @param props See {@link OverlayAppProps}.
 */
export function OverlayApp(props: OverlayAppProps): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the controller is one object for the mount's lifetime; its members are the reactive parts
  const c = props.controller;
  // Opened under a page modal dialog: start folded (the panel would be inert).
  // eslint-disable-next-line solid/reactivity -- the initial state only; the effect below follows changes
  const startsOpen = !props.page.pageModal() && props.presentation !== 'folded';
  const [open, setOpen] = createSignal(startsOpen);
  const [dock, setDock] = createSignal<'right' | 'left'>('right');
  const [picking, setPicking] = createSignal(false);
  const [pickMessage, setPickMessage] = createSignal<string | null>(null);
  const [highlight, setHighlight] = createSignal<HighlightTarget | null>(null);
  const [announcement, setAnnouncement] = createSignal('');
  /** Say a line once, politely (the sr-only status below). */
  const announce = createAnnouncer(setAnnouncement, (run) => {
    // eslint-disable-next-line solid/reactivity -- a frame callback: reads the seam when it runs, untracked
    props.requestFrame(run);
  });
  const [geometryTick, setGeometryTick] = createSignal(0);
  let heading: HTMLHeadingElement | undefined;
  let pill: HTMLButtonElement | undefined;
  let cancelPick: HTMLButtonElement | undefined;
  /** Where focus goes back when picking is cancelled. */
  let pickReturn: HTMLElement | undefined;
  let layer: HTMLDivElement | undefined;
  let stopPicker: (() => void) | null = null;

  // eslint-disable-next-line solid/reactivity -- the mode is fixed for the mount (a switch remounts its panels)
  const mode = props.mode ?? OVERLAY_MODES[0];
  const ModeConfig = mode.Config;
  const ModeResults = mode.Results;
  const state = c.state;
  const ready = (): boolean => state().phase === 'ready';
  const held = (): boolean => !c.editable();
  const paused = (): boolean => props.page.pageModal();
  const indicator = createMemo(() => sessionIndicator(state(), c.view()));
  /** The page on screen runs a simulation: said beside the session's indicator, folded too. */
  const simulated = createMemo(() => c.runsSimulation());
  const banner = createMemo(() => stateBanner(state(), c.view()));
  const notice = createMemo(() => {
    const current = state();
    return current.phase === 'ready' && current.notice !== null
      ? noticeBanner(current.notice, simulated())
      : null;
  });
  const sessionState = (): 'inactive' | 'active' | 'unavailable' | null => {
    const current = state();
    return current.phase === 'ready' ? current.status.state : null;
  };
  const pending = (): string | null => {
    const current = state();
    return current.phase === 'ready' ? current.pending : null;
  };
  // The highlight follows its element through page and inner scrolling
  // and resizes: one geometry read per frame at most, only while it shows.
  let geometryQueued = false;
  const queueGeometry = (): void => {
    if ((highlight() === null && !picking()) || geometryQueued) return;
    geometryQueued = true;
    props.requestFrame(() => {
      geometryQueued = false;
      setGeometryTick((tick) => tick + 1);
    });
  };
  /**
   * Guards over the page's frames while picking: pointer input over a frame
   * goes to that frame's own document (never to the picker), so a click
   * there would act on the frame. The guard takes it and says why.
   */
  const frameRects = createMemo(() => {
    geometryTick();
    if (!picking()) return [];
    return props.page
      .frames()
      .map((frame) => viewportRect(frame))
      .filter((rect): rect is NonNullable<typeof rect> => rect !== null);
  });
  const framesMessage = 'Frames can’t be picked: their content is another page.';
  const highlightRect = createMemo(() => {
    geometryTick();
    const target = highlight();
    return target === null ? null : viewportRect(target.element);
  });

  /**
   * Whether the page's focused element is free for the overlay to take:
   * nothing focused, or focus already inside the overlay (its shadow host
   * when mounted in one).
   *
   * @param active The document's focused element.
   * @returns `true` when the overlay may take focus from it.
   */
  const focusIsFree = (active: Element | null): boolean => {
    if (active === null || active === document.body || layer === undefined) return true;
    const root = layer.getRootNode();
    return layer.contains(active) || (root instanceof ShadowRoot && active === root.host);
  };
  /**
   * Whether the command palette holds focus: the overlay never takes it from
   * the palette — not even when it already held focus as the overlay
   * mounted, since the overlay's host is inserted before it renders and the
   * palette can open in that gap — because the palette dismisses on any
   * outside focus. Other injected surfaces (the detection strip, the
   * known-conflicts card) never dismiss on focus loss, so an explicitly
   * opened overlay takes focus from them like from any page control.
   *
   * @param active The document's focused element (the palette's focus reads as its shadow host).
   * @returns `true` when the palette's host holds focus.
   */
  const focusIsClaimed = (active: Element | null): boolean =>
    active?.localName === COMMAND_PALETTE_HOST_NAME;
  /**
   * Move focus once the target is visible (next frame: visibility flips
   * first). A just-revealed panel can still resolve as hidden for a frame
   * (an attempt may run before the frame's style recalc), so a move that
   * does not take is tried again on the next frames — never once another UI
   * (e.g. a palette opened meanwhile) claimed focus. Not keyed on
   * `transitionend`: the visibility switch is no transition (and reduced
   * motion drops every transition), so no event would come; the frames
   * bound the wait.
   *
   * @param element The control to focus, read on each attempt (`undefined` gives up).
   */
  const focusSoon = (element: () => HTMLElement | undefined): void => {
    retryFocus(
      {
        requestFrame: props.requestFrame,
        active: () => document.activeElement,
        isFree: focusIsFree,
        isClaimed: focusIsClaimed,
        attempt: () => {
          const target = element();
          if (target === undefined) return undefined;
          target.focus({ preventScroll: true });
          const root = target.getRootNode() as Document | ShadowRoot;
          return root.activeElement === target;
        }
      },
      FOCUS_TRIES
    );
  };

  const collapse = (): void => {
    setOpen(false);
    setHighlight(null);
    props.onPresented?.(false);
    focusSoon(() => pill);
  };
  /**
   * Whether the overlay may move focus when it comes back from under a page
   * modal: an explicit open or the user's own unfold took it; a re-open on
   * page load never does.
   */
  // eslint-disable-next-line solid/reactivity -- the presentation is fixed for the mount
  let ownsFocus = props.presentation == null;
  const expand = (): void => {
    // A modal the page removed without closing it fires nothing: re-read.
    props.page.refreshModal();
    ownsFocus = true;
    if (paused()) return;
    setOpen(true);
    props.onPresented?.(true);
    focusSoon(() => heading);
  };

  const endPicking = (): void => {
    stopPicker?.();
    stopPicker = null;
    setPicking(false);
    setPickMessage(null);
    setHighlight(null);
  };
  const cancelPicking = (): void => {
    endPicking();
    focusSoon(() => pickReturn);
  };
  /** The shell's picking service (a mode starts it; a hit goes to the mode). */
  const beginPicking = (returnTo: HTMLElement | undefined, events: PickEvents): void => {
    pickReturn = returnTo;
    setPicking(true);
    setHighlight(null);
    stopPicker = props.startPicking({
      hover: (pick) => {
        setHighlight(
          pick === null
            ? null
            : {
                element: pick.element,
                label: events.label(pick),
                subject: pick.candidate.subject
              }
        );
      },
      pick: (pick, pointed) => {
        if (pick !== null) {
          endPicking();
          events.onPick(pick);
          return;
        }
        // A miss keeps picking and says why, visibly.
        setPickMessage(
          pointed?.localName === 'iframe'
            ? framesMessage
            : 'Nothing to exclude there. Point at an image or a lazily rendered section.'
        );
      },
      cancel: cancelPicking,
      tab: () => {
        cancelPick?.focus({ preventScroll: true });
      }
    });
    focusSoon(() => cancelPick);
  };
  onCleanup(() => {
    stopPicker?.();
  });

  /** What the active mode's panels use from the shell (fixed seams for the mount's lifetime). */
  const modeContext: OverlayModeContext = {
    controller: c,
    // eslint-disable-next-line solid/reactivity -- one page-tools object per mount; its members are the reactive parts
    page: props.page,
    panelOpen: open,
    requestFrame: (run) => {
      props.requestFrame(run);
    },
    // eslint-disable-next-line solid/reactivity -- a fixed seam for the mount's lifetime
    createVirtualizer: props.createVirtualizer,
    pick: beginPicking,
    highlight: setHighlight,
    announce
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || picking()) return;
    event.preventDefault();
    if (open()) collapse();
  };

  const onBannerAction = (action: BannerAction): void => {
    switch (action) {
      case 'retry-load':
        c.retryLoad();
        break;
      case 'retry-apply':
        c.apply();
        break;
      case 'retry-action':
        c.retryFailedAction();
        break;
      case 'reload':
        c.reloadPage();
        return;
      case 'dismiss':
        c.dismissNotice();
        break;
    }
    // The banner that held focus is gone or changing: land on the heading,
    // never on the page's body.
    focusSoon(() => heading);
  };

  // A page modal dialog makes everything outside it inert, the overlay too:
  // fold into the pill (marked paused) until it closes, then come back —
  // also when it opened under the modal (unless it was meant to start folded).
  // eslint-disable-next-line solid/reactivity -- the presentation is fixed for the mount
  let openBeforeModal = props.presentation !== 'folded';
  createEffect(
    on(
      paused,
      (isPaused) => {
        if (isPaused) {
          openBeforeModal = open();
          endPicking();
          setOpen(false);
        } else if (openBeforeModal) {
          setOpen(true);
          if (ownsFocus) focusSoon(() => heading);
        }
      },
      { defer: true }
    )
  );
  // Something the page opened in the top layer paints over the overlay:
  // move back on top (not over a modal — the user must answer it first).
  createEffect(
    on(
      () => props.page.pageTopLayerOpened(),
      () => {
        if (layer !== undefined && !paused()) showInTopLayer(layer, log);
      },
      { defer: true }
    )
  );

  // A state change can unmount the focused control (Stop once stopped, the
  // footer while reloading, a notice's button): focus then falls out of the
  // overlay to the page. Land it on the heading instead — only when the
  // last focused control is gone, never when the user moved elsewhere.
  let lastFocused: Element | null = null;
  const onFocusIn = (event: FocusEvent): void => {
    lastFocused = event.target instanceof Element ? event.target : null;
  };
  createEffect(
    on(
      () => [state(), c.view(), notice()],
      () => {
        props.requestFrame(() => {
          if (lastFocused === null || lastFocused.isConnected || layer === undefined) return;
          const root = layer.getRootNode();
          const active =
            'activeElement' in root ? (root as Document | ShadowRoot).activeElement : null;
          if (active === null || active === layer.ownerDocument.body)
            heading?.focus({ preventScroll: true });
        });
      },
      { defer: true }
    )
  );

  onMount(() => {
    props.listen(window, 'scroll', queueGeometry);
    props.listen(window, 'resize', queueGeometry);
    if (layer !== undefined) showInTopLayer(layer, log);
    // A re-open follows a page load: the page keeps its focus.
    if (props.presentation == null) focusSoon(() => heading);
    // An event-time call (an explicit open of this live overlay), never tracked.
    // eslint-disable-next-line solid/reactivity -- read at call time, like an event handler
    props.onRevealReady?.(() => {
      if (picking()) endPicking();
      expand();
    });
  });
  onCleanup(() => {
    setHighlight(null);
  });

  const footerLine = createMemo(() => {
    const view = c.view();
    return footerLineFor({
      invalid: c.invalidCount(),
      stuck: view?.kind === 'unavailable' && !view.retryable,
      dirty: c.dirty(),
      save: c.saveState()
    });
  });
  // A draft that can no longer be kept is said once, as it becomes so (the
  // footer line is not a live region: it changes on every edit).
  createEffect(
    on(
      () => draftTooLarge(c.saveState()),
      (tooLarge, before) => {
        if (tooLarge && before !== true) announce(DRAFT_TOO_LARGE_WORDS);
      }
    )
  );

  const applyLabel = (): string => {
    // An Apply waiting for its set readings is under way already.
    if (pending() === 'apply' || pending() === 'reset' || c.checking()) return 'Applying…';
    if (sessionState() !== 'active') return 'Apply';
    return c.dirty() ? 'Apply changes' : 'Re-apply';
  };
  /** Only a long paste holds the editor (no action in flight). */
  const pasteOnly = (): boolean => c.pasting() && pending() === null;
  /**
   * Apply, Reset and Stop are unavailable: held, unless only a long paste
   * holds the editor — they then wait for it in the controller and run, in
   * the order clicked, once it lands.
   */
  const actionHeld = (): boolean => held() && !pasteOnly();
  /** Reset is unavailable: held as {@link actionHeld}, or nothing to reset (a landing paste will make the draft differ). */
  const resetHeld = (): boolean => actionHeld() || (!c.dirty() && !pasteOnly());

  return (
    <div
      class="xo-layer"
      ref={layer}
      // The page's CSS zoom reaches the overlay through its host: undo it.
      style={props.page.zoom() === 1 ? undefined : { zoom: String(1 / props.page.zoom()) }}
      on:keydown={onKeyDown}
      on:focusin={onFocusIn}
      // Any interaction first checks the extension is still there: a
      // reloaded extension's overlay leaves instead of failing every ask.
      on:pointerdown={() => {
        props.isInvalid();
      }}
    >
      {/* The highlight paints under the panel: the panel is never covered. */}
      <Show when={highlightRect()}>
        {(rect) => (
          <>
            <div
              class="xo-highlight"
              style={{
                transform: `translate(${String(rect().x)}px, ${String(rect().y)}px)`,
                width: `${String(rect().width)}px`,
                height: `${String(rect().height)}px`
              }}
            />
            <div
              class="xo-highlight-label"
              style={{
                transform: `translate(${String(Math.max(8, rect().x))}px, ${String(
                  rect().y > LABEL_HEIGHT_PX + LABEL_GAP_PX
                    ? rect().y - LABEL_HEIGHT_PX - LABEL_GAP_PX
                    : rect().y + rect().height + LABEL_GAP_PX
                )}px)`
              }}
            >
              <span class="xo-highlight-lane">{highlight()?.label}</span>
              <span class="xo-highlight-subject">{highlight()?.subject}</span>
            </div>
          </>
        )}
      </Show>

      <aside
        class="xo-panel"
        data-dock={dock()}
        data-open={String(open() && !picking())}
        aria-labelledby="xo-title"
        inert={!open() || picking()}
      >
        <header class="xo-header">
          <span class="xo-brand" aria-hidden="true">
            <Crosshair size={14} strokeWidth={2.5} />
          </span>
          <div class="xo-heading">
            <h1 class="xo-title" id="xo-title" tabIndex={-1} ref={heading}>
              {TOOL_TITLE}
            </h1>
            <div class="xo-meta">
              <span class="xo-indicator" data-tone={indicator().tone}>
                <Glyph name={indicator().glyph} size={12} />
                <span>
                  <span class="xo-sr-only">Session: </span>
                  {indicator().label}
                </span>
              </span>
              <Show when={simulated()}>
                <SimulatedIndicator />
              </Show>
              <span class="xo-origin" title={props.origin}>
                {hostOf(props.origin)}
              </span>
            </div>
          </div>
          <div class="xo-header-actions">
            <button
              type="button"
              class="xo-icon-button"
              data-optional="true"
              aria-label={dock() === 'right' ? 'Dock to the left' : 'Dock to the right'}
              title={dock() === 'right' ? 'Dock to the left' : 'Dock to the right'}
              onClick={() => setDock((side) => (side === 'right' ? 'left' : 'right'))}
            >
              <Show
                when={dock() === 'right'}
                fallback={<PanelRight size={16} aria-hidden="true" />}
              >
                <PanelLeft size={16} aria-hidden="true" />
              </Show>
            </button>
            <button
              type="button"
              class="xo-icon-button"
              aria-label="Collapse"
              title="Collapse (Esc)"
              onClick={collapse}
            >
              <Minus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              class="xo-icon-button"
              aria-label="Close the Exclusion Builder"
              title="Close"
              onClick={() => {
                props.onPresented?.(false);
                props.onClose();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div class="xo-body">
          <Show
            when={state().phase !== 'loading'}
            fallback={
              <div class="xo-skeleton" role="status">
                <span class="xo-sr-only">Loading the session</span>
                <div class="xo-skeleton-block" style={{ height: '64px' }} />
                <div class="xo-skeleton-block" style={{ height: '28px', width: '60%' }} />
                <For each={LANE_ORDER}>
                  {() => <div class="xo-skeleton-block" style={{ height: '96px' }} />}
                </For>
              </div>
            }
          >
            <Show when={banner()}>
              {(current) => (
                <BannerView
                  banner={withoutRepeatedActions(current(), notice())}
                  onAction={onBannerAction}
                  held={pending() !== null}
                  live
                />
              )}
            </Show>
            <Show when={notice()}>
              {(current) => <BannerView banner={current()} onAction={onBannerAction} />}
            </Show>
            <Show when={state().phase !== 'load-failed'}>
              <ModeConfig context={modeContext} />
              {ModeResults === null ? null : <ModeResults context={modeContext} />}
            </Show>
          </Show>
        </div>

        <Show when={ready()}>
          <footer class="xo-footer">
            <p class="xo-footer-status" data-tone={footerLine()?.tone ?? 'muted'}>
              {footerLine()?.text ?? ''}
            </p>
            <div class="xo-footer-actions">
              <Show when={sessionState() === 'active' || sessionState() === 'unavailable'}>
                <button
                  type="button"
                  class="xo-button"
                  aria-disabled={actionHeld() ? 'true' : undefined}
                  onClick={() => {
                    c.stop();
                  }}
                >
                  <Square size={13} aria-hidden="true" />
                  {pending() === 'stop' ? 'Stopping…' : 'Stop'}
                </button>
              </Show>
              <Show when={sessionState() === 'active'}>
                <button
                  type="button"
                  class="xo-button"
                  aria-disabled={resetHeld() ? 'true' : undefined}
                  title={
                    c.dirty()
                      ? 'Discard edits and re-apply the applied exclusions'
                      : 'Nothing to reset: the draft is the applied set'
                  }
                  onClick={() => {
                    if (!resetHeld()) c.reset();
                  }}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  Reset
                </button>
              </Show>
              <button
                type="button"
                class="xo-button"
                data-variant="primary"
                aria-disabled={actionHeld() ? 'true' : undefined}
                aria-busy={pending() === 'apply' || pending() === 'reset'}
                onClick={() => {
                  c.apply();
                }}
              >
                <Show
                  when={pending() === 'apply' || pending() === 'reset'}
                  fallback={<Play size={13} aria-hidden="true" />}
                >
                  <Glyph name="spinner" size={13} />
                </Show>
                {applyLabel()}
              </button>
            </div>
          </footer>
        </Show>
      </aside>

      <Show when={!open() && !picking()}>
        <button
          type="button"
          class="xo-pill"
          data-dock={dock()}
          ref={pill}
          onClick={expand}
          aria-disabled={paused() ? 'true' : undefined}
        >
          <span class="xo-brand" aria-hidden="true">
            <Crosshair size={12} strokeWidth={2.5} />
          </span>
          <span>{mode.label}</span>
          <span class="xo-indicator" data-tone={paused() ? 'neutral' : indicator().tone}>
            <Glyph name={paused() ? 'idle' : indicator().glyph} size={12} />
            {paused() ? 'Paused: page dialog open' : indicator().label}
          </span>
          <Show when={simulated() && !paused()}>
            <SimulatedIndicator />
          </Show>
          <span class="xo-sr-only"> — open the Exclusion Builder</span>
        </button>
      </Show>

      <For each={frameRects()}>
        {(rect) => (
          <div
            class="xo-frame-guard"
            aria-hidden="true"
            style={{
              transform: `translate(${String(rect.x)}px, ${String(rect.y)}px)`,
              width: `${String(rect.width)}px`,
              height: `${String(rect.height)}px`
            }}
            onPointerEnter={() => {
              setHighlight(null);
              setPickMessage(framesMessage);
            }}
            onClick={() => {
              setPickMessage(framesMessage);
            }}
          />
        )}
      </For>

      <Show when={picking()}>
        <div
          class="xo-pickbar"
          role="group"
          aria-label="Picking on the page"
          // Keys typed with focus on the bar reach only the overlay (the
          // page-key guard keeps them from the window): handle them here.
          on:keydown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              // Handled: the overlay's own Escape (collapse) must not run too.
              event.stopPropagation();
              cancelPicking();
            } else if (event.key === 'Tab') {
              event.preventDefault();
              cancelPick?.focus({ preventScroll: true });
            }
          }}
        >
          <span class="xo-pickbar-text" aria-live="polite">
            {pickMessage() ??
              'Point at an image or a lazily rendered section, then click. Scripts are listed in On this page.'}
          </span>
          <span class="xo-kbd" aria-hidden="true">
            Esc
          </span>
          <button type="button" class="xo-button" ref={cancelPick} onClick={cancelPicking}>
            Cancel
          </button>
        </div>
      </Show>

      <p class="xo-sr-only" role="status" aria-live="polite">
        {announcement()}
      </p>
    </div>
  );
}
