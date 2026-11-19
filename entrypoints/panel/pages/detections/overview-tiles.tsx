/**
 * The Detections overview: four stat tiles above the detection list,
 * readable at a glance.
 *
 * - **Score**: a ring (active, then collecting, over the off track) and
 *   "N of M optimizations active" — with the reason suffixes when the
 *   Exclusion Builder turned served features off here ("· 2 off in this
 *   tab") or the extension simulated some ("· 1 simulated in this tab",
 *   "· simulation not verified") — and the collecting/off counts.
 * - **WP Rocket**: the version (or "Version not exposed") and the
 *   footprints that prove it; absent = the neutral "Not detected".
 * - **Page cache**: the bar's cache answer in the bar's tone; every state
 *   but cached explains itself through a tooltip on its value, a cached
 *   page states its generation time; the hosting cache layer when worth
 *   naming; a link to the headers that hold the evidence.
 * - **Stack**: the declared WordPress version, the server answer and the
 *   platform the headers identified.
 *
 * Grid (the page container's tiers): 4 columns from `@wide`, else 2×2.
 * Compact: the score tile spans both columns and the WP Rocket tile steps
 * aside — the top bar states the plugin and its version at every width — and
 * the ring shrinks to 44 px.
 *
 * States: the shell renders the body only over loaded data, so the tiles
 * always have an answer; before data the shell shows {@link
 * OverviewSkeleton} (same grid). A render failure inside the tiles is
 * contained to one line (logged) — the detection list below still renders
 * — until new data arrives, which retries the tiles.
 */
import type { JSX } from 'solid-js';
import { createEffect, createMemo, ErrorBoundary, For, on, Show } from 'solid-js';
import CircleCheck from 'lucide-solid/icons/circle-check';
import Database from 'lucide-solid/icons/database';
import Rocket from 'lucide-solid/icons/rocket';
import Server from 'lucide-solid/icons/server';
import { Card } from '../../../../components/ui/card';
import { ScoreRing } from '../../../../components/ui/score-ring';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatTile, type StatTileTone } from '../../../../components/ui/stat-tile';
import { StatusDot } from '../../../../components/ui/status-badge';
import { Tooltip } from '../../../../components/ui/tooltip';
import { cacheLayerCopy } from '../../../../lib/detection/cache-context';
import {
  builderOffSummary,
  LIST_JOINER_CONTENT,
  simulationSummaryParts
} from '../../../../lib/detection/hud';
import { createLogger } from '../../../../lib/logger';
import type { DetectionsSummary } from '../../../../lib/panel/detections-summary';
import { WPR_NOT_DETECTED } from '../../../../lib/panel/wpr-evidence';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import type { CacheAnswerTone } from '../../top-bar/selectors';
import {
  CACHE_EVIDENCE_ROUTE,
  overviewView,
  type CacheTileView,
  type OverviewView,
  type StackTileView,
  type WprTileView
} from './overview';

const log = createLogger('panel');

/**
 * The tiles' grid. Compact (and regular): two equal columns; wide: four,
 * the score tile a little wider (its ring sits beside the sentence).
 * `minmax(0, …)` tracks let long values wrap instead of widening the grid.
 */
export const OVERVIEW_GRID =
  'grid grid-cols-2 gap-2 @wide:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,1fr))]';

/** A tile's cell: a one-track grid, so the tile fills the row's height and the cell's width. */
const TILE_CELL = 'grid min-w-0';

/** The score tile's cell: both columns at compact, one from regular up. */
export const SCORE_CELL = 'col-span-2 @regular:col-span-1';

/**
 * The WP Rocket tile's cell: hidden at compact (the top bar's pill states
 * the plugin and its version at every width), so the narrow grid stays 2×2.
 */
export const WPR_CELL = '@max-regular:hidden';

/**
 * The score ring's side per container tier: 44 px at compact (the score
 * tile spans the narrow grid; a smaller ring leaves the sentence room),
 * 52 px from regular up. Classes, not the ring's `size` prop: the tier is
 * the page container's (the grid's own tiers), which only CSS can read.
 * The prop still sets the intrinsic 44 px the classes restate.
 */
export const SCORE_RING_SIZE = 'size-[44px] @regular:size-[52px]';

/** The ring's intrinsic side (px) — the compact tier's, matching {@link SCORE_RING_SIZE}. */
export const SCORE_RING_COMPACT_PX = 44;

/**
 * A suffix (or count) whose separator dot sits in the inline-start gutter
 * its container clips (`-ms-3` inside `overflow-hidden`): the dot shows
 * between phrases on a line and disappears at a line start.
 */
const GUTTER_DOT =
  'relative ms-3 min-w-0 max-w-full before:absolute before:-start-2 before:text-fg-muted before:content-(--fdt-joiner)';

/**
 * A value that explains itself on hover/focus: reads as the value (its
 * tone inherited), the dotted underline hints the explanation. No negative
 * margins: the 24 px hit area takes its own line height, so the trigger
 * never overlaps the label or the line below it.
 */
const FACT_TRIGGER =
  'justify-items-start text-start underline decoration-line-3 decoration-dotted underline-offset-2';

/** The cache icon's tone per answer tone (neutral keeps the label's muted icon). */
const CACHE_ICON_TONES: Readonly<Record<CacheAnswerTone, StatTileTone>> = {
  ok: 'ok',
  warn: 'warn',
  neutral: 'muted'
};

/** The plugin tile's value when the page exposes no version. */
export const VERSION_NOT_EXPOSED = 'Version not exposed';

/**
 * What the absent plugin tile looked for. "Unique to WP Rocket": a page can
 * still show optimizations other tools also apply (deferred scripts), which
 * never prove the plugin — so their cards may read Active beside this tile.
 */
export const WPR_ABSENT_SENTENCE =
  'No generator tag, cache signature or optimization unique to WP Rocket found on this page.';

/** The cache tile's value when WP Rocket is absent. */
export const CACHE_NOT_APPLICABLE = 'Not applicable';

/** The cache tile's sentence when WP Rocket is absent. */
export const CACHE_NOT_APPLICABLE_SENTENCE = 'WP Rocket was not detected on this page.';

/** The cache tile's evidence link text. */
export const CACHE_EVIDENCE_LINK = 'Check headers';

/** The stack tile's value when the page declares no WordPress version. */
export const WORDPRESS_UNDECLARED = 'WordPress version not declared';

/** The stack tile's server line per silent server answer. */
export const SERVER_SILENCE: Readonly<Record<'unknown' | 'unavailable', string>> = {
  unknown: 'Server not named in the headers',
  unavailable: 'Response headers not captured'
};

/** The fallback's title and sentence when the tiles fail to render. */
export const OVERVIEW_UNAVAILABLE = {
  title: 'Overview unavailable',
  sentence: 'The detection list below still shows every result.'
} as const;

/**
 * The machine-readable form of a cache stamp for `<time datetime>`.
 *
 * @param seconds Epoch seconds (representable by the view model's contract).
 * @returns The ISO-8601 instant.
 */
function isoInstant(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * The score tile: ring, headline sentence (+ reason suffixes) and counts.
 *
 * @param props.score The optimization counts.
 */
function ScoreTile(props: { score: OverviewView['score'] }): JSX.Element {
  return (
    <StatTile
      label="Optimizations"
      hideLabel
      valueRole="stat"
      media={
        <ScoreRing
          size={SCORE_RING_COMPACT_PX}
          class={SCORE_RING_SIZE}
          total={props.score.total}
          segments={[
            { value: props.score.active, kind: 'ok' },
            { value: props.score.collecting, kind: 'warn' }
          ]}
        />
      }
      sub={
        <span data-fdt-summary-counts class="flex flex-wrap gap-x-2.5 gap-y-0.5">
          <span class="inline-flex items-center gap-1">
            <StatusDot kind="warn" class="shrink-0" />
            {formatCount(props.score.collecting)} collecting
          </span>
          <span class="inline-flex items-center gap-1">
            {/* The ring's off track, as a dot (decorative: the words say it). */}
            <span
              aria-hidden="true"
              class="size-1.5 shrink-0 rounded-full border border-line-3 bg-surface-4"
            />
            {formatCount(props.score.off)} off
          </span>
        </span>
      }
    >
      {/* The clip hides a wrapped suffix's gutter dot at its line start. */}
      <p data-fdt-summary-headline class="min-w-0 overflow-hidden">
        <span class="block">
          <span>{formatCount(props.score.active)}</span>{' '}
          <span class="text-xs font-medium text-fg-muted">
            of <span>{formatCount(props.score.total)}</span>
          </span>
        </span>{' '}
        <span class="-ms-3 flex flex-wrap text-xs font-normal text-fg-secondary">
          <span class="ms-3 min-w-0">optimizations active</span>
          <Show when={builderOffSummary(props.score.offInTab)}>
            {(suffix) => (
              // One unit: wraps whole onto the next line, never mid-phrase.
              <span data-fdt-summary-off class={`${GUTTER_DOT} whitespace-nowrap`}>
                <span class="sr-only">, </span>
                {suffix()}
              </span>
            )}
          </Show>
          <For each={simulationSummaryParts(props.score.simulated, props.score.unverified)}>
            {(part) => (
              <span data-fdt-summary-simulation class={`${GUTTER_DOT} whitespace-nowrap`}>
                <span class="sr-only">, </span>
                {part}
              </span>
            )}
          </For>
        </span>
      </p>
    </StatTile>
  );
}

/**
 * The WP Rocket tile.
 *
 * @param props.view The plugin answer.
 */
function WprTile(props: { view: WprTileView }): JSX.Element {
  const detected = createMemo(() => (props.view.kind === 'detected' ? props.view : undefined));
  return (
    <Show
      when={detected()}
      fallback={
        <StatTile
          label="WP Rocket"
          icon={Rocket}
          valueTone="neutral"
          sub={<span data-fdt-summary-fact="wpr">{WPR_ABSENT_SENTENCE}</span>}
        >
          {WPR_NOT_DETECTED}
        </StatTile>
      }
    >
      {(view) => (
        <StatTile
          label="WP Rocket"
          icon={Rocket}
          iconTone="accent"
          valueTone={view().version === null ? 'muted' : 'primary'}
          sub={
            <span class="inline-flex items-start gap-1 text-status-ok">
              {/* Optical alignment with the 11 px line's first baseline. */}
              <CircleCheck size={12} class="mt-px shrink-0" aria-hidden="true" />
              <span class="min-w-0">{view().evidence}</span>
            </span>
          }
        >
          <Show when={view().version} fallback={VERSION_NOT_EXPOSED}>
            {(version) => <span class="font-mono">{version()}</span>}
          </Show>
        </StatTile>
      )}
    </Show>
  );
}

/**
 * The page-cache tile.
 *
 * @param props.view The cache answer.
 */
function CacheTile(props: { view: CacheTileView }): JSX.Element {
  const answered = createMemo(() => (props.view.kind === 'answered' ? props.view : undefined));
  return (
    <Show
      when={answered()}
      fallback={
        <StatTile
          label="Page cache"
          icon={Database}
          valueTone="muted"
          sub={CACHE_NOT_APPLICABLE_SENTENCE}
        >
          {CACHE_NOT_APPLICABLE}
        </StatTile>
      }
    >
      {(view) => (
        <StatTile
          label="Page cache"
          icon={Database}
          iconTone={CACHE_ICON_TONES[view().tone]}
          valueTone={view().tone}
          link={{ href: `#/${CACHE_EVIDENCE_ROUTE}`, label: CACHE_EVIDENCE_LINK }}
          sub={
            // A plain conditional, not <Show>: the tile renders its sub row
            // whenever the slot holds anything, an empty <Show> included.
            view().stamp !== null || view().layer !== null ? (
              <span class="flex flex-col gap-0.5">
                <Show when={view().stamp}>
                  {(stamp) => (
                    <span data-fdt-summary-fact="cache">
                      Cache generated{' '}
                      <time class="text-fg-secondary" datetime={isoInstant(stamp().seconds)}>
                        {stamp().formatted}
                      </time>
                    </span>
                  )}
                </Show>
                <Show when={view().layer}>
                  {(layer) => (
                    <span data-fdt-summary-fact="cache-layer">{cacheLayerCopy(layer()).fact}</span>
                  )}
                </Show>
              </span>
            ) : undefined
          }
        >
          <Show when={view().explained} fallback={view().copy.chip}>
            {/* A block box: an inline wrapper would sit under the first line of a
                wrapped trigger only, so its lines would read over different stacks. */}
            <span data-fdt-summary-fact="cache" class="block">
              <Tooltip content={view().copy.tooltip} class={FACT_TRIGGER}>
                {view().copy.chip}
              </Tooltip>
            </span>
          </Show>
        </StatTile>
      )}
    </Show>
  );
}

/**
 * The stack tile.
 *
 * @param props.view The stack facts.
 */
function StackTile(props: { view: StackTileView }): JSX.Element {
  const server = createMemo(() =>
    props.view.server.kind === 'captured' ? props.view.server : undefined
  );
  /** The silent server answer (read only while nothing was captured). */
  const silence = (): 'unknown' | 'unavailable' =>
    props.view.server.kind === 'unknown' ? 'unknown' : 'unavailable';
  return (
    <StatTile
      label="Stack"
      icon={Server}
      valueTone={props.view.wordpressVersion === null ? 'muted' : 'primary'}
      sub={
        <span class="flex flex-col gap-0.5">
          <Show
            when={server()}
            fallback={<span data-fdt-overview-server>{SERVER_SILENCE[silence()]}</span>}
          >
            {(captured) => (
              <span data-fdt-overview-server class="font-mono text-fg-secondary">
                {captured().value}
              </span>
            )}
          </Show>
          <Show when={props.view.platform}>
            {(platform) => (
              <span data-fdt-summary-fact="platform">
                <span class="text-fg-secondary">{platform().name}</span> via{' '}
                <span class="font-mono break-all text-fg-secondary">{platform().header}</span>
              </span>
            )}
          </Show>
        </span>
      }
    >
      <Show when={props.view.wordpressVersion} fallback={WORDPRESS_UNDECLARED}>
        {(version) => (
          <span data-fdt-summary-fact="wordpress">
            WordPress <span class="font-mono font-medium">{version()}</span>
          </span>
        )}
      </Show>
    </StatTile>
  );
}

/**
 * The fallback when the tiles fail to render: named, quiet, never a dead
 * end. New data retries the tiles (a crash caused by one payload must not
 * outlive it); the same data never retries, so a deterministic crash is
 * logged once per payload, never in a loop.
 *
 * @param props.input The data identity the tiles crashed on (read reactively).
 * @param props.retry The boundary's reset.
 */
function OverviewUnavailable(props: { input: () => unknown; retry: () => void }): JSX.Element {
  // Deferred: the crash's own data must not retry at once. Owned by the
  // boundary's fallback, so it is disposed as soon as the tiles render again.
  createEffect(
    on(
      () => props.input(),
      () => {
        props.retry();
      },
      { defer: true }
    )
  );
  return (
    <div data-fdt="detections-overview-error">
      <Card>
        <p class="text-xs font-semibold text-fg-primary">{OVERVIEW_UNAVAILABLE.title}</p>
        <p class="text-2xs text-fg-muted">{OVERVIEW_UNAVAILABLE.sentence}</p>
      </Card>
    </div>
  );
}

/** Props of {@link OverviewTiles}. */
export interface OverviewTilesProps {
  /** The loaded page data. */
  data: FdtData;
  /** Its summary (the page's one `summarizeFdtData` pass). */
  summary: DetectionsSummary;
  /** The page clock (epoch ms). */
  now: number;
}

/**
 * Render the overview tiles.
 *
 * @param props See {@link OverviewTilesProps}.
 * @returns The tile grid, or its contained failure line.
 */
export function OverviewTiles(props: OverviewTilesProps): JSX.Element {
  return (
    <ErrorBoundary
      fallback={(cause: unknown, reset) => {
        log.error('Detections overview crashed — the page renders its fallback line', {
          cause: cause instanceof Error ? { message: cause.message } : cause
        });
        // The clock is not data: a tick must not retry a crash.
        return <OverviewUnavailable input={() => [props.data, props.summary]} retry={reset} />;
      }}
    >
      <OverviewGrid data={props.data} summary={props.summary} now={props.now} />
    </ErrorBoundary>
  );
}

/**
 * The tile grid itself (inside {@link OverviewTiles}'s boundary, so a
 * failing view or tile is contained there).
 *
 * @param props See {@link OverviewTilesProps}.
 */
function OverviewGrid(props: OverviewTilesProps): JSX.Element {
  const view = createMemo(() => overviewView(props.data, props.summary, props.now));
  return (
    <section
      data-fdt="detections-summary"
      aria-label="Page overview"
      class={OVERVIEW_GRID}
      // Set once on the root; every gutter dot reads it.
      style={{ '--fdt-joiner': LIST_JOINER_CONTENT }}
    >
      <div data-fdt-overview-tile="score" class={`${TILE_CELL} ${SCORE_CELL}`}>
        <ScoreTile score={view().score} />
      </div>
      <div data-fdt-overview-tile="wpr" class={`${TILE_CELL} ${WPR_CELL}`}>
        <WprTile view={view().wpr} />
      </div>
      <div data-fdt-overview-tile="cache" class={TILE_CELL}>
        <CacheTile view={view().cache} />
      </div>
      <div data-fdt-overview-tile="stack" class={TILE_CELL}>
        <StackTile view={view().stack} />
      </div>
    </section>
  );
}

/**
 * The overview's loading shape — the same grid and cells, one placeholder
 * per tile — for the shell's boot skeleton (a real wait only).
 *
 * @returns The placeholder grid.
 */
export function OverviewSkeleton(): JSX.Element {
  return (
    <div data-fdt="detections-overview-skeleton" class={OVERVIEW_GRID}>
      <Skeleton class={`h-18 w-full ${SCORE_CELL}`} />
      <Skeleton class={`h-18 w-full ${WPR_CELL}`} />
      <Skeleton class="h-18 w-full" />
      <Skeleton class="h-18 w-full" />
    </div>
  );
}
