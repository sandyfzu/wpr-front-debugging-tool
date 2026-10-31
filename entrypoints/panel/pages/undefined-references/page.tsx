/**
 * The Undefined References page: the names the page's errors reported as
 * undefined, each with where it may be defined, plus a copyable Delay JS
 * exclusion for the script that defines it.
 *
 * State matrix (one body at a time, chosen by `resolvePageView`):
 * - waiting for interaction — Delay JS still holds the scripts;
 * - processing — words exist and the first script read is in flight
 *   (skeletons shaped like the cards; the real wait only, never a timer);
 * - empty — no words (monitoring while the capture may still report some);
 * - results — the word cards; answers stream in as the search reaches them;
 *   when this browser cannot list the page's scripts (feature absent) the
 *   words list unsearched under a notice;
 * - failed — the words list unsearched under the error, with Retry (or, after
 *   an extension reload, the reopen-DevTools remedy).
 *
 * Results and failed share one mounted list, so moving between them (a
 * refetch whose read fails, a rescan) never rebuilds the cards or drops
 * focus. The page owns its store (created per mount, disposed with it).
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
import Info from 'lucide-solid/icons/info';
import MousePointerClick from 'lucide-solid/icons/mouse-pointer-click';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import ScanSearch from 'lucide-solid/icons/scan-search';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { EmptyState } from '../../../../components/ui/empty-state';
import { MOTION_REVEAL } from '../../../../components/ui/classes';
import { Skeleton } from '../../../../components/ui/skeleton';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { toast } from '../../../../components/ui/toast-store';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';
import { runtimeOnPage } from '../../../../lib/detection/simulation-fact';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { realInspectedScripts, type InspectedScripts } from './inspected-scripts';
import {
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
import { WordCard } from './word-card';

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
}

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
            inlineCut={() => loaded()?.wprDetections.delay_js.truncated === true}
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

/** The processing body: two skeleton cards in the word card's shape. */
function ProcessingState(): JSX.Element {
  return (
    <div data-fdt="undefined-refs-processing" aria-busy="true" class="flex w-full flex-col gap-2">
      <p class="text-2xs text-fg-secondary">Reading the page's scripts…</p>
      <For each={[0, 1]}>{() => <SkeletonCard />}</For>
    </div>
  );
}

/** One placeholder card: badge · word · verdict, then two definition lines. */
function SkeletonCard(): JSX.Element {
  return (
    <Card
      header={
        <div class="flex w-full items-center gap-1.5">
          <Skeleton class="h-4 w-16" />
          <Skeleton class="h-3.5 w-24" />
          <Skeleton class="ms-auto h-3 w-16" />
        </div>
      }
    >
      <div class="flex flex-col gap-2">
        <Skeleton class="h-3.5 w-full" />
        <Skeleton class="h-3.5 w-3/4" />
      </div>
    </Card>
  );
}

/** Props of {@link WordsState}. */
interface WordsStateProps {
  /** The page store. */
  store: UndefinedReferencesStore;
  /**
   * The capture cut the page's inline scripts to its size caps (the Delay JS
   * row arrived marked truncated): the inline search saw only part of them.
   */
  inlineCut: () => boolean;
}

/**
 * The listed words — the results, or the failure's unsearched list under its
 * notice. A plain keyed list, not a virtual one: the capture caps a page at
 * 50 words, so every card renders at once and keeps its DOM (and focus)
 * across pushes, answers and refetches. Its first paint fades in once (the
 * container's insert), never per card.
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
  return (
    <div data-fdt="undefined-refs-results" class={cn('flex w-full flex-col gap-2', MOTION_REVEAL)}>
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
      <ul aria-label="Undefined references" class="flex flex-col gap-2">
        <For each={props.store.words()}>
          {(word) => (
            <li>
              <WordCard
                word={word}
                answer={props.store.answerOf(word)}
                pageOrigin={props.store.pageOrigin()}
                unreadable={props.store.unreadableScripts()}
                inlineCut={props.inlineCut()}
              />
            </li>
          )}
        </For>
      </ul>
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
