/**
 * The Known Conflicts badge + slide-in list, rendered inside a shadow root.
 *
 * State never depends on a transition: open/close is class-based and
 * immediate (the swap happens through the same `hidden` class the stylesheet
 * pins), animation is decoration only — a click can never strand a container
 * mid-transition, whatever the motion settings report. Item text renders
 * through text nodes; the link handler receives the validated URL from the
 * owning module (the component never opens anything itself).
 */

import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';
import { emptyStateVisible, loadingCopyVisible } from './scan-state';

/** What the scanner found and where it is, minus behavior. */
export interface KnownConflictsUiState {
  /** The database is still being resolved (no scan has a verdict yet). */
  loading: boolean;
  /** A scan finished with zero findings (never shown before one finishes). */
  scannedEmpty: boolean;
  /** The found rows, DB order. */
  findings: readonly KnownConflict[];
  /** The list panel is open (the badge row is not). */
  listOpen: boolean;
  /** The badge is collapsed (only the furl tab remains). */
  badgeCollapsed: boolean;
}

/** Behavior the owner module wires to the badge's controls. */
export interface KnownConflictsUiActions {
  /** Toggle the badge's collapsed state (the ◂/▸ furl tab). */
  toggleBadge(): void;
  /** Open the list panel from the badge. */
  openList(): void;
  /** Close the list panel (the badge row returns). */
  closeList(): void;
  /** Open a finding's support article (validated by the owner module). */
  openFinding(url: string): void;
}

/** Badge label (case-exact user-facing string). */
const BADGE_LABEL = 'Known Conflicts found';
/** List header (case-exact user-facing string; this copy was corrected). */
const LIST_TITLE = 'Known conflicts found';
/** Empty-state copy (the corrected version of the shipped copy defect). */
const EMPTY_COPY = 'No known conflicts found...';
/** Loading-state copy shown until the database resolves. */
const LOADING_COPY = 'Loading conflicts database...';
/** Beyond this many rows the badge reads `9+` (parity display rule). */
const BADGE_COUNT_CAP = 9;

/**
 * The badge count as rendered: the raw number, or `9+` beyond the cap.
 *
 * @param count Row count of the current scan.
 */
function badgeCount(count: number): string {
  return count > BADGE_COUNT_CAP ? `${String(BADGE_COUNT_CAP)}+` : String(count);
}

/** The furl tab's glyphs: the badge's edge it moves towards, ▸ = expand. */
const FURL_ARROWS = { collapsed: '▸', expanded: '◂' } as const;

/** The warning glyph, rendered inline inside the badge (a data path set). */
const WARNING_ICON_PATHS = [
  'm2.5 85 43-74.41a22.59 22.59 0 0 1 8-8.35 15.72 15.72 0 0 1 16 0 22.52 22.52 0 0 1 7.93 8.38l.23.44 42.08 73.07a20.91 20.91 0 0 1 3 10.84 16.44 16.44 0 0 1-1.74 7.43 15.45 15.45 0 0 1-5.74 6 21 21 0 0 1-11.35 2.78H17.06a19 19 0 0 1-7.83-1.74 15.83 15.83 0 0 1-6.65-5.72A16.26 16.26 0 0 1 0 95.18a21.66 21.66 0 0 1 2.2-9.62c.1-.2.2-.4.31-.59Z',
  'm9.09 88.78 43-74.38c5.22-8.94 13.49-9.2 18.81 0l42.32 73.49c4.12 6.79 2.41 15.9-9.31 15.72H17.7c-7.92.18-12.7-6.17-8.61-14.83Z',
  'M57.55 83.15a5.47 5.47 0 0 1 5.85-1.22 5.65 5.65 0 0 1 2 1.3 5.49 5.49 0 0 1 1.6 3.54 5.12 5.12 0 0 1-.08 1.4 5.22 5.22 0 0 1-.42 1.34 5.51 5.51 0 0 1-5.2 3.25 5.63 5.63 0 0 1-2.26-.53 5.51 5.51 0 0 1-2.81-2.92A6 6 0 0 1 55.9 88a5.28 5.28 0 0 1 0-1.31 6 6 0 0 1 .56-2 4.6 4.6 0 0 1 1.14-1.56Zm8.12-10.21c-.19 4.78-8.28 4.78-8.46 0-.82-8.19-2.92-27.63-2.85-35.32.07-2.37 2-3.78 4.55-4.31a11.65 11.65 0 0 1 2.48-.25 12.54 12.54 0 0 1 2.5.25c2.59.56 4.63 2 4.63 4.43V38l-2.84 35Z'
] as const;

export function KnownConflictsView(props: {
  state: KnownConflictsUiState;
  actions: KnownConflictsUiActions;
}): JSX.Element {
  return (
    <div class="kc-chrome">
      <div class="kc-list" classList={{ 'kc-hidden': !props.state.listOpen }}>
        <div class="kc-list-head">
          <span class="kc-eyebrow">WPR Front Debugging Tool</span>
          <button
            type="button"
            class="kc-close"
            title="Close the list"
            aria-label="Close the Known Conflicts list"
            onClick={() => {
              props.actions.closeList();
            }}
          >
            ×
          </button>
        </div>
        <h3 class="kc-title">{LIST_TITLE}</h3>
        <div class="kc-items">
          <Show when={loadingCopyVisible(props.state.loading, props.state.findings)}>
            <div class="kc-none">{LOADING_COPY}</div>
          </Show>
          <Show when={props.state.findings.length > 0}>
            <For each={props.state.findings}>
              {(finding) => (
                <div
                  class="kc-item"
                  role="button"
                  tabIndex={0}
                  title={finding.url}
                  onClick={() => {
                    props.actions.openFinding(finding.url);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') props.actions.openFinding(finding.url);
                  }}
                >
                  <strong>{finding.name}</strong>
                  <Show when={finding.summary}>{(summary) => ` - ${summary()}`}</Show>
                </div>
              )}
            </For>
          </Show>
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
            <div class="kc-none">{EMPTY_COPY}</div>
          </Show>
        </div>
      </div>

      <div class="kc-badges" classList={{ 'kc-hidden': props.state.listOpen }}>
        <button
          type="button"
          class="kc-badge"
          classList={{ 'kc-collapsed': props.state.badgeCollapsed }}
          title="Open Known Conflicts list"
          onClick={() => {
            props.actions.openList();
          }}
        >
          <span>{BADGE_LABEL}</span>
          <svg viewBox="0 0 122.88 111.24" aria-hidden="true" class="kc-warning">
            <path d={WARNING_ICON_PATHS[0]} />
            <path
              d={WARNING_ICON_PATHS[1]}
              style={{ fill: 'var(--status-warn)', 'fill-rule': 'evenodd' }}
            />
            <path d={WARNING_ICON_PATHS[2]} style={{ fill: 'var(--status-warn-soft)' }} />
          </svg>
          <Show when={!props.state.loading}>
            <span>: {badgeCount(props.state.findings.length)}</span>
          </Show>
        </button>
        <button
          type="button"
          class="kc-furl"
          title="Hide Known Conflicts badge"
          aria-label="Toggle the Known Conflicts badge"
          onClick={() => {
            props.actions.toggleBadge();
          }}
        >
          {props.state.badgeCollapsed ? FURL_ARROWS.collapsed : FURL_ARROWS.expanded}
        </button>
      </div>
    </div>
  );
}
