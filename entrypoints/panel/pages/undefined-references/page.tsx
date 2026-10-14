/**
 * The Undefined References page: the names the page's errors reported as
 * undefined, each with where it may be defined, plus the bridge to the
 * Exclusion Builder for the usual Delay JS fix.
 *
 * State matrix (one body at a time, chosen by `resolvePageView`):
 * - waiting for interaction — Delay JS still holds the scripts;
 * - processing — words exist and the first script read is in flight
 *   (skeletons shaped like the cards; the real wait only, never a timer);
 * - failed — the script read failed, Retry reads again;
 * - empty — no words (monitoring while the capture may still report some);
 * - results — the word cards; when this browser cannot list the page's
 *   scripts (feature absent) the cards say so instead of searching.
 *
 * The page owns its store (created per mount, disposed with it). Pushes of
 * new words append cards in arrival order without touching existing ones
 * (keyed by word), and the status line announces them once, politely.
 */
import type { JSX } from 'solid-js';
import { For, Match, Show, Switch, createMemo } from 'solid-js';
import CircleCheck from 'lucide-solid/icons/circle-check';
import Info from 'lucide-solid/icons/info';
import MousePointerClick from 'lucide-solid/icons/mouse-pointer-click';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import ScanSearch from 'lucide-solid/icons/scan-search';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { MOTION_REVEAL } from '../../../../components/ui/classes';
import { Skeleton } from '../../../../components/ui/skeleton';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { toast } from '../../../../components/ui/toast-store';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { realScriptLoader, type ScriptLoader } from './inspected-scripts';
import { scanFailureMessage, summarizeResults, type ScanFailure } from './model';
import {
  createUndefinedReferencesStore,
  type UndefinedReferencesDeps,
  type UndefinedReferencesStore
} from './store';
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

/** Props of {@link UndefinedReferencesPage} — test seams only; production passes none. */
export interface UndefinedReferencesPageProps {
  /** Override the store's effects (script loader, timers, search). */
  deps?: Partial<UndefinedReferencesDeps>;
  /** Override the copy action of every definition row. */
  onCopy?: (url: string) => void;
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
   * Which page the data describes: the stamp of the latest settled fetch. A
   * refresh in flight keeps the previous key (its data is still the old
   * page's); pushes keep it too (same page, patched fields).
   */
  const pageKey = createMemo((previous: number): number => {
    const state = data.state();
    return state.status === 'ready' ? state.fetchedAt : previous;
  }, -1);

  // Deps are settled once per mount — a test seam, never reactive.
  // eslint-disable-next-line solid/reactivity
  const overrides = props.deps;
  const loader: ScriptLoader | null =
    overrides?.loadScripts !== undefined ? overrides.loadScripts : realScriptLoader();

  const store = createUndefinedReferencesStore(
    {
      delayJsPresent: () => loaded()?.wprDetections.delay_js.present ?? false,
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
      loadScripts: loader
    }
  );

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
            return view.kind === 'failed' ? view : null;
          })()}
        >
          {(view) => (
            <CenteredState>
              <ErrorState
                title="Couldn't read the page's scripts"
                message={scanFailureMessage(view().failure)}
                onRetry={() => {
                  store.retry();
                }}
              />
            </CenteredState>
          )}
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
        <Match
          when={(() => {
            const view = store.view();
            return view.kind === 'results' ? view : null;
          })()}
        >
          {(view) => (
            <ResultsState store={store} searched={view().searched} onCopy={props.onCopy} />
          )}
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
    <div data-fdt="undefined-refs-processing" aria-busy="true" class="flex flex-col gap-2">
      <p class="text-2xs text-fg-secondary">Searching the page's scripts for definitions…</p>
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
        <Skeleton class="h-3 w-20" />
        <Skeleton class="h-3.5 w-full" />
        <Skeleton class="h-3.5 w-3/4" />
      </div>
    </Card>
  );
}

/** Props of {@link ResultsState}. */
interface ResultsStateProps {
  /** The page store. */
  store: UndefinedReferencesStore;
  /** Whether a definition search ran (false: feature absent in this browser). */
  searched: boolean;
  /** Copy override for the rows (tests). */
  onCopy?: (url: string) => void;
}

/**
 * The results body: summary + rescan, then one card per word. A plain keyed
 * list, not a virtual one — the capture caps a page at 50 words, so every
 * card renders at once and keeps its DOM (and focus) across pushes. Its first
 * paint fades in once (the container's insert), never per card.
 *
 * @param props See {@link ResultsStateProps}.
 */
function ResultsState(props: ResultsStateProps): JSX.Element {
  const summary = createMemo(() =>
    summarizeResults(props.store.words(), (word) => props.store.definitionsOf(word))
  );
  return (
    <div data-fdt="undefined-refs-results" class={cn('flex flex-col gap-2', MOTION_REVEAL)}>
      <Show when={!props.searched}>
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
          <span class="font-medium text-fg-primary">{summary().total}</span>{' '}
          {summary().total === 1 ? 'undefined reference' : 'undefined references'}
          <Show when={props.searched}>
            {' · '}
            <span class="font-medium text-fg-primary">{summary().withDefinition}</span> with a
            possible definition
          </Show>
        </p>
        <Show when={props.searched}>
          {/* Busy shows as text, not `loading`: that disables the button,
              which would drop keyboard focus mid-rescan. A click while busy
              is a no-op (the store dedupes). */}
          <Button
            variant="ghost"
            size="sm"
            class="shrink-0"
            aria-busy={props.store.rescanning() || undefined}
            title="Read the page's scripts again (for scripts added since the last read)"
            data-fdt="undefined-refs-rescan"
            onClick={() => {
              props.store.rescan();
            }}
          >
            <RefreshCw size={14} class="shrink-0" aria-hidden="true" />
            <span class="@max-regular:sr-only">
              {props.store.rescanning() ? 'Rescanning…' : 'Rescan'}
            </span>
          </Button>
        </Show>
      </div>
      <ul aria-label="Undefined references" class="flex flex-col gap-2">
        <For each={props.store.words()}>
          {(word) => (
            <li>
              <WordCard
                word={word}
                definitions={props.store.definitionsOf(word)}
                onCopy={props.onCopy}
              />
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
