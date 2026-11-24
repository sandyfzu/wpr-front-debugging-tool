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
import { fillTokens, type CopyTokenValues } from '../../lib/release-notes/copy-tokens';
import type { ReleaseHighlight, ReleaseNote, ReleaseNotice } from '../../lib/release-notes/notes';
import { resolveScreenshot, type ScreenshotPalette } from '../../lib/release-notes/screenshots';

/** The page's section and label words. */
export const RELEASE_WORDS = {
  highlights: 'New in this version',
  howTo: 'How to open',
  improvements: 'Also improved',
  notices: 'What changed'
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
  return <p class="text-2xs font-medium uppercase tracking-wide text-fg-muted">{props.children}</p>;
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
    <ul data-fdt={props.hook} class="flex list-disc flex-col gap-1 ps-4 text-xs text-fg-secondary">
      <For each={props.lines}>{(line) => <li>{fillTokens(line, props.tokens)}</li>}</For>
    </ul>
  );
}

/**
 * One highlight card: screenshot (when bundled), title, summary, every way
 * to open it, then its details.
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
      <article data-fdt-highlight={props.highlight.id} class="flex min-w-0 flex-col gap-2 p-2.5">
        <Show when={image()}>
          {(shot) => (
            // Fixed intrinsic box (no layout shift); lazy below the fold.
            <img
              src={shot().src}
              width={shot().width}
              height={shot().height}
              alt={shot().alt}
              loading="lazy"
              decoding="async"
              class="h-auto w-full rounded-md border border-line-1"
            />
          )}
        </Show>
        <Heading level={props.level} class="text-xs font-semibold text-fg-primary">
          {props.highlight.title}
        </Heading>
        <p class="text-xs text-fg-secondary">
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
      <section data-fdt-notice={props.notice.id} class="flex min-w-0 flex-col gap-1.5 p-2.5">
        <Heading level={props.level} class="text-xs font-semibold text-fg-primary">
          {props.notice.title}
        </Heading>
        <p class="text-xs text-fg-secondary">{fillTokens(props.notice.body, props.tokens)}</p>
        <Show when={props.notice.items}>
          {(items) => (
            <dl class="flex flex-col gap-1.5 text-xs">
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
        class={
          props.level === 2
            ? 'text-sm font-semibold text-fg-primary'
            : 'text-xs font-semibold text-fg-primary'
        }
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
          {/* Auto-fill columns: one at a phone width, two from ~ 36 rem. */}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
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
          <div class="flex flex-col gap-3">
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
