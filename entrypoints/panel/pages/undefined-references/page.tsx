/**
 * The Undefined References page: the names the page's errors reported as
 * undefined, as one calm list (name, how many scripts may define it, where),
 * each row opening its detail — the possible definitions as source-link
 * tiles with a copyable Delay JS exclusion (side pane from the split width,
 * drill-in below it).
 *
 * State matrix (one body at a time, chosen by `resolvePageView`):
 * - waiting for interaction — Delay JS still holds the scripts;
 * - processing — words exist and the first script read is in flight
 *   (skeleton rows shaped like the list's; the real wait only, never a timer);
 * - empty — no words (monitoring while the capture may still report some);
 * - results — the word rows; answers stream in as the search reaches them;
 *   when this browser cannot list the page's scripts (feature absent) the
 *   words list unsearched under a notice;
 * - failed — the words list unsearched under the error, with Retry (or, after
 *   an extension reload, the reopen-DevTools remedy).
 *
 * Results and failed share one mounted list, so moving between them (a
 * refetch whose read fails, a rescan) never rebuilds the rows, the selection
 * or focus. The list joins the panel's search/find protocol (the words are
 * searched by name). The page owns its store (created per mount, disposed
 * with it).
 */
import type { JSX } from 'solid-js';
import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup
} from 'solid-js';
import Check from 'lucide-solid/icons/check';
import CircleCheck from 'lucide-solid/icons/circle-check';
import EyeOff from 'lucide-solid/icons/eye-off';
import Info from 'lucide-solid/icons/info';
import MousePointerClick from 'lucide-solid/icons/mouse-pointer-click';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import ScanSearch from 'lucide-solid/icons/scan-search';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import Variable from 'lucide-solid/icons/variable';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { EmptyState } from '../../../../components/ui/empty-state';
import { MOTION_REVEAL } from '../../../../components/ui/classes';
import { Skeleton } from '../../../../components/ui/skeleton';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { toast } from '../../../../components/ui/toast-store';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';
import { runtimeOnPage } from '../../../../lib/detection/simulation-fact';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { inlineScriptsCut } from '../javascript/capture-bounds';
import { cn } from '../../../../utils/cn';
import { useFdtData } from '../../state/use-fdt-data';
import { openResourceCapability, type OpenResource } from '../open-resource';
import { PageFrame } from '../page-frame';
import { CalmFilteredList } from '../resource-list/calm-list';
import {
  calmRowClass,
  calmRowEstimate,
  ListRow,
  ListRowHead,
  type ListRowColumns
} from '../resource-list/list-row';
import { realInspectedScripts, type InspectedScripts } from './inspected-scripts';
import {
  UNDEFINED_REFERENCE_NOUN,
  displayWord,
  isCrossOriginSentinel,
  isRetryable,
  scanFailureMessage,
  summarizeResults,
  summaryFacts,
  type SummaryFact,
  type ScanFailure
} from './model';
import {
  createUndefinedReferencesStore,
  type UndefinedReferencesDeps,
  type UndefinedReferencesStore
} from './store';
import { COPIED_FLASH_MS } from '../../../../components/ui/copy-flash';
import { WordDetail } from './word-detail';
import {
  WORD_LIST,
  wordDefinitionCount,
  wordKind,
  wordPreview,
  wordRow,
  wordRowView,
  type WordRow,
  type WordRowView
} from './word-view';

/** The page title (the route's nav label). */
const TITLE = 'Undefined References';

/** The one-line "what am I looking at". */
const SUBTITLE = 'Missing names from page errors, and where they may be defined';

/** The waiting state's sentence: why nothing can be reported yet, and what unblocks it. */
export const WAITING_DESCRIPTION = `${LABEL_DELAY_JAVASCRIPT_EXECUTION} holds the page's scripts until the first interaction — click or scroll the inspected page.`;

/** The empty state's sentence while the capture may still report words. */
export const MONITORING_DESCRIPTION =
  'Monitoring — any that occur while the page runs appear here.';

/** The empty state's sentence once every held script ran. */
export const SETTLED_DESCRIPTION = "The page's scripts ran without an undefined reference.";

/** The feature-absent notice above unsearched results. */
export const UNSEARCHED_NOTICE =
  "This browser can't list the inspected page's scripts, so no definition search runs. The names come straight from the page's errors.";

/** The failure notice's title. */
export const FAILED_TITLE = "Couldn't read the page's scripts";

/** The failure notice's second sentence: what the list below still is. */
export const FAILED_WORDS_NOTE =
  "The names below come straight from the page's errors, unsearched.";

/** The stale-read hint beside the summary. */
export const STALE_NOTE = 'New scripts loaded since the last read.';

/** Props of {@link UndefinedReferencesPage} — test seams only; production passes none. */
export interface UndefinedReferencesPageProps {
  /** Override the store's effects (inspected-window reader, timers, search pacing). */
  deps?: Partial<UndefinedReferencesDeps>;
  /** The list's virtualizer seam (default: the list's own; tests inject a double). */
  createVirtualizer?: VirtualizerFactory;
  /** "Open in Sources" seam (`null`: none); production detects DevTools' own. */
  openResource?: OpenResource | null;
}

/** The list's optional columns (rows and head share them): the definition count, no chips. */
const COLUMNS: ListRowColumns = { size: true, states: false };

/** A stable empty list, so absent data never re-triggers the word memo. */
const NO_WORDS: readonly string[] = [];

/**
 * The page body for the `undefined-references` route.
 *
 * @param props Test seams (see {@link UndefinedReferencesPageProps}).
 */
export function UndefinedReferencesPage(props: UndefinedReferencesPageProps): JSX.Element {
  const data = useFdtData();

  /** The loaded page data (the shell renders pages only while it exists). */
  const loaded = createMemo((): FdtData | null => {
    const state = data.state();
    return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  });

  /**
   * Which fetch the data comes from: the stamp of the latest settled fetch. A
   * refresh in flight keeps the previous key (its data is still the old
   * fetch's); pushes keep it too (same fetch, patched fields).
   */
  const pageKey = createMemo((previous: number): number => {
    const state = data.state();
    return state.status === 'ready' ? state.fetchedAt : previous;
  }, -1);

  // Deps are settled once per mount — a test seam, never reactive.
  // eslint-disable-next-line solid/reactivity
  const overrides = props.deps;
  const inspected: InspectedScripts | null =
    overrides?.inspected !== undefined ? overrides.inspected : realInspectedScripts();

  const store = createUndefinedReferencesStore(
    {
      delayJsPresent: () => {
        const row = loaded()?.wprDetections.delay_js;
        return row !== undefined && runtimeOnPage(row);
      },
      allScriptsLoaded: () => loaded()?.allScriptsLoaded ?? false,
      words: () => loaded()?.undefinedReferencesOnPage ?? NO_WORDS,
      inlineScripts: () => loaded()?.wprDetections.delay_js.scripts ?? [],
      pageKey
    },
    {
      onRescanFailed: (failure: ScanFailure) => {
        toast.error("Couldn't rescan the page's scripts", {
          description: `${scanFailureMessage(failure)} The previous results stay listed.`
        });
      },
      ...overrides,
      inspected
    }
  );

  const openResource =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the seam is fixed per page
    props.openResource === undefined ? openResourceCapability(browser) : props.openResource;

  const listed = (): boolean => {
    const kind = store.view().kind;
    return kind === 'results' || kind === 'failed';
  };

  return (
    <PageFrame id="undefined-references" title={TITLE} subtitle={SUBTITLE} fill>
      {/* Mounted for the page's life so later arrivals are announced. The
          alternating no-break space makes an identical sentence a new one. */}
      <p role="status" class="sr-only" data-fdt="undefined-refs-status">
        {store.announcement().text}
        {store.announcement().seq % 2 === 1 ? ' ' : ''}
      </p>
      <Switch>
        <Match when={store.view().kind === 'waiting-interaction'}>
          <CenteredState>
            <EmptyState
              icon={<MousePointerClick size={16} aria-hidden="true" />}
              title="Waiting for page interaction"
              description={WAITING_DESCRIPTION}
            />
          </CenteredState>
        </Match>
        <Match when={store.view().kind === 'processing'}>
          <ProcessingState />
        </Match>
        <Match
          when={(() => {
            const view = store.view();
            return view.kind === 'empty' ? view : null;
          })()}
        >
          {(view) => (
            <CenteredState>
              <EmptyState
                icon={
                  view().monitoring ? (
                    <ScanSearch size={16} aria-hidden="true" />
                  ) : (
                    <CircleCheck size={16} aria-hidden="true" />
                  )
                }
                title="No undefined references detected"
                description={view().monitoring ? MONITORING_DESCRIPTION : SETTLED_DESCRIPTION}
              />
            </CenteredState>
          )}
        </Match>
        <Match when={listed()}>
          <WordsState
            store={store}
            inlineCut={() => {
              const delayJs = loaded()?.wprDetections.delay_js;
              return delayJs !== undefined && inlineScriptsCut(delayJs);
            }}
            openResource={openResource}
            createVirtualizer={props.createVirtualizer}
          />
        </Match>
      </Switch>
    </PageFrame>
  );
}

/**
 * Center a one-message state in the frame's remaining height (the frame is
 * a full-height column in fill mode).
 *
 * @param props.children The state view.
 */
function CenteredState(props: { children: JSX.Element }): JSX.Element {
  return <div class="flex flex-1 flex-col justify-center pb-8">{props.children}</div>;
}

/** The processing body: two skeleton rows in the list's calm row shape. */
function ProcessingState(): JSX.Element {
  return (
    <div data-fdt="undefined-refs-processing" aria-busy="true" class="flex w-full flex-col gap-1">
      <p class="mb-2 text-2xs text-fg-secondary">Reading the page's scripts…</p>
      <For each={[0, 1]}>{() => <SkeletonRow />}</For>
    </div>
  );
}

/** The skeleton row's surface: the list's own two-line row geometry, at rest. */
const SKELETON_ROW_CLASS = cn(
  calmRowClass({ lines: 'two', interactive: false, selected: false, current: false }),
  'gap-3.5'
);

/** One placeholder row: icon tile, name and preview lines, the count. */
function SkeletonRow(): JSX.Element {
  return (
    <div data-fdt="skeleton-row" class={SKELETON_ROW_CLASS}>
      <Skeleton class="size-8 shrink-0 rounded-lg" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton class="h-3.5 w-28" />
        <Skeleton class="h-3 w-48 max-w-full" />
      </div>
      <Skeleton class="h-3 w-6 shrink-0" />
    </div>
  );
}

/** Props of {@link WordsState}. */
interface WordsStateProps {
  /** The page store. */
  store: UndefinedReferencesStore;
  /**
   * The capture cut the page's inline script text to its size caps (list
   * entries or text lost, never just another field clipped): the inline
   * search saw only part of them.
   */
  inlineCut: () => boolean;
  /** DevTools' "Open in Sources", or `null` (the detail's tiles open a new tab). */
  openResource: OpenResource | null;
  /** The list's virtualizer seam (tests). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * The listed words — the results, or the failure's unsearched list under its
 * notice — as the calm list with its detail. Rows are the words alone (one
 * object per word for the list's life, reconciled by word); each row's cells
 * and the detail read the word's answer live ({@link WordRowView}), so a row's
 * DOM, focus and open detail survive pushes, streaming answers, refetches and
 * failures. The body's first paint fades in once (the container's insert),
 * never per row.
 *
 * @param props See {@link WordsStateProps}.
 */
function WordsState(props: WordsStateProps): JSX.Element {
  const failure = (): ScanFailure | null => {
    const view = props.store.view();
    return view.kind === 'failed' ? view.failure : null;
  };
  const searched = (): boolean => {
    const view = props.store.view();
    return view.kind === 'results' && view.searched;
  };
  const unsupported = (): boolean => {
    const view = props.store.view();
    return view.kind === 'results' && !view.searched;
  };
  const summary = createMemo(() =>
    summarizeResults(props.store.words(), (word) => props.store.answerOf(word))
  );
  const rows = createMemo((): readonly WordRow[] => props.store.words().map(wordRow));
  /**
   * A word's current view (read live by its row cells and the detail).
   *
   * @param word The word.
   */
  const viewOf = (word: string): WordRowView =>
    wordRowView(
      word,
      props.store.answerOf(word),
      props.store.unreadableScripts(),
      props.inlineCut()
    );
  return (
    <div
      data-fdt="undefined-refs-results"
      class={cn('flex min-h-0 w-full flex-1 flex-col gap-3', MOTION_REVEAL)}
    >
      <Show when={failure()}>
        {(kind) => <FailureNotice failure={kind()} store={props.store} />}
      </Show>
      <Show when={unsupported()}>
        <Card>
          <p class="flex items-start gap-1.5 text-2xs leading-snug text-fg-secondary">
            <Info
              size={12}
              class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES.info)}
              aria-hidden="true"
            />
            {UNSEARCHED_NOTICE}
          </p>
        </Card>
      </Show>
      <div class="flex min-h-6 items-center gap-3">
        <p
          data-fdt="undefined-refs-summary"
          class="min-w-0 flex-1 text-2xs text-fg-secondary tabular-nums"
        >
          <SummaryText
            facts={summaryFacts(
              summary(),
              searched(),
              props.store.unreadableScripts(),
              props.inlineCut()
            )}
          />
          <Show when={searched() && props.store.staleScripts()}>
            {' '}
            <span data-fdt="undefined-refs-stale" class="text-fg-primary">
              {STALE_NOTE}
            </span>
          </Show>
        </p>
        <Show when={searched()}>
          <RescanButton store={props.store} />
        </Show>
      </div>
      <CalmFilteredList
        variant="calm"
        rows={rows()}
        rowKey={(row) => row.key}
        // A row is its word: the same word is the same row (its answer is read live).
        sameRow={(a, b) => a.word === b.word}
        definition={WORD_LIST}
        noun={UNDEFINED_REFERENCE_NOUN}
        listLabel="Undefined references"
        searchLabel="Search undefined references"
        searchPlaceholder="Search names…"
        rowHook="word-row"
        empty={
          <EmptyState
            icon={<CircleCheck size={16} aria-hidden="true" />}
            title="No undefined references detected"
          />
        }
        head={<ListRowHead columns={COLUMNS} icon name="Name" size="Scripts" />}
        estimateSize={(_view, compact) => calmRowEstimate('two', compact, false)}
        renderRow={(row) => {
          const view = createMemo(() => viewOf(row.word));
          return (
            <ListRow
              columns={COLUMNS}
              icon={isCrossOriginSentinel(row.word) ? EyeOff : Variable}
              name={displayWord(row.word)}
              mono={!isCrossOriginSentinel(row.word)}
              preview={wordPreview(view(), props.store.pageOrigin())}
              size={wordDefinitionCount(view())}
            />
          );
        }}
        detail={{
          kind: wordKind,
          title: (row) => displayWord(row.word),
          body: (row) => (
            <WordDetail
              view={() => viewOf(row().word)}
              pageOrigin={props.store.pageOrigin}
              unreadable={props.store.unreadableScripts}
              inlineCut={props.inlineCut}
              openResource={props.openResource}
            />
          ),
          // Short on purpose: the drill bar (Back · ↑/↓ · "n of m") fits the 320 px floor.
          backLabel: 'References'
        }}
        createVirtualizer={props.createVirtualizer}
      />
    </div>
  );
}

/**
 * The summary line: one non-breaking fact per {@link summaryFacts} entry,
 * joined by `·` — on a narrow panel the line breaks between facts, never
 * inside one (no lone trailing word).
 *
 * @param props.facts The facts.
 */
function SummaryText(props: { facts: readonly SummaryFact[] }): JSX.Element {
  return (
    <For each={props.facts}>
      {(fact, index) => (
        <>
          {index() > 0 ? ' · ' : ''}
          <span class="whitespace-nowrap">
            <Show when={fact.count !== undefined}>
              <span class="font-medium text-fg-primary">{fact.count}</span>{' '}
            </Show>
            {fact.label}
          </span>
        </>
      )}
    </For>
  );
}

/**
 * The read-failure notice above the unsearched words: the cause, and Retry
 * when this panel can recover (after an extension reload only reopening
 * DevTools can, so the message says that instead). Retry swaps the list for
 * the processing body, so the focused Retry hands focus to the page's `h1`
 * as it unmounts — never to `<body>`.
 *
 * @param props.failure The failure.
 * @param props.store The page store.
 */
function FailureNotice(props: {
  failure: ScanFailure;
  store: UndefinedReferencesStore;
}): JSX.Element {
  let retryButton: HTMLButtonElement | undefined;
  onCleanup(() => {
    if (!retryButton || document.activeElement !== retryButton) return;
    retryButton.closest('[data-fdt-page]')?.querySelector<HTMLElement>('h1')?.focus();
  });
  return (
    <Card>
      {/* Wraps: Retry sits beside the message when it has ~14rem, else below
          it, aligned with the text — the title never squeezes against it. */}
      <div
        data-fdt="undefined-refs-failure"
        role="alert"
        class="flex flex-wrap items-start gap-x-2 gap-y-2"
      >
        <div class="flex min-w-0 flex-1 basis-56 items-start gap-2">
          <TriangleAlert
            size={14}
            class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES.error)}
            aria-hidden="true"
          />
          <div class="flex min-w-0 flex-col gap-0.5">
            <p class="text-xs font-medium text-fg-primary">{FAILED_TITLE}</p>
            <p class="text-2xs leading-snug text-fg-secondary">
              {scanFailureMessage(props.failure)} {FAILED_WORDS_NOTE}
            </p>
          </div>
        </div>
        <Show when={isRetryable(props.failure)}>
          <Button
            ref={retryButton}
            variant="secondary"
            size="sm"
            class="ms-5.5 shrink-0"
            onClick={() => {
              props.store.retry();
            }}
          >
            Retry
          </Button>
        </Show>
      </div>
    </Card>
  );
}

/**
 * The rescan control: icon-only below the regular tier at rest, but its
 * label shows at every width while it works ("Rescanning…") and briefly once
 * it is done ("Rescanned"), so the busy/done feedback is never hidden. It
 * never disables (a disabled button drops keyboard focus); a click while
 * busy is a no-op. It turns secondary when scripts loaded after the read.
 *
 * @param props.store The page store.
 */
function RescanButton(props: { store: UndefinedReferencesStore }): JSX.Element {
  const [done, setDone] = createSignal(false);
  let resetDone: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(resetDone);
  });
  createEffect(
    on(
      () => props.store.rescansDone(),
      () => {
        setDone(true);
        clearTimeout(resetDone);
        resetDone = setTimeout(() => setDone(false), COPIED_FLASH_MS);
      },
      { defer: true }
    )
  );
  const label = (): string =>
    props.store.rescanning() ? 'Rescanning…' : done() ? 'Rescanned' : 'Rescan';
  const showLabel = (): boolean => props.store.rescanning() || done();
  return (
    <Button
      variant={props.store.staleScripts() ? 'secondary' : 'ghost'}
      size="sm"
      class="shrink-0"
      aria-busy={props.store.rescanning() || undefined}
      title="Read the page's scripts again (for scripts added since the last read)"
      data-fdt="undefined-refs-rescan"
      onClick={() => {
        setDone(false);
        props.store.rescan();
      }}
    >
      <Show
        when={done() && !props.store.rescanning()}
        fallback={<RefreshCw size={14} class="shrink-0" aria-hidden="true" />}
      >
        <Check size={14} class={cn('shrink-0', STATUS_TEXT_CLASSES.ok)} aria-hidden="true" />
      </Show>
      <span class={cn(!showLabel() && '@max-regular:sr-only')}>{label()}</span>
    </Button>
  );
}
