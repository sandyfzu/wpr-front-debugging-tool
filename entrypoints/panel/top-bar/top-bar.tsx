/**
 * The panel's top bar — the persistent band above the nav and the content:
 * the four opening answers (is WP Rocket here, is the page cached, what
 * server served it, how old is the data) at first paint with zero
 * interactions, plus the shell's controls (palette, Exclusions, Refresh).
 *
 * Placement contract: the bar sits outside the content region's scrolling,
 * so an answer never scrolls out and data never pushes the panel's chrome.
 * Width contract, two layers. The width rule ({@link topBarLayout}, the
 * shell width) picks the full or compact form: compact folds the name, the
 * secondary parts and the Exclusions entry into "⋯" (the entry stays inline
 * only while its session state is news) and shortens the pills. The measured
 * fold (`fold.tsx` over `lib/panel/top-bar-fold.ts`) then keeps every
 * foldable part whole or gone: address, server, cache age, freshness text,
 * then the brand mark drop in that order until the rest fits, each into "⋯"
 * (which then shows at any width; a held stale freshness marks it). The WP
 * Rocket and cache pills and the end controls never fold; nothing is cut
 * mid-glyph and nothing scrolls.
 *
 * Data honesty and aging are the answers' and the selectors' (see
 * `answers.tsx`, `selectors.ts`); ages advance through the aging clock and
 * stop when the panel is hidden or no data is loaded.
 */
import {
  ErrorBoundary,
  Show,
  createEffect,
  createMemo,
  on,
  onCleanup,
  type Accessor,
  type JSX
} from 'solid-js';
import Globe from 'lucide-solid/icons/globe';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { AppBar } from '../../../components/ui/app-bar';
import { BrandMark } from '../../../components/ui/brand-mark';
import { Button } from '../../../components/ui/button';
import { createLogger } from '../../../lib/logger';
import { topBarLayout } from '../../../lib/panel/top-bar-layout';
import { PaletteTrigger } from '../palette/palette-trigger';
import { createAgingClock, realAgingClockDeps } from '../state/aging-clock';
import { useFdtData } from '../state/use-fdt-data';
import { ANSWER, CacheAnswer, FreshnessAnswer, PlatformAnswer, WprAnswer } from './answers';
import {
  BuilderEntry,
  createContainedBuilderEntryModel,
  type BuilderEntryDeps
} from './builder-entry';
import { builderNeedsGlance } from './builder-session';
import { FoldPart, REAL_FOLD_SEAMS, createTopBarFold, type TopBarFoldSeams } from './fold';
import { TopBarMenu } from './overflow-menu';
import { createPageAddress } from './page-address';
import { REFRESH_LABEL, refreshControl } from './refresh';
import { topBarSegments, type TopBarSegments } from './selectors';

const log = createLogger('panel');

/** The palette trigger's wiring (the shell owns the overlay store). */
export interface TopBarPalette {
  /** Whether the palette is open. */
  readonly open: () => boolean;
  /** Toggle the palette. */
  readonly toggle: () => void;
  /** The fixed chord in the platform's notation. */
  readonly keyHint: () => string;
}

/** Props of {@link TopBar}. */
export interface TopBarProps {
  /** The shell's measured inline size (px) — the width rule's input. */
  readonly width: Accessor<number>;
  /** The palette trigger's wiring. */
  readonly palette: TopBarPalette;
  /** The exclusion builder entry's transport. */
  readonly builderEntry: BuilderEntryDeps;
  /** Reads the inspected page URL (null when unknown); called once per data settle. */
  readonly readPageUrl: () => Promise<string | null>;
  /**
   * The appearance control's slot, between Refresh/freshness and "⋯"
   * (empty until a surface passes its control). It is an end control: the
   * fold measures the end slot as laid out, so it needs no reserve.
   */
  readonly appearance?: JSX.Element;
  /** The fold's measuring seams (tests; production measures layout). */
  readonly foldSeams?: TopBarFoldSeams;
}

/** The thin divider between the product name and the answers. */
const DIVIDER = 'h-5 w-px shrink-0 bg-line-2';

/**
 * The answers' group: the pills shrink (and elide) only at the floor, once
 * every foldable part is folded; parts never shrink.
 */
const ANSWERS = 'flex min-w-0 items-center gap-1';

/** The start row: the bar's identity and answers, measured by the fold. */
const START_ROW = 'flex min-w-0 items-center gap-1.5';

/**
 * Read the answers once per state change or clock tick, containing a
 * selector failure (a payload that skipped validation) to one log line and
 * the bar's downtime text — never the shell.
 *
 * @param read The composition (throws on a hostile payload).
 * @returns The answers, or null when they could not be composed.
 */
function safeSegments(read: () => TopBarSegments): Accessor<TopBarSegments | null> {
  return createMemo(() => {
    try {
      return read();
    } catch (cause) {
      log.error('Top bar answers failed — the bar renders its downtime line', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
      return null;
    }
  });
}

/** The bar's downtime line (the answers could not be composed). */
function StatusUnavailable(): JSX.Element {
  return (
    <span class={ANSWER}>
      <span class="text-fg-muted">Status unavailable</span>
    </span>
  );
}

/**
 * The Refresh control: re-reads the page (the palette's Reload), retries a
 * failed read, and stays busy while a read is in the air. Its title names
 * stale data (the remedy it is).
 *
 * @param props.stale Whether the shown data is stale.
 */
function RefreshButton(props: { stale: boolean }): JSX.Element {
  const data = useFdtData();
  const control = createMemo(() => refreshControl(data.state(), props.stale));
  return (
    <Button
      variant="ghost"
      class="w-7 px-0"
      aria-label={REFRESH_LABEL}
      title={control().title}
      busy={control().kind === 'busy'}
      aria-disabled={control().kind === 'held' ? true : undefined}
      data-fdt-refresh={control().kind}
      onClick={() => {
        const kind = control().kind;
        if (kind === 'reload') data.reload();
        else if (kind === 'retry') data.retry();
      }}
    >
      <Show when={control().kind !== 'busy'}>
        <RefreshCw size={14} aria-hidden="true" />
      </Show>
    </Button>
  );
}

/**
 * Render the top bar.
 *
 * The bar reads the shell's data store through its context (pages and bars
 * never touch messaging) and ages its answers through the aging clock,
 * whose cadence follows the machine's loaded states and the document's
 * visibility.
 *
 * @param props See {@link TopBarProps}.
 */
export function TopBar(props: TopBarProps): JSX.Element {
  const data = useFdtData();
  const clock = createAgingClock(realAgingClockDeps());
  // Contained: a failing builder state drops its entry, never the bar.
  // eslint-disable-next-line solid/reactivity -- the transport is fixed for the mount
  const builder = createContainedBuilderEntryModel(props.builderEntry);
  // eslint-disable-next-line solid/reactivity -- the reader is fixed for the mount
  const address = createPageAddress(data.state, props.readPageUrl);
  const layout = createMemo(() => topBarLayout(props.width()));
  const compact = (): boolean => layout().overflow;
  // eslint-disable-next-line solid/reactivity -- the seams are fixed for the mount
  const fold = createTopBarFold(compact, props.foldSeams ?? REAL_FOLD_SEAMS);

  // The cadence follows the machine's loaded statuses; the deferred run
  // matches the clock's initial disarmed state, so only the flips matter —
  // pushes patching data under the same status never touch the clock.
  createEffect(
    on(
      () => {
        const status = data.state().status;
        return status === 'ready' || status === 'refreshing';
      },
      (loaded) => {
        clock.setLoaded(loaded);
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    clock.stop();
  });

  const segments = safeSegments(() => topBarSegments(data.state(), clock.now()));
  const stale = createMemo(() => segments()?.freshness.kind === 'stale');

  return (
    <AppBar
      data-fdt="panel-top-bar"
      label="Page status"
      // Paint priority over the content region: nothing scrolled or
      // stacked inside a page can cover the bar (fixed overlays — dialogs
      // z-40+, tooltip and menu portals z-50 — still rank above it). Also
      // the positioned box folded parts lay out against.
      class="relative z-10"
      start={
        <div ref={fold.attachStart} data-fdt="top-bar-start" class={START_ROW}>
          <FoldPart fold={fold} part="brand">
            <BrandMark />
          </FoldPart>
          <Show when={layout().showName} fallback={<span class="sr-only">WPR FDT</span>}>
            <span class="shrink-0 text-xs font-semibold whitespace-nowrap text-fg-primary">
              WPR FDT
            </span>
            <span class={DIVIDER} aria-hidden="true" />
          </Show>
          <ErrorBoundary
            fallback={(cause: unknown) => {
              log.error('Top bar answers crashed — the bar renders its downtime line', {
                cause: cause instanceof Error ? { message: cause.message } : cause
              });
              return <StatusUnavailable />;
            }}
          >
            <Show when={segments()} fallback={<StatusUnavailable />}>
              {(answers) => (
                <div data-fdt="top-bar-answers" class={ANSWERS}>
                  <WprAnswer segments={answers} compact={compact()} />
                  <CacheAnswer segments={answers} compact={compact()} fold={fold} />
                  <Show when={!compact()}>
                    <FoldPart fold={fold} part="server">
                      <PlatformAnswer segments={answers} />
                    </FoldPart>
                  </Show>
                </div>
              )}
            </Show>
          </ErrorBoundary>
          <Show when={compact() ? null : address()}>
            {(current) => (
              <FoldPart fold={fold} part="address">
                <span
                  data-fdt="top-bar-address"
                  title={`Inspected page: ${current().url}`}
                  class="flex items-center gap-1.5 text-fg-secondary"
                >
                  <Globe size={14} class="shrink-0" aria-hidden="true" />
                  {/* A designed cap: a long URL elides here, the title and
                      the menu keep it whole. */}
                  <span class="max-w-64 truncate font-mono text-2xs">{current().label}</span>
                </span>
              </FoldPart>
            )}
          </Show>
        </div>
      }
      end={
        <>
          <PaletteTrigger
            open={props.palette.open}
            toggle={props.palette.toggle}
            wide={() => !compact()}
            keyHint={props.palette.keyHint}
          />
          <Show when={builder()}>
            {(model) => (
              // Compact, the entry waits in "⋯" unless its state is news.
              <Show when={!compact() || builderNeedsGlance(model().view())}>
                <BuilderEntry model={model()} showLabel={layout().showExclusionsLabel} />
              </Show>
            )}
          </Show>
          <RefreshButton stale={stale()} />
          <Show when={compact() ? null : segments()}>
            {(answers) => (
              <FoldPart fold={fold} part="freshness" data-fdt="top-bar-freshness">
                <FreshnessAnswer view={() => answers().freshness} short />
              </FoldPart>
            )}
          </Show>
          {props.appearance}
          <TopBarMenu
            segments={segments}
            address={address}
            builder={builder()}
            stale={stale()}
            visible={fold.menu()}
            inline={fold.inline}
            compact={compact()}
            attach={fold.attachMenu}
          />
        </>
      }
    />
  );
}
