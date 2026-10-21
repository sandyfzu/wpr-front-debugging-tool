/**
 * Renders one {@link Banner}: glyph + title + body, side notes, and its
 * forward actions as buttons — a dismissal as a close control in the
 * corner, never an orphan text button. For the main state banner only its
 * words form the live region (buttons never get read out on each change).
 */
import { For, Show, type JSX } from 'solid-js';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import X from 'lucide-solid/icons/x';
import type { Banner as BannerData, BannerAction } from './banner-model';
import { Glyph } from './glyph';

/** A forward action (anything but the dismissal). */
type ForwardAction = Exclude<BannerAction, 'dismiss'>;

/** Each forward action's button words. */
const ACTION_LABEL: Record<ForwardAction, string> = {
  'retry-load': 'Retry',
  'retry-apply': 'Retry',
  'retry-action': 'Retry',
  reload: 'Reload page'
};

/** Props of {@link BannerView}. */
export interface BannerViewProps {
  readonly banner: BannerData;
  readonly onAction: (action: BannerAction) => void;
  /** Holds the forward actions (an action is already in flight). */
  readonly held?: boolean;
  /** Announce the words politely (the overlay's main state banner). */
  readonly live?: boolean;
}

/**
 * The banner.
 *
 * @param props See {@link BannerViewProps}.
 */
export function BannerView(props: BannerViewProps): JSX.Element {
  const forward = (): ForwardAction[] =>
    props.banner.actions.filter((action): action is ForwardAction => action !== 'dismiss');
  return (
    <section class="xo-banner" data-tone={props.banner.tone}>
      <span class="xo-banner-glyph">
        <Glyph name={props.banner.glyph} size={16} />
      </span>
      <div class="xo-banner-text" role={props.live === true ? 'status' : undefined}>
        <p class="xo-banner-title">{props.banner.title}</p>
        <p class="xo-banner-body">{props.banner.body}</p>
      </div>
      <Show when={props.banner.actions.includes('dismiss')}>
        <button
          type="button"
          class="xo-icon-button xo-banner-close"
          data-size="small"
          aria-label={`Dismiss: ${props.banner.title}`}
          title="Dismiss"
          onClick={() => {
            props.onAction('dismiss');
          }}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </Show>
      <Show when={props.banner.notes.length > 0}>
        <ul class="xo-banner-notes">
          <For each={props.banner.notes}>{(note) => <li>{note}</li>}</For>
        </ul>
      </Show>
      <Show when={forward().length > 0}>
        <div class="xo-banner-actions">
          <For each={forward()}>
            {(action) => (
              <button
                type="button"
                class="xo-button"
                aria-disabled={props.held === true ? 'true' : undefined}
                onClick={() => {
                  if (props.held !== true) props.onAction(action);
                }}
              >
                <RefreshCw size={13} aria-hidden="true" />
                {ACTION_LABEL[action]}
              </button>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
