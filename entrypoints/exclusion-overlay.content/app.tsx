/**
 * The overlay's view: a tool shell (header with the session indicator,
 * dock/collapse/close; body; footer actions) hosting the Exclusions mode,
 * plus its collapsed pill, the picking bar and the page highlight — all in
 * one top-layer element. Reads the controller and the page tools; owns
 * only view state (open, dock side, picking, the candidate list, the
 * highlight).
 *
 * State matrix (each arm renders its own words and a way forward):
 * loading (skeleton) · load failed (error + Retry) · nothing applied
 * (empty-draft guidance) · populated draft · applying/stopping (controls
 * held) · reloading · reload overdue (notice: Reload, Stop, keep editing) ·
 * applied (counts per lane and row) · applied with no-match rows ·
 * served unmodified · interception unavailable (cause + remedy, Retry when
 * transient) · not intercepted · can't verify · a feature absent from the
 * page (per lane) · the last action's notice · paused under a page modal
 * dialog.
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
import List from 'lucide-solid/icons/list';
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
import { LANE_COPY, TOOL_TITLE, saveStateWords, sessionIndicator, viewCopy } from './copy';
import type { OverlayController } from './controller';
import { Candidates } from './exclusions/candidates';
import { laneReport } from './exclusions/counts';
import { LANE_ORDER, type LaneKey } from './exclusions/draft';
import { Lane } from './exclusions/lane';
import { PAGE_SCAN_LIMIT, type PageCandidate } from './exclusions/page-scan';
import { Glyph } from './glyph';
import { viewportRect, type PageTools, type PointedPick } from './page-tools';
import type { PickerEvents } from './picker';
import type { VirtualizerFactory } from '../../components/ui/virtual-list';
import { createLogger } from '../../lib/logger';

const log = createLogger('exclusion-overlay');

/** Space kept between the highlight label and the box (px). */
const LABEL_GAP_PX = 4;
/** The highlight label's height (px) — decides whether it fits above the box. */
const LABEL_HEIGHT_PX = 22;

/**
 * Put the layer in the browser's top layer (a manual popover: no light
 * dismiss, no focus move), above every page stacking context — again on
 * each call, which moves it above whatever the page opened since. Without
 * popover support the layer stays a fixed element on the highest z-index.
 *
 * @param layer The overlay's root element.
 */
function showInTopLayer(layer: HTMLElement): void {
  if (typeof layer.showPopover !== 'function') return;
  layer.setAttribute('popover', 'manual');
  try {
    if (layer.matches(':popover-open')) layer.hidePopover();
    layer.showPopover();
  } catch (cause) {
    // The host document refused (e.g. detached): the fixed fallback renders it.
    log.warn('Showing the overlay in the top layer failed; using the fixed fallback', cause);
    layer.removeAttribute('popover');
  }
}

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
  /** Start picking on the page; returns the stop. */
  readonly startPicking: (events: PickerEvents<PointedPick>) => () => void;
  /** Whether the extension context is gone (reading it tears a dead overlay down). */
  readonly isInvalid: () => boolean;
  /** The lists' virtualizer seam (tests render every row; default: the library). */
  readonly createVirtualizer?: VirtualizerFactory;
}

/** What the highlight shows. */
interface HighlightTarget {
  readonly element: Element;
  readonly lane: LaneKey;
  readonly subject: string;
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
  const [open, setOpen] = createSignal(!props.page.pageModal());
  const [dock, setDock] = createSignal<'right' | 'left'>('right');
  const [picking, setPicking] = createSignal(false);
  const [pickMessage, setPickMessage] = createSignal<string | null>(null);
  const [listOpen, setListOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal<HighlightTarget | null>(null);
  const [announcement, setAnnouncement] = createSignal('');
  const [geometryTick, setGeometryTick] = createSignal(0);
  let heading: HTMLHeadingElement | undefined;
  let pill: HTMLButtonElement | undefined;
  let cancelPick: HTMLButtonElement | undefined;
  let pickButton: HTMLButtonElement | undefined;
  let layer: HTMLDivElement | undefined;
  let stopPicker: (() => void) | null = null;

  const state = c.state;
  const ready = (): boolean => state().phase === 'ready';
  const held = (): boolean => !c.editable();
  const paused = (): boolean => props.page.pageModal();
  const indicator = createMemo(() => sessionIndicator(state(), c.view()));
  const banner = createMemo(() => stateBanner(state(), c.view()));
  const notice = createMemo(() => {
    const current = state();
    return current.phase === 'ready' && current.notice !== null
      ? noticeBanner(current.notice)
      : null;
  });
  const reports = createMemo(() => {
    const view = c.view();
    return view?.kind === 'applied' ? view.reports : [];
  });
  const pageCounts = createMemo(() => {
    const counts = new Map<LaneKey, number>();
    for (const candidate of props.page.candidates())
      counts.set(candidate.lane, (counts.get(candidate.lane) ?? 0) + 1);
    return counts;
  });
  const candidateCount = (): string =>
    props.page.candidatesCapped()
      ? `${String(PAGE_SCAN_LIMIT)}+`
      : String(props.page.candidates().length);
  const sessionState = (): 'inactive' | 'active' | 'unavailable' | null => {
    const current = state();
    return current.phase === 'ready' ? current.status.state : null;
  };
  const pending = (): string | null => {
    const current = state();
    return current.phase === 'ready' ? current.pending : null;
  };
  const draftEmpty = createMemo(() => {
    const draft = c.draft();
    return (
      LANE_ORDER.every((lane) => draft.rows[lane].length === 0) &&
      !draft.disable.delayJs &&
      !draft.disable.deferJs &&
      !draft.disable.lazyRender
    );
  });

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

  /** Move focus once the target is visible (next frame: visibility flips first). */
  const focusSoon = (element: () => HTMLElement | undefined): void => {
    props.requestFrame(() => element()?.focus({ preventScroll: true }));
  };

  const collapse = (): void => {
    setOpen(false);
    setListOpen(false);
    setHighlight(null);
    focusSoon(() => pill);
  };
  const expand = (): void => {
    // A modal the page removed without closing it fires nothing: re-read.
    props.page.refreshModal();
    if (paused()) return;
    setOpen(true);
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
    focusSoon(() => pickButton);
  };
  /** Commit a pointer pick: the row lands in its lane, focused. */
  const commitPick = (pick: PointedPick): void => {
    endPicking();
    const added = c.addCandidate(pick.candidate.lane, pick.candidate.row, true);
    setAnnouncement(
      added
        ? `Added ${pick.candidate.subject} to ${LANE_COPY[pick.candidate.lane].label}`
        : `${pick.candidate.subject} is already in ${LANE_COPY[pick.candidate.lane].label}`
    );
  };
  const beginPicking = (): void => {
    if (!c.editable()) return;
    setPicking(true);
    setHighlight(null);
    stopPicker = props.startPicking({
      hover: (pick) => {
        setHighlight(
          pick === null
            ? null
            : { element: pick.element, lane: pick.candidate.lane, subject: pick.candidate.subject }
        );
      },
      pick: (pick, pointed) => {
        if (pick !== null) {
          commitPick(pick);
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

  /** Add from the page list (focus stays on the list). */
  const addFromList = (candidate: PageCandidate, alreadyAdded: boolean): void => {
    if (alreadyAdded) {
      c.addCandidate(candidate.lane, candidate.row, true);
      return;
    }
    if (c.addCandidate(candidate.lane, candidate.row, false)) {
      setAnnouncement(`Added ${candidate.subject} to ${LANE_COPY[candidate.lane].label}`);
    }
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

  createEffect(
    on(
      listOpen,
      (isOpen) => {
        if (isOpen) props.page.rescan();
      },
      { defer: true }
    )
  );

  // A page modal dialog makes everything outside it inert, the overlay too:
  // fold into the pill (marked paused) until it closes, then come back.
  let openBeforeModal = true;
  createEffect(
    on(
      paused,
      (isPaused) => {
        if (isPaused) {
          openBeforeModal = open();
          endPicking();
          setOpen(false);
          setListOpen(false);
        } else if (openBeforeModal) {
          setOpen(true);
          focusSoon(() => heading);
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
        if (layer !== undefined && !paused()) showInTopLayer(layer);
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
    if (layer !== undefined) showInTopLayer(layer);
    focusSoon(() => heading);
  });
  onCleanup(() => {
    setHighlight(null);
  });

  const footerLine = createMemo((): { text: string; tone: 'muted' | 'error' } | null => {
    const invalid = c.invalidCount();
    if (invalid > 0)
      return {
        text: `${String(invalid)} ${invalid === 1 ? 'row needs' : 'rows need'} fixing`,
        tone: 'error'
      };
    const view = c.view();
    if (view?.kind === 'unavailable' && !view.retryable) {
      return { text: 'Applying again won’t help until the cause above is fixed', tone: 'muted' };
    }
    if (c.dirty()) return { text: 'Edits not applied yet', tone: 'muted' };
    const words = saveStateWords(c.saveState());
    return words === null
      ? null
      : { text: words, tone: c.saveState().kind === 'not-saved' ? 'error' : 'muted' };
  });

  const applyLabel = (): string => {
    if (pending() === 'apply' || pending() === 'reset') return 'Applying…';
    if (sessionState() !== 'active') return 'Apply';
    return c.dirty() ? 'Apply changes' : 'Re-apply';
  };
  const resetHeld = (): boolean => held() || !c.dirty();

  return (
    <div
      class="xo-layer"
      // Tokens re-declared inside the shadow tree: page `*` rules setting
      // custom properties reach the host, never this element.
      data-fdt-tokens
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
              <span class="xo-highlight-lane">
                {LANE_COPY[highlight()?.lane ?? 'delayJs'].label}
              </span>
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
              aria-label="Close the exclusion builder"
              title="Close"
              onClick={() => {
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
              <div class="xo-toolbar">
                <button
                  type="button"
                  class="xo-button"
                  ref={pickButton}
                  aria-disabled={held() ? 'true' : undefined}
                  onClick={beginPicking}
                >
                  <Crosshair size={14} aria-hidden="true" />
                  Pick on page
                </button>
                <button
                  type="button"
                  class="xo-button"
                  aria-expanded={listOpen()}
                  aria-controls="xo-candidates"
                  aria-disabled={ready() ? undefined : 'true'}
                  onClick={() => {
                    if (ready()) setListOpen((isOpen) => !isOpen);
                  }}
                >
                  <List size={14} aria-hidden="true" />
                  On this page <span class="xo-count">{candidateCount()}</span>
                </button>
              </div>
              <Show when={ready() && draftEmpty() && c.view()?.kind === 'off'}>
                <p class="xo-empty">{viewCopy({ kind: 'off' }).body}</p>
              </Show>
              <Show when={listOpen()}>
                <div id="xo-candidates">
                  <Candidates
                    candidates={props.page.candidates()}
                    draft={c.draft()}
                    locked={held()}
                    createVirtualizer={props.createVirtualizer}
                    onAdd={addFromList}
                    onHover={(candidate) => {
                      setHighlight(
                        candidate === null
                          ? null
                          : {
                              element: candidate.element,
                              lane: candidate.lane,
                              subject: candidate.subject
                            }
                      );
                    }}
                  />
                </div>
              </Show>
              <For each={LANE_ORDER}>
                {(lane) => (
                  <Lane
                    lane={lane}
                    controller={c}
                    report={laneReport(reports(), lane)}
                    pageCount={props.page.scanned() ? (pageCounts().get(lane) ?? 0) : null}
                    requestFrame={props.requestFrame}
                    locked={held()}
                    createVirtualizer={props.createVirtualizer}
                  />
                )}
              </For>
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
                  aria-disabled={held() ? 'true' : undefined}
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
                aria-disabled={held() ? 'true' : undefined}
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
          <span>Exclusions</span>
          <span class="xo-indicator" data-tone={paused() ? 'neutral' : indicator().tone}>
            <Glyph name={paused() ? 'idle' : indicator().glyph} size={12} />
            {paused() ? 'Paused: page dialog open' : indicator().label}
          </span>
          <span class="xo-sr-only"> — open the exclusion builder</span>
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
        <div class="xo-pickbar" role="group" aria-label="Picking on the page">
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
