/**
 * Renders one {@link Banner}: glyph + title + body, side notes, and its
 * forward actions as buttons. The banner is a status region (`role=status`)
 * only when asked — the main state banner announces its changes; a notice
 * banner is announced through the overlay's own announcer instead.
 */
import { For, Show, type JSX } from 'solid-js';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import type { Banner as BannerData, BannerAction } from './banner-model';
import { Glyph } from './glyph';

/** Each action's button words. */
const ACTION_LABEL: Record<BannerAction, string> = {
  'retry-load': 'Retry',
  'retry-apply': 'Retry',
  reload: 'Reload page',
  dismiss: 'Dismiss'
};

/** Props of {@link BannerView}. */
export interface BannerViewProps {
  readonly banner: BannerData;
  readonly onAction: (action: BannerAction) => void;
  /** Disables the actions (an action is already in flight). */
  readonly locked?: boolean;
  /** Live region (polite) for the overlay's main state banner. */
  readonly live?: boolean;
}

/**
 * The banner.
 *
 * @param props See {@link BannerViewProps}.
 */
export function BannerView(props: BannerViewProps): JSX.Element {
  return (
    <section
      class="xo-banner"
      data-tone={props.banner.tone}
      role={props.live === true ? 'status' : undefined}
    >
      <span class="xo-banner-glyph">
        <Glyph name={props.banner.glyph} size={16} />
      </span>
      <p class="xo-banner-title">{props.banner.title}</p>
      <p class="xo-banner-body">{props.banner.body}</p>
      <Show when={props.banner.notes.length > 0}>
        <ul class="xo-banner-notes">
          <For each={props.banner.notes}>{(note) => <li>{note}</li>}</For>
        </ul>
      </Show>
      <Show when={props.banner.actions.length > 0}>
        <div class="xo-banner-actions">
          <For each={props.banner.actions}>
            {(action) => (
              <button
                type="button"
                class="xo-button"
                data-variant={action === 'dismiss' ? 'ghost' : undefined}
                disabled={props.locked === true && action !== 'dismiss'}
                onClick={() => {
                  props.onAction(action);
                }}
              >
                <Show when={action !== 'dismiss'}>
                  <RefreshCw size={13} aria-hidden="true" />
                </Show>
                {ACTION_LABEL[action]}
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
