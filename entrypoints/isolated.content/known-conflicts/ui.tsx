/**
 * The Known Conflicts widget: a floating marker pill (bottom-left inset) and
 * the conflict report card it opens, rendered inside a shadow root.
 *
 * Two presentation states, one anchor point:
 * - closed — the pill (alert icon + count chip in a scan-mood tint) plus a
 *   slim collapse handle; collapsing slides the pill out to the left and
 *   keeps the handle, which doubles as the expand control (+ a small dot
 *   while findings exist);
 * - open — the report card rises from the pill's anchor; the pill row sinks
 *   away at the same beat (the card replaces the pill in place).
 *
 * State never depends on a transition: open/close is class-based (CSS owns
 * opacity/transform/visibility), a click can never strand a container
 * mid-transition, whatever the motion settings report. Item text renders
 * through text nodes; the row handler receives the validated URL from the
 * owning module (the component never opens anything itself).
 */

import type { JSX, JSXElement } from 'solid-js';
import { For, Show } from 'solid-js';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';
import { emptyStateVisible, loadingCopyVisible, markerMood } from './scan-state';
import { CLEAR_ICON_CIRCLE, CLEAR_ICON_PATHS, COLLAPSE_ICON_PATHS, OPEN_ICON_PATHS } from './icons';
import { StrokeIcon, ALERT_ICON_PATHS, CLOSE_ICON_PATHS } from '../ui/icons';
import { TOOL_EYEBROW } from '../ui/copies';

/** What the scanner found and where it is, minus behavior. */
export interface KnownConflictsUiState {
  /** The database is still being resolved (no scan has a verdict yet). */
  loading: boolean;
  /** A scan finished with zero findings (never shown before one finishes). */
  scannedEmpty: boolean;
  /** The found rows, DB order. */
  findings: readonly KnownConflict[];
  /** The report card is open (the marker row is away). */
  listOpen: boolean;
  /** The marker pill is collapsed (only the handle remains). */
  badgeCollapsed: boolean;
}

/** Behavior the owner module wires to the widget's controls. */
export interface KnownConflictsUiActions {
  /** Register the card's root element once (focus choreography). */
  registerPanel(element: HTMLElement | null): void;
  /** Register the marker pill once (the focus hand-back on close). */
  registerBadge(element: HTMLElement | null): void;
  /** Toggle the pill's collapsed state (the slim edge handle). */
  toggleBadge(): void;
  /** Open the report card from the pill. */
  openList(): void;
  /** Close the report card (the marker row returns). */
  closeList(): void;
  /** Open a finding's support article (validated by the owner module). */
  openFinding(url: string): void;
}

/** Pill accessible label + the visible count's sentence stem (exact string). */
const BADGE_LABEL = 'Known Conflicts found: ';
/** Card title (case-exact user-facing string; this copy was corrected). */
const LIST_TITLE = 'Known conflicts found';
/** Empty-state copy (the corrected version of the shipped copy defect). */
const EMPTY_COPY = 'No known conflicts found...';
/** Empty-state sub-line: what a settled empty verdict means. */
const EMPTY_HINT = 'Nothing on this page matches the conflict database.';
/** Loading-state copy shown until the database resolves. */
const LOADING_COPY = 'Loading conflicts database...';
/** Footer affordance hint: what rows do. */
const FOOT_HINT = 'Click a row to open its support article.';
/** Footer affordance hint, close key. */
const ESC_HINT = 'esc';
/** Pending marker: no verdict yet (muted, pulsing chip). */
const PENDING_MARK = '…';
/** Beyond this many rows the count reads `9+` (unchanged display rule). */
const BADGE_COUNT_CAP = 9;
/** The card's element id (in this shadow root's scope): the pill's
 * `aria-controls` target, naming what its expanded state opens. */
const CARD_ID = 'wpr-fdt-known-conflicts-card';

/**
 * The marker count as rendered: the raw number, or `9+` beyond the cap.
 *
 * @param count Row count of the current scan.
 */
export function badgeCount(count: number): string {
  return count > BADGE_COUNT_CAP ? `${String(BADGE_COUNT_CAP)}+` : String(count);
}

/** The count chip's content: the pending mark, or the counted value. */
const CountChip = (props: { count: number; pending: boolean }): JSXElement => (
  <span class="kc-count">
    <Show when={props.pending} fallback={badgeCount(props.count)}>
      {PENDING_MARK}
    </Show>
  </span>
);

export function KnownConflictsView(props: {
  state: KnownConflictsUiState;
  actions: KnownConflictsUiActions;
}): JSX.Element {
  /** The marker's tint/label vocabulary, from the scan machine's decisions. */
  const mood = () => markerMood(props.state.findings, props.state.loading);
  /**
   * The marker icon follows the mood: the alert triangle while findings or
   * no verdict exist, the check ring once a settled scan confirms a clean
   * surface (a green warning triangle would read as an inverted alarm).
   */
  const markerIcon = () => (mood() === 'clear' ? CLEAR_ICON_PATHS : ALERT_ICON_PATHS);

  return (
    <div
      class="kc-chrome"
      classList={{
        'kc-open': props.state.listOpen,
        'kc-alert': mood() === 'alert',
        'kc-clear': mood() === 'clear',
        'kc-pending': mood() === 'pending'
      }}
    >
      {/* The report card. Always mounted: hidden states are
       * visibility/opacity, never a display flip (the shipped defect was a
       * display-state class losing to a later display declaration). */}
      <section
        id={CARD_ID}
        ref={(el) => {
          props.actions.registerPanel(el);
        }}
        class="kc-list"
        role="dialog"
        aria-label={LIST_TITLE}
        tabIndex={-1}
      >
        <header class="kc-list-head">
          <div class="kc-list-titles">
            <span class="kc-eyebrow">{TOOL_EYEBROW}</span>
            {/* The count chip sits beside the title — inside it the probe
             * element's textContent would grow the exact title string. */}
            <div class="kc-titlerow">
              <h3 class="kc-title">{LIST_TITLE}</h3>
              <CountChip count={props.state.findings.length} pending={props.state.loading} />
            </div>
          </div>
          <button
            type="button"
            class="kc-close"
            title="Close the list"
            aria-label="Close the Known Conflicts list"
            onClick={() => {
              props.actions.closeList();
            }}
          >
            <StrokeIcon paths={CLOSE_ICON_PATHS} />
          </button>
        </header>

        <div class="kc-list-body">
          <Show when={loadingCopyVisible(props.state.loading, props.state.findings)}>
            <div class="kc-none kc-none-loading">
              <span class="kc-spin" aria-hidden="true" />
              {LOADING_COPY}
            </div>
          </Show>
          <For each={props.state.findings}>
            {(finding) => (
              <button
                type="button"
                class="kc-item"
                title={finding.url}
                onClick={() => {
                  props.actions.openFinding(finding.url);
                }}
              >
                <span class="kc-item-mark" aria-hidden="true">
                  <StrokeIcon paths={ALERT_ICON_PATHS} />
                </span>
                <span class="kc-item-text">
                  <span class="kc-item-name">{finding.name}</span>
                  <Show when={finding.summary}>
                    <span class="kc-item-summary">{finding.summary}</span>
                  </Show>
                </span>
                <span class="kc-item-go" aria-hidden="true">
                  <StrokeIcon paths={OPEN_ICON_PATHS} />
                </span>
              </button>
            )}
          </For>
          {/* The state flagged `scannedEmpty` already carries the pass-flow
           * verdict; re-deriving through the same rule keeps the view gated
           * against the loading state and against findings that arrived
           * after it was stored. */}
          <Show
            when={emptyStateVisible(
              props.state.findings,
              props.state.scannedEmpty,
              props.state.loading
            )}
          >
            {/* The empty verdict renders as two honest state lines: the copy
             * itself (the element the site suite's probe reads, whose
             * textContent must stay the exact corrected string) and the
             * explanation line under it, aligned into the copy's column. */}
            <div class="kc-none kc-none-empty">
              <span class="kc-none-mark" aria-hidden="true">
                <StrokeIcon paths={CLEAR_ICON_PATHS} circle={CLEAR_ICON_CIRCLE} />
              </span>
              <span class="kc-none-copy">{EMPTY_COPY}</span>
            </div>
            <div class="kc-none kc-none-clearhint">
              <span class="kc-none-hint">{EMPTY_HINT}</span>
            </div>
          </Show>
        </div>

        <footer class="kc-list-foot">
          <span>{FOOT_HINT}</span>
          <kbd class="kc-kbd">{ESC_HINT}</kbd>
        </footer>
      </section>

      {/* The marker row: collapse handle + pill. The handle anchors the
       * corner and paints above the pill, so a collapsing pill slides out to
       * the left under it (and returns from underneath) — no hole ever opens
       * where the pill was. The card's opacity/transform motion hands the
       * anchor over at the same beat. */}
      <div class="kc-badges">
        <button
          type="button"
          class="kc-furl"
          title={
            props.state.badgeCollapsed ? 'Show Known Conflicts badge' : 'Hide Known Conflicts badge'
          }
          aria-label={
            props.state.badgeCollapsed
              ? 'Show the Known Conflicts badge'
              : 'Hide the Known Conflicts badge'
          }
          aria-pressed={props.state.badgeCollapsed}
          onClick={() => {
            props.actions.toggleBadge();
          }}
        >
          <span class="kc-furl-chevron" aria-hidden="true">
            <StrokeIcon paths={COLLAPSE_ICON_PATHS} />
          </span>
          <Show when={props.state.badgeCollapsed && props.state.findings.length > 0}>
            <span class="kc-furl-dot" aria-hidden="true" />
          </Show>
        </button>
        <button
          type="button"
          class="kc-badge"
          ref={(el) => {
            props.actions.registerBadge(el);
          }}
          classList={{ 'kc-collapsed': props.state.badgeCollapsed }}
          title={BADGE_LABEL.trim()}
          aria-haspopup="dialog"
          aria-controls={CARD_ID}
          aria-expanded={props.state.listOpen}
          onClick={() => {
            props.actions.openList();
          }}
        >
          {/* The count's sentence stem renders visibly hidden so the
           * accessible label and the probe-visible text agree, and the
           * count chip follows after it. */}
          <span class="kc-sr">{BADGE_LABEL}</span>
          <span class="kc-mark" aria-hidden="true">
            <StrokeIcon paths={markerIcon()} />
          </span>
          <CountChip count={props.state.findings.length} pending={props.state.loading} />
        </button>
      </div>
    </div>
  );
}
