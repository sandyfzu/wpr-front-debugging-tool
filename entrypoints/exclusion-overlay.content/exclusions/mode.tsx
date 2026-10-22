/**
 * The Exclusions mode's panel: pick on the page or from the page's list,
 * then compose rows per lane (each lane shows the applied page's counts
 * inline). Reads the session controller and the page tools through the
 * shell's mode context; owns only its own view state (the page list).
 */
import { createEffect, createMemo, createSignal, For, on, Show, type JSX } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Crosshair from 'lucide-solid/icons/crosshair';
import List from 'lucide-solid/icons/list';
import { LANE_COPY, commitAnnouncement, viewCopy } from '../copy';
import type { OverlayModePanelProps } from '../modes';
import { Candidates } from './candidates';
import { laneReport } from './counts';
import { LANE_ORDER, type LaneKey } from './draft';
import { Lane } from './lane';
import { PAGE_SCAN_LIMIT, type PageCandidate } from './page-scan';
import type { LatestCommits } from './row-notes';

/**
 * Commit batches already announced: a panel remount (mode switch, reopen)
 * never repeats one. Weak, so batches leave with their notes.
 */
const ANNOUNCED = new WeakSet<LatestCommits>();

/** The page list's id: the toolbar toggle's `aria-controls` target. */
const CANDIDATES_ID = 'xo-candidates';

/**
 * The Exclusions config panel.
 *
 * @param props See {@link OverlayModePanelProps}.
 */
export function ExclusionsConfig(props: OverlayModePanelProps): JSX.Element {
  // eslint-disable-next-line solid/reactivity -- the context is one object for the mount's lifetime; its members are the reactive parts
  const shell = props.context;
  const c = shell.controller;
  const [listOpen, setListOpen] = createSignal(false);
  let pickButton: HTMLButtonElement | undefined;

  const ready = (): boolean => c.state().phase === 'ready';
  const held = (): boolean => !c.editable();
  const reports = createMemo(() => {
    const view = c.view();
    return view?.kind === 'applied' ? view.reports : [];
  });
  const pageCounts = createMemo(() => {
    const counts = new Map<LaneKey, number>();
    for (const candidate of shell.page.candidates())
      counts.set(candidate.lane, (counts.get(candidate.lane) ?? 0) + 1);
    return counts;
  });
  const candidateCount = (): string =>
    shell.page.candidatesCapped()
      ? `${String(PAGE_SCAN_LIMIT)}+`
      : String(shell.page.candidates().length);
  const draftEmpty = createMemo(() => {
    const draft = c.draft();
    return (
      LANE_ORDER.every((lane) => draft.rows[lane].length === 0) &&
      !draft.disable.delayJs &&
      !draft.disable.deferJs &&
      !draft.disable.lazyRender
    );
  });

  // Every commit that changed or removed rows is said once (newest wins),
  // including the restore that ran before this panel mounted. A pick says
  // "Added …" itself, after this, so its own words win.
  createEffect(
    on(
      () => c.notes().latest,
      (latest) => {
        if (latest === null || ANNOUNCED.has(latest)) return;
        ANNOUNCED.add(latest);
        const text = commitAnnouncement(latest);
        if (text !== null) shell.announce(text);
      }
    )
  );

  // The page list closes with the panel (folded by the user or by a page
  // dialog); picking keeps it, so the list is still there after a pick.
  createEffect(
    on(shell.panelOpen, (isOpen) => {
      if (!isOpen) setListOpen(false);
    })
  );
  createEffect(
    on(
      listOpen,
      (isOpen) => {
        if (isOpen) shell.page.rescan();
      },
      { defer: true }
    )
  );

  /** Pick on the page: a hit lands in its lane, focused. */
  const beginPicking = (): void => {
    if (!c.editable()) return;
    shell.pick(pickButton, {
      label: (pick) => LANE_COPY[pick.candidate.lane].label,
      onPick: (pick) => {
        const added = c.addCandidate(pick.candidate.lane, pick.candidate.row, true);
        shell.announce(
          added
            ? `Added ${pick.candidate.subject} to ${LANE_COPY[pick.candidate.lane].label}`
            : `${pick.candidate.subject} is already in ${LANE_COPY[pick.candidate.lane].label}`
        );
      }
    });
  };

  /** Add from the page list (focus stays on the list). */
  const addFromList = (candidate: PageCandidate, alreadyAdded: boolean): void => {
    if (alreadyAdded) {
      c.addCandidate(candidate.lane, candidate.row, true);
      return;
    }
    if (c.addCandidate(candidate.lane, candidate.row, false)) {
      shell.announce(`Added ${candidate.subject} to ${LANE_COPY[candidate.lane].label}`);
    }
  };

  return (
    <>
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
        {/* A disclosure: the open state is styled from `aria-expanded` (fill +
            the turned chevron). The list mounts only while open, so
            `aria-controls` is set only then — it never names a missing id. */}
        <button
          type="button"
          class="xo-button xo-disclosure"
          aria-expanded={listOpen()}
          aria-controls={listOpen() ? CANDIDATES_ID : undefined}
          aria-disabled={ready() ? undefined : 'true'}
          onClick={() => {
            if (ready()) setListOpen((isOpen) => !isOpen);
          }}
        >
          <List size={14} aria-hidden="true" />
          On this page <span class="xo-count">{candidateCount()}</span>
          <ChevronDown size={14} class="xo-chevron" aria-hidden="true" />
        </button>
      </div>
      <Show when={ready() && draftEmpty() && c.view()?.kind === 'off'}>
        <p class="xo-empty">{viewCopy({ kind: 'off' }).body}</p>
      </Show>
      <Show when={listOpen()}>
        <div id={CANDIDATES_ID}>
          <Candidates
            candidates={shell.page.candidates()}
            draft={c.draft()}
            locked={held()}
            createVirtualizer={shell.createVirtualizer}
            onAdd={addFromList}
            onHover={(candidate) => {
              shell.highlight(
                candidate === null
                  ? null
                  : {
                      element: candidate.element,
                      label: LANE_COPY[candidate.lane].label,
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
            pageCount={shell.page.scanned() ? (pageCounts().get(lane) ?? 0) : null}
            requestFrame={shell.requestFrame}
            locked={held()}
            announce={(text) => {
              shell.announce(text);
            }}
            createVirtualizer={shell.createVirtualizer}
          />
        )}
      </For>
    </>
  );
}
