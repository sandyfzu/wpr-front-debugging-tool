/**
 * One release's body on the What's new page: its highlight cards (with
 * their screenshot when one is bundled), the short improvements list and
 * the notices users must know about. Pure view over a registry row; copy
 * placeholders are filled from the page's token values.
 */
import type { Accessor, JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Card } from '../../components/ui/card';
import { FOCUS_RING } from '../../components/ui/classes';
import { fillTokens, type CopyTokenValues } from '../../lib/release-notes/copy-tokens';
import type { ReleaseHighlight, ReleaseNote, ReleaseNotice } from '../../lib/release-notes/notes';
import { resolveScreenshot, type ScreenshotPalette } from '../../lib/release-notes/screenshots';
import { cn } from '../../utils/cn';
import { WHATS_NEW_TYPE } from './type-scale';

/** The page's section and label words. */
export const RELEASE_WORDS = {
  highlights: 'New in this version',
  howTo: 'How to open',
  improvements: 'Also improved',
  notices: 'What changed',
  /** A screenshot link's tooltip. */
  fullSize: 'Open full size in a new tab'
} as const;

/** What every release body reads from the page. */
export interface ReleaseScope {
  /** The filled copy placeholders. */
  readonly tokens: CopyTokenValues;
  /** The palette on screen (picks each screenshot's file). */
  readonly palette: Accessor<ScreenshotPalette>;
}

/** A heading level the release body renders (history nests one lower). */
type HeadingLevel = 2 | 3 | 4;

/**
 * A heading at a level.
 *
 * @param props.level The level.
 * @param props.class Its classes.
 * @param props.children Its text.
 */
function Heading(props: {
  level: HeadingLevel;
  class: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Dynamic component={`h${String(props.level)}`} class={props.class}>
      {props.children}
    </Dynamic>
  );
}

/** A section's small caps label. */
function CapsLabel(props: { children: JSX.Element }): JSX.Element {
  return <p class={WHATS_NEW_TYPE.caps}>{props.children}</p>;
}

/**
 * A bulleted list of filled copy lines.
 *
 * @param props.lines The lines.
 * @param props.tokens The placeholder values.
 * @param props.hook The list's test hook.
 */
function Lines(props: {
  lines: readonly string[];
  tokens: CopyTokenValues;
  hook: string;
}): JSX.Element {
  return (
    <ul data-fdt={props.hook} class={cn('flex list-disc flex-col gap-1 ps-5', WHATS_NEW_TYPE.body)}>
      <For each={props.lines}>{(line) => <li>{fillTokens(line, props.tokens)}</li>}</For>
    </ul>
  );
}

/**
 * A highlight card with a screenshot, from the `@feature` tier up: the image
 * in its own column at no more than its intrinsic width (`--shot-width`, so
 * it is never upscaled), the text in the rest (≥ 20 rem; the tier is sized
 * so the shot is whole at that minimum). Below the tier the
 * card stacks, the image filling the card up to that same width.
 */
export const HIGHLIGHT_ROW =
  '@feature:grid @feature:grid-cols-[minmax(0,var(--shot-width))_minmax(20rem,1fr)] @feature:items-start @feature:gap-6';

/**
 * One highlight card: screenshot (when bundled), then title, summary, every
 * way to open it and its details — beside the screenshot on a wide page.
 *
 * @param props.highlight The registry row.
 * @param props.scope The page's tokens and palette.
 * @param props.level The card title's heading level.
 */
function HighlightCard(props: {
  highlight: ReleaseHighlight;
  scope: ReleaseScope;
  level: HeadingLevel;
}): JSX.Element {
  const image = () => resolveScreenshot(props.highlight.screenshot, props.scope.palette());
  return (
    <Card>
      <article
        data-fdt-highlight={props.highlight.id}
        class={cn('flex min-w-0 flex-col gap-3', image() && HIGHLIGHT_ROW)}
        style={image() ? { '--shot-width': `${String(image()?.width)}px` } : undefined}
      >
        <Show when={image()}>
          {(shot) => (
            // A narrow page shrinks the shot: the link opens the file at its
            // real size in a new tab (a bundled file, nothing remote).
            <a
              href={shot().src}
              target="_blank"
              rel="noopener"
              title={RELEASE_WORDS.fullSize}
              data-fdt="highlight-shot"
              class={cn('block max-w-(--shot-width) rounded-md', FOCUS_RING)}
            >
              {/* Fixed intrinsic box (no layout shift); lazy below the fold.
                  The ring draws the edge outside the layout box, so the pixels
                  keep the full width (a border would shave 2 px off a 1:1 image). */}
              <img
                src={shot().src}
                width={shot().width}
                height={shot().height}
                alt={shot().alt}
                loading="lazy"
                decoding="async"
                class="block h-auto w-full rounded-md ring-1 ring-line-1"
              />
            </a>
          )}
        </Show>
        <div class="flex min-w-0 flex-col gap-2">
          <Heading level={props.level} class={WHATS_NEW_TYPE.item}>
            {props.highlight.title}
          </Heading>
          <p class={WHATS_NEW_TYPE.body}>
            {fillTokens(props.highlight.summary, props.scope.tokens)}
          </p>
          <div class="flex flex-col gap-1">
            <CapsLabel>{RELEASE_WORDS.howTo}</CapsLabel>
            <Lines
              lines={props.highlight.howTo}
              tokens={props.scope.tokens}
              hook="highlight-how-to"
            />
          </div>
          <Show when={props.highlight.details}>
            {(details) => (
              <Lines lines={details()} tokens={props.scope.tokens} hook="highlight-details" />
            )}
          </Show>
        </div>
      </article>
    </Card>
  );
}

/**
 * One notice: title, body and its labeled lines.
 *
 * @param props.notice The registry row.
 * @param props.tokens The placeholder values.
 * @param props.level The notice title's heading level.
 */
function NoticeCard(props: {
  notice: ReleaseNotice;
  tokens: CopyTokenValues;
  level: HeadingLevel;
}): JSX.Element {
  return (
    <Card>
      <section data-fdt-notice={props.notice.id} class="flex min-w-0 flex-col gap-1.5">
        <Heading level={props.level} class={WHATS_NEW_TYPE.item}>
          {props.notice.title}
        </Heading>
        <p class={WHATS_NEW_TYPE.body}>{fillTokens(props.notice.body, props.tokens)}</p>
        <Show when={props.notice.items}>
          {(items) => (
            <dl class={cn('flex flex-col gap-1.5', WHATS_NEW_TYPE.body)}>
              <For each={items()}>
                {(item) => (
                  <div class="flex min-w-0 flex-col">
                    <dt class="font-medium text-fg-primary">{item.label}</dt>
                    <dd class="text-fg-secondary">{fillTokens(item.text, props.tokens)}</dd>
                  </div>
                )}
              </For>
            </dl>
          )}
        </Show>
      </section>
    </Card>
  );
}

/**
 * A titled block of the release body.
 *
 * @param props.title The block's heading text.
 * @param props.level Its heading level (its cards sit one lower).
 * @param props.children The block's content.
 */
function Block(props: { title: string; level: 2 | 3; children: JSX.Element }): JSX.Element {
  return (
    <section class="flex flex-col gap-2">
      <Heading
        level={props.level}
        class={props.level === 2 ? WHATS_NEW_TYPE.section : WHATS_NEW_TYPE.subsection}
      >
        {props.title}
      </Heading>
      {props.children}
    </section>
  );
}

/**
 * Render one release's body.
 *
 * @param props.note The release.
 * @param props.scope The page's tokens and palette.
 * @param props.level The blocks' heading level (2 for the running release, 3 inside history).
 */
export function ReleaseBody(props: {
  note: ReleaseNote;
  scope: ReleaseScope;
  level: 2 | 3;
}): JSX.Element {
  const cardLevel = (): HeadingLevel => (props.level === 2 ? 3 : 4);
  return (
    <div class="flex flex-col gap-6">
      <Show when={props.note.highlights.length > 0}>
        <Block title={RELEASE_WORDS.highlights} level={props.level}>
          {/* One card per row: a screenshot gets the width, never half of it.
              The list is the container its cards' `@feature` tier measures. */}
          <div data-fdt="highlight-list" class="@container flex flex-col gap-3">
            <For each={props.note.highlights}>
              {(highlight) => (
                <HighlightCard highlight={highlight} scope={props.scope} level={cardLevel()} />
              )}
            </For>
          </div>
        </Block>
      </Show>
      <Show when={props.note.improvements.length > 0}>
        <Block title={RELEASE_WORDS.improvements} level={props.level}>
          <Lines
            lines={props.note.improvements}
            tokens={props.scope.tokens}
            hook="release-improvements"
          />
        </Block>
      </Show>
      <Show when={props.note.notices.length > 0}>
        <Block title={RELEASE_WORDS.notices} level={props.level}>
          {/* Short text cards: side by side once two fit at a readable width. */}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-3">
            <For each={props.note.notices}>
              {(notice) => (
                <NoticeCard notice={notice} tokens={props.scope.tokens} level={cardLevel()} />
              )}
            </For>
          </div>
        </Block>
      </Show>
    </div>
  );
}
