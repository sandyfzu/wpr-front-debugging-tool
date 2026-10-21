/**
 * One editor lane: a feature's rows (always through the virtual list — one
 * code path whatever the count), its feature-wide disable when it has one,
 * the applied page's counts, and the lane's own notes (feature absent from
 * the page, rows unused under the disable). Row keyboard model: Enter adds
 * a row below, Backspace on an empty row removes it, ArrowUp/ArrowDown move
 * between rows, a multi-line paste splits into rows.
 */
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import Plus from 'lucide-solid/icons/plus';
import Trash from 'lucide-solid/icons/trash';
import CircleAlert from 'lucide-solid/icons/circle-alert';
import {
  VirtualList,
  type VirtualizerFactory,
  type VirtualScrollRequest
} from '../../../components/ui/virtual-list';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import { EXCLUSION_SET_LIMITS } from '../../../lib/messaging/exclusion-session';
import { LANE_COPY } from '../copy';
import type { OverlayController } from '../controller';
import { laneCounts, rowMatches } from './counts';
import { laneFeature, type DraftRow, type LaneKey, type RowSelection } from './draft';

/** Seed row height (px) before measurement: one input line plus padding. */
const ROW_ESTIMATE_PX = 37;

/**
 * Frames a focus request may wait for its row to render (scrolled into the
 * window first; a far jump re-measures for a few frames).
 */
const FOCUS_FRAMES = 12;

/** Rows a lane shows without its own scroller (one page scroller holds them). */
const INLINE_ROWS = 8;

/** Props of {@link Lane}. */
export interface LaneProps {
  readonly lane: LaneKey;
  readonly controller: OverlayController;
  /** The rewritten page's report for this lane (undefined when not applied here). */
  readonly report: TransformReport | undefined;
  /** Elements on the page this lane can act on (null until the page scan finished). */
  readonly pageCount: number | null;
  /** One animation-frame request (context-owned). */
  readonly requestFrame: (run: () => void) => void;
  /** Whether controls are locked (an action is in flight). */
  readonly locked: boolean;
  /** The virtualizer seam (tests). */
  readonly createVirtualizer?: VirtualizerFactory | undefined;
}

/** The lane's count line, e.g. "3 of 9 delayed scripts restored". */
function countLine(report: TransformReport | undefined, noun: string): string | null {
  const counts = laneCounts(report);
  if (counts === null) return null;
  if (counts.featureWide)
    return `All ${String(counts.rewritten)} ${noun} restored (feature disabled)`;
  return `${String(counts.rewritten)} of ${String(counts.candidates)} ${noun} restored`;
}

/**
 * Where a paste lands in a row: its input's selection, or the end of its text
 * when the input has none.
 *
 * @param field The row's input (the paste's current target).
 * @param row The row.
 */
function selectionOf(field: EventTarget | null, row: DraftRow): RowSelection {
  const caret = row.text.length;
  if (!(field instanceof HTMLInputElement)) return { start: caret, end: caret };
  return { start: field.selectionStart ?? caret, end: field.selectionEnd ?? caret };
}

/**
 * The editor lane.
 *
 * @param props See {@link LaneProps}.
 */
export function Lane(props: LaneProps): JSX.Element {
  const copy = (): (typeof LANE_COPY)[LaneKey] => LANE_COPY[props.lane];
  const toggleKey = (): ReturnType<typeof laneFeature>['toggleKey'] =>
    laneFeature(props.lane).toggleKey;
  const rows = createMemo((): readonly DraftRow[] => props.controller.draft().rows[props.lane]);
  const disabled = (): boolean => {
    const key = toggleKey();
    return key !== null && props.controller.draft().disable[key];
  };
  const headingId = (): string => `xo-lane-${props.lane}`;
  const [scrollTo, setScrollTo] = createSignal<VirtualScrollRequest | null>(null);
  let root: HTMLElement | undefined;

  /** The row a focus move is heading to (arrow presses accumulate on it, never on a stale focus). */
  let focusTarget: string | null = null;
  /** Focus a row's input once it is rendered (scrolling it into the window first). */
  const focusRow = (id: string): void => {
    const index = rows().findIndex((row) => row.id === id);
    if (index === -1) return;
    focusTarget = id;
    setScrollTo({ index });
    let frames = 0;
    const attempt = (): void => {
      if (focusTarget !== id) return;
      const input = root?.querySelector<HTMLInputElement>(`[data-row-id="${id}"] input`);
      if (input) {
        input.focus({ preventScroll: false });
        focusTarget = null;
        return;
      }
      frames += 1;
      if (frames < FOCUS_FRAMES) props.requestFrame(attempt);
      // Gave up: forget the target, so the next move starts from focus.
      else if (focusTarget === id) focusTarget = null;
    };
    // Usually rendered already (the list updates synchronously): focus now,
    // so typing right after "Add row" lands in the row; else retry per frame.
    attempt();
  };

  createEffect(
    on(
      () => props.controller.focusRequest(),
      (request) => {
        if (request?.lane === props.lane) focusRow(request.id);
      },
      { defer: true }
    )
  );

  /** Arrow-key move to the neighbor row. */
  const moveFocus = (id: string, step: -1 | 1): void => {
    const list = rows();
    const index = list.findIndex((row) => row.id === (focusTarget ?? id));
    const target = list[index + step];
    if (target !== undefined) focusRow(target.id);
  };

  const onRowKeyDown = (row: DraftRow, event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(row.id, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (props.locked) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      props.controller.insertRows(props.lane, [''], row.id);
    } else if (event.key === 'Backspace' && row.text === '' && rows().length > 1) {
      event.preventDefault();
      props.controller.removeRow(props.lane, row.id);
    }
  };

  const onRowPaste = (row: DraftRow, event: ClipboardEvent): void => {
    if (props.locked) {
      event.preventDefault();
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!/\r?\n/.test(text.trim())) return;
    event.preventDefault();
    props.controller.pasteRows(props.lane, row.id, text, selectionOf(event.currentTarget, row));
  };

  const full = (): boolean => rows().length >= EXCLUSION_SET_LIMITS.rowsPerFeature;

  return (
    <section
      class="xo-lane"
      aria-labelledby={headingId()}
      ref={root}
      // Focus that landed on a row by any other way (click, Tab) ends a
      // pending arrow move.
      on:focusin={() => {
        focusTarget = null;
      }}
    >
      <div class="xo-lane-head">
        <div class="xo-lane-titles">
          <h2 class="xo-lane-title" id={headingId()}>
            {copy().label}
          </h2>
          <span class="xo-lane-hint">{copy().rowHint}</span>
          <Show when={countLine(props.report, copy().noun)}>
            {(line) => <span class="xo-lane-count">{line()}</span>}
          </Show>
        </div>
        <Show when={toggleKey()}>
          {(key) => (
            <button
              type="button"
              role="switch"
              class="xo-switch"
              aria-checked={disabled()}
              aria-label={`Disable feature: ${copy().label} on this page`}
              aria-disabled={props.locked ? 'true' : undefined}
              onClick={() => {
                props.controller.setDisable(key(), !disabled());
              }}
            >
              <span class="xo-switch-track" aria-hidden="true">
                <span class="xo-switch-thumb" />
              </span>
              <span aria-hidden="true">Disable feature</span>
            </button>
          )}
        </Show>
      </div>
      <Show when={disabled()}>
        <p class="xo-lane-note">
          The whole feature is off for this page; rows are not used while it is.
        </p>
      </Show>
      <Show when={!disabled() && props.pageCount === 0 && rows().length === 0}>
        <p class="xo-lane-note">{copy().absent}</p>
      </Show>
      <Show when={rows().length > 0}>
        <div class="xo-rows" data-scroll={rows().length > INLINE_ROWS ? 'own' : undefined}>
          <VirtualList
            scrollerRole="list"
            aria-label={`${copy().label} rows`}
            count={rows().length}
            estimateSize={() => ROW_ESTIMATE_PX}
            getItemKey={(index) => rows()[index]?.id ?? `missing-${String(index)}`}
            overscan={8}
            scrollTo={scrollTo}
            createVirtualizer={props.createVirtualizer}
            class="xo-scroller"
          >
            {(item) => (
              // Unkeyed on purpose: each keystroke makes a new row object, and
              // a keyed render would remount the input (losing focus).
              <Show when={rows()[item.index]}>
                {(row) => (
                  <LaneRow
                    lane={props.lane}
                    row={row()}
                    position={item.index + 1}
                    total={rows().length}
                    controller={props.controller}
                    report={props.report}
                    showMatches={props.report !== undefined && !props.report.featureWide}
                    locked={props.locked}
                    onKeyDown={(event) => {
                      onRowKeyDown(row(), event);
                    }}
                    onPaste={(event) => {
                      onRowPaste(row(), event);
                    }}
                  />
                )}
              </Show>
            )}
          </VirtualList>
        </div>
      </Show>
      <div class="xo-lane-foot">
        <button
          type="button"
          class="xo-button"
          data-variant="ghost"
          aria-disabled={full() || props.locked ? 'true' : undefined}
          onClick={() => {
            props.controller.insertRows(props.lane, [''], null);
          }}
        >
          <Plus size={14} aria-hidden="true" />
          Add row
        </button>
        <Show when={full()}>
          <span class="xo-lane-limit">
            {`${String(EXCLUSION_SET_LIMITS.rowsPerFeature)} rows is the most a lane holds.`}
          </span>
        </Show>
      </div>
    </section>
  );
}

/**
 * A reason's text with its backtick-quoted parts (patterns) rendered as
 * code rather than as raw backticks.
 *
 * @param text The engine's reason.
 */
function withCode(text: string): JSX.Element {
  return (
    <For each={text.split('`')}>
      {(part, index) => (
        <Show when={index() % 2 === 1} fallback={part}>
          <code class="xo-code">{part}</code>
        </Show>
      )}
    </For>
  );
}

/** A row's match badge words. */
function matchLabel(count: number): string {
  if (count === 0) return 'No match';
  return `${String(count)} ${count === 1 ? 'match' : 'matches'}`;
}

/** Props of {@link LaneRow}. */
interface LaneRowProps {
  readonly lane: LaneKey;
  readonly row: DraftRow;
  readonly position: number;
  readonly total: number;
  readonly controller: OverlayController;
  readonly report: TransformReport | undefined;
  /** The lane has match counts (keeps the badge column aligned on every row). */
  readonly showMatches: boolean;
  readonly locked: boolean;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly onPaste: (event: ClipboardEvent) => void;
}

/**
 * One editable row: the input, its match count on the applied page, its
 * remove control and its inline problem.
 *
 * @param props See {@link LaneRowProps}.
 */
function LaneRow(props: LaneRowProps): JSX.Element {
  const label = (): string => `${LANE_COPY[props.lane].label} row ${String(props.position)}`;
  const problem = (): string | null =>
    props.controller.rowProblem(props.lane, props.row.id, props.row.text);
  const matches = (): number | null => rowMatches(props.report, props.row.text);
  const errorId = (): string => `${props.row.id}-problem`;
  return (
    <div
      class="xo-row"
      role="listitem"
      aria-setsize={props.total}
      aria-posinset={props.position}
      data-row-id={props.row.id}
    >
      <div class="xo-row-line">
        <input
          class="xo-row-input"
          type="text"
          spellcheck={false}
          autocomplete="off"
          maxLength={EXCLUSION_SET_LIMITS.rowChars}
          value={props.row.text}
          // The full row, for rows wider than the input.
          title={props.row.text.length > 40 ? props.row.text : undefined}
          placeholder={LANE_COPY[props.lane].placeholder}
          aria-label={label()}
          aria-invalid={problem() !== null}
          aria-describedby={problem() === null ? undefined : errorId()}
          readOnly={props.locked}
          onInput={(event) => {
            props.controller.editRow(props.lane, props.row.id, event.currentTarget.value);
          }}
          // Native listener: runs at the input, before the overlay's own
          // Escape handling further up.
          on:keydown={(event) => {
            props.onKeyDown(event);
          }}
          onPaste={(event) => {
            props.onPaste(event);
          }}
        />
        <Show when={props.showMatches}>
          <Show
            when={matches() !== null}
            fallback={<span class="xo-match" data-tone="none" aria-hidden="true" />}
          >
            <span class="xo-match" data-tone={(matches() ?? 0) > 0 ? 'ok' : 'warn'}>
              {matchLabel(matches() ?? 0)}
            </span>
          </Show>
        </Show>
        <button
          type="button"
          class="xo-icon-button"
          data-size="small"
          aria-label={`Remove ${label()}`}
          title="Remove row"
          aria-disabled={props.locked ? 'true' : undefined}
          onClick={() => {
            props.controller.removeRow(props.lane, props.row.id);
          }}
        >
          <Trash size={14} aria-hidden="true" />
        </button>
      </div>
      <Show when={problem()}>
        {(reason) => (
          <p class="xo-row-error" id={errorId()}>
            <CircleAlert size={12} aria-hidden="true" />
            <span>{withCode(reason())}</span>
          </p>
        )}
      </Show>
    </div>
  );
}
