/**
 * The overlay's view: a tool shell (header with the session indicator,
 * dock/collapse/close; body; footer actions) hosting the Exclusions mode,
 * plus its collapsed pill, the pick layer and the page highlight — all in
 * one top-layer element. Reads the controller and the page tools; owns
 * only view state (open, dock side, picking, the candidate list, the
 * highlight).
 *
 * State matrix (each arm renders its own words and a way forward):
 * loading (skeleton) · load failed (error + Retry) · not applied (empty
 * draft guidance) · populated draft · applying/stopping (controls locked)
 * · reloading (then a manual reload once overdue) · applied (counts per
 * lane and row) · applied with no-match rows (warned per row) · served
 * unmodified · interception unavailable (cause + remedy, Retry when
 * transient) · not intercepted · can't verify · a feature absent from the
 * page (per lane) · the last action's notice.
 *
 * Keyboard: Escape cancels picking, else collapses to the pill (focus goes
 * to it); the pill reopens to the heading; every control is a native
 * button or input in reading order.
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
import { noticeBanner, stateBanner, type BannerAction } from './banner-model';
import { LANE_COPY, TOOL_TITLE, saveStateWords, sessionIndicator, viewCopy } from './copy';
import type { OverlayController } from './controller';
import { Candidates } from './exclusions/candidates';
import { laneReport } from './exclusions/counts';
import { LANE_ORDER, type LaneKey } from './exclusions/draft';
import { Lane } from './exclusions/lane';
import type { PageCandidate } from './exclusions/page-scan';
import { Glyph } from './glyph';
import { viewportRect, type PageTools, type PointedPick } from './page-tools';

/** Space kept between the highlight label and the box (px). */
const LABEL_GAP_PX = 4;
/** The highlight label's height (px) — decides whether it fits above the box. */
const LABEL_HEIGHT_PX = 22;

/**
 * Put the layer in the browser's top layer (a manual popover: no light
 * dismiss, no focus move), above every page stacking context. Without
 * popover support the layer stays a fixed element on the highest z-index.
 *
 * @param layer The overlay's root element.
 */
function showInTopLayer(layer: HTMLElement): void {
  if (typeof layer.showPopover !== 'function') return;
  layer.setAttribute('popover', 'manual');
  try {
    layer.showPopover();
  } catch {
    // Already shown, or the host document refused (detached): the fixed
    // fallback below still renders it.
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
  /** Remove the overlay. */
  readonly onClose: () => void;
  /** Scroll the page by a wheel delta while the pick glass covers it. */
  readonly scrollPage: (dx: number, dy: number) => void;
  /** Whether the extension context is gone (reading it tears a dead overlay down). */
  readonly isInvalid: () => boolean;
}

/** What the highlight shows. */
interface HighlightTarget {
  readonly element: Element;
  readonly lane: LaneKey;
  readonly subject: string;
}

/**
 * The overlay.
 *
 * @param props See {@link OverlayAppProps}.
 */
export function OverlayApp(props: OverlayAppProps): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the controller is one object for the mount's lifetime; its members are the reactive parts
  const c = props.controller;
  const [open, setOpen] = createSignal(true);
  const [dock, setDock] = createSignal<'right' | 'left'>('right');
  const [picking, setPicking] = createSignal(false);
  const [listOpen, setListOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal<HighlightTarget | null>(null);
  const [announcement, setAnnouncement] = createSignal('');
  const [geometryTick, setGeometryTick] = createSignal(0);
  let heading: HTMLHeadingElement | undefined;
  let pill: HTMLButtonElement | undefined;
  let glass: HTMLDivElement | undefined;
  let pickButton: HTMLButtonElement | undefined;
  let layer: HTMLDivElement | undefined;

  const state = c.state;
  const ready = (): boolean => state().phase === 'ready';
  const locked = (): boolean => {
    const current = state();
    return current.phase !== 'ready' || current.pending !== null;
  };
  const indicator = createMemo(() => sessionIndicator(state(), c.view()));
  const banner = createMemo(() => stateBanner(state(), c.view()));
  const notice = createMemo(() => {
    const current = state();
    return current.phase === 'ready' && current.notice !== null
      ? noticeBanner(current.notice)
      : null;
  });
  const draftEmpty = createMemo(() => {
    const draft = c.draft();
    return (
      LANE_ORDER.every((lane) => draft.rows[lane].length === 0) &&
      !draft.disable.delayJs &&
      !draft.disable.deferJs &&
      !draft.disable.lazyRender
    );
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
  const sessionState = (): 'inactive' | 'active' | 'unavailable' | null => {
    const current = state();
    return current.phase === 'ready' ? current.status.state : null;
  };
  const pending = (): string | null => {
    const current = state();
    return current.phase === 'ready' ? current.pending : null;
  };

  // The highlight follows its element through page scroll and resize:
  // one geometry read per frame at most, only while a highlight shows.
  let geometryQueued = false;
  const queueGeometry = (): void => {
    if (highlight() === null || geometryQueued) return;
    geometryQueued = true;
    props.requestFrame(() => {
      geometryQueued = false;
      setGeometryTick((tick) => tick + 1);
    });
  };
  onMount(() => {
    props.listen(window, 'scroll', queueGeometry);
    props.listen(window, 'resize', queueGeometry);
  });
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
    setOpen(true);
    focusSoon(() => heading);
  };

  const startPicking = (): void => {
    setPicking(true);
    setHighlight(null);
    focusSoon(() => glass);
  };
  const stopPicking = (): void => {
    setPicking(false);
    setHighlight(null);
    focusSoon(() => pickButton);
  };

  /** Commit a pointer pick: the row lands in its lane, focused. */
  const commitPick = (pick: PointedPick): void => {
    const added = c.addCandidate(pick.candidate.lane, pick.candidate.row, true);
    setPicking(false);
    setHighlight(null);
    setAnnouncement(
      added
        ? `Added ${pick.candidate.subject} to ${LANE_COPY[pick.candidate.lane].label}`
        : `${pick.candidate.subject} is already in ${LANE_COPY[pick.candidate.lane].label}`
    );
  };

  /** Add from the page list (focus stays on the list). */
  const addFromList = (candidate: PageCandidate, alreadyAdded: boolean): void => {
    if (alreadyAdded) {
      c.addCandidate(candidate.lane, candidate.row, true);
      return;
    }
    c.addCandidate(candidate.lane, candidate.row, false);
    setAnnouncement(`Added ${candidate.subject} to ${LANE_COPY[candidate.lane].label}`);
  };

  let pointerQueued = false;
  let lastPoint = { x: 0, y: 0 };
  const onGlassMove = (event: PointerEvent): void => {
    lastPoint = { x: event.clientX, y: event.clientY };
    if (pointerQueued) return;
    pointerQueued = true;
    // eslint-disable-next-line solid/reactivity -- a frame callback scheduled by a pointer event: read untracked on purpose
    props.requestFrame(() => {
      pointerQueued = false;
      if (!picking()) return;
      const pick = props.page.pointPick(lastPoint.x, lastPoint.y);
      setHighlight(
        pick === null
          ? null
          : { element: pick.element, lane: pick.candidate.lane, subject: pick.candidate.subject }
      );
    });
  };
  const onGlassClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const pick = props.page.pointPick(event.clientX, event.clientY);
    if (pick === null) {
      setAnnouncement('Nothing to exclude there. Point at an image or a lazily rendered section.');
      return;
    }
    commitPick(pick);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    if (picking()) stopPicking();
    else if (open()) collapse();
  };

  const onBannerAction = (action: BannerAction): void => {
    switch (action) {
      case 'retry-load':
        c.retryLoad();
        break;
      case 'retry-apply':
        c.apply();
        break;
      case 'reload':
        c.reloadPage();
        break;
      case 'dismiss':
        c.dismissNotice();
        break;
    }
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

  onMount(() => {
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

  return (
    <div
      class="xo-layer"
      ref={layer}
      on:keydown={onKeyDown}
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
            <h1 class="xo-title xo-heading-target" id="xo-title" tabIndex={-1} ref={heading}>
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
                {props.origin}
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
              <div class="xo-skeleton" aria-busy="true" aria-label="Loading the session">
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
                // Only an action in flight locks the banner's own actions:
                // Retry after a failed load and the overdue manual reload
                // must stay usable outside the ready state.
                <BannerView
                  banner={current()}
                  onAction={onBannerAction}
                  locked={pending() !== null}
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
                  disabled={!ready()}
                  onClick={startPicking}
                >
                  <Crosshair size={14} aria-hidden="true" />
                  Pick on page
                </button>
                <button
                  type="button"
                  class="xo-button"
                  aria-expanded={listOpen()}
                  aria-controls="xo-candidates"
                  disabled={!ready()}
                  onClick={() => setListOpen((isOpen) => !isOpen)}
                >
                  <List size={14} aria-hidden="true" />
                  On this page <span class="xo-count">{props.page.candidates().length}</span>
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
                    locked={locked()}
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
                    pageCount={pageCounts().get(lane) ?? 0}
                    requestFrame={props.requestFrame}
                    locked={locked()}
                  />
                )}
              </For>
            </Show>
          </Show>
        </div>

        <Show when={ready()}>
          <footer class="xo-footer">
            <p class="xo-footer-status" data-tone={footerLine()?.tone ?? 'muted'} role="status">
              {footerLine()?.text ?? ''}
            </p>
            <div class="xo-footer-actions">
              <Show when={sessionState() === 'active' || sessionState() === 'unavailable'}>
                <button
                  type="button"
                  class="xo-button"
                  disabled={locked()}
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
                  disabled={locked()}
                  title="Discard edits and re-apply the applied exclusions"
                  onClick={() => {
                    c.reset();
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
                disabled={locked()}
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
          aria-label={`Open the exclusion builder — session: ${indicator().label}`}
        >
          <span class="xo-brand" aria-hidden="true">
            <Crosshair size={12} strokeWidth={2.5} />
          </span>
          <span>Exclusions</span>
          <span class="xo-indicator" data-tone={indicator().tone} aria-hidden="true">
            <Glyph name={indicator().glyph} size={12} />
            {indicator().label}
          </span>
        </button>
      </Show>

      <Show when={picking()}>
        <div
          class="xo-glass"
          ref={glass}
          tabIndex={-1}
          role="application"
          aria-label="Pick an element: point at it and click; Escape cancels"
          onPointerMove={onGlassMove}
          onPointerLeave={() => setHighlight(null)}
          onClick={onGlassClick}
          onWheel={(event) => {
            props.scrollPage(event.deltaX, event.deltaY);
            queueGeometry();
          }}
        />
        <div class="xo-pickbar" role="group" aria-label="Picking">
          <span class="xo-pickbar-text">
            Point at an image or a lazily rendered section, then click. Scripts are listed in On
            this page.
          </span>
          <span class="xo-kbd" aria-hidden="true">
            Esc
          </span>
          <button type="button" class="xo-button" onClick={stopPicking}>
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
