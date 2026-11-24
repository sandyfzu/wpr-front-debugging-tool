/**
 * The LCP analysis section: a run bar (Analyze, the opt-in highlight switch,
 * what an analysis does) above a result card holding the analysis's state —
 * the outcome with its notes and recoveries, the four-part breakdown with
 * its total, and the candidates in paint order. Every state is read from the
 * session; nothing here latches.
 *
 * States: never analysed (an empty card saying what Analyze produces) ·
 * first analysis pending (a skeleton shaped like the result — the real wait
 * only) · re-analysing (keeps the shown answer, Analyze busy) ·
 * page-unreachable (per miss) · unsupported · no LCP · no navigation timing
 * (candidates only) · breakdown (+ text/missing-resource, prerender,
 * highlight and stale notes) · a failed re-analysis (its notice above the
 * kept answer).
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import Info from 'lucide-solid/icons/info';
import ScanSearch from 'lucide-solid/icons/scan-search';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Switch } from '../../../../components/ui/switch';
import { LCP_PARTS, type LcpBreakdown } from '../../../../lib/lcp-analysis/breakdown';
import { LCP_HIGHLIGHT_MS } from '../../../../lib/lcp-analysis/deadlines';
import {
  candidateRows,
  describeLcpOutcome,
  formatMs,
  formatPercent,
  LCP_HIGHLIGHT_NOTES,
  LCP_PART_HINTS,
  LCP_PART_LABELS,
  LCP_RESOURCE_NOTES,
  prerenderNote,
  type LcpRecovery
} from '../../../../lib/lcp-analysis/outcome-view';
import type { LcpAnalysisOutcome } from '../../../../lib/lcp-analysis/run-analysis';
import { formatCount } from '../../../../utils/format-count';
import { OutcomeNotice } from '../outcome-notice';
import { RecoveryButtons } from '../recovery-buttons';
import { ToolEmptyCard } from '../tool-empty-card';
import type { LcpVitalsSession } from './session';
import { RELOAD_PAGE_LABEL } from '../recovery-words';

/** What an analysis does, next to Analyze. */
export const LCP_DISCLOSURE =
  'Reads the LCP the browser reported for the inspected page so far. The page is not changed — framing the element only draws over it.';

/** The highlight switch's label. */
export const HIGHLIGHT_LABEL = `Frame the LCP element on the page (${formatCount(LCP_HIGHLIGHT_MS / 1000)} s)`;

/** The line once the page reloaded or navigated after the shown analysis. */
export const LCP_STALE_COPY =
  'The page reloaded or changed since this analysis — it describes the earlier page load. Analyze again for the page as it is now.';

/** The recoveries' button labels. */
export const LCP_RECOVERY_LABELS: Readonly<Record<LcpRecovery, string>> = {
  retry: 'Analyze again',
  'reload-page': RELOAD_PAGE_LABEL
};

/** The result card before any analysis: what Analyze produces. */
export const LCP_EMPTY = {
  title: 'No analysis yet',
  description:
    "Analyze to split this page's LCP into its four parts, from the first byte to the paint, and list every candidate in paint order."
} as const;

/** The parts' grid: stacked when compact, two by two from `@regular`, one row from `@wide`. */
const PARTS_GRID = 'grid gap-3 @regular:grid-cols-2 @wide:grid-cols-4';

/** Props of {@link LcpCard}. */
export interface LcpCardProps {
  session: LcpVitalsSession;
  /** Reload the inspected page; absent where the context cannot. */
  reloadPage?: () => void;
}

/**
 * The breakdown: its total, then one block per part (name, time and share,
 * a share meter, what it measures).
 *
 * @param props.breakdown The breakdown.
 */
function Breakdown(props: { breakdown: LcpBreakdown }): JSX.Element {
  return (
    <section
      data-fdt="lcp-breakdown"
      class="flex flex-col gap-2"
      aria-labelledby="lcp-breakdown-title"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 id="lcp-breakdown-title" class="text-xs font-semibold text-fg-primary">
          Breakdown
        </h3>
        <span data-fdt-lcp-total class="text-xs font-semibold text-fg-primary tabular-nums">
          LCP {formatMs(props.breakdown.total)}
        </span>
      </div>
      <div class={PARTS_GRID}>
        <For each={props.breakdown.parts}>
          {(part) => (
            <div data-fdt-lcp-part={part.key} class="flex min-w-0 flex-col gap-1">
              <div class="flex flex-wrap items-baseline justify-between gap-x-2">
                <span class="min-w-0 text-xs text-fg-primary">{LCP_PART_LABELS[part.key]}</span>
                <span class="shrink-0 text-xs font-semibold text-fg-primary tabular-nums">
                  {formatMs(part.duration)}
                  <span class="ms-1.5 font-normal text-2xs text-fg-secondary">
                    {formatPercent(part.percent)}
                  </span>
                </span>
              </div>
              <div class="h-1 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-accent"
                  style={{ width: `${String(part.percent ?? 0)}%` }}
                />
              </div>
              <span class="text-2xs text-fg-muted">{LCP_PART_HINTS[part.key]}</span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

/**
 * The candidates in paint order, the LCP marked.
 *
 * @param props.outcome The analysis.
 */
function Candidates(props: {
  outcome: Extract<LcpAnalysisOutcome, { kind: 'analysed' }>;
}): JSX.Element {
  const rows = createMemo(() =>
    candidateRows(props.outcome.candidates, props.outcome.activationStart)
  );
  return (
    <Show when={rows().length > 0}>
      <section class="flex flex-col gap-1" aria-labelledby="lcp-candidates-title">
        <h3 id="lcp-candidates-title" class="text-xs font-semibold text-fg-primary">
          Candidates{' '}
          <span class="font-normal text-fg-secondary tabular-nums">
            ({formatCount(rows().length)})
          </span>
        </h3>
        <ol data-fdt="lcp-candidates" class="flex flex-col gap-1">
          <For each={rows()}>
            {(row) => (
              <li
                data-fdt-lcp-candidate={row.id}
                class="flex min-h-9 min-w-0 flex-col justify-center gap-0.5 py-1"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="w-5 shrink-0 text-2xs text-fg-muted tabular-nums">{row.id}</span>
                  <span
                    class="min-w-0 flex-1 truncate font-mono text-2xs text-fg-primary"
                    title={row.element ?? undefined}
                  >
                    {row.element ?? 'Element no longer on the page'}
                  </span>
                  <Show when={row.isLcp}>
                    <Badge kind="info">LCP</Badge>
                  </Show>
                  <span class="shrink-0 text-2xs text-fg-secondary tabular-nums">{row.time}</span>
                </div>
                <div class="flex min-w-0 items-center gap-2 ps-7 text-2xs text-fg-secondary">
                  <span class="min-w-0 flex-1 truncate font-mono" title={row.url ?? undefined}>
                    {row.url ?? 'Text'}
                  </span>
                  <span class="shrink-0 tabular-nums">{row.size}</span>
                </div>
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
}

/** The result card before any analysis: an honest empty view naming what Analyze produces. */
function EmptyResult(): JSX.Element {
  return (
    <ToolEmptyCard
      hook="lcp-empty"
      icon={ScanSearch}
      title={LCP_EMPTY.title}
      description={LCP_EMPTY.description}
    />
  );
}

/** The first analysis's wait: a skeleton shaped like the result (outcome, parts, candidates). */
function ResultSkeleton(): JSX.Element {
  return (
    <Card>
      <div data-fdt-lcp-loading class="flex flex-col gap-3">
        <Skeleton class="h-12 rounded-md" />
        <div class="flex justify-between gap-2">
          <Skeleton class="h-3 w-20" />
          <Skeleton class="h-3 w-16" />
        </div>
        <div class={PARTS_GRID}>
          <For each={LCP_PARTS}>
            {() => (
              <div class="flex flex-col gap-1.5">
                <Skeleton class="h-3 w-28 max-w-full" />
                <Skeleton class="h-1" />
                <Skeleton class="h-3 w-40 max-w-full" />
              </div>
            )}
          </For>
        </div>
        <Skeleton class="h-3 w-24" />
        <Skeleton class="h-8" />
        <Skeleton class="h-8" />
      </div>
    </Card>
  );
}

/**
 * Render the section.
 *
 * @param props See {@link LcpCardProps}.
 */
export function LcpCard(props: LcpCardProps): JSX.Element {
  const run = () => props.session.analysis.state();
  const shown = () => run().shown;
  const view = createMemo(() => {
    const answer = shown();
    return answer === null ? null : describeLcpOutcome(answer.outcome);
  });
  /** A failed re-analysis's words (the kept answer stays below), else null. */
  const failureView = createMemo(() => {
    const failure = run().failure;
    return failure === null ? null : describeLcpOutcome(failure.outcome);
  });
  /** Analyze again. */
  const analyse = (): void => {
    void props.session.analysis.start();
  };
  /** The analysed outcome, else undefined. */
  const analysed = () => {
    const outcome = shown()?.outcome;
    return outcome?.kind === 'analysed' ? outcome : undefined;
  };
  /** The breakdown, when one was computed. */
  const breakdown = () => {
    const outcome = analysed();
    return outcome?.breakdown.kind === 'breakdown' ? outcome.breakdown : undefined;
  };
  /** The notes under the outcome's sentence: the LCP resource's, the prerender's, the highlight's. */
  const notes = (): string[] => {
    const outcome = analysed();
    if (outcome === undefined) return [];
    const parts = breakdown();
    return [
      parts === undefined ? null : LCP_RESOURCE_NOTES[parts.resource],
      prerenderNote(outcome.activationStart),
      LCP_HIGHLIGHT_NOTES[outcome.highlight]
    ].filter((note): note is string => note !== null);
  };

  return (
    <section data-fdt="lcp-card" class="flex flex-col gap-2.5" aria-labelledby="lcp-card-title">
      <h2 id="lcp-card-title" class="text-sm font-semibold text-fg-primary">
        Largest Contentful Paint
      </h2>
      <Card>
        <div data-fdt="lcp-run-bar" class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant="primary" busy={run().pending} data-fdt-lcp-analyse onClick={analyse}>
              <Show when={!run().pending}>
                <ScanSearch size={12} aria-hidden="true" />
              </Show>
              {run().pending ? 'Analyzing…' : 'Analyze LCP'}
            </Button>
            <Switch
              label={HIGHLIGHT_LABEL}
              checked={props.session.highlight()}
              onChange={(on) => {
                props.session.setHighlight(on);
              }}
              class="min-w-0"
            />
          </div>
          <p class="flex items-start gap-1.5 text-2xs text-fg-secondary">
            <Info size={12} class="mt-px shrink-0 text-fg-muted" aria-hidden="true" />
            <span>{LCP_DISCLOSURE}</span>
          </p>
        </div>
      </Card>
      <Show
        when={shown() !== null}
        fallback={
          <Show when={run().pending} fallback={<EmptyResult />}>
            <ResultSkeleton />
          </Show>
        }
      >
        <Card>
          <div data-fdt="lcp-result" class="flex flex-col gap-3">
            <Show when={failureView()} keyed>
              {(failure) => (
                <OutcomeNotice
                  data-fdt="lcp-failure"
                  data-fdt-lcp-outcome={run().failure?.outcome.kind}
                  kind={failure.tone}
                  title={failure.title}
                  message={failure.message}
                >
                  <RecoveryButtons
                    recoveries={failure.recoveries}
                    labels={LCP_RECOVERY_LABELS}
                    onRetry={analyse}
                    reloadPage={props.reloadPage}
                    hook="lcp-failure"
                  />
                </OutcomeNotice>
              )}
            </Show>
            <Show when={view()} keyed>
              {(outcomeView) => (
                <OutcomeNotice
                  data-fdt="lcp-outcome"
                  data-fdt-lcp-outcome={shown()?.outcome.kind}
                  kind={outcomeView.tone}
                  title={outcomeView.title}
                  message={outcomeView.message}
                >
                  <For each={notes()}>
                    {(note) => <p class="ps-5 text-2xs text-fg-secondary">{note}</p>}
                  </For>
                  <Show when={props.session.analysis.stale()}>
                    <p data-fdt-lcp-stale class="ps-5 text-2xs text-fg-secondary">
                      {LCP_STALE_COPY}
                    </p>
                  </Show>
                  <RecoveryButtons
                    recoveries={outcomeView.recoveries}
                    labels={LCP_RECOVERY_LABELS}
                    onRetry={analyse}
                    reloadPage={props.reloadPage}
                    hook="lcp"
                  />
                </OutcomeNotice>
              )}
            </Show>
            <Show when={breakdown()} keyed>
              {(parts) => <Breakdown breakdown={parts} />}
            </Show>
            <Show when={analysed()} keyed>
              {(outcome) => <Candidates outcome={outcome} />}
            </Show>
          </div>
        </Card>
      </Show>
    </section>
  );
}
