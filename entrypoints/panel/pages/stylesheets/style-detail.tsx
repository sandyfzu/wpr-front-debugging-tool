/**
 * One style's detail body (the side pane or the drill-in view of the
 * Stylesheets list): every state chip with its source, the source-link tile
 * (links: Open in Sources / new tab, nothing fetched), the facts its element
 * carries, and an inline style's full CSS — highlighted up to the code
 * block's limit, plain past it, shown in part past the render cap, cut at
 * the page's read cap (each said so), with a Format toggle that re-flows
 * the shown text for reading (copies keep the served CSS). The
 * snapshot-only critical row says why it has no CSS and never asks.
 *
 * The CSS is read on open from the list's snapshot; a refresh re-reads it
 * while the text already shown stays (no flash). Each read state is drawn:
 * waiting (a skeleton), answered, or missing (one muted line saying why).
 */
import type { Accessor, JSX } from 'solid-js';
import { Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { Button } from '../../../../components/ui/button';
import { CodeBlock, HIGHLIGHT_MAX_CHARS } from '../../../../components/ui/code-block';
import { Skeleton } from '../../../../components/ui/skeleton';
import { PAGE_STYLE_LIMITS } from '../../../../lib/messaging/page-styles';
import {
  STYLE_SOURCE_MAX_CHARS,
  type StyleSourceResult
} from '../../../../lib/messaging/style-source';
import { cutToUnits } from '../../../../utils/cap-text';
import { formatCount } from '../../../../utils/format-count';
import { formatCss } from '../../../../utils/format-css';
import type { CodeBlockSeams } from '../javascript/code-seams';
import type { OpenResource } from '../open-resource';
import { DetailSection, DETAIL_COLUMNS, FactList } from '../resource-list/detail-section';
import { createOnDemand } from '../resource-list/on-demand';
import { SourceLink } from '../resource-list/source-link';
import { READ_FAILURE_NOTES } from '../resource-list/top-frame-reader';
import { StateChips } from '../resource-list/state-chip-list';
import { splitStateChips } from '../resource-list/state-chips';
import { INLINE_CSS_LABEL, NO_HREF_NAME } from '../resource-list/style-words';
import { CRITICAL_SNAPSHOT_DETAIL, styleFacts, type StyleRowView } from './style-view';

/** Props of {@link StyleDetail}. */
export interface StyleDetailProps {
  /** The selected row (live: a same-key refresh updates it in place). */
  view: Accessor<StyleRowView>;
  /** "Open in Sources" (null: the tile opens a new tab). */
  openResource: OpenResource | null;
  /**
   * Read this row's CSS; `null` when there is nothing to read (a link, the
   * snapshot row). A new function is a new read (a new list, a moved row);
   * the signal aborts when it is replaced or the detail closes, so the read
   * stops asking for further chunks.
   */
  readSource: Accessor<((signal: AbortSignal) => Promise<StyleSourceResult>) | null>;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
}

/** Why the CSS is missing, one muted line each. */
export const STYLE_SOURCE_NOTES: Readonly<
  Record<'gone' | 'invalid-request' | 'not-inline' | 'unreachable' | 'unreadable', string>
> = {
  gone: 'This style is no longer on the page — refresh the list.',
  'not-inline': 'The page holds no CSS for this element — refresh the list.',
  ...READ_FAILURE_NOTES
};

/**
 * The most CSS the detail renders (plain past the highlight limit). Past it
 * a plain block's layout alone runs long tasks (≈ 0.9 M characters: 84 +
 * 67 ms, measured in Chromium), so the view shows the start; copy still
 * takes everything the read kept.
 */
export const STYLE_DISPLAY_MAX_CHARS = 200_000;

/** The note under CSS the page cut at the read cap. */
export const STYLE_SOURCE_CUT_NOTE = `The page keeps the first ${formatCount(STYLE_SOURCE_MAX_CHARS)} characters of this style (copy included).`;

/** The note under CSS shown only in part. */
export const STYLE_DISPLAY_CUT_NOTE = `Showing the first ${formatCount(STYLE_DISPLAY_MAX_CHARS)} characters; Copy takes the rest too.`;

/** The note under CSS too large to highlight (the block shows it plain). */
export const STYLE_PLAIN_NOTE = `Over ${formatCount(HIGHLIGHT_MAX_CHARS)} characters: shown as plain text, without highlighting.`;

/** The CSS block's toggle: re-flow the shown CSS one declaration per line. */
export const FORMAT_CSS_LABEL = 'Format';

/** What the CSS block shows of a style's text. */
export interface CssDisplay {
  /** The shown text: the served CSS, or its formatted form, within the render cap. */
  readonly text: string;
  /** Whether the render cap hid part of it (the note says Copy takes the rest). */
  readonly cut: boolean;
}

/**
 * The shown CSS: the served text, or — formatted — the re-flow of the part
 * the render cap shows, capped again (formatting adds line breaks and
 * indents), so the work and the rendered size stay bounded by the cap.
 *
 * @param css The style's CSS as read.
 * @param formatted Whether the Format toggle is on.
 * @returns The text to show and whether the cap hid part of the CSS.
 */
export function cssDisplay(css: string, formatted: boolean): CssDisplay {
  const served = cutToUnits(css, STYLE_DISPLAY_MAX_CHARS);
  const cutServed = served.length < css.length;
  if (!formatted) return { text: served, cut: cutServed };
  const reflowed = formatCss(served);
  const text = cutToUnits(reflowed, STYLE_DISPLAY_MAX_CHARS);
  return { text, cut: cutServed || text.length < reflowed.length };
}

/**
 * Render one style's detail body.
 *
 * @param props See {@link StyleDetailProps}.
 */
export function StyleDetail(props: StyleDetailProps): JSX.Element {
  const facts = createMemo(() => styleFacts(props.view()));
  const row = () => props.view().row;
  return (
    <div data-fdt="style-detail" class="@container/detail min-w-0">
      <div class={DETAIL_COLUMNS}>
        <div class="flex min-w-0 flex-col gap-3.5">
          <ChipLine view={props.view()} />
          <Show when={row().type === 'external'}>
            <Show
              when={row().href !== ''}
              fallback={<p class="text-2xs text-fg-muted">{NO_HREF_NAME}</p>}
            >
              <SourceLink
                url={row().href}
                clipped={row().href.length >= PAGE_STYLE_LIMITS.hrefChars}
                openResource={props.openResource}
              />
            </Show>
          </Show>
          <FactList facts={facts()} hook="style-facts" />
        </div>
        <div class="flex min-w-0 flex-col gap-3.5">
          <Switch>
            <Match when={row().source === 'snapshot'}>
              <p data-fdt="style-snapshot-note" class="text-2xs text-fg-secondary">
                {CRITICAL_SNAPSHOT_DETAIL}
              </p>
            </Match>
            <Match when={row().type === 'inline'}>
              <InlineCss readSource={props.readSource} codeBlock={props.codeBlock} />
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}

/**
 * Every state chip with its source icon, or the quiet "no state" line.
 *
 * @param props.view The row.
 */
function ChipLine(props: { view: StyleRowView }): JSX.Element {
  return (
    <Show
      when={props.view.chips.length > 0}
      fallback={
        <p data-fdt="style-no-state" class="text-2xs text-fg-muted">
          No WP Rocket state on this style.
        </p>
      }
    >
      <div data-fdt="style-detail-chips" class="flex flex-wrap items-center gap-1">
        <StateChips chips={splitStateChips(props.view.chips, props.view.chips.length)} />
      </div>
    </Show>
  );
}

/** What the CSS section shows: the text, a note, or nothing yet. */
type CssShown =
  | { readonly kind: 'text'; readonly text: string; readonly truncated: boolean }
  | { readonly kind: 'note'; readonly note: string }
  | { readonly kind: 'waiting' };

/** The waiting state (shared). */
const WAITING: CssShown = { kind: 'waiting' };

/**
 * An inline style's CSS, read on demand.
 *
 * @param props.readSource The read (see {@link StyleDetailProps.readSource}).
 * @param props.codeBlock Code block seams (tests only).
 */
function InlineCss(props: {
  readSource: StyleDetailProps['readSource'];
  codeBlock?: CodeBlockSeams;
}): JSX.Element {
  const read = createOnDemand(
    () => props.readSource(),
    (load, signal) => load(signal)
  );
  // A re-read (refresh) keeps the text already shown until its answer lands.
  const shown = createMemo<CssShown>((previous) => {
    const state = read();
    if (state.status === 'loading') return previous.kind === 'text' ? previous : WAITING;
    // Idle before the read starts (first render) — or for good when there is nothing to read.
    if (state.status === 'idle')
      return props.readSource() === null
        ? { kind: 'note', note: STYLE_SOURCE_NOTES.unreachable }
        : WAITING;
    if (state.status === 'failed') return { kind: 'note', note: STYLE_SOURCE_NOTES.unreachable };
    const result = state.value;
    if (result.status === 'ok')
      return { kind: 'text', text: result.text, truncated: result.truncated };
    return {
      kind: 'note',
      note: STYLE_SOURCE_NOTES[result.status === 'gone' ? 'gone' : result.reason]
    };
  }, WAITING);
  const text = (): { text: string; truncated: boolean } | null => {
    const value = shown();
    return value.kind === 'text' ? value : null;
  };
  const note = (): string | null => {
    const value = shown();
    return value.kind === 'note' ? value.note : null;
  };
  // Per detail: a new row opens served, as the page sent it.
  const [formatted, setFormatted] = createSignal(false);
  return (
    <DetailSection title="CSS" hook="style-css">
      <Switch>
        <Match when={shown().kind === 'waiting'}>
          <Skeleton class="h-16 w-full" />
        </Match>
        <Match when={note()}>
          {(line) => (
            <p data-fdt="style-css-note" class="text-2xs text-fg-muted">
              {line()}
            </p>
          )}
        </Match>
        <Match when={text()}>
          {(css) => {
            const display = createMemo(() => cssDisplay(css().text, formatted()));
            return (
              <Show
                when={css().text.trim() !== ''}
                fallback={
                  <p data-fdt="style-css-empty" class="text-2xs text-fg-muted">
                    This style holds no CSS.
                  </p>
                }
              >
                <CodeBlock
                  text={display().text}
                  lang="css"
                  label={INLINE_CSS_LABEL}
                  class="min-w-0"
                  loadHighlighter={props.codeBlock?.loadHighlighter}
                  createObserver={props.codeBlock?.createObserver}
                  watchOverflow={props.codeBlock?.watchOverflow}
                  actions={
                    <Button
                      type="button"
                      data-fdt="style-css-format"
                      variant="ghost"
                      size="sm"
                      aria-pressed={formatted()}
                      onClick={() => setFormatted((on) => !on)}
                      class="min-h-6 px-1.5 text-2xs"
                    >
                      {FORMAT_CSS_LABEL}
                    </Button>
                  }
                />
                {/* The block's own verdict reads the shown text: so does its note. */}
                <Show when={display().text.length > HIGHLIGHT_MAX_CHARS}>
                  <p data-fdt="style-css-plain" class="text-2xs text-fg-muted">
                    {STYLE_PLAIN_NOTE}
                  </p>
                </Show>
                <Show when={display().cut}>
                  <p data-fdt="style-css-shown-cut" class="text-2xs text-fg-muted">
                    {STYLE_DISPLAY_CUT_NOTE}
                  </p>
                </Show>
                <Show when={css().truncated}>
                  <p data-fdt="style-css-cut" class="text-2xs text-fg-muted">
                    {STYLE_SOURCE_CUT_NOTE}
                  </p>
                </Show>
              </Show>
            );
          }}
        </Match>
      </Switch>
    </DetailSection>
  );
}
