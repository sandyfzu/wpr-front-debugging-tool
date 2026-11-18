/**
 * The options page: the P9A page model mounted with its real storage IO, its
 * registry-driven section cards, and the supplemental behaviors the settings
 * surface owns — the appearance choice (persisting instantly so every open
 * surface restyles through their existing storage watches), the instant rows
 * (the on-page UI gate and the palette shortcut, each over its own storage
 * item, outside the draft) and the Known Conflicts freshness row.
 *
 * The page is a **writer**: only it and the panel drive the appearance
 * setting; injected UIs only read. The Save flow is the model's
 * — dirty-gated, busy-guarded, awaiting one write, its typed outcome toasts —
 * with no artificial delay anywhere.
 */
import type { JSX } from 'solid-js';
import { createEffect, createSignal, onCleanup } from 'solid-js';
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
import { capitalize } from '../../utils/text';
import { isAppearance, type Appearance } from '../../utils/theme';
import { PAGE_SURFACE_NAMES, PAGE_UI_MENU_RESCUE } from '../../lib/page-commands/commands';
import { setAppearanceOption } from '../../lib/storage/options';
import { createLogger } from '../../lib/logger';
import {
  createInstantSettingModel,
  type InstantSettingIO,
  type InstantSettingModel,
  type InstantSettingSnapshot,
  type InstantWriteOutcome
} from '../../lib/options/instant-setting';
import { createPageUiGateIO, createPaletteChordIO } from '../../lib/options/instant-io';
import {
  keyLegend,
  readKeyboardLayout,
  type KeyboardNavigator,
  type KeyLayoutLookup
} from '../../lib/options/keyboard-layout';
import { chordsEqual, formatChord, type PaletteChord } from '../../lib/storage/palette-chord';
import { resolveChordPlatform, type ChordPlatform } from '../../lib/storage/palette-chord-platform';
import { OptionSections, type OptionRowScope } from './sections';
import type { InstantRowsScope } from './instant-rows';
import { KnownConflictsFreshness } from './kc-freshness';

const log = createLogger('options');

/** The save outcome toasts' copy, verbatim. */
const SAVE_SUCCESS_TITLE = 'Options saved';
const SAVE_FAILURE_TITLE = 'Saving the options failed';
const APPEARANCE_WRITE_FAILURE_TITLE = 'The color theme could not be saved';
const APPEARANCE_WRITE_FAILURE_DESCRIPTION = 'The theme choice is kept as unsaved — try Save.';
const PAGE_UI_ON_TITLE = 'On-page UI turned on';
const PAGE_UI_OFF_TITLE = 'On-page UI turned off';
const PAGE_UI_OFF_DESCRIPTION = `Open pages close it now; turn it back on here or from ${PAGE_UI_MENU_RESCUE}.`;
const PAGE_UI_FAILURE_TITLE = 'The on-page UI setting could not be saved';
const CHORD_SAVED_TITLE = `${capitalize(PAGE_SURFACE_NAMES.commandPalette)} shortcut saved`;
const CHORD_FAILURE_TITLE = `The ${PAGE_SURFACE_NAMES.commandPalette} shortcut could not be saved`;
const INSTANT_FAILURE_DESCRIPTION =
  'The previous value stays — check that the extension is still enabled, then try again.';

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
  /** The on-page UI gate's seams (default: its storage item). */
  pageUiIO?: InstantSettingIO<boolean>;
  /** The palette shortcut's seams (default: its storage item). */
  chordIO?: InstantSettingIO<PaletteChord>;
  /** The keyboard convention (default: `runtime.getPlatformInfo`, `'other'` on failure). */
  resolvePlatform?: () => Promise<ChordPlatform>;
  /** The active keyboard layout (default: the Keyboard Map API, feature-detected). */
  readLayout?: () => Promise<KeyLayoutLookup | null>;
}

/**
 * Mount one instant setting's machine for the page's lifetime: a signal
 * mirrors its snapshot, the boot read starts now, the watch ends with the page.
 *
 * @param io The setting's seams.
 * @param equals Value equality.
 */
function mountInstantSetting<T>(
  io: InstantSettingIO<T>,
  equals: (a: T, b: T) => boolean
): { model: InstantSettingModel<T>; snapshot: () => InstantSettingSnapshot<T> } {
  const [snapshot, setSnapshot] = createSignal<InstantSettingSnapshot<T>>({ status: 'loading' });
  const model = createInstantSettingModel(io, equals, (next) => {
    setSnapshot(() => next);
  });
  onCleanup(() => {
    model.dispose();
  });
  void model.load();
  return { model, snapshot };
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

  // One-shot seams, like the model's IO above (never swapped mid-life).
  /* eslint-disable solid/reactivity */
  const gate = mountInstantSetting(props.pageUiIO ?? createPageUiGateIO(log), Object.is);
  const chord = mountInstantSetting(props.chordIO ?? createPaletteChordIO(log), chordsEqual);
  const resolvePlatform =
    props.resolvePlatform ??
    (() => resolveChordPlatform({ getPlatformInfo: () => browser.runtime.getPlatformInfo(), log }));
  const readLayout =
    props.readLayout ?? (() => readKeyboardLayout(navigator as KeyboardNavigator, log));
  /* eslint-enable solid/reactivity */
  const [platform, setPlatform] = createSignal<ChordPlatform | null>(null);
  void resolvePlatform()
    .catch((cause: unknown) => {
      log.warn('The keyboard convention could not be resolved — using Ctrl notation', cause);
      return 'other' as const;
    })
    .then(setPlatform);
  const [layout, setLayout] = createSignal<KeyLayoutLookup | null>(null);
  /** (Re-)read the layout: at mount, and whenever recording starts (it may have changed). */
  const refreshLayout = (): void => {
    void readLayout()
      .catch((cause: unknown) => {
        log.debug('The keyboard layout could not be read — showing US key legends', cause);
        return null;
      })
      .then((next) => setLayout(() => next));
  };
  refreshLayout();

  /**
   * Toast an instant write's outcome (superseded/unchanged writes stay quiet —
   * the latest request answers).
   *
   * @param outcome The write's outcome.
   * @param success The success toast, when written.
   * @param failureTitle The failure toast's title.
   */
  const announceInstant = (
    outcome: InstantWriteOutcome,
    success: { title: string; description?: string },
    failureTitle: string
  ): void => {
    if (outcome === 'written') toast.success(success.title, { description: success.description });
    else if (outcome === 'failed') {
      toast.error(failureTitle, { description: INSTANT_FAILURE_DESCRIPTION });
    }
  };

  const instant: InstantRowsScope = {
    gate: gate.snapshot,
    chord: chord.snapshot,
    platform,
    legend: (value) => keyLegend(value.code, layout()),
    setGate: (next) => {
      void gate.model
        .set(next)
        .then((outcome) => {
          announceInstant(
            outcome,
            next
              ? { title: PAGE_UI_ON_TITLE }
              : { title: PAGE_UI_OFF_TITLE, description: PAGE_UI_OFF_DESCRIPTION },
            PAGE_UI_FAILURE_TITLE
          );
        })
        .catch((cause: unknown) => {
          log.error('Applying the on-page UI gate failed unexpectedly', cause);
        });
    },
    setChord: (next) => {
      void chord.model
        .set(next)
        .then((outcome) => {
          // Spelled in words: toasts are read aloud, and glyphs read poorly.
          const current = platform() ?? 'other';
          const shown = formatChord(next, current, 'words', keyLegend(next.code, layout()));
          announceInstant(
            outcome,
            {
              title: CHORD_SAVED_TITLE,
              description: `${shown} opens the ${PAGE_SURFACE_NAMES.commandPalette} on inspected pages.`
            },
            CHORD_FAILURE_TITLE
          );
        })
        .catch((cause: unknown) => {
          log.error('Applying the palette shortcut failed unexpectedly', cause);
        });
    },
    retryGate: () => {
      void gate.model.load();
    },
    retryChord: () => {
      void chord.model.load();
    },
    refreshLayout
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
            <Show when={failedMessage() !== null}>
              <ErrorState
                title="Couldn't load the options"
                message={failedMessage() ?? undefined}
                onRetry={() => {
                  void model.load();
                }}
              />
            </Show>
            {/* The instant rows ride their own reads: a failed draft load keeps
                the gate's switch (the on-page UI rescue) reachable. */}
            <div data-fdt="options-sections" class={cn(MOTION_REVEAL, 'flex flex-col gap-3')}>
              <OptionSections scope={scope} instant={instant} drafted={ready() !== null} />
            </div>
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
