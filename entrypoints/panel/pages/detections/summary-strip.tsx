/**
 * The Detections summary strip — the one answer the status bar does not
 * give: how much of WP Rocket is working on this page ("N of M
 * optimizations active", with a small accent meter right after it), plus
 * the facts the bar lacks or only labels: the cache's absolute generation
 * time (the bar shows its age); for every non-cached state, the same cache
 * label the bar's segment shows, here as the focusable trigger of the
 * shared explanation (the bar has no room for the why); the hosting cache
 * layer when the cache state does not already settle or name it; the
 * WordPress version; and the header that identified the platform. Plugin
 * presence, version, age and server stay the status bar's alone.
 *
 * Card facts are read off the same card list the grid renders, so the two
 * cannot disagree; the page facts (cache state, layer, WordPress version)
 * come from the same summary the support report prints. Secondary facts sit
 * on one wrapping line of `·`-separated items whose separators are clipped
 * at line starts (each dot lives in the item's hidden inline-start gutter,
 * with empty CSS alt text so it never reaches the accessibility tree).
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Card } from '../../../../components/ui/card';
import { Tooltip } from '../../../../components/ui/tooltip';
import { cacheCopy, cacheLayerCopy, type CacheCopy } from '../../../../lib/detection/cache-context';
import type { DetectionsSummary } from '../../../../lib/panel/detections-summary';

/** One secondary fact, its separator dot in the clipped gutter. */
const FACT =
  "relative ms-3 min-w-0 max-w-full before:absolute before:-start-2 before:text-fg-muted before:content-['·'_/_'']";

/**
 * A fact-as-tooltip-trigger: reads as text (dotted underline hints the
 * explanation); keeps the 24 px hit area without loosening the line rhythm.
 */
const FACT_TRIGGER =
  '-my-1 justify-items-start text-start text-fg-primary underline decoration-line-3 decoration-dotted underline-offset-2';

/**
 * The cache copy the strip renders as an explained fact: every state except
 * `cached` (whose fact is the absolute stamp) and `not-applicable` (no
 * cache question on a page WP Rocket did not handle).
 *
 * @param cache The summary's cache answer.
 * @returns The shared chip/tooltip copy, or null when no explained fact applies.
 */
export function explainedCacheCopy(cache: DetectionsSummary['cache']): CacheCopy | null {
  if (cache.kind === 'not-applicable' || cache.kind === 'cached') return null;
  return cacheCopy(cache);
}

/**
 * The meter's fill share, as a CSS width.
 *
 * @param active Active optimizations.
 * @param total All optimization rows.
 * @returns A percentage in [0, 100] (0 for an empty set).
 */
export function meterWidth(active: number, total: number): string {
  if (total <= 0 || active <= 0) return '0%';
  return `${Math.min(100, (active / total) * 100).toFixed(2)}%`;
}

/**
 * The machine-readable form of a cache stamp for `<time datetime>`.
 *
 * @param seconds Epoch seconds (representable by the view model's contract).
 * @returns The ISO-8601 instant.
 */
function isoInstant(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Props of {@link SummaryStrip}. */
export interface SummaryStripProps {
  /** The page facts. */
  summary: DetectionsSummary;
}

/**
 * Render the summary strip.
 *
 * @param props See {@link SummaryStripProps}.
 * @returns The strip card.
 */
export function SummaryStrip(props: SummaryStripProps): JSX.Element {
  const counts = () => props.summary.optimizations;
  /** The cache stamp when the page is cached with a representable one. */
  const stamp = () => {
    const cache = props.summary.cache;
    return cache.kind === 'cached' && cache.seconds !== null && cache.formatted !== null
      ? { seconds: cache.seconds, formatted: cache.formatted }
      : undefined;
  };
  const explained = () => explainedCacheCopy(props.summary.cache);
  const hasFacts = () =>
    !props.summary.wpr.present ||
    stamp() !== undefined ||
    explained() !== null ||
    props.summary.cacheLayer !== null ||
    props.summary.wordpressVersion !== null ||
    props.summary.platform !== null;

  return (
    <Card level={1}>
      <div data-fdt="detections-summary" class="flex flex-col gap-2">
        {/* The meter sits right after the headline (under it when the line
            is full), sized to read as part of the sentence, not as a bar. */}
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p data-fdt-summary-headline class="text-sm text-fg-primary">
            <span class="font-semibold tabular-nums">{counts().active}</span>
            <span class="text-fg-secondary">
              {' '}
              of <span class="tabular-nums">{counts().total}</span> optimizations active
            </span>
          </p>
          {/* Decorative: the sentence beside it states the same numbers. */}
          <div
            aria-hidden="true"
            data-fdt-summary-meter
            class="h-1.5 w-48 max-w-full shrink overflow-hidden rounded-full bg-surface-3"
          >
            <div
              class="h-full rounded-full bg-accent"
              style={{ width: meterWidth(counts().active, counts().total) }}
            />
          </div>
        </div>
        <Show when={hasFacts()}>
          <div class="overflow-hidden">
            <ul
              aria-label="Page facts"
              class="-ms-3 flex flex-wrap gap-y-1 text-2xs text-fg-secondary"
            >
              <Show when={!props.summary.wpr.present}>
                <li class={FACT} data-fdt-summary-fact="wpr">
                  WP Rocket was not detected on this page.
                </li>
              </Show>
              <Show when={stamp()}>
                {(cache) => (
                  <li class={FACT} data-fdt-summary-fact="cache">
                    Cache generated{' '}
                    <time
                      class="whitespace-nowrap tabular-nums text-fg-primary"
                      datetime={isoInstant(cache().seconds)}
                    >
                      {cache().formatted}
                    </time>
                  </li>
                )}
              </Show>
              <Show when={explained()}>
                {(copy) => (
                  <li class={FACT} data-fdt-summary-fact="cache">
                    <Tooltip content={copy().tooltip} class={FACT_TRIGGER}>
                      {copy().chip}
                    </Tooltip>
                  </li>
                )}
              </Show>
              <Show when={props.summary.cacheLayer}>
                {(layer) => (
                  <li class={FACT} data-fdt-summary-fact="cache-layer">
                    {cacheLayerCopy(layer()).fact}
                  </li>
                )}
              </Show>
              <Show when={props.summary.wordpressVersion}>
                {(version) => (
                  <li class={FACT} data-fdt-summary-fact="wordpress">
                    WordPress <span class="font-mono break-all text-fg-primary">{version()}</span>
                  </li>
                )}
              </Show>
              <Show when={props.summary.platform}>
                {(platform) => (
                  <li class={FACT} data-fdt-summary-fact="platform">
                    <span class="text-fg-primary">{platform().name}</span> via{' '}
                    <span class="font-mono break-all text-fg-primary">{platform().header}</span>
                  </li>
                )}
              </Show>
            </ul>
          </div>
        </Show>
      </div>
    </Card>
  );
}
