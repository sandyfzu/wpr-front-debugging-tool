/**
 * One script's detail body (the side pane or the drill-in view of the
 * JavaScript list): every state chip with its source, the facts its tag
 * carries, the source-link tile (external), the full inline code and the
 * served tag — each highlighted, the code as JavaScript or JSON by the
 * script's type, the tag as HTML.
 *
 * Reads on open: the served tag (always, from the same snapshot the list
 * came from), and the complete source when the capture bounded an inline
 * text. Each read has its states: waiting (a skeleton line), answered, or
 * failed (one muted line saying why; the captured text stays when there is
 * some). The body is its own `@container`: from the regular width (a wide
 * drill-in) facts and code sit side by side; the 350 px pane stacks them.
 */
import type { Accessor, JSX } from 'solid-js';
import { Match, Show, Switch, createMemo } from 'solid-js';
import { CodeBlock, HIGHLIGHT_MAX_CHARS } from '../../../../components/ui/code-block';
import type { CodeLanguage } from '../../../../components/ui/code-block-langs';
import { Skeleton } from '../../../../components/ui/skeleton';
import type {
  ServedScriptTagResult,
  ServedScriptTagReadFailure,
  ServedScriptTagError
} from '../../../../lib/messaging/served-script-tag';
import type { OpenResource } from '../open-resource';
import { DetailSection, DETAIL_COLUMNS, FactList } from '../resource-list/detail-section';
import { createOnDemand, type OnDemandState } from '../resource-list/on-demand';
import { SourceLink } from '../resource-list/source-link';
import { READ_FAILURE_NOTES } from '../resource-list/top-frame-reader';
import { StateChips } from '../resource-list/state-chip-list';
import { splitStateChips } from '../resource-list/state-chips';
import type { CodeBlockSeams } from './code-seams';
import {
  EMPTY_SRC_NAME,
  NO_CODE_PREVIEW,
  countLines,
  expandedCutNote,
  expandedText,
  lineCount,
  scriptCodeLanguage,
  scriptFacts,
  type ScriptRowView
} from './script-view';

/** Props of {@link ScriptDetail}. */
export interface ScriptDetailProps {
  /** The selected row (live: a same-key refresh updates it in place). */
  view: Accessor<ScriptRowView>;
  /** The row's 1-based position among inline scripts (names its code block). */
  inlineOrdinal: Accessor<number>;
  /** "Open in Sources" (null: the tile opens a new tab). */
  openResource: OpenResource | null;
  /**
   * Read this row's served tag; `null` when the page data carries no
   * snapshot to read from. Re-read when its identity changes.
   */
  readServedTag: Accessor<(() => Promise<ServedScriptTagResult>) | null>;
  /** Read the complete captured source (bounded captures only); `null`: no snapshot. */
  loadSource: Accessor<((signal: AbortSignal) => Promise<string>) | null>;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
}

/** The served tag's one-line notes, by why it is missing. */
export const SERVED_TAG_NOTES: Readonly<
  Record<'gone' | ServedScriptTagError | ServedScriptTagReadFailure | 'no-snapshot', string>
> = {
  gone: 'The page changed since this list was read — refresh to read its tag.',
  'not-kept': "Not kept: this page's script tags exceed the capture budget.",
  'not-ready': 'The page could not answer yet — refresh to try again.',
  ...READ_FAILURE_NOTES,
  'no-snapshot': 'This page data carries no capture to read the tag from — refresh the panel.'
};

/** The note when the complete source could not be read (the captured part stays). */
export const SOURCE_READ_NOTE =
  'Showing the captured part — the full source is unavailable. Refresh the panel to read it again.';

/**
 * Render one script's detail body.
 *
 * @param props See {@link ScriptDetailProps}.
 */
export function ScriptDetail(props: ScriptDetailProps): JSX.Element {
  // One read per opened row (the body is built per key) and per snapshot.
  const servedTag = createOnDemand(
    () => props.readServedTag(),
    (read) => read()
  );
  const tagSettled = (): boolean => servedTag().status !== 'loading';
  const servedType = (): string | null | undefined => {
    const state = servedTag();
    return state.status === 'ready' && state.value.status === 'ok' ? state.value.type : undefined;
  };
  const language = createMemo(() =>
    scriptCodeLanguage(props.view().row, servedType(), tagSettled())
  );
  const facts = createMemo(() => scriptFacts(props.view()));
  return (
    <div data-fdt="script-detail" class="@container/detail min-w-0">
      <div class={DETAIL_COLUMNS}>
        <div class="flex min-w-0 flex-col gap-3.5">
          <ChipLine view={props.view()} />
          <Show when={props.view().row.type === 'external'}>
            <Show
              when={props.view().row.content !== ''}
              fallback={<p class="text-2xs text-fg-muted">{EMPTY_SRC_NAME}</p>}
            >
              <SourceLink
                url={props.view().row.content}
                clipped={props.view().capture === 'clipped'}
                openResource={props.openResource}
              />
            </Show>
          </Show>
          <FactList facts={facts()} hook="script-facts" />
        </div>
        <div class="flex min-w-0 flex-col gap-3.5">
          <Show when={props.view().row.type === 'inline'}>
            <InlineSource
              view={props.view()}
              ordinal={props.inlineOrdinal()}
              language={language()}
              loadSource={props.loadSource()}
              codeBlock={props.codeBlock}
            />
          </Show>
          <ServedTag state={servedTag()} codeBlock={props.codeBlock} />
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
function ChipLine(props: { view: ScriptRowView }): JSX.Element {
  return (
    <Show
      when={props.view.chips.length > 0}
      fallback={
        <p data-fdt="script-no-state" class="text-2xs text-fg-muted">
          No WP Rocket state on this script.
        </p>
      }
    >
      <div data-fdt="script-detail-chips" class="flex flex-wrap items-center gap-1">
        <StateChips chips={splitStateChips(props.view.chips, props.view.chips.length)} />
      </div>
    </Show>
  );
}

/** Props of {@link InlineSource}. */
interface InlineSourceProps {
  view: ScriptRowView;
  ordinal: number;
  /** The code's language, `undefined` while the served type is still asked. */
  language: CodeLanguage | undefined;
  /** The complete-source read (bounded captures only), `null` without a snapshot. */
  loadSource: ((signal: AbortSignal) => Promise<string>) | null;
  codeBlock?: CodeBlockSeams;
}

/**
 * An inline script's code: the captured text when it is complete, else the
 * complete source read on demand (the captured part, noted, when that read
 * fails or there is no snapshot). Past the render limit it shows the start,
 * and says so.
 *
 * @param props See {@link InlineSourceProps}.
 */
function InlineSource(props: InlineSourceProps): JSX.Element {
  const complete = (): boolean => props.view.capture === 'complete';
  const full = createOnDemand(
    () => (complete() ? null : props.loadSource),
    (load, signal) => load(signal)
  );
  /** The text to show and whether it is only the captured part of a bounded source. */
  const source = (): { text: string; partial: boolean } | null => {
    if (complete()) return { text: props.view.row.content, partial: false };
    const state = full();
    if (state.status === 'loading') return null;
    if (state.status === 'ready') return { text: state.value, partial: false };
    return { text: props.view.row.content, partial: true };
  };
  const shown = (): { text: string; cut: boolean } =>
    expandedText(source()?.text ?? '', HIGHLIGHT_MAX_CHARS);
  return (
    <DetailSection
      title="Source"
      hook="script-source"
      aside={source() === null ? undefined : lineCount(countLines(source()?.text ?? ''))}
    >
      <Show
        when={source() !== null && props.language !== undefined}
        fallback={<Skeleton class="h-16 w-full" />}
      >
        <Show
          when={(source()?.text ?? '').trim() !== ''}
          fallback={
            <p class="text-2xs text-fg-muted">
              {props.view.capture === 'not-captured'
                ? NO_CODE_PREVIEW['not-captured']
                : NO_CODE_PREVIEW.blank}
            </p>
          }
        >
          {/* Keyed by language: a block's language is fixed at mount. */}
          <Show when={props.language} keyed>
            {(lang) => (
              <CodeBlock
                text={shown().text}
                lang={lang}
                label={`Inline script ${String(props.ordinal)}`}
                class="min-w-0"
                loadHighlighter={props.codeBlock?.loadHighlighter}
                createObserver={props.codeBlock?.createObserver}
                watchOverflow={props.codeBlock?.watchOverflow}
              />
            )}
          </Show>
          <Show when={shown().cut}>
            <p data-fdt="script-source-cut" class="text-2xs text-fg-muted">
              {expandedCutNote(HIGHLIGHT_MAX_CHARS)}
            </p>
          </Show>
        </Show>
        <Show when={source()?.partial === true}>
          <p data-fdt="script-source-partial" class="text-2xs text-fg-muted">
            {SOURCE_READ_NOTE}
          </p>
        </Show>
      </Show>
    </DetailSection>
  );
}

/**
 * The served tag, highlighted as HTML; a skeleton line while it is read; one
 * muted line naming why it is missing otherwise.
 *
 * @param props.state The served-tag read's state.
 * @param props.codeBlock Code block seams (tests only).
 */
function ServedTag(props: {
  state: OnDemandState<ServedScriptTagResult>;
  codeBlock?: CodeBlockSeams;
}): JSX.Element {
  const reply = (): ServedScriptTagResult | null =>
    props.state.status === 'ready' ? props.state.value : null;
  const tag = (): string | null => {
    const value = reply();
    return value?.status === 'ok' ? value.tag : null;
  };
  const note = (): string | null => {
    if (props.state.status === 'idle') return SERVED_TAG_NOTES['no-snapshot'];
    if (props.state.status === 'failed') return SERVED_TAG_NOTES.unreachable;
    const value = reply();
    if (value === null || value.status === 'ok') return null;
    return value.status === 'gone' ? SERVED_TAG_NOTES.gone : SERVED_TAG_NOTES[value.reason];
  };
  return (
    <DetailSection title="Served as" hook="script-served-tag">
      <Switch>
        <Match when={props.state.status === 'loading'}>
          <Skeleton class="h-8 w-full" />
        </Match>
        <Match when={note()}>
          {(text) => (
            <p data-fdt="script-served-tag-note" class="text-2xs text-fg-muted">
              {text()}
            </p>
          )}
        </Match>
        <Match when={tag()}>
          {(text) => (
            <CodeBlock
              text={text()}
              lang="html"
              label="Served tag"
              defaultWrap
              class="min-w-0"
              loadHighlighter={props.codeBlock?.loadHighlighter}
              createObserver={props.codeBlock?.createObserver}
              watchOverflow={props.codeBlock?.watchOverflow}
            />
          )}
        </Match>
      </Switch>
    </DetailSection>
  );
}
