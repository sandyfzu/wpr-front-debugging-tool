/**
 * The JavaScript page's Runtime states section: every `<script>` on the
 * inspected page as it is now (the live DOM — not the snapshot detection
 * parsed), each with its Delay JS state (executed, failed, skipped,
 * pending, not delayed), source group (theme, plugins, inline, other), id,
 * classes and code. Loaded on first show (its own chunk).
 *
 * State matrix: first read pending → skeleton rows · page-unreachable (per
 * miss, with recoveries) · read: empty (no scripts) / source-empty (the
 * chosen group has none now, with the way back) / filtered-empty (the
 * shared `NoMatches`) / populated (notes for a cut list and for scripts no
 * state chip covers) · re-reading (the shown read stays, Read again busy) ·
 * stale once the page reloaded (a show re-reads; while shown, a note).
 *
 * A re-read keeps the view mounted (S-2): source and state chips, query,
 * scroll and the open details of rows that did not change.
 */
import type { JSX } from 'solid-js';
import {
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch
} from 'solid-js';
import FileCode from 'lucide-solid/icons/file-code';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { Button } from '../../../../components/ui/button';
import { EmptyState } from '../../../../components/ui/empty-state';
import { FilterBar, type FilterChip } from '../../../../components/ui/filter-bar';
import { Skeleton } from '../../../../components/ui/skeleton';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { SCRIPT_NOUN } from '../../../../lib/detection/count-nouns';
import {
  describeRuntimeMiss,
  LIVE_STATE_HINT,
  LIVE_STATE_LABEL,
  NO_SCRIPTS_COPY,
  outsideFiltersNote,
  RUNTIME_GROUP_EMPTY_TITLES,
  RUNTIME_GROUP_LABELS,
  RUNTIME_STALE_COPY,
  truncatedNote,
  type RuntimeRecovery
} from '../../../../lib/script-runtime/outcome-view';
import type { ScriptGroup } from '../../../../lib/script-runtime/classify';
import type { LiveScriptsOutcome } from '../../../../lib/script-runtime/read-live';
import { useFdtData } from '../../state/use-fdt-data';
import { OutcomeNotice } from '../outcome-notice';
import { RecoveryButtons } from '../recovery-buttons';
import { inspectedReloadAction } from '../reload-inspected';
import { FilteredList } from '../resource-list/filtered-list';
import { reconcileRows } from '../resource-list/resource-list-view';
import { RuntimeScriptRow } from './runtime-row';
import { realRuntimeStatesDeps } from './runtime-real-deps';
import {
  estimateRuntimeRow,
  groupCounts,
  outsideFilterCounts,
  RUNTIME_GROUPS,
  RUNTIME_STATE_LIST,
  rowsOfSource,
  runtimeRows,
  sameRuntimeRow,
  type RuntimeRow,
  type RuntimeSourceFilter
} from './runtime-rows';
import { createRuntimeStatesSession, type RuntimeStatesSession } from './runtime-session';
import type { CodeBlockSeams } from './script-row';
import { pruneKeyedFlags, toggleRowFlag } from './script-view';

/** The recoveries' button labels. */
export const RUNTIME_RECOVERY_LABELS: Readonly<Record<RuntimeRecovery, string>> = {
  retry: 'Read again',
  'reload-page': 'Reload page'
};

/** The source chips' "every group" label. */
export const ALL_SOURCES_LABEL = 'All sources';

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
  /* eslint-enable solid/reactivity */
  session.ensure();

  const run = () => session.read.state();
  const outcome = () => run().shown?.outcome;
  /** The read, when the page answered. */
  const read = () => {
    const current = outcome();
    return current?.kind === 'read' ? current : undefined;
  };
  /** How the read missed the page, when it did. */
  const missKind = () => {
    const current = outcome();
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
      <Switch>
        <Match when={run().shown === null}>
          <div data-fdt-runtime-loading class="grid grid-cols-1 gap-2">
            <Skeleton class="h-6 w-full" />
            <Skeleton class="h-12 w-full" />
            <Skeleton class="h-12 w-full" />
          </div>
        </Match>
        <Match when={missKind()} keyed>
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
        </Match>
        {/* Not keyed: a re-read swaps the read under a mounted list (S-2). */}
        <Match when={read()}>
          {(current) => (
            <RuntimeList
              read={current()}
              createVirtualizer={props.createVirtualizer}
              codeBlock={props.codeBlock}
            />
          )}
        </Match>
      </Switch>
    </section>
  );
}

/** Props of {@link RuntimeList}. */
interface RuntimeListProps {
  read: Extract<LiveScriptsOutcome, { kind: 'read' }>;
  createVirtualizer?: VirtualizerFactory;
  codeBlock?: CodeBlockSeams;
}

/**
 * The source chips, the read's notes and the state-filtered list.
 *
 * @param props See {@link RuntimeListProps}.
 */
function RuntimeList(props: RuntimeListProps): JSX.Element {
  // Reconciled here (not only in the list), so open details follow identity.
  const rows = createMemo(
    (previous: readonly RuntimeRow[]) =>
      reconcileRows(previous, runtimeRows(props.read.scripts), sameRuntimeRow),
    []
  );
  const [source, setSource] = createSignal<RuntimeSourceFilter>('all');
  const sourceRows = createMemo(() => rowsOfSource(rows(), source()));
  /** The chosen group, or undefined for every source. */
  const chosenGroup = (): ScriptGroup | undefined => {
    const current = source();
    return current === 'all' ? undefined : current;
  };
  const counts = createMemo(() => groupCounts(rows()));
  const sourceChips = createMemo((): FilterChip[] => [
    { value: 'all', label: ALL_SOURCES_LABEL, count: rows().length },
    ...RUNTIME_GROUPS.map((group) => ({
      value: group,
      label: RUNTIME_GROUP_LABELS[group],
      count: counts()[group],
      // An empty group cannot be chosen — unless it is the chosen one (it emptied on a re-read).
      disabled: counts()[group] === 0 && source() !== group
    }))
  ]);
  const notes = createMemo(() =>
    [
      truncatedNote({
        truncated: props.read.truncated,
        total: props.read.total,
        listed: props.read.scripts.length
      }),
      outsideFiltersNote(outsideFilterCounts(sourceRows()))
    ].filter((note): note is string => note !== null)
  );

  // Open details live here, keyed by row id; a re-read that changed or
  // removed a row closes it (another script must not open expanded).
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set());
  createComputed(
    on(rows, (current, previous) => {
      if (previous === undefined) return;
      setExpanded((ids) => pruneKeyedFlags(ids, previous, current, (row) => row.id));
    })
  );

  return (
    <>
      <Show when={rows().length > 0}>
        <FilterBar
          chips={sourceChips()}
          selected={source()}
          onSelect={(value) => {
            // Chip values are this bar's own ids.
            setSource(() => value as RuntimeSourceFilter);
          }}
          filterLabel="Filter by source"
          showSearch={false}
          data-fdt-runtime-sources
        />
      </Show>
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
      <FilteredList
        definition={RUNTIME_STATE_LIST}
        rows={sourceRows()}
        sameRow={sameRuntimeRow}
        empty={
          <Show
            when={chosenGroup()}
            fallback={
              <EmptyState
                icon={<FileCode size={16} aria-hidden="true" />}
                title={NO_SCRIPTS_COPY.title}
                description={NO_SCRIPTS_COPY.description}
              />
            }
          >
            {(group) => (
              <EmptyState
                icon={<FileCode size={16} aria-hidden="true" />}
                title={RUNTIME_GROUP_EMPTY_TITLES[group()]}
                description="The last read found none from this source."
                action={
                  <Button size="sm" variant="primary" onClick={() => setSource('all')}>
                    Show all sources
                  </Button>
                }
              />
            )}
          </Show>
        }
        noun={SCRIPT_NOUN}
        listLabel="Live scripts"
        searchLabel="Search live scripts"
        searchPlaceholder="Search URLs, IDs, classes and code…"
        estimateSize={(row) => estimateRuntimeRow(row, expanded().has(row.id))}
        renderRow={(row) => (
          <RuntimeScriptRow
            row={row}
            expanded={expanded().has(row.id)}
            onToggle={() => setExpanded((ids) => toggleRowFlag(ids, row.id))}
            codeBlock={props.codeBlock}
          />
        )}
        rowHook="runtime-row"
        createVirtualizer={props.createVirtualizer}
      />
    </>
  );
}
