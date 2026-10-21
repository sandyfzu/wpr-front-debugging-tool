/**
 * The panel's status bar — the persistent answer strip at the shell's
 * bottom edge: the four opening questions (is the plugin here, is the page
 * cached, what platform served it, how old is the data) answered at first
 * paint with zero interactions, each navigable segment linking to its
 * owning page.
 *
 * Placement contract: the strip is the shell's bottom edge and lives
 * outside the content region's own scrolling, so an answer never scrolls
 * out and data never pushes the panel's chrome — at every docking geometry.
 * The strip element is its own container-query anchor (the `@container`
 * class): the glanceability rule — all four segments on one line from 480 px
 * of strip width, wrapping below, never a horizontal scroll — is owned by
 * {@link statusBarLayout}, mirrored by the row's `@min-[480px]:` class
 * literal, and pinned by the sync-guard test.
 *
 * Data honesty: boot renders placeholder slots until real data arrives; an
 * errored state renders quiet slots (the error view above carries the
 * cause); real data saying "absent" renders the absent state — never a
 * fabricated answer for a question the data has not answered. Displayed
 * ages advance through the aging clock and stop entirely when the panel is
 * hidden or no data is loaded.
 */
import {
  ErrorBoundary,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  on,
  onCleanup,
  type JSX
} from 'solid-js';
import { FOCUS_RING } from '../../../components/ui/classes';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import { cn } from '../../../utils/cn';
import { createLogger } from '../../../lib/logger';
import { useFdtData } from '../state/use-fdt-data';
import { createAgingClock, realAgingClockDeps } from './aging-clock';
import type { SegmentId, StatusBarSegments } from './selectors';
import { STALE_WINDOW_MINUTES, statusBarSegments } from './selectors';

const log = createLogger('panel');

/**
 * The container width from which all four segments hold one line (px).
 *
 * The glanceability contract: from this width on the answers sit on a
 * single line (long values elide inside their segment); below it the row
 * wraps — and nothing ever scrolls horizontally.
 */
export const STATUS_BAR_GLANCEABLE_MIN_WIDTH = 480;

/** The strip's two layouts, as the container width picks them. */
export type StatusBarLayout = 'single-line' | 'wrapped';

/**
 * Resolve the strip's layout for a container inline width.
 *
 * The rule's CSS arm is the row's `@min-[480px]:` class literal below (the
 * rule in pure form lives here because container conditions cannot read a
 * value); the sync-guard test pins the two together, along with the strip's
 * container declaration.
 *
 * @param containerWidth The strip's inline size in px (fractional allowed).
 */
export function statusBarLayout(containerWidth: number): StatusBarLayout {
  return containerWidth >= STATUS_BAR_GLANCEABLE_MIN_WIDTH ? 'single-line' : 'wrapped';
}

/**
 * The strip: the shell's bottom edge, and its own size container (the
 * `@container` class) — the segments' container queries read the strip's
 * own width, so the layout follows the strip at every docking geometry.
 */
const STRIP =
  '@container flex shrink-0 items-center overflow-hidden border-t border-line-2 bg-surface-1 px-2';

/**
 * The segments' row: a wrapping line by default, one line from the glance
 * threshold on (the variant is {@link statusBarLayout}'s CSS arm — the
 * sync-guard test keeps the literal and the constant one rule).
 */
const ROW =
  'flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 py-1 @min-[480px]:flex-nowrap';

/**
 * One segment: dense strip type. The class carries no hover surface — it is
 * shared with non-interactive variants (quiet dashes, unknown, freshness
 * text); the link variants add their own hover ring classes, so a hover
 * affordance never decorates text that is not a control.
 */
export const SEGMENT =
  'flex min-h-6 min-w-0 items-center gap-1.5 rounded-sm text-2xs text-fg-primary no-underline';

/** The interactive segment's hover surface (links only). */
export const SEGMENT_HOVER = 'hover:bg-surface-3';

/** A segment's secondary text (ages, capture stamps, captured values): first to elide. */
const SEGMENT_DETAIL = 'min-w-0 truncate text-fg-secondary';

/** A segment's honest quiet answer (no data yet, nothing available). */
const SEGMENT_QUIET = 'text-fg-muted';

/** The placeholder slot's size, on the strip's real type ramp. */
const PLACEHOLDER = 'w-24';

/**
 * Each navigable segment's owning page, as the hash the shell's router
 * reads. The three data answers live on the Detections overview; the
 * freshness segment is absent from this table on purpose — data age is a
 * shell-owned concept, so it renders as text until a page owns it (never a
 * control that goes nowhere).
 */
const SEGMENT_TARGETS: Record<Exclude<SegmentId, 'freshness'>, string> = {
  wpr: '#/detections',
  cache: '#/detections',
  platform: '#/detections'
};

/**
 * The freshness segment's hover detail: the data's absolute capture stamp,
 * plus the stale state's remedy.
 *
 * @param kind The freshness answer the segment is showing.
 * @param view The view the stamp is read from.
 * @returns The title text, or undefined when there is no stamp to show.
 */
function freshnessTitle(
  kind: 'current' | 'stale',
  view: { readonly capturedAt: string | null }
): string | undefined {
  if (view.capturedAt === null) return undefined;
  const stamp = `Page data captured at ${view.capturedAt}`;
  return kind === 'current'
    ? `${stamp}.`
    : `${stamp} — older than ${STALE_WINDOW_MINUTES.toString()} min. Re-verify against the page; reload it to refresh.`;
}

/**
 * The freshness facts a `title` attr cannot carry to keyboard or screen-reader
 * users (title tooltips are hover-only and not reliably announced): the stamp
 * always, and the stale remedy when the marker is up. Rendered once as sr-only
 * text inside the segment — the hover `title` stays for mouse users, and the
 * non-interactive segment still ships no invented focus stop.
 *
 * @param props.kind The freshness answer the segment is showing.
 * @param props.view The view the stamp is read from.
 */
function FreshnessDetail(props: {
  kind: 'current' | 'stale';
  view: { readonly capturedAt: string | null };
}): JSX.Element {
  return (
    <span class="sr-only">
      {props.view.capturedAt === null ? null : (
        <span>Page data captured at {props.view.capturedAt}. </span>
      )}
      <Show when={props.kind === 'stale'} fallback={null}>
        <span>
          Data is older than {STALE_WINDOW_MINUTES} min — re-verify against the page; reload it to
          refresh.
        </span>
      </Show>
    </span>
  );
}

/**
 * A segment's quiet slot: the wait placeholder (a real wait — the same
 * skeleton language as the page above) when `loading`, otherwise the honest
 * silence dash. Non-interactive by definition: a control without a name or
 * a destination ships nowhere.
 *
 * @param props.loading True renders the wait placeholder; false the dash.
 */
function QuietSegment(props: { loading: boolean }): JSX.Element {
  return (
    <span class={SEGMENT}>
      <Show when={!props.loading} fallback={<Skeleton class={PLACEHOLDER} />}>
        <span class={SEGMENT_QUIET}>—</span>
      </Show>
    </span>
  );
}

/**
 * The presence/version segment: the plugin's chip when real data answers —
 * version beside the name when known, "Not detected" in the neutral tone
 * the toolbar badge's absent gray maps onto — and a quiet slot before data
 * or on an error. Navigates to the Detections overview, the page that
 * explains either answer.
 *
 * @param props The composed segments accessor (each read resolves the strip
 *   inside this segment's scope, keeping one selector failure contained).
 */
function WprSegment(props: { segments: () => StatusBarSegments }): JSX.Element {
  const view = createMemo(() => props.segments().wpr);
  const detected = createMemo(() => {
    const current = view();
    return current.kind === 'detected' ? current : undefined;
  });
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <QuietSegment loading />
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <QuietSegment loading={false} />
      </Match>
      <Match when={view().kind === 'not-detected'}>
        <a href={SEGMENT_TARGETS.wpr} class={cn(SEGMENT, SEGMENT_HOVER, FOCUS_RING)}>
          <StatusBadge kind="neutral" icon>
            Not detected
          </StatusBadge>
        </a>
      </Match>
      <Match when={detected()}>
        {(state) => (
          <a href={SEGMENT_TARGETS.wpr} class={cn(SEGMENT, SEGMENT_HOVER, FOCUS_RING)}>
            <StatusBadge kind="ok" icon class="min-w-0">
              {/* Non-keyed Match children rebuild their reads live: reading
                  the answered value through one narrowed accessor call keeps
                  the text reactive without re-rendering the branch. The
                  label rides its own eliding span — a validator-legal
                  64-char version shrinks inside its chip instead of pushing
                  the row's neighbors out. */}
              <Show when={state().version !== null} fallback="WP Rocket">
                <span class="min-w-0 truncate">{`WP Rocket ${state().version ?? ''}`}</span>
              </Show>
            </StatusBadge>
          </a>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The cached-or-not segment: the cache chip with its relative age when the
 * page is cached ("Cached" alone when no stamp exists — never an invented
 * age), the other four explicit cache states with their copy-module tooltip,
 * and a quiet slot while there is no answer — including when the plugin is
 * absent (caching is not its question there). A bypass reads "Bypass
 * requested" — the visit's intent, never a cache verdict nor a host/CDN claim.
 *
 * @param props The composed segments accessor (see {@link WprSegment}).
 */
function CacheSegment(props: { segments: () => StatusBarSegments }): JSX.Element {
  const view = createMemo(() => props.segments().cache);
  const cached = createMemo(() => {
    const current = view();
    return current.kind === 'cached' ? current : undefined;
  });
  /** The non-cached, non-silent states (every one carries the copy module's pair). */
  const cacheDetail = createMemo(() => {
    const current = view();
    return current.kind === 'uncertain-signature' ||
      current.kind === 'possibly-cached' ||
      current.kind === 'not-detected' ||
      current.kind === 'bypass-requested'
      ? current
      : undefined;
  });
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <QuietSegment loading />
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <QuietSegment loading={false} />
      </Match>
      <Match when={view().kind === 'not-applicable'}>
        <QuietSegment loading={false} />
      </Match>
      <Match when={cacheDetail()}>
        {(state) => (
          <Tooltip
            as="a"
            href={SEGMENT_TARGETS.cache}
            content={state().copy.tooltip}
            class={cn(SEGMENT, SEGMENT_HOVER)}
          >
            {/* Warn only for conflicting evidence; `not-detected` and the
                bypass request (intent, not a fault) stay neutral. */}
            <StatusBadge
              kind={
                state().kind === 'uncertain-signature' || state().kind === 'possibly-cached'
                  ? 'warn'
                  : 'neutral'
              }
              icon
            >
              {state().copy.chip}
            </StatusBadge>
          </Tooltip>
        )}
      </Match>
      <Match when={cached()}>
        {(state) => {
          // The stamp's pair — age and its absolute form — arrive together
          // (one implies the other); the `?? ''` fallbacks are type-shape
          // only, the guarded branch guarantees they never render. All
          // reads stay inline: a narrowed snapshot here would freeze the
          // displayed age (the branch never rebuilds on unchanged
          // truthiness).
          return (
            <Show
              when={state().age !== null}
              fallback={
                <a href={SEGMENT_TARGETS.cache} class={cn(SEGMENT, SEGMENT_HOVER, FOCUS_RING)}>
                  <StatusBadge kind="ok" class="min-w-0">
                    {state().copy.chip}
                  </StatusBadge>
                </a>
              }
            >
              <Tooltip
                as="a"
                href={SEGMENT_TARGETS.cache}
                content={state().copy.tooltip}
                class={cn(SEGMENT, SEGMENT_HOVER)}
              >
                <StatusBadge kind="ok" class="min-w-0">
                  {state().copy.chip}
                </StatusBadge>
                <span class={SEGMENT_DETAIL}>{state().age ?? ''}</span>
              </Tooltip>
            </Show>
          );
        }}
      </Match>
    </Switch>
  );
}

/**
 * The platform/server segment: the captured `server` and `x-powered-by`
 * values when the headers carry them; "unknown" as quiet text when the
 * captured headers name neither, the silence dash when none were captured
 * at all, and the placeholder before data. The captured value navigates to
 * the Detections overview (its cards carry the full header detail); a
 * valueless state doesn't ship a control.
 *
 * @param props The composed segments accessor (see {@link WprSegment}).
 */
function PlatformSegment(props: { segments: () => StatusBarSegments }): JSX.Element {
  const view = createMemo(() => props.segments().platform);
  const captured = createMemo(() => {
    const current = view();
    return current.kind === 'captured' ? current : undefined;
  });
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <QuietSegment loading />
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <QuietSegment loading={false} />
      </Match>
      <Match when={view().kind === 'unknown'}>
        <span class={SEGMENT}>
          <span class={SEGMENT_QUIET}>unknown</span>
        </span>
      </Match>
      <Match when={captured()}>
        {(state) => (
          <a href={SEGMENT_TARGETS.platform} class={cn(SEGMENT, SEGMENT_HOVER, FOCUS_RING)}>
            <span class="sr-only">Platform</span>
            <span class={SEGMENT_DETAIL}>{state().value}</span>
          </a>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The data-freshness segment — the strip's non-navigable answer: how old
 * the rendered data is, in the machine's own settle stamps, always as text
 * (data age is shell-owned; a page owning it is the revisit owner). The
 * stale marker past the selectors' threshold rides the shared vocabulary's
 * warn treatment; the hover detail states the capture stamp and, when
 * stale, the remedy.
 *
 * @param props The composed segments accessor (see {@link WprSegment}).
 */
function FreshnessSegment(props: { segments: () => StatusBarSegments }): JSX.Element {
  const view = createMemo(() => props.segments().freshness);
  /** Narrow the answer to one variant (undefined hides the branch). */
  const narrowed = (kind: 'current' | 'stale') =>
    createMemo(() => {
      const state = view();
      return state.kind === kind ? state : undefined;
    });
  const current = narrowed('current');
  const stale = narrowed('stale');
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <span class={SEGMENT}>
          <Skeleton class={PLACEHOLDER} />
        </span>
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <span class={SEGMENT}>
          <span class={SEGMENT_QUIET}>—</span>
        </span>
      </Match>
      <Match when={view().kind === 'refreshing'}>
        <span class={SEGMENT}>
          <span class={SEGMENT_DETAIL}>Refreshing…</span>
        </span>
      </Match>
      <Match when={current()}>
        {(state) => (
          <span title={freshnessTitle('current', state())} class={SEGMENT}>
            <FreshnessDetail kind="current" view={state()} />
            <span class={SEGMENT_DETAIL}>Updated {state().age}</span>
          </span>
        )}
      </Match>
      <Match when={stale()}>
        {(state) => (
          <span title={freshnessTitle('stale', state())} class={SEGMENT}>
            <FreshnessDetail kind="stale" view={state()} />
            <span class={SEGMENT_DETAIL}>Updated {state().age}</span>
            <StatusBadge kind="warn" icon>
              Stale
            </StatusBadge>
          </span>
        )}
      </Match>
    </Switch>
  );
}

/** Props of {@link StatusBar}. */
export interface StatusBarProps {
  /**
   * A control after the answers (the exclusion builder entry): outside the
   * answers' row and its crash containment, at the strip's end.
   */
  readonly trailing?: JSX.Element;
}

/**
 * Render the status bar.
 *
 * The strip reads the shell's data store through its context (pages and
 * strips never touch messaging) and ages its displayed values through the
 * aging clock, whose cadence follows the machine's loaded states and the
 * document's visibility. One rendering failure of a selector is contained:
 * the strip degrades to its downtime line instead of taking the shell down.
 */
export function StatusBar(props: StatusBarProps = {}): JSX.Element {
  const data = useFdtData();
  const clock = createAgingClock(realAgingClockDeps());

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

  /**
   * The composed segment views, read inside each segment's scope (the
   * accessor is plain so a throwing selector resolves at the segment —
   * under the boundary — rather than at the shell's root).
   */
  const segments = (): StatusBarSegments => statusBarSegments(data.state(), clock.now());

  return (
    <footer role="contentinfo" aria-label="Page status" data-fdt="panel-status-bar" class={STRIP}>
      <ErrorBoundary
        fallback={(cause: unknown) => {
          log.error('Status bar crashed — the strip renders its downtime line', {
            cause: cause instanceof Error ? { message: cause.message } : cause
          });
          return (
            <span class={SEGMENT}>
              <span class={SEGMENT_QUIET}>Status unavailable</span>
            </span>
          );
        }}
      >
        <div class={ROW}>
          <WprSegment segments={segments} />
          <CacheSegment segments={segments} />
          <PlatformSegment segments={segments} />
          <FreshnessSegment segments={segments} />
        </div>
      </ErrorBoundary>
      {props.trailing}
    </footer>
  );
}
