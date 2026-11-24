/**
 * The JavaScript page's Runtime states section: every `<script>` on the
 * inspected page as it is now (the live DOM — not the snapshot detection
 * parsed), each with its Delay JS state (executed, failed, skipped,
 * pending, not delayed), source group (theme, plugins, inline, other), id,
 * classes and code — as a calm list (Source × State facets, search) whose
 * rows open their detail (side pane from the split width, drill-in below
 * it). Loaded on first show (its own chunk).
 *
 * State matrix: first read pending → skeleton rows · page-unreachable (per
 * miss, with recoveries) · read: empty (no scripts) / filtered-empty (the
 * shared `NoMatches`, with Clear filters) / populated (notes for a cut list
 * and for scripts no State value covers) · re-reading (the shown read
 * stays, Read again busy) · a failed re-read (its notice above the kept
 * list) · stale once the page reloaded or changed (a show re-reads; while
 * shown, a note).
 *
 * A re-read — answered or failed — keeps the view mounted (S-2): facets,
 * query, scroll and the selection (rows are keyed by the script, not its
 * state: the open detail follows a script whose state changed).
 */
import type { JSX } from 'solid-js';
import { createMemo, createRoot, For, Show } from 'solid-js';
import Braces from 'lucide-solid/icons/braces';
import Code from 'lucide-solid/icons/code';
import FileCode from 'lucide-solid/icons/file-code';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { SCRIPT_NOUN } from '../../../../lib/detection/count-nouns';
import {
  describeRuntimeMiss,
  LIVE_STATE_HINT,
  LIVE_STATE_LABEL,
  NO_SCRIPTS_COPY,
  outsideFiltersNote,
  RUNTIME_STALE_COPY,
  truncatedNote,
  type RuntimeRecovery
} from '../../../../lib/script-runtime/outcome-view';
import type { LiveScriptsOutcome } from '../../../../lib/script-runtime/read-live';
import { useFdtData } from '../../state/use-fdt-data';
import { openResourceCapability, type OpenResource } from '../open-resource';
import { OutcomeNotice } from '../outcome-notice';
import { RecoveryButtons } from '../recovery-buttons';
import { inspectedReloadAction } from '../reload-inspected';
import { CalmFilteredList } from '../resource-list/calm-list';
import {
  calmRowEstimate,
  ListRow,
  ListRowHead,
  type ListRowColumns
} from '../resource-list/list-row';
import type { CodeBlockSeams } from './code-seams';
import { RuntimeDetail, RuntimeStateLine } from './runtime-detail';
import { realRuntimeStatesDeps } from './runtime-real-deps';
import {
  outsideFilterCounts,
  RUNTIME_FACETS,
  runtimeCopy,
  runtimeKind,
  runtimeRows,
  runtimeSearchField,
  sameRuntimeRow,
  urlClipped
} from './runtime-rows';
import { createRuntimeStatesSession, type RuntimeStatesSession } from './runtime-session';
import { RELOAD_PAGE_LABEL } from '../recovery-words';

/** The recoveries' button labels. */
export const RUNTIME_RECOVERY_LABELS: Readonly<Record<RuntimeRecovery, string>> = {
  retry: 'Read again',
  'reload-page': RELOAD_PAGE_LABEL
};

/** The panel-lifetime session (created on the section's first show). */
let sharedSession: RuntimeStatesSession | null = null;

/**
 * Create a session in its own reactive root (never disposed: it lives as
 * long as the panel document).
 *
 * @param create Builds the session.
 */
export function createRuntimeStatesHandle(
  create: () => RuntimeStatesSession
): RuntimeStatesSession {
  return createRoot(create);
}

/** Props of {@link RuntimeStatesSection}. */
export interface RuntimeStatesSectionProps {
  /** A prebuilt session (tests); absent, the panel-lifetime one. */
  session?: RuntimeStatesSession;
  /**
   * Reloads the inspected page (tests; `null`: the context cannot); absent,
   * DevTools' own reload when available.
   */
  reloadInspectedPage?: (() => void) | null;
  /** "Open in Sources" (tests; `null`: none); absent, DevTools' own when available. */
  openResource?: OpenResource | null;
  /** The list's virtualizer seam (tests). */
  createVirtualizer?: VirtualizerFactory;
  /** Code block seams (tests). */
  codeBlock?: CodeBlockSeams;
}

/**
 * Render the section (reads on show unless the shown read is current).
 *
 * @param props See {@link RuntimeStatesSectionProps}.
 */
export function RuntimeStatesSection(props: RuntimeStatesSectionProps): JSX.Element {
  const store = useFdtData();
  // The session is chosen once per mount.
  const session =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: a mount keeps its session
    props.session ??
    (sharedSession ??= createRuntimeStatesHandle(() =>
      createRuntimeStatesSession(realRuntimeStatesDeps({ state: store.state }))
    ));
  // Read once on purpose: the context cannot change.
  /* eslint-disable solid/reactivity */
  const reloadPage =
    props.reloadInspectedPage === undefined
      ? inspectedReloadAction(browser)
      : (props.reloadInspectedPage ?? undefined);
  const openResource =
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;
  /* eslint-enable solid/reactivity */
  session.ensure();

  const run = () => session.read.state();
  const outcome = () => run().shown?.outcome;
  /** The read, when the page answered. */
  const read = () => {
    const current = outcome();
    return current?.kind === 'read' ? current : undefined;
  };
  /** How the latest read missed the page, when it did (a failed re-read keeps the list below). */
  const missKind = () => {
    const current = run().failure?.outcome ?? outcome();
    return current?.kind === 'page-unreachable' ? current.miss : undefined;
  };
  const readAgain = (): void => {
    void session.read.start();
  };

  return (
    <section
      data-fdt="runtime-states"
      class="flex min-h-0 flex-1 flex-col gap-2"
      aria-labelledby="runtime-states-title"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="runtime-states-title" class="text-sm font-semibold text-fg-primary">
            {LIVE_STATE_LABEL}
          </h2>
          <p class="text-2xs text-fg-secondary">{LIVE_STATE_HINT}</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          busy={run().pending}
          data-fdt-runtime-read
          onClick={readAgain}
        >
          <Show when={!run().pending}>
            <RefreshCw size={12} aria-hidden="true" />
          </Show>
          Read again
        </Button>
      </div>
      <Show when={session.read.stale()}>
        <p data-fdt-runtime-stale class="text-2xs text-fg-secondary">
          {RUNTIME_STALE_COPY}
        </p>
      </Show>
      <Show when={run().shown === null}>
        <div data-fdt-runtime-loading class="grid grid-cols-1 gap-2">
          <Skeleton class="h-6 w-full" />
          <Skeleton class="h-12 w-full" />
          <Skeleton class="h-12 w-full" />
        </div>
      </Show>
      <Show when={missKind()} keyed>
        {(miss) => {
          const view = describeRuntimeMiss(miss);
          return (
            <OutcomeNotice
              data-fdt="runtime-outcome"
              data-fdt-runtime-miss={miss}
              kind="error"
              title={view.title}
              message={view.message}
            >
              <RecoveryButtons
                recoveries={view.recoveries}
                labels={RUNTIME_RECOVERY_LABELS}
                onRetry={readAgain}
                reloadPage={reloadPage}
                hook="runtime"
              />
            </OutcomeNotice>
          );
        }}
      </Show>
      {/* Not keyed: a re-read swaps the read under a mounted list (S-2). */}
      <Show when={read()}>
        {(current) => (
          <RuntimeList
            read={current()}
            openResource={openResource}
            createVirtualizer={props.createVirtualizer}
            codeBlock={props.codeBlock}
          />
        )}
      </Show>
    </section>
  );
}

/** Props of {@link RuntimeList}. */
interface RuntimeListProps {
  read: Extract<LiveScriptsOutcome, { kind: 'read' }>;
  openResource: OpenResource | null;
  createVirtualizer?: VirtualizerFactory;
  codeBlock?: CodeBlockSeams;
}

/** The list's columns (rows and head share them): the state line, no size. */
const COLUMNS: ListRowColumns = { size: false, states: true };

/**
 * The read's notes and the calm list: Source × State facets, the search,
 * the rows and the selected script's detail.
 *
 * @param props See {@link RuntimeListProps}.
 */
function RuntimeList(props: RuntimeListProps): JSX.Element {
  const rows = createMemo(() => runtimeRows(props.read.scripts, props.read.baseUrl));
  const notes = createMemo(() =>
    [
      truncatedNote({
        truncated: props.read.truncated,
        total: props.read.total,
        listed: props.read.scripts.length
      }),
      outsideFiltersNote(outsideFilterCounts(rows()))
    ].filter((note): note is string => note !== null)
  );

  return (
    <>
      <Show when={notes().length > 0}>
        <div class="flex flex-col gap-0.5">
          <For each={notes()}>
            {(note) => (
              <p data-fdt-runtime-note class="text-2xs text-fg-muted">
                {note}
              </p>
            )}
          </For>
        </div>
      </Show>
      {/* The list reconciles by key: an unchanged script keeps its row, a
          changed one updates its open detail in place (S-2). */}
      <CalmFilteredList
        rows={rows()}
        rowKey={(row) => row.key}
        sameRow={sameRuntimeRow}
        facets={RUNTIME_FACETS}
        searchField={runtimeSearchField}
        noun={SCRIPT_NOUN}
        listLabel="Live scripts"
        searchLabel="Search live scripts"
        searchPlaceholder="Search URLs, IDs, classes and code…"
        rowHook="runtime-row"
        empty={
          <EmptyState
            icon={<FileCode size={16} aria-hidden="true" />}
            title={NO_SCRIPTS_COPY.title}
            description={NO_SCRIPTS_COPY.description}
          />
        }
        head={<ListRowHead columns={COLUMNS} icon name="Script" states="State" />}
        estimateSize={(_row, compact) => calmRowEstimate('two', compact, true)}
        renderRow={(row) => (
          <ListRow
            columns={COLUMNS}
            icon={
              row.script.sourceKind === 'url' ? FileCode : row.script.structuredData ? Braces : Code
            }
            name={row.name}
            preview={row.preview}
            clipped={urlClipped(row.script)}
            stateContent={<RuntimeStateLine script={row.script} row />}
          />
        )}
        detail={{
          kind: runtimeKind,
          title: (row) => row.name,
          copy: runtimeCopy,
          body: (row) => (
            <RuntimeDetail
              row={row}
              openResource={props.openResource}
              codeBlock={props.codeBlock}
            />
          ),
          backLabel: 'Live scripts'
        }}
        createVirtualizer={props.createVirtualizer}
      />
    </>
  );
}
