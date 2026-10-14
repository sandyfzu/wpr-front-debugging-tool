/**
 * The Detections summary strip: the long form of the status bar's short
 * answers — plugin + version, cache state with its relative AND absolute
 * time, the platform plus the header that identified it, the server value —
 * and "N of M optimizations active". One wrapping line of `·`-separated
 * facts read off the same card list the grid renders (so the two cannot
 * disagree).
 *
 * The separators are clipped at line starts: every fact carries its leading
 * dot in the negative inline-start margin the list hides behind its
 * `overflow-hidden` frame, so a wrapped line never opens with a stray `·`;
 * the dot's empty CSS alt text keeps it out of the accessibility tree.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import { Card } from '../../../../components/ui/card';
import { StatusBadge } from '../../../../components/ui/status-badge';
import type { DetectionsSummary } from '../../../../lib/panel/detections-summary';
import { relativeAge } from '../../status-bar/relative-age';

/**
 * One fact: an inline group with its leading separator in the hidden gutter
 * (`ms-3` pushes it in, the `before:` dot sits in that margin).
 */
const FACT =
  "relative ms-3 inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1 before:absolute before:-start-2 before:text-fg-muted before:content-['·'_/_'']";

/** Props of {@link SummaryStrip}. */
export interface SummaryStripProps {
  /** The page facts. */
  summary: DetectionsSummary;
  /** The page clock reading (epoch ms) relative ages read. */
  now: number;
}

/**
 * Render the summary strip.
 *
 * @param props See {@link SummaryStripProps}.
 */
export function SummaryStrip(props: SummaryStripProps): JSX.Element {
  const cached = () => (props.summary.cache.kind === 'cached' ? props.summary.cache : undefined);
  return (
    <Card level={1}>
      {/* The clip frame sits on the content box, so line-start dots vanish. */}
      <div class="overflow-hidden">
        <ul
          data-fdt="detections-summary"
          aria-label="Page summary"
          class="-ms-3 flex flex-wrap items-center gap-y-1.5 text-xs"
        >
          <li class={FACT}>
            <Show
              when={props.summary.wpr.present ? props.summary.wpr : undefined}
              fallback={
                <StatusBadge kind="neutral" icon>
                  WP Rocket not detected
                </StatusBadge>
              }
            >
              {(wpr) => (
                <StatusBadge kind="ok" icon class="min-w-0">
                  <span class="min-w-0 truncate">
                    WP Rocket
                    <Show when={wpr().version}>
                      {(version) => <span class="font-mono"> {version()}</span>}
                    </Show>
                  </span>
                </StatusBadge>
              )}
            </Show>
          </li>
          <Switch>
            <Match when={cached()}>
              {(cache) => (
                <li class={FACT} data-fdt-summary-fact="cache">
                  <span class="font-medium">Cached</span>
                  <Show when={cache().seconds !== null && cache().formatted !== null}>
                    <span class="tabular-nums">
                      {relativeAge(props.now - (cache().seconds ?? 0) * 1000)}
                    </span>
                    <span class="text-2xs text-fg-secondary tabular-nums">
                      ({cache().formatted})
                    </span>
                  </Show>
                </li>
              )}
            </Match>
            <Match when={props.summary.cache.kind === 'not-cached'}>
              <li class={FACT} data-fdt-summary-fact="cache">
                <span class="text-fg-secondary">Not cached</span>
              </li>
            </Match>
          </Switch>
          <Show when={props.summary.platform}>
            {(platform) => (
              <li class={FACT} data-fdt-summary-fact="platform">
                <span class="font-medium">{platform().name}</span>
                <span class="text-2xs text-fg-secondary">
                  via <span class="font-mono break-all">{platform().header}</span>
                </span>
              </li>
            )}
          </Show>
          <Show when={props.summary.server}>
            {(server) => (
              <li class={FACT} data-fdt-summary-fact="server">
                <span class="text-fg-muted">Server</span>
                <span class="font-mono break-all">{server()}</span>
              </li>
            )}
          </Show>
          <li class={FACT} data-fdt-summary-fact="optimizations">
            <span class="font-medium tabular-nums">
              {props.summary.optimizations.active} of {props.summary.optimizations.total}
            </span>
            <span class="text-fg-secondary">optimizations active</span>
          </li>
        </ul>
      </div>
    </Card>
  );
}
