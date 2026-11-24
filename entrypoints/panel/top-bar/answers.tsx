/**
 * The top bar's four answers — is WP Rocket here, is the page cached, what
 * server served it, how old is the data — each rendered from its selector
 * view (`selectors.ts` decides; these components only place and wire).
 *
 * Data honesty: boot renders placeholder slots until real data arrives; an
 * errored state renders quiet slots (the error view below carries the
 * cause); real data saying "absent" renders the absent state — never a
 * fabricated answer for a question the data has not answered. The three
 * data answers link to the Detections overview (the page that explains
 * them); freshness is text, never a control.
 */
import { Match, Show, Switch, createMemo, type JSX } from 'solid-js';
import { FOCUS_RING } from '../../../components/ui/classes';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Tooltip } from '../../../components/ui/tooltip';
import { WPR_NOT_DETECTED } from '../../../lib/panel/wpr-evidence';
import { cn } from '../../../utils/cn';
import { routeHref } from '../router';
import { FOLD_ELIDE_MARK, FoldPart, type TopBarFoldControl } from './fold';
import type { FreshnessSegmentView, SegmentId, TopBarSegments } from './selectors';
import { cacheAnswerTone, STALE_WINDOW_MINUTES } from './selectors';

/** The composed answers accessor (each read resolves inside the caller's boundary). */
export type SegmentsAccessor = () => TopBarSegments;

/**
 * One answer's frame. No hover surface here: it is shared with the
 * non-interactive forms (quiet dashes, unknown, freshness text); links add
 * {@link ANSWER_HOVER}, so a hover affordance never decorates plain text.
 */
export const ANSWER =
  'flex min-h-6 min-w-0 items-center gap-1.5 rounded-full text-2xs text-fg-primary no-underline';

/** A link answer's hover surface. */
export const ANSWER_HOVER = 'hover:bg-surface-3';

/** The pill shape the status chips take in the bar. */
const PILL = 'h-5.5 min-w-0 whitespace-nowrap rounded-full px-1.5';

/**
 * A pill's label. The bar's fold keeps the pills whole by folding the
 * secondary parts first; only when nothing is left to fold (the floor)
 * does a label elide inside its pill, never a cut glyph. The fold reads
 * the label's lost width back through its marker attribute.
 */
const PILL_TEXT = 'min-w-0 truncate';

/**
 * The WP Rocket label's cap: an outsized (validator-legal 64-char) version
 * elides here by design (the full name stays in the link's name and title).
 */
const LEAD_TEXT_CAP = 'max-w-48';

/** The captured server value's cap: a long header pair elides here; the title keeps it whole. */
const SERVER_TEXT_CAP = 'max-w-72';

/** An answer's secondary text (ages, captured values): first to elide. */
const ANSWER_DETAIL = 'min-w-0 truncate text-fg-secondary';

/** An answer's honest quiet text (no data yet, nothing available). */
const ANSWER_QUIET = 'text-fg-muted';

/** The placeholder slot, pill-shaped. */
const PLACEHOLDER = 'h-5.5 w-20 rounded-full';

/**
 * A pill label, marked for the fold's elision read-back.
 *
 * @param props.class Extra classes (a cap).
 * @param props.children The label.
 */
function PillText(props: { class?: string; children: JSX.Element }): JSX.Element {
  return (
    <span {...FOLD_ELIDE_MARK} class={cn(PILL_TEXT, props.class)}>
      {props.children}
    </span>
  );
}

/**
 * Each linked answer's owning page, as the hash the shell's router reads.
 * Freshness is absent on purpose: data age is shell-owned, so it renders
 * as text until a page owns it (never a control that goes nowhere).
 */
export const ANSWER_TARGETS: Record<Exclude<SegmentId, 'freshness'>, string> = {
  wpr: routeHref('detections'),
  cache: routeHref('detections'),
  platform: routeHref('detections')
};

/**
 * The freshness answer's hover detail: the absolute instant the panel fetched the data,
 * plus the stale state's remedy.
 *
 * @param kind The freshness answer shown.
 * @param view The view the stamp is read from.
 * @returns The title text, or undefined when there is no stamp to show.
 */
export function freshnessTitle(
  kind: 'current' | 'stale',
  view: { readonly fetchedAt: string | null }
): string | undefined {
  if (view.fetchedAt === null) return undefined;
  const stamp = `Page data fetched at ${view.fetchedAt}`;
  return kind === 'current'
    ? `${stamp}.`
    : `${stamp} — older than ${STALE_WINDOW_MINUTES.toString()} min. Re-verify against the page; reload it to refresh.`;
}

/**
 * The freshness facts a `title` cannot carry to keyboard or screen-reader
 * users (title tooltips are hover-only): the stamp always, and the stale
 * remedy when the marker is up — sr-only text inside the answer, so the
 * non-interactive answer still ships no invented focus stop.
 *
 * @param props.kind The freshness answer shown.
 * @param props.view The view the stamp is read from.
 */
function FreshnessDetail(props: {
  kind: 'current' | 'stale';
  view: { readonly fetchedAt: string | null };
}): JSX.Element {
  return (
    <span class="sr-only">
      {props.view.fetchedAt === null ? null : (
        <span>Page data fetched at {props.view.fetchedAt}. </span>
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
 * An answer's quiet slot: the wait placeholder (a real wait) when
 * `loading`, otherwise the honest silence dash. Never interactive.
 *
 * @param props.loading True renders the placeholder; false the dash.
 */
function QuietAnswer(props: { loading: boolean }): JSX.Element {
  return (
    <span class={ANSWER}>
      <Show when={!props.loading} fallback={<Skeleton class={PLACEHOLDER} />}>
        <span class={ANSWER_QUIET}>—</span>
      </Show>
    </span>
  );
}

/**
 * The presence/version answer: the plugin's pill — version beside the name
 * when known, "Not detected" in the neutral tone (the toolbar badge's absent
 * gray) — and a quiet slot before data or on an error.
 *
 * @param props.segments The composed answers.
 * @param props.compact The folded bar: a known version shows alone (the
 *   name stays in the link's name and title).
 */
export function WprAnswer(props: { segments: SegmentsAccessor; compact: boolean }): JSX.Element {
  const view = createMemo(() => props.segments().wpr);
  const detected = createMemo(() => {
    const current = view();
    return current.kind === 'detected' ? current : undefined;
  });
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <QuietAnswer loading />
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <QuietAnswer loading={false} />
      </Match>
      <Match when={view().kind === 'not-detected'}>
        <a href={ANSWER_TARGETS.wpr} class={cn(ANSWER, ANSWER_HOVER, FOCUS_RING)}>
          <StatusBadge kind="neutral" icon class={PILL}>
            <PillText>{WPR_NOT_DETECTED}</PillText>
          </StatusBadge>
        </a>
      </Match>
      <Match when={detected()}>
        {(state) => (
          <a
            href={ANSWER_TARGETS.wpr}
            title={
              props.compact && state().version !== null
                ? `WP Rocket ${state().version ?? ''}`
                : undefined
            }
            class={cn(ANSWER, ANSWER_HOVER, FOCUS_RING)}
          >
            <StatusBadge kind="ok" icon class={PILL}>
              {/* Non-keyed Match children rebuild their reads live: one
                  narrowed accessor call keeps the text reactive without
                  re-rendering the branch. */}
              <Show when={state().version !== null} fallback={<PillText>WP Rocket</PillText>}>
                <PillText class={LEAD_TEXT_CAP}>
                  <span class={props.compact ? 'sr-only' : undefined}>WP Rocket </span>
                  {state().version ?? ''}
                </PillText>
              </Show>
            </StatusBadge>
          </a>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The cached-or-not answer: the cache pill with its relative age when the
 * page is cached ("Cached" alone when no stamp exists — never an invented
 * age), the other four explicit cache states with their copy-module
 * tooltip, and a quiet slot while there is no answer — including when the
 * plugin is absent (caching is not its question there). A bypass reads
 * "Bypass requested": the visit's intent, never a cache verdict.
 *
 * @param props.segments The composed answers.
 * @param props.compact The compact bar: the age hides visually (it stays in
 *   the link's name; the tooltip and the "⋯" menu keep it).
 * @param props.fold The bar's fold: on a full bar the age is a foldable
 *   part (whole or gone; the menu holds it when folded).
 */
export function CacheAnswer(props: {
  segments: SegmentsAccessor;
  compact: boolean;
  fold: TopBarFoldControl;
}): JSX.Element {
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
        <QuietAnswer loading />
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <QuietAnswer loading={false} />
      </Match>
      <Match when={view().kind === 'not-applicable'}>
        <QuietAnswer loading={false} />
      </Match>
      <Match when={cacheDetail()}>
        {(state) => (
          <Tooltip
            as="a"
            href={ANSWER_TARGETS.cache}
            content={state().copy.tooltip}
            placement="bottom"
            class={cn(ANSWER, ANSWER_HOVER)}
          >
            {/* The shared tone rule (warn only for conflicting evidence). */}
            <StatusBadge kind={cacheAnswerTone(state())} icon class={PILL}>
              <PillText>{state().copy.chip}</PillText>
            </StatusBadge>
          </Tooltip>
        )}
      </Match>
      <Match when={cached()}>
        {(state) => {
          // The stamp's pair — age and its absolute form — arrive together;
          // the `?? ''` fallback is type-shape only. All reads stay inline:
          // a narrowed snapshot here would freeze the displayed age.
          return (
            <Show
              when={state().age !== null}
              fallback={
                <a href={ANSWER_TARGETS.cache} class={cn(ANSWER, ANSWER_HOVER, FOCUS_RING)}>
                  <StatusBadge kind={cacheAnswerTone(state())} class={PILL}>
                    <PillText>{state().copy.chip}</PillText>
                  </StatusBadge>
                </a>
              }
            >
              <Tooltip
                as="a"
                href={ANSWER_TARGETS.cache}
                content={state().copy.tooltip}
                placement="bottom"
                class={cn(ANSWER, ANSWER_HOVER)}
              >
                <StatusBadge kind={cacheAnswerTone(state())} class={PILL}>
                  <PillText>{state().copy.chip}</PillText>
                </StatusBadge>
                {/* Compact: sr-only (the name keeps it). Full: a foldable
                    part, whole or gone; its end padding is the hover
                    surface's, so it leaves with the age. */}
                <Show
                  when={!props.compact}
                  fallback={<span class="sr-only">{state().age ?? ''}</span>}
                >
                  <FoldPart fold={props.fold} part="cacheAge" class="pe-1">
                    <span class="text-fg-secondary">{state().age ?? ''}</span>
                  </FoldPart>
                </Show>
              </Tooltip>
            </Show>
          );
        }}
      </Match>
    </Switch>
  );
}

/**
 * The platform/server answer: the captured `server` and `x-powered-by`
 * values when the headers carry them; "unknown" as quiet text when the
 * captured headers name neither, the silence dash when none were captured,
 * the placeholder before data. A captured value links to the Detections
 * overview; a valueless state ships no control. The bar folds the whole
 * answer (whole or gone); a value past its cap elides, the title keeps it.
 *
 * @param props.segments The composed answers.
 */
export function PlatformAnswer(props: { segments: SegmentsAccessor }): JSX.Element {
  const view = createMemo(() => props.segments().platform);
  const captured = createMemo(() => {
    const current = view();
    return current.kind === 'captured' ? current : undefined;
  });
  return (
    <Switch>
      <Match when={view().kind === 'loading'}>
        <QuietAnswer loading />
      </Match>
      <Match when={view().kind === 'unavailable'}>
        <QuietAnswer loading={false} />
      </Match>
      <Match when={view().kind === 'unknown'}>
        <span class={ANSWER}>
          <span class={ANSWER_QUIET}>unknown</span>
        </span>
      </Match>
      <Match when={captured()}>
        {(state) => (
          <a
            href={ANSWER_TARGETS.platform}
            title={state().value}
            class={cn(ANSWER, ANSWER_HOVER, FOCUS_RING, 'px-1 font-mono')}
          >
            <span class="sr-only">Platform</span>
            <span class={cn(ANSWER_DETAIL, SERVER_TEXT_CAP, 'text-fg-muted')}>{state().value}</span>
          </a>
        )}
      </Match>
    </Switch>
  );
}

/**
 * The data-freshness answer — the bar's non-navigable one: how old the
 * shown data is, always as text. The stale marker past the selectors'
 * threshold rides the warn treatment; the hover title states the capture
 * stamp and, when stale, the remedy; the same facts ride sr-only text.
 *
 * @param props.view The freshness view.
 * @param props.short Show the age alone beside the Refresh control (the
 *   "Updated" word stays in the text, sr-only).
 */
export function FreshnessAnswer(props: {
  view: () => FreshnessSegmentView;
  short?: boolean;
}): JSX.Element {
  /**
   * The age text. Full form: "Updated <age>". Short form: the same words
   * for assistive tech and text reads (sr-only), the age alone on screen.
   *
   * @param age The relative age.
   */
  const ageText = (age: string): JSX.Element => (
    <Show when={props.short === true} fallback={<span class={ANSWER_DETAIL}>Updated {age}</span>}>
      <span class="sr-only">Updated {age}</span>
      <span class={ANSWER_DETAIL} aria-hidden="true">
        {age}
      </span>
    </Show>
  );
  /** Narrow the answer to one variant (undefined hides the branch). */
  const narrowed = (kind: 'current' | 'stale') =>
    createMemo(() => {
      const state = props.view();
      return state.kind === kind ? state : undefined;
    });
  const current = narrowed('current');
  const stale = narrowed('stale');
  return (
    <Switch>
      <Match when={props.view().kind === 'loading'}>
        <span class={ANSWER}>
          <Skeleton class="h-4 w-16" />
        </span>
      </Match>
      <Match when={props.view().kind === 'unavailable'}>
        <span class={ANSWER}>
          <span class={ANSWER_QUIET}>—</span>
        </span>
      </Match>
      <Match when={props.view().kind === 'refreshing'}>
        <span class={ANSWER}>
          <span class={ANSWER_DETAIL}>Refreshing…</span>
        </span>
      </Match>
      <Match when={current()}>
        {(state) => (
          <span title={freshnessTitle('current', state())} class={ANSWER}>
            <FreshnessDetail kind="current" view={state()} />
            {ageText(state().age)}
          </span>
        )}
      </Match>
      <Match when={stale()}>
        {(state) => (
          <span title={freshnessTitle('stale', state())} class={ANSWER}>
            <FreshnessDetail kind="stale" view={state()} />
            {ageText(state().age)}
            <StatusBadge kind="warn" icon>
              Stale
            </StatusBadge>
          </span>
        )}
      </Match>
    </Switch>
  );
}
