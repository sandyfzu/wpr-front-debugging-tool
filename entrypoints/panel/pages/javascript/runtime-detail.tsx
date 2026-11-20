/**
 * One live script in the Runtime states list: its state line (the state's
 * icon + word, then its source group — the row's states cell and the
 * detail's first line) and its detail body (the side pane or the drill-in
 * view): why it is in its state, the source-link tile for a URL, the facts
 * its tag carries and its code — all the read kept, highlighted as
 * JavaScript or JSON up to the code block's limit and plain past it (the
 * block says so), with a note when the read's budget or cap cut it.
 *
 * One column at every width (`DETAIL_STACK`); the code opens wrapped when
 * minified and caps its height to the detail view's (`DETAIL_CODE_MAX_HEIGHT`).
 */
import type { Accessor, JSX } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import { Badge } from '../../../../components/ui/badge';
import { CodeBlock } from '../../../../components/ui/code-block';
import { StatusBadge } from '../../../../components/ui/status-badge';
import {
  RUNTIME_GROUP_LABELS,
  RUNTIME_STATE_LABELS,
  RUNTIME_STATE_TONES,
  stateReason
} from '../../../../lib/script-runtime/outcome-view';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import type { OpenResource } from '../open-resource';
import {
  DETAIL_CODE_MAX_HEIGHT,
  DetailSection,
  DETAIL_STACK,
  FactList
} from '../resource-list/detail-section';
import { opensWrapped } from '../../../../lib/panel/detail-code';
import { SourceLink } from '../resource-list/source-link';
import { cn } from '../../../../utils/cn';
import type { CodeBlockSeams } from './code-seams';
import {
  EMPTY_CODE_COPY,
  runtimeCodeLanguage,
  runtimeCodeNote,
  runtimeFacts,
  urlClipped,
  type RuntimeRow
} from './runtime-rows';
import { countLines, lineCount } from './script-view';

/**
 * A script's state (icon + word, never color alone) and its source group.
 * Carries the state and group as data attributes (the harness reads them).
 *
 * @param props.script The record.
 * @param props.row The list row's form: one line — a compact list (a
 *   phone-width panel) shows the state alone, the group staying in the
 *   detail and the Source facet, so the badges never wrap onto a second line.
 */
export function RuntimeStateLine(props: { script: LiveScriptRecord; row?: boolean }): JSX.Element {
  return (
    <span
      class={cn(
        'flex min-w-0 items-center gap-1',
        props.row === true ? 'flex-nowrap' : 'flex-wrap'
      )}
      data-fdt-runtime-state={props.script.state}
      data-fdt-runtime-group={props.script.group}
    >
      <StatusBadge kind={RUNTIME_STATE_TONES[props.script.state]} icon class="shrink-0">
        {RUNTIME_STATE_LABELS[props.script.state]}
      </StatusBadge>
      <Badge variant="outline" class={props.row === true ? '@max-regular:hidden' : undefined}>
        {RUNTIME_GROUP_LABELS[props.script.group]}
      </Badge>
    </span>
  );
}

/** Props of {@link RuntimeDetail}. */
export interface RuntimeDetailProps {
  /** The selected row (live: a re-read that changed the script updates it in place). */
  row: Accessor<RuntimeRow>;
  /** "Open in Sources" (null: the tile opens a new tab). */
  openResource: OpenResource | null;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
}

/**
 * Render one live script's detail body.
 *
 * @param props See {@link RuntimeDetailProps}.
 */
export function RuntimeDetail(props: RuntimeDetailProps): JSX.Element {
  const script = () => props.row().script;
  const facts = createMemo(() => runtimeFacts(script()));
  return (
    <div data-fdt="runtime-detail" data-fdt-runtime-detail class="min-w-0">
      <div class={DETAIL_STACK}>
        <div class="flex min-w-0 flex-col gap-3.5">
          <div class="flex min-w-0 flex-col gap-1.5">
            <RuntimeStateLine script={script()} />
            <p data-fdt="runtime-reason" class="text-2xs text-fg-secondary">
              {stateReason(script())}
            </p>
          </div>
          <Show when={script().sourceKind === 'url'}>
            {/* The resolved address when the page's base gives one (a relative
                URL then opens too); else the URL as captured (shown as text). */}
            <SourceLink
              url={props.row().url ?? script().source}
              clipped={urlClipped(script())}
              openResource={props.openResource}
            />
          </Show>
          <FactList facts={facts()} hook="runtime-facts" />
        </div>
        <RuntimeCode row={props.row()} codeBlock={props.codeBlock} />
      </div>
    </div>
  );
}

/**
 * The script's code section: every character the read kept (at most the
 * per-script cap — a plain block stays cheap at that size; the code block
 * highlights up to its limit and notes the plain rest), the cut note when
 * the read kept only the start, the empty-code line for a tag without code;
 * nothing for a URL script without inline code.
 *
 * @param props.row The row.
 * @param props.codeBlock Code block seams (tests only).
 */
function RuntimeCode(props: { row: RuntimeRow; codeBlock?: CodeBlockSeams }): JSX.Element {
  const script = () => props.row.script;
  const note = createMemo(() => runtimeCodeNote(script()));
  return (
    <Show when={script().fullText !== '' || script().sourceKind !== 'url'}>
      <DetailSection
        title="Code"
        hook="runtime-code"
        aside={script().fullText === '' ? undefined : lineCount(countLines(script().fullText))}
      >
        <Show
          when={script().fullText !== ''}
          fallback={<p class="text-2xs text-fg-muted">{EMPTY_CODE_COPY}</p>}
        >
          <Show when={note()}>
            {(text) => (
              <p data-fdt-runtime-code-note class="text-2xs text-fg-muted">
                {text()}
              </p>
            )}
          </Show>
          {/* Keyed by language: a block's language is fixed at mount. */}
          <Show when={runtimeCodeLanguage(script())} keyed>
            {(lang) => (
              <CodeBlock
                text={script().fullText}
                lang={lang}
                label={`${props.row.name} code`}
                defaultWrap={opensWrapped(script().fullText)}
                maxHeight={DETAIL_CODE_MAX_HEIGHT}
                class="min-w-0"
                loadHighlighter={props.codeBlock?.loadHighlighter}
                createObserver={props.codeBlock?.createObserver}
                watchOverflow={props.codeBlock?.watchOverflow}
              />
            )}
          </Show>
        </Show>
      </DetailSection>
    </Show>
  );
}
