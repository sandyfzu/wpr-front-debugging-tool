/**
 * One live script's row in the Runtime states list: its name and Details,
 * then its state (icon + word), source group and where it comes from (URL,
 * or the start of its code), then its id and classes; Details opens why it is in its state, every
 * field in full and the whole code (with a note when the read cut it).
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { MOTION_TURN } from '../../../../components/ui/classes';
import { CodeBlock } from '../../../../components/ui/code-block';
import { KeyValueList } from '../../../../components/ui/key-value';
import { StatusBadge } from '../../../../components/ui/status-badge';
import {
  codeNote,
  RUNTIME_GROUP_LABELS,
  RUNTIME_STATE_LABELS,
  RUNTIME_STATE_TONES,
  stateReason
} from '../../../../lib/script-runtime/outcome-view';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import { capTitle } from '../../../../utils/cap-text';
import { cn } from '../../../../utils/cn';
import type { RuntimeRow } from './runtime-rows';
import type { CodeBlockSeams } from './script-row';

/** The detail's words for a field the script does not have. */
export const NONE_VALUE = 'None';

/** The source field's words for a script without a URL. */
export const INLINE_SOURCE_COPY = {
  inline: 'Inline code',
  'converted-inline': 'Inline code, run by Delay JS from a data: URL'
} as const;

/** The second line's words for an inline script without code. */
export const EMPTY_CODE_COPY = 'No code in the tag.';

/** Props of {@link RuntimeScriptRow}. */
export interface RuntimeScriptRowProps {
  row: RuntimeRow;
  /** Whether the details are open. */
  expanded: boolean;
  onToggle: () => void;
  /** Code block seams (tests only). */
  codeBlock?: CodeBlockSeams;
}

/**
 * The script's id and classes as one selector-like line (`#id .a .b`), or
 * `''` when it has neither.
 *
 * @param script The record.
 */
export function identityLine(script: Pick<LiveScriptRecord, 'id' | 'classes'>): string {
  const parts = script.classes.map((name) => `.${name}`);
  if (script.id !== '') parts.unshift(`#${script.id}`);
  return parts.join(' ');
}

/**
 * Where the script comes from, in full (the detail's source field).
 *
 * @param script The record.
 */
export function sourceText(script: Pick<LiveScriptRecord, 'sourceKind' | 'source'>): string {
  return script.sourceKind === 'url' ? script.source : INLINE_SOURCE_COPY[script.sourceKind];
}

/**
 * Render one row.
 *
 * @param props See {@link RuntimeScriptRowProps}.
 */
export function RuntimeScriptRow(props: RuntimeScriptRowProps): JSX.Element {
  const script = () => props.row.script;
  const detailId = () => `runtime-script-detail-${String(props.row.id)}`;
  /** The second line: the URL, else the start of the code. */
  const lead = () =>
    script().sourceKind === 'url'
      ? script().source
      : script().preview === ''
        ? EMPTY_CODE_COPY
        : script().preview;
  const identity = () => identityLine(script());
  return (
    <div
      class="flex min-w-0 flex-col gap-1"
      data-fdt-runtime-state={script().state}
      data-fdt-runtime-group={script().group}
    >
      <div class="flex min-w-0 items-center gap-1.5">
        <span
          class="min-w-0 flex-1 truncate font-mono text-xs text-fg-primary"
          title={capTitle(props.row.name)}
        >
          {props.row.name}
        </span>
        <Button
          size="sm"
          variant="ghost"
          class="shrink-0"
          aria-expanded={props.expanded}
          aria-controls={detailId()}
          data-fdt-runtime-toggle
          onClick={() => {
            props.onToggle();
          }}
        >
          <ChevronRight
            size={12}
            aria-hidden="true"
            class={cn(MOTION_TURN, props.expanded && 'rotate-90')}
          />
          Details
        </Button>
      </div>
      {/* Meta under the name: a compact row wraps the source onto its own line. */}
      <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <StatusBadge kind={RUNTIME_STATE_TONES[script().state]} icon>
          {RUNTIME_STATE_LABELS[script().state]}
        </StatusBadge>
        <Badge variant="outline">{RUNTIME_GROUP_LABELS[script().group]}</Badge>
        <span
          class="min-w-0 grow basis-40 truncate font-mono text-2xs text-fg-secondary"
          title={script().sourceKind === 'url' ? capTitle(script().source) : undefined}
        >
          {lead()}
        </span>
      </div>
      <Show when={identity() !== ''}>
        <span class="min-w-0 truncate font-mono text-2xs text-fg-muted">{identity()}</span>
      </Show>
      <Show when={props.expanded}>
        <RuntimeScriptDetail id={detailId()} row={props.row} codeBlock={props.codeBlock} />
      </Show>
    </div>
  );
}

/**
 * A row's details: the state's reason, every field in full, the code.
 *
 * @param props.id The region's id (the toggle controls it).
 * @param props.row The row.
 * @param props.codeBlock Code block seams (tests only).
 */
function RuntimeScriptDetail(props: {
  id: string;
  row: RuntimeRow;
  codeBlock?: CodeBlockSeams;
}): JSX.Element {
  const script = () => props.row.script;
  const note = () => codeNote(script());
  return (
    <div id={props.id} data-fdt-runtime-detail class="flex min-w-0 flex-col gap-2 pt-1">
      <p class="text-2xs text-fg-secondary">{stateReason(script())}</p>
      <KeyValueList
        items={[
          {
            term: 'Status attribute',
            value: <span class="font-mono">{script().rawStatus ?? NONE_VALUE}</span>
          },
          {
            term: 'Source',
            value: <span class="font-mono break-all">{sourceText(script())}</span>
          },
          {
            term: 'ID',
            value: <span class="font-mono break-all">{script().id || NONE_VALUE}</span>
          },
          {
            term: 'Classes',
            value: (
              <span class="font-mono break-all">
                {script().classes.length === 0 ? NONE_VALUE : script().classes.join(' ')}
              </span>
            )
          }
        ]}
      />
      <Show when={script().fullText !== ''}>
        <Show when={note()}>
          {(text) => (
            <p data-fdt-runtime-code-note class="text-2xs text-fg-muted">
              {text()}
            </p>
          )}
        </Show>
        {/* The list's scroller holds the whole code (no nested scroller). */}
        <CodeBlock
          text={script().fullText}
          lang={script().structuredData ? 'json' : 'javascript'}
          label={`${props.row.name} code`}
          class="min-w-0"
          loadHighlighter={props.codeBlock?.loadHighlighter}
          createObserver={props.codeBlock?.createObserver}
          watchOverflow={props.codeBlock?.watchOverflow}
        />
      </Show>
    </div>
  );
}
