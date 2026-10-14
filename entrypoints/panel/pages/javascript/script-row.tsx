/**
 * One row of the JavaScript page's script list: the type chip and state
 * chips, then the script itself — an external script's URL (opens in a new
 * tab, copyable) or an inline script's code (collapsed to three lines,
 * expandable, copyable). Rows are virtual: they mount and unmount with
 * scrolling, so they hold no state of their own — the expanded flag comes
 * from the page.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { MOTION_TURN } from '../../../../components/ui/classes';
import { CodeBlock, type CodeBlockProps } from '../../../../components/ui/code-block';
import { CopyButton } from '../../../../components/ui/copy-button';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { cn } from '../../../../utils/cn';
import { ExternalLink } from '../page-frame';
import type { InlineCode, ScriptRowView } from './script-view';
import { COLLAPSED_CODE_LINES, codeToggleLabel, lineCount } from './script-view';

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
  /** Whether the inline code is expanded (page-owned state). */
  expanded: boolean;
  /**
   * Flip the expanded state.
   *
   * @param toggle The toggle button, so a collapse can keep it in view.
   */
  onToggle: (toggle: HTMLButtonElement) => void;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
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
      class={cn(
        'flex flex-col gap-1.5 px-2 py-1.5',
        props.index < props.setSize - 1 && 'border-b border-line-1'
      )}
    >
      <Show
        when={props.view.code}
        fallback={
          <ExternalScript url={props.view.row.content} chips={<RowChips view={props.view} />} />
        }
      >
        {(code) => (
          <InlineScript
            id={props.view.row.id}
            source={props.view.row.content}
            code={code()}
            chips={<RowChips view={props.view} />}
            expanded={props.expanded}
            onToggle={(toggle) => {
              props.onToggle(toggle);
            }}
            codeBlock={props.codeBlock}
          />
        )}
      </Show>
    </div>
  );
}

/**
 * The type chip and the state chips — what the row is and how WP Rocket
 * treats it. Text always names the state; color only reinforces it. Rendered
 * as bare items so the caller's wrapping line lays them out with its own
 * trailing items; a chip never breaks inside its own label.
 *
 * @param props.view The row.
 */
function RowChips(props: { view: ScriptRowView }): JSX.Element {
  return (
    <>
      <Badge variant="outline" class="font-medium whitespace-nowrap">
        {props.view.row.type === 'inline' ? 'Inline' : 'External'}
      </Badge>
      <For each={props.view.badges}>
        {(badge) => (
          <StatusBadge kind={badge.kind} class="whitespace-nowrap">
            {badge.label}
          </StatusBadge>
        )}
      </For>
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
function ExternalScript(props: { url: string; chips: JSX.Element }): JSX.Element {
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
          <CopyButton text={props.url} label="Script URL" showLabel={false} class="shrink-0" />
        </Show>
      </div>
    </div>
  );
}

/** Props of {@link InlineScript}. */
interface InlineScriptProps {
  /** The row id (names the code block for `aria-controls`). */
  id: number;
  /** The full inline source. */
  source: string;
  /** The derived code shape. */
  code: InlineCode;
  /** The row's chips. */
  chips: JSX.Element;
  /** Whether the code is expanded. */
  expanded: boolean;
  /** Flip the expanded state. */
  onToggle: (toggle: HTMLButtonElement) => void;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
}

/**
 * An inline script: chips with the line count and copy control, then the
 * code — clamped to three lines while collapsed (the block fades the edge
 * only when text is clipped) — and the toggle.
 * Collapsed, the block renders (and highlights) only the preview; the full
 * source arrives on expand.
 *
 * @param props See {@link InlineScriptProps}.
 */
function InlineScript(props: InlineScriptProps): JSX.Element {
  const codeId = (): string => `fdt-js-code-${String(props.id)}`;
  const collapsed = (): boolean => props.code.expandable && !props.expanded;
  return (
    <>
      <div class="flex flex-wrap items-center gap-1">
        {props.chips}
        <Show when={!props.code.blank}>
          <span class="ms-auto flex items-center gap-1 ps-1">
            <span class="text-2xs text-fg-muted tabular-nums">{lineCount(props.code.lines)}</span>
            <CopyButton text={props.source} label="Inline script" showLabel={false} />
          </span>
        </Show>
      </div>
      <Show
        when={!props.code.blank}
        fallback={<p class="text-2xs text-fg-muted">Empty inline script</p>}
      >
        <CodeBlock
          id={codeId()}
          text={collapsed() ? props.code.preview : props.source}
          lang="javascript"
          label={`Inline script ${String(props.id + 1)} code`}
          maxLines={collapsed() ? COLLAPSED_CODE_LINES : undefined}
          class="min-w-0"
          loadHighlighter={props.codeBlock?.loadHighlighter}
          createObserver={props.codeBlock?.createObserver}
          watchOverflow={props.codeBlock?.watchOverflow}
        />
        <Show when={props.code.expandable}>
          <Button
            variant="ghost"
            size="sm"
            data-fdt="script-code-toggle"
            aria-expanded={props.expanded}
            aria-controls={codeId()}
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
