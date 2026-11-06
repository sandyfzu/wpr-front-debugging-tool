/**
 * The LCP analysis card: what an analysis does, the Analyse control with the
 * opt-in highlight switch, and the analysis's state — pending (keeps the
 * shown answer), the outcome with its notes and recoveries, the four-part
 * breakdown with its total, and the candidates in paint order. Every state
 * is read from the session; nothing here latches.
 *
 * States: never analysed (the disclosure only) · pending · page-unreachable
 * (per miss) · unsupported · no LCP · no navigation timing (candidates only)
 * · breakdown (+ text/missing-resource, prerender, highlight and stale notes).
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import Info from 'lucide-solid/icons/info';
import ScanSearch from 'lucide-solid/icons/scan-search';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Switch } from '../../../../components/ui/switch';
import type { LcpBreakdown } from '../../../../lib/lcp-analysis/breakdown';
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
import { RecoveryButtons } from './recovery-buttons';
import type { LcpVitalsSession } from './session';

/** What an analysis does, next to Analyse. */
export const LCP_DISCLOSURE =
  'Reads the LCP the browser reported for the inspected page so far. The page is not changed — framing the element only draws over it.';

/** The highlight switch's label. */
export const HIGHLIGHT_LABEL = `Frame the LCP element on the page (${formatCount(LCP_HIGHLIGHT_MS / 1000)} s)`;

/** The line once the page reloaded or navigated after the shown analysis. */
export const LCP_STALE_COPY =
  'The page reloaded since this analysis — it describes the earlier load. Analyse again for the page as it is now.';

/** The recoveries' button labels. */
export const LCP_RECOVERY_LABELS: Readonly<Record<LcpRecovery, string>> = {
  retry: 'Analyse again',
  'reload-page': 'Reload page'
};

/** Props of {@link LcpCard}. */
export interface LcpCardProps {
  session: LcpVitalsSession;
  /** Reload the inspected page; absent where the context cannot. */
  reloadPage?: () => void;
}

/**
 * The breakdown: one row per part (name, what it measures, a share meter,
 * time and share), then the total.
 *
 * @param props The breakdown.
 */
function Breakdown(props: { breakdown: LcpBreakdown }): JSX.Element {
  return (
    <div data-fdt="lcp-breakdown" class="flex flex-col">
      <For each={props.breakdown.parts}>
        {(part) => (
          <div
            data-fdt-lcp-part={part.key}
            class="flex min-h-8 flex-col gap-1 border-b border-line-1 py-1.5"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="min-w-0 text-xs text-fg-primary">{LCP_PART_LABELS[part.key]}</span>
              <span class="shrink-0 text-xs text-fg-primary tabular-nums">
                {formatMs(part.duration)}
                <span class="ms-1.5 inline-block w-12 text-end text-2xs text-fg-secondary">
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
      <div data-fdt-lcp-total class="flex items-baseline justify-between gap-2 pt-1.5">
        <span class="text-xs font-semibold text-fg-primary">LCP</span>
        <span class="text-xs font-semibold text-fg-primary tabular-nums">
          {formatMs(props.breakdown.total)}
        </span>
      </div>
    </div>
  );
}

/**
 * The candidates in paint order, the LCP marked.
 *
 * @param props The analysis.
 */
function Candidates(props: {
  outcome: Extract<LcpAnalysisOutcome, { kind: 'analysed' }>;
}): JSX.Element {
  const rows = createMemo(() =>
    candidateRows(props.outcome.candidates, props.outcome.activationStart)
  );
  return (
    <Show when={rows().length > 0}>
      <section class="flex flex-col gap-1.5" aria-label="LCP candidates">
        <h3 class="text-xs font-semibold text-fg-primary">
          Candidates{' '}
          <span class="font-normal text-fg-secondary tabular-nums">
            ({formatCount(rows().length)})
          </span>
        </h3>
        <ol data-fdt="lcp-candidates" class="flex flex-col">
          <For each={rows()}>
            {(row) => (
              <li
                data-fdt-lcp-candidate={row.id}
                class="flex min-h-8 min-w-0 flex-col justify-center gap-0.5 border-b border-line-1 py-1"
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

/**
 * Render the card.
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
    <Card level={1} class="p-2.5">
      <section data-fdt="lcp-card" class="flex flex-col gap-2.5" aria-labelledby="lcp-card-title">
        <h2 id="lcp-card-title" class="text-sm font-semibold text-fg-primary">
          Largest Contentful Paint
        </h2>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="primary"
            busy={run().pending}
            data-fdt-lcp-analyse
            onClick={() => {
              void props.session.analysis.start();
            }}
          >
            <Show when={!run().pending}>
              <ScanSearch size={12} aria-hidden="true" />
            </Show>
            {run().pending ? 'Analysing…' : 'Analyse LCP'}
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
                onRetry={() => {
                  void props.session.analysis.start();
                }}
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
      </section>
    </Card>
  );
}
