/**
 * One row of the JavaScript page's script list: the type chip and state
 * chips, then the script itself — an external script's URL (opens in a new
 * tab, copyable) or an inline script's code (collapsed to three lines,
 * expandable, copyable, wrapped by the row's own Wrap toggle — the compact
 * row owns the language caption and the one toggle, the block owns no
 * chrome). Rows are virtual: they mount and unmount with scrolling, so they
 * hold no state of their own — the expanded and wrapped flags come from the
 * page.
 */
import type { JSX } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { MOTION_TURN } from '../../../../components/ui/classes';
import {
  CodeBlock,
  HIGHLIGHT_MAX_CHARS,
  WRAP_LABEL,
  type CodeBlockProps
} from '../../../../components/ui/code-block';
import type { CodeLanguage } from '../../../../components/ui/code-block-langs';
import { CopyButton } from '../../../../components/ui/copy-button';
import { cn } from '../../../../utils/cn';
import { CURRENT_MATCH_ROW } from '../current-match';
import { ExternalLink } from '../page-frame';
import { StateChips } from '../resource-list/state-chip-list';
import type { ContentCapture, InlineCode, ScriptRowView } from './script-view';
import {
  COLLAPSED_CODE_LINES,
  codeCaption,
  codeToggleLabel,
  expandedCutNote,
  expandedText,
  ORIGINAL_TYPE_TITLE
} from './script-view';

/** One remedy for unavailable/stale source reads; partial previews are never a copy fallback. */
const SOURCE_READ_REMEDY = 'Refresh the panel and try copying again.';

/** The one language inline code highlights (and the row's caption names). */
const CODE_LANG: CodeLanguage = 'javascript';

/** The code block's test seams, forwarded untouched (production omits them). */
export type CodeBlockSeams = Pick<
  CodeBlockProps,
  'loadHighlighter' | 'createObserver' | 'watchOverflow'
>;

/** Props of {@link ScriptRow}. */
export interface ScriptRowProps {
  /** The row's data. */
  view: ScriptRowView;
  /** Zero-based position in the rendered (filtered) list. */
  index: number;
  /** The rendered list's length (`aria-setsize`). */
  setSize: number;
  /** The row's 1-based position among the page's inline scripts (names its code). */
  inlineOrdinal: number;
  /** Whether the inline code is expanded (page-owned state). */
  expanded: boolean;
  /** Whether the inline code wraps (page-owned state; rows hold none). */
  wrap: boolean;
  /**
   * Flip the expanded state.
   *
   * @param toggle The toggle button, so a collapse can keep it in view.
   */
  onToggle: (toggle: HTMLButtonElement) => void;
  /** Flip the wrapped state. */
  onWrap: () => void;
  /** The find's current match — `aria-current` + the shared row marker. */
  current?: boolean;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
  /** Read the exact full captured source when the inventory was bounded. */
  loadSource?: (signal: AbortSignal) => Promise<string>;
}

/**
 * Render one script row.
 *
 * The root is the list item (`aria-setsize`/`aria-posinset` — the full list
 * is never in the DOM); its height is natural (the list measures it). Compact
 * width stacks an external URL under its chips; from the regular tier it
 * shares their line.
 *
 * @param props See {@link ScriptRowProps}.
 */
export function ScriptRow(props: ScriptRowProps): JSX.Element {
  return (
    <div
      data-fdt="script-row"
      data-fdt-script-type={props.view.row.type}
      role="listitem"
      aria-setsize={props.setSize}
      aria-posinset={props.index + 1}
      aria-current={props.current === true ? 'true' : undefined}
      class={cn(
        'flex flex-col gap-1.5 px-2 py-1.5',
        props.index < props.setSize - 1 && 'border-b border-line-1',
        props.current === true && CURRENT_MATCH_ROW
      )}
    >
      <Show
        when={props.view.code}
        fallback={
          <ExternalScript
            url={props.view.row.content}
            loadSource={
              props.loadSource ??
              (props.view.capture === 'clipped' ? missingSnapshotSource : undefined)
            }
            chips={<RowChips view={props.view} />}
          />
        }
      >
        {(code) => (
          <InlineScript
            domId={props.view.domId}
            ordinal={props.inlineOrdinal}
            capture={props.view.capture}
            source={props.view.row.content}
            loadSource={props.loadSource}
            code={code()}
            chips={<RowChips view={props.view} />}
            expanded={props.expanded}
            wrap={props.wrap}
            onToggle={(toggle) => {
              props.onToggle(toggle);
            }}
            onWrap={props.onWrap}
            codeBlock={props.codeBlock}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * The type chip, the state chips (at most three, then "+N") and, on a
 * delayed row, its original `type` — what the row is and how WP Rocket
 * treats it. Text always names the state; color only reinforces it. Rendered
 * as bare items so the caller's wrapping line lays them out with its own
 * trailing items; a chip never breaks inside its own label, while the type
 * (a page value, up to 64 characters) breaks anywhere rather than push the
 * row sideways.
 *
 * @param props.view The row.
 */
function RowChips(props: { view: ScriptRowView }): JSX.Element {
  return (
    <>
      <Badge variant="outline" class="font-medium whitespace-nowrap">
        {props.view.row.type === 'inline' ? 'Inline' : 'External'}
      </Badge>
      <StateChips chips={props.view.chips} />
      <Show when={props.view.typeDetail}>
        {(detail) => (
          <span
            data-fdt="script-original-type"
            title={ORIGINAL_TYPE_TITLE}
            class="min-w-0 font-mono text-2xs break-all text-fg-secondary"
          >
            {detail()}
          </span>
        )}
      </Show>
    </>
  );
}

/**
 * An external script: chips, then the URL with its copy control — on the
 * chips' line from the regular tier (wrapping below when the chips leave it
 * under 12 rem), on its own line below when compact.
 *
 * @param props.url The script URL (possibly relative or empty).
 * @param props.chips The row's chips.
 */
function ExternalScript(props: {
  url: string;
  chips: JSX.Element;
  loadSource?: (signal: AbortSignal) => Promise<string>;
}): JSX.Element {
  return (
    <div class="flex flex-wrap items-center gap-1">
      {props.chips}
      <div class="flex min-h-6 min-w-0 basis-full items-center gap-1 @regular:ms-1 @regular:flex-1 @regular:basis-48">
        <Show
          when={props.url !== ''}
          fallback={<span class="text-2xs text-fg-muted">Empty src attribute</span>}
        >
          <div class="min-w-0 flex-1">
            <ExternalLink href={props.url} />
          </div>
          <CopyButton
            loadText={props.loadSource}
            sourceFailureDescription={SOURCE_READ_REMEDY}
            text={props.url}
            label="Script URL"
            showLabel={false}
            class="shrink-0"
          />
        </Show>
      </div>
    </div>
  );
}

/** Props of {@link InlineScript}. */
interface InlineScriptProps {
  /** The code block's DOM id (the toggle's `aria-controls` target). */
  domId: string;
  /** The 1-based position among inline scripts (the code's accessible name). */
  ordinal: number;
  /** How much of the text the capture delivered. */
  capture: ContentCapture;
  /** The inline source as captured. */
  source: string;
  /** The derived code shape. */
  code: InlineCode;
  /** The row's chips. */
  chips: JSX.Element;
  /** Whether the code is expanded. */
  expanded: boolean;
  /** Whether the code wraps. */
  wrap: boolean;
  /** Flip the expanded state. */
  onToggle: (toggle: HTMLButtonElement) => void;
  /** Flip the wrapped state. */
  onWrap: () => void;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
  /** Read the exact full captured source when the inventory was bounded. */
  loadSource?: (signal: AbortSignal) => Promise<string>;
}

/**
 * An inline script: the chips line carries the row facts and the controls —
 * chips, the language-and-count caption and the two code actions (wrap,
 * copy) — then the toolbar-less code (clamped to three lines while
 * collapsed; the block fades the edge only when lines are cut off) and the
 * toggle. The block owns no chrome of its own: the caption is the row's one
 * language statement, and the row's Wrap is the code's one accessible toggle
 * (reactive through the page-owned state, so it survives a virtual
 * remount). Collapsed, the block renders (and highlights) only the preview;
 * the full source arrives on expand up to the render limit. Copy reads the
 * complete snapshot separately. The toggle is offered only when it reveals
 * something: more lines, a cut preview line, or a clamp that clips (a
 * wrapped long line).
 *
 * Capture states: a clipped preview is marked "Content clipped"; copy reads
 * the complete script through the snapshot reader. Text the size budget left
 * out reads "Content not captured (size budget)" — never "Empty inline script", which is reserved
 * for a script that really has no text.
 *
 * @param props See {@link InlineScriptProps}.
 */
function InlineScript(props: InlineScriptProps): JSX.Element {
  const [clamped, setClamped] = createSignal(false);
  const collapsed = (): boolean => !props.expanded;
  // A not-captured text is always empty (the budget left it out), so blankness
  // alone gates the code; the note below tells the two empty causes apart.
  const hasCode = (): boolean => !props.code.blank;
  const toggleable = (): boolean => props.expanded || props.code.expandable || clamped();
  // Expanded, a script past the render limit shows its start (and says so).
  const expandedView = (): { text: string; cut: boolean } =>
    expandedText(props.source, HIGHLIGHT_MAX_CHARS);
  return (
    <>
      <div class="flex flex-wrap items-center gap-1">
        {props.chips}
        <Show when={props.capture === 'clipped'}>
          <Badge kind="warn" class="whitespace-nowrap">
            Content clipped
          </Badge>
        </Show>
        <Show when={hasCode() || props.capture === 'not-captured'}>
          <span class="ms-auto flex items-center gap-1 ps-1">
            <Show when={hasCode()}>
              <span class="text-2xs text-fg-muted tabular-nums">
                {codeCaption(CODE_LANG, props.code.lines)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-fdt="script-code-wrap"
                aria-pressed={props.wrap}
                onClick={props.onWrap}
                class="min-h-6 px-1.5 text-2xs"
              >
                {WRAP_LABEL}
              </Button>
            </Show>
            <CopyButton
              text={props.source}
              loadText={
                props.loadSource ??
                (props.capture !== 'complete' ? missingSnapshotSource : undefined)
              }
              sourceFailureDescription={SOURCE_READ_REMEDY}
              label="Inline script"
              showLabel={false}
            />
          </span>
        </Show>
      </div>
      <Show
        when={hasCode()}
        fallback={<p class="text-2xs text-fg-muted">{emptyNote(props.capture)}</p>}
      >
        <CodeBlock
          id={props.domId}
          text={collapsed() ? props.code.preview : expandedView().text}
          lang={CODE_LANG}
          label={`Inline script ${String(props.ordinal)}`}
          maxLines={collapsed() ? COLLAPSED_CODE_LINES : undefined}
          cutLines={collapsed() ? props.code.cutLines : undefined}
          onClipChange={setClamped}
          toolbar={false}
          wrap={props.wrap}
          class="min-w-0"
          loadHighlighter={props.codeBlock?.loadHighlighter}
          createObserver={props.codeBlock?.createObserver}
          watchOverflow={props.codeBlock?.watchOverflow}
        />
        <Show when={!collapsed() && expandedView().cut}>
          <p data-fdt="script-expanded-cut" class="text-2xs text-fg-muted">
            {expandedCutNote(HIGHLIGHT_MAX_CHARS)}
          </p>
        </Show>
        <Show when={toggleable()}>
          <Button
            variant="ghost"
            size="sm"
            data-fdt="script-code-toggle"
            aria-expanded={props.expanded}
            aria-controls={props.domId}
            onClick={(event) => {
              props.onToggle(event.currentTarget);
            }}
            class="self-start"
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              class={cn(MOTION_TURN, props.expanded && 'rotate-180')}
            />
            {codeToggleLabel(props.code, props.expanded)}
          </Button>
        </Show>
      </Show>
    </>
  );
}

/**
 * The note standing in for code an inline row cannot show.
 *
 * @param capture The row's capture state.
 */
export function emptyNote(capture: ContentCapture): string {
  return capture === 'not-captured' ? 'Content not captured (size budget)' : 'Empty inline script';
}

/**
 * Refuse to copy a bounded preview without the capture needed to recover its source.
 * @returns A rejected read, handled by the shared copy control's refresh remedy.
 */
function missingSnapshotSource(): Promise<string> {
  return Promise.reject(new Error('Refresh the panel to capture the complete script source.'));
}
