/**
 * The detection widget's view: the mood-driven marker pill (presence icon +
 * identity + status chip, bottom-right) and the report card it opens — the
 * Known Conflicts shell's two shapes over one anchor, adapted to a
 * header-row layout and static evidence chips.
 *
 * State never depends on a transition: open/close is class-based (CSS owns
 * opacity/transform/visibility), a click can never strand a container
 * mid-transition. Rows are static evidence chips — no pointer cursor, no
 * hover/press response, full feature name + one-line why in tooltips. The
 * pill and the close control are the only interactive elements; the drag
 * rides the chrome (its non-interactive regions grabbed), whose
 * listeners live in the owner module, not here.
 */

import type { JSX, JSXElement } from 'solid-js';
import { For, Show } from 'solid-js';
import {
  BUILDER_PILL_HINT_SPOKEN,
  LIST_JOINER_CONTENT,
  type BuilderTabLine
} from '../../../lib/detection/hud';
import type { StripCardModel, StripRowModifier } from './strip-state';
import {
  CARD_ARIA_LABEL,
  INSPECTOR_BUILDER_LINE_ID,
  INSPECTOR_CARD_ID,
  PILL_LABEL_STEM
} from './strip-state';
import type { InspectorMood } from './strip-state';
import type { StripIconGlyph } from './icons';
import { MODIFIER_ICONS, PRESENT_ICON_PATHS } from './icons';
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
  /** Open the report card from the pill (the activation click's descriptor). */
  openCard(trigger: { readonly detail: number }): void;
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

/**
 * The tab-level line: the displayed page is the Exclusion Builder's rewrite,
 * with one hint per feature it changed. Visible text in neutral colours (a
 * statement, not a link); the hints' joiner dot sits in a clipped gutter so
 * a wrapped line never starts with it. Assistive tech hears the shared
 * spoken sentence once (commas, never the dot) — also the card dialog's
 * description, so opening the card announces it.
 *
 * @param props.line The shared tab-level line.
 * @returns The line block.
 */
const BuilderLine = (props: { line: BuilderTabLine }): JSXElement => (
  <div class="ins-builder" data-fdt-strip-builder style={{ '--ins-joiner': LIST_JOINER_CONTENT }}>
    {/* Spoken once, as one sentence: the laid-out pieces below are flex
     * items, whose accessible text would gain stray spaces around commas. */}
    <span id={INSPECTOR_BUILDER_LINE_ID} class="ins-sr">
      {props.line.spoken}
    </span>
    <div class="ins-builder-shown" aria-hidden="true">
      <p class="ins-builder-title">{props.line.title}</p>
      <p class="ins-builder-hints">
        <span class="ins-builder-list">
          <For each={props.line.hints}>
            {(hint) => (
              <span class="ins-builder-hint" data-fdt-strip-builder-hint>
                {hint}
              </span>
            )}
          </For>
        </span>
      </p>
    </div>
  </div>
);

/**
 * A row's in-tab modifier (Exclusion Builder or simulation): the badge (icon + short words, the
 * at-a-glance cue; hidden from assistive tech) and the full sentence as
 * visible text on its own line (never hover-only), spoken once.
 *
 * @param props.modifier The row's modifier.
 * @returns The badge + sentence pair.
 */
const RowModifier = (props: { modifier: StripRowModifier }): JSXElement => (
  <>
    <span class="ins-mod" data-fdt-strip-modifier={props.modifier.kind} aria-hidden="true">
      <span class="ins-mod-icon">
        <GroupGlyph glyph={MODIFIER_ICONS[props.modifier.kind]} />
      </span>
      {props.modifier.chip}
    </span>
    <span class="ins-mod-line" data-fdt-strip-modifier-line>
      <span class="ins-sr">, </span>
      {props.modifier.sentence}
    </span>
  </>
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
        aria-describedby={
          props.model().builderLine === null ? undefined : INSPECTOR_BUILDER_LINE_ID
        }
        tabIndex={-1}
      >
        {/* Plain blocks, not header/footer: inside the dialog they would
         * duplicate the host page's banner/contentinfo landmarks. */}
        <div class="ins-card-head">
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
        </div>

        {/* The single scroll region holds no control, so it is its own tab
         * stop: keyboard users can scroll it. */}
        <div class="ins-card-body" tabIndex={0}>
          {/* The pending/failed body copies (no grouped rows in these). */}
          <Show when={props.model().stateCopy !== null}>
            <div class="ins-state">
              <span class="ins-state-title">{props.model().stateCopy?.title}</span>
              <Show when={props.model().stateCopy?.hint !== ''}>
                <span class="ins-state-hint">{props.model().stateCopy?.hint}</span>
              </Show>
            </div>
          </Show>
          <Show when={props.model().builderLine}>{(line) => <BuilderLine line={line()} />}</Show>
          <For each={props.model().groups}>
            {(group) => (
              <div class="ins-group">
                <GroupHead heading={group.heading} icon={group.icon} />
                <div class="ins-group-rows">
                  <For each={group.rows}>
                    {(row) => (
                      <div
                        class="ins-row"
                        // A modified row already shows its sentence; the tooltip would
                        // repeat it as the row's accessible description.
                        title={
                          row.modifier === null && row.simulation === null ? row.tooltip : undefined
                        }
                      >
                        <span class={`ins-chip ins-chip-${row.chipState}`}>{row.label}</span>
                        <Show when={row.count !== null && row.unit !== null}>
                          <span class="ins-value">
                            {String(row.count)} {row.unit}
                          </span>
                        </Show>
                        <Show when={row.simulation}>
                          {(simulation) => <RowModifier modifier={simulation()} />}
                        </Show>
                        <Show when={row.modifier}>
                          {(modifier) => <RowModifier modifier={modifier()} />}
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="ins-card-foot">
          <span>{props.model().footer}</span>
        </div>
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
          // The press count rides to the owner: it is the pointer-vs-keyboard
          // discriminator the drag suppression consults (keyboard activations
          // carry `detail === 0` and never read the pointer path's flag).
          props.actions.openCard({ detail: event.detail });
        }}
      >
        <span class="ins-sr">{PILL_LABEL_STEM}</span>
        <span class="ins-mark" aria-hidden="true">
          <StrokeIcon paths={PRESENT_ICON_PATHS} />
        </span>
        <span class="ins-identity">
          {/* Rewritten page: the identity and the hint are spoken as one run
           * (an sr-only piece of its own would gain a stray space before the
           * comma in Chromium's name), so the shown identity is hidden from
           * assistive tech and heard once. */}
          <Show when={props.model().builderPill !== null} fallback={props.model().identity}>
            <span aria-hidden="true">{props.model().identity}</span>
            <span class="ins-sr" data-fdt-strip-pill-builder-spoken>
              {`${props.model().identity}${BUILDER_PILL_HINT_SPOKEN}`}
            </span>
          </Show>
        </span>
        {/* The in-tab change's glyph after the version: a shape, not colour alone. */}
        <Show when={props.model().builderPill}>
          {(kind) => (
            <span class="ins-pill-builder" data-fdt-strip-pill-builder={kind()} aria-hidden="true">
              <GroupGlyph glyph={MODIFIER_ICONS[kind()]} />
            </span>
          )}
        </Show>
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
