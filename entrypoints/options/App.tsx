/**
 * The options page: the P9A page model mounted with its real storage IO, its
 * registry-driven section cards, and the two supplemental behaviors the
 * settings surface owns — the appearance choice (persisting instantly so
 * every open surface restyles through their existing storage watches) and the
 * Known Conflicts freshness row.
 *
 * The page is a **writer**: only it and the panel drive the appearance
 * setting; the popup and injected UIs only read. The Save flow is the model's
 * — dirty-gated, busy-guarded, awaiting one write, its typed outcome toasts —
 * with no artificial delay anywhere.
 */
import type { JSX } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';
import { For, Show } from 'solid-js';
import { PageHeader } from '../../components/ui/page-header';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ui/error-state';
import { Toasts } from '../../components/ui/toast';
import { MOTION_REVEAL } from '../../components/ui/classes';
import { toast } from '../../components/ui/toast-store';
import {
  createOptionsPageModel,
  INITIAL_OPTIONS_PAGE_SNAPSHOT,
  type OptionsSaveOutcome,
  type OptionsPageIO,
  type OptionsPageSnapshot
} from '../../lib/options/page-model';
import { isAppearance, type Appearance } from '../../utils/theme';
import { setAppearanceOption } from '../../lib/storage/options';
import { createLogger } from '../../lib/logger';
import { OptionSections, type OptionRowScope } from './sections';
import { KnownConflictsFreshness } from './kc-freshness';

const log = createLogger('options');

/** The save outcome toasts' copy, verbatim. */
const SAVE_SUCCESS_TITLE = 'Options saved';
const SAVE_FAILURE_TITLE = 'Saving the options failed';
const APPEARANCE_WRITE_FAILURE_TITLE = 'The color theme could not be saved';
const APPEARANCE_WRITE_FAILURE_DESCRIPTION = 'The theme choice is kept as unsaved — try Save.';

export interface OptionsPageProps {
  /** The extension's product name, as the manifest declares it (the h1). */
  name: string;
  /** The extension's manifest version (the header's mono chip). */
  version: string;
  /** The page model's IO seams (default: the storage contract). */
  io?: OptionsPageIO;
  /**
   * The appearance writer seam: persists the chosen appearance immediately so
   * every open surface restyles through their existing storage watches.
   * (Default: {@link setAppearanceOption}; rejections never throw here.)
   */
  writeAppearance?: (next: Appearance) => Promise<void>;
}

/**
 * Mount the options page on the page model.
 *
 * The model is the owner of drafts, dirty gating and saves; the page is its
 * view, converting the typed outcomes into toasts (announced exactly once per
 * outcome object) and, for the appearance row, additionally firing the
 * instant-choice write that the live-restyling contract asks for.
 *
 * @param props See {@link OptionsPageProps}.
 */
export function App(props: OptionsPageProps): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<Readonly<OptionsPageSnapshot>>(
    INITIAL_OPTIONS_PAGE_SNAPSHOT
  );
  // One-shot init, not a reactive read: the IO seam is injected once per
  // mounted page (swapping it mid-life is not a supported move — the model
  // owns the storage coupling from here on).
  // eslint-disable-next-line solid/reactivity
  const model = createOptionsPageModel(props.io, setSnapshot);
  void model.load();

  /** The toast announcement guard: one toast per outcome object identity. */
  let announced: OptionsSaveOutcome | null = null;
  createEffect(() => {
    const current = snapshot();
    const outcome = current.status === 'ready' ? current.lastSave : null;
    if (outcome === null || outcome === announced) return;
    announced = outcome;
    if (outcome.ok) {
      toast.success(SAVE_SUCCESS_TITLE, {
        description: outcome.wrote ? undefined : 'No changes to save.'
      });
    } else {
      toast.error(SAVE_FAILURE_TITLE, { description: outcome.message });
    }
  });

  /** The appearance choice's instant write: the failures doom the draft here. */
  const writeAppearance = (next: Appearance): void => {
    const write = props.writeAppearance ?? setAppearanceOption;
    void write(next).catch((cause: unknown) => {
      log.error('The appearance write failed — the choice stays unsaved', cause);
      toast.error(APPEARANCE_WRITE_FAILURE_TITLE, {
        description: APPEARANCE_WRITE_FAILURE_DESCRIPTION
      });
    });
  };

  /**
   * The registry-scope the rows render through (all edits go setOption).
   *
   * The appearance row additionally fires its instant write — but never while
   * a save is in flight: the write is a whole-shape read-modify-write, and
   * reading during the save's window would write the pre-save value back over
   * the just-landing save, silently reverting the saved non-appearance
   * fields. Skipping here keeps the choice drafted (the model still records
   * it and re-dirties the page against the save's baseline); the in-flight
   * save merged the older draft, so the choice lands on the page's next Save
   * — the same unsaved-draft path the appearance-write failure toast teaches.
   */
  const scope: OptionRowScope = {
    read: (row) => {
      const current = snapshot();
      if (current.status !== 'ready') return row.kind === 'appearance' ? 'system' : false;
      return current.draft[row.id] ?? (row.kind === 'appearance' ? 'system' : false);
    },
    edit: (row, value) => {
      const current = snapshot();
      model.setOption(row.id, value);
      // Synchronous, untracked read (an event handler): the save state at
      // click time is what gates the write.
      const saving = current.status === 'ready' && current.saving;
      if (row.kind === 'appearance' && isAppearance(value) && !saving) writeAppearance(value);
    }
  };

  const ready = (): Extract<OptionsPageSnapshot, { status: 'ready' }> | null => {
    const current = snapshot();
    return current.status === 'ready' ? current : null;
  };
  const failedMessage = (): string | null => {
    const current = snapshot();
    return current.status === 'failed' ? current.failure : null;
  };
  const canSave = (): boolean => {
    const current = ready();
    return current !== null && current.dirty && !current.saving;
  };

  return (
    <>
      <main class="fdt-page @container" data-fdt-page="options">
        <div
          data-fdt="options-body"
          class="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 px-3 pb-8 pt-4"
        >
          <PageHeader
            title={props.name}
            subtitle="Options"
            actions={
              <div class="flex items-center gap-1.5">
                <Badge kind="neutral" variant="outline" class="font-mono">
                  v{props.version}
                </Badge>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canSave()}
                  loading={ready()?.saving === true}
                  onClick={() => {
                    void model.save();
                  }}
                >
                  Save
                </Button>
              </div>
            }
          />

          <Show
            when={snapshot().status !== 'loading'}
            fallback={
              <div data-fdt="options-skeleton" class="flex flex-col gap-3">
                <span class="sr-only" role="status">
                  Loading the options
                </span>
                <div class="h-12 rounded-md border border-line-1 bg-surface-1 p-2.5">
                  <Skeleton class="h-3 w-32" />
                  <Skeleton class="mt-2 h-3 w-64" />
                </div>
                <For each={[0, 1, 2]}>
                  {() => (
                    <div
                      aria-hidden="true"
                      class="rounded-md border border-line-1 bg-surface-1 p-2.5"
                    >
                      <Skeleton class="h-3 w-24" />
                      <Skeleton class="mt-3 h-3 w-full" />
                      <Skeleton class="mt-2 h-3 w-full" />
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <Show
              when={snapshot().status === 'ready'}
              fallback={
                <ErrorState
                  title="Couldn't load the options"
                  message={failedMessage() ?? undefined}
                  onRetry={() => {
                    void model.load();
                  }}
                />
              }
            >
              <div data-fdt="options-sections" class={cn(MOTION_REVEAL, 'flex flex-col gap-3')}>
                <OptionSections scope={scope} />
              </div>
            </Show>
            <KnownConflictsFreshness />
          </Show>
        </div>
      </main>
      {/* The toast region mounts outside both fixed-containing-block candidates
          on this page — the animated body's wrapper and the @container page root
          (container-type applies layout containment): either would anchor the
          region's position:fixed to the scrolling content instead of the
          viewport. The mount root has neither transform nor containment, so the
          region floats at the viewport's corner as the toast contract asks. */}
      <Toasts />
    </>
  );
}

/** The entrypoint's default export (WXT html pages and the shell import this). */
export default App;
