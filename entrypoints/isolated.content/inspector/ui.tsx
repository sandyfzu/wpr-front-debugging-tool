/**
 * The detection widget's view: the mood-driven marker pill (presence icon +
 * identity + status chip, bottom-right) and the report card it opens — the
 * Known Conflicts shell's two shapes over one anchor, adapted to the strip
 * brief's header-row semantics and static evidence chips.
 *
 * State never depends on a transition: open/close is class-based (CSS owns
 * opacity/transform/visibility), a click can never strand a container
 * mid-transition. Rows are static evidence chips — no pointer cursor, no
 * hover/press response, full feature name + one-line why in tooltips. The
 * pill and the close control are the only interactive elements; the drag
 * rides the chrome (its non-interactive regions grabbed, `P12A.5`), whose
 * listeners live in the owner module, not here.
 */

import type { JSX, JSXElement } from 'solid-js';
import { For, Show } from 'solid-js';
import type { StripCardModel } from './strip-state';
import { CARD_ARIA_LABEL, INSPECTOR_CARD_ID, PILL_LABEL_STEM } from './strip-state';
import type { InspectorMood } from './strip-state';
import type { StripIconGlyph } from './icons';
import { PRESENT_ICON_PATHS } from './icons';
import { StrokeIcon, CLOSE_ICON_PATHS } from '../ui/icons';
import { TOOL_EYEBROW } from '../ui/copies';

/** Behavior the owner module wires to the widget's controls. */
export interface InspectorUiActions {
  /** Register the card's root element once (focus choreography). */
  registerCard(element: HTMLElement | null): void;
  /** Register the pill once (the focus hand-back on close). */
  registerPill(element: HTMLElement | null): void;
  /** Register the chrome once (the drag's listener site + translate target). */
  registerChrome(element: HTMLElement | null): void;
  /** Open the report card from the pill. */
  openCard(): void;
  /** Close the report card (the pill returns). */
  closeCard(): void;
}

/** The chrome's mood classes (state never rides a transition — class handles). */
const MOOD_CLASS: Record<InspectorMood, string> = {
  green: 'ins-green',
  amber: 'ins-amber',
  gray: 'ins-gray',
  pulse: 'ins-pulse',
  red: 'ins-red'
};

/** The widget's reactive inputs (accessors — the components run once). */
export interface InspectorViewProps {
  /** The card model for the current data. */
  model: () => StripCardModel;
  /** The chrome mood. */
  mood: () => InspectorMood;
  /** Whether the card is open. */
  cardOpen: () => boolean;
  /** The wired controls. */
  actions: InspectorUiActions;
}

/** Render one glyph through the shared factory (its path/node data verbatim). */
const GroupGlyph = (props: { glyph: StripIconGlyph }): JSXElement => (
  <StrokeIcon
    paths={props.glyph.paths}
    circle={props.glyph.circle ?? null}
    ellipse={props.glyph.ellipse ?? null}
  />
);

/** One group's header: scent, not controls (never focusable). */
const GroupHead = (props: { heading: string; icon: StripIconGlyph }): JSXElement => (
  <div class="ins-group-head">
    <span class="ins-group-icon" aria-hidden="true">
      <GroupGlyph glyph={props.icon} />
    </span>
    <span class="ins-group-label">{props.heading}</span>
  </div>
);

export function InspectorView(props: InspectorViewProps): JSX.Element {
  /** The pill's tooltip: identity + the cache chip's one-line why. */
  const pillTooltip = (): string | undefined => {
    const why = props.model().cacheTooltip;
    return why === null ? undefined : `${props.model().identity} — ${why}`;
  };

  return (
    <div
      class="ins-chrome"
      classList={{
        'ins-open': props.cardOpen(),
        [MOOD_CLASS[props.mood()]]: true
      }}
      ref={(el) => {
        props.actions.registerChrome(el);
      }}
    >
      {/* The report card. Always mounted: hidden states are
       * visibility/opacity, never a display flip. */}
      <section
        id={INSPECTOR_CARD_ID}
        ref={(el) => {
          props.actions.registerCard(el);
        }}
        class="ins-card"
        role="dialog"
        aria-label={CARD_ARIA_LABEL}
        tabIndex={-1}
      >
        <header class="ins-card-head">
          <div class="ins-titles">
            <span class="ins-eyebrow">{TOOL_EYEBROW}</span>
            <div class="ins-titlerow">
              <h3 class="ins-title">{props.model().identity}</h3>
            </div>
            <Show when={props.model().cacheChip}>
              {(chip) => (
                <div class="ins-chiprow">
                  <span
                    class={`ins-cache ins-cache-${chip().state}`}
                    title={props.model().cacheTooltip ?? undefined}
                  >
                    <span class="ins-cache-text">{chip().text}</span>
                    <Show when={chip().stamp !== null}>
                      <span class="ins-cache-stamp">{` · ${chip().stamp ?? ''}`}</span>
                    </Show>
                  </span>
                </div>
              )}
            </Show>
          </div>
          <button
            type="button"
            class="ins-close"
            title="Close the report"
            aria-label="Close the report card"
            onClick={() => {
              props.actions.closeCard();
            }}
          >
            <StrokeIcon paths={CLOSE_ICON_PATHS} />
          </button>
        </header>

        <div class="ins-card-body">
          {/* The pending/failed body copies (no grouped rows in these). */}
          <Show when={props.model().stateCopy !== null}>
            <div class="ins-state">
              <span class="ins-state-title">{props.model().stateCopy?.title}</span>
              <Show when={props.model().stateCopy?.hint !== ''}>
                <span class="ins-state-hint">{props.model().stateCopy?.hint}</span>
              </Show>
            </div>
          </Show>
          <For each={props.model().groups}>
            {(group) => (
              <div class="ins-group">
                <GroupHead heading={group.heading} icon={group.icon} />
                <div class="ins-group-rows">
                  <For each={group.rows}>
                    {(row) => (
                      <div class="ins-row" title={row.tooltip}>
                        <span class={`ins-chip ins-chip-${row.chipState}`}>{row.label}</span>
                        <Show when={row.count !== null && row.unit !== null}>
                          <span class="ins-count">
                            {String(row.count)} {row.unit}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        <footer class="ins-card-foot">
          <span>{props.model().footer}</span>
        </footer>
      </section>

      {/* The marker pill: presence icon + identity + status chip, anchored
       * bottom-right. The card's motion hands the anchor over at the same
       * beat; the sr-label stem keeps the accessible name sentence-shaped. */}
      <button
        type="button"
        class="ins-pill"
        ref={(el) => {
          props.actions.registerPill(el);
        }}
        title={pillTooltip()}
        aria-haspopup="dialog"
        aria-controls={INSPECTOR_CARD_ID}
        aria-expanded={props.cardOpen()}
        onClick={(event) => {
          // The activation gate: only user input opens the card. Script-
          // dispatched (untrusted) click syntheses — observed replaying after
          // the keyboard activation in test runs — must not reopen behind an
          // Escape (a real browser interaction is always trusted here; no
          // extension surface synthesizes clicks into this widget).
          if (!event.isTrusted) return;
          props.actions.openCard();
        }}
      >
        <span class="ins-sr">{PILL_LABEL_STEM}</span>
        <span class="ins-mark" aria-hidden="true">
          <StrokeIcon paths={PRESENT_ICON_PATHS} />
        </span>
        <span class="ins-identity">{props.model().identity}</span>
        <Show when={props.model().cacheChip}>
          {(chip) => (
            <span class={`ins-cache ins-cache-${chip().state}`}>
              <span class="ins-cache-text">{chip().text}</span>
              <Show when={chip().stamp !== null}>
                <span class="ins-cache-stamp">{` · ${chip().stamp ?? ''}`}</span>
              </Show>
            </span>
          )}
        </Show>
      </button>
    </div>
  );
}
