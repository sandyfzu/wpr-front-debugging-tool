/**
 * The recursive JSON renderer — the structured-data surface for payloads
 * (sidebar objects, tool results). Primitives render inline; arrays/objects
 * collapse under a count-badge toggle; the `searchQuery` prop is a plain
 * presentational input (P6 wires the search store — this component never
 * reaches for one): matching substrings are marked in place, and a match in
 * a collapsed branch auto-expands its ancestors, so hits cannot hide.
 *
 * Structured JSON is deliberately not rendered through the code block's
 * syntax highlighter — syntax coloring is for *sources*, not data, and the
 * flat dump sheds every affordance this renderer carries.
 */
import type { ComponentProps, JSX } from 'solid-js';
import { createMemo, createSignal, For, Match, Show, Switch, splitProps } from 'solid-js';
import { ChevronDown, ChevronRight } from 'lucide-solid';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

export type JsonValueProps = {
  /** The value to render — any JSON value (primitives, arrays, objects). */
  value: unknown;
  /** The term of an object entry; absent at the root and for array items. */
  keyName?: string;
  /** The query whose matches are marked (presentational only). */
  searchQuery?: string;
  /** Whether containers start collapsed (default `false`: expanded, devtools-visible). */
  defaultCollapsed?: boolean;
  /** Extra classes on the node, merged last so callers win. */
  class?: string;
} & Omit<ComponentProps<'div'>, 'class' | 'children'>;

/** One segment of marked display text: plain runs alternate with matches. */
interface TextPart {
  text: string;
  match: boolean;
}

/**
 * Split a string into plain/marked segments around each case-insensitive
 * occurrence of the query (pure). Exhaustive, contiguous, in order.
 *
 * @param text The display string to split.
 * @param queryLower The lowercased query; empty yields one unmarked segment.
 * @returns At least one segment (the whole text when nothing matches).
 */
function splitMatches(text: string, queryLower: string): TextPart[] {
  if (text.length === 0 || queryLower.length === 0) return [{ text, match: false }];
  const lowered = text.toLowerCase();
  const parts: TextPart[] = [];
  let from = 0;
  while (from < text.length) {
    const at = lowered.indexOf(queryLower, from);
    if (at < 0) {
      parts.push({ text: text.slice(from), match: false });
      break;
    }
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + queryLower.length), match: true });
    from = at + queryLower.length;
  }
  return parts.length > 0 ? parts : [{ text, match: false }];
}

/**
 * Narrow a value to a plain JSON object: `null`, arrays and host objects
 * ('Map', 'document') are excluded so untrusted payloads are never assumed.
 *
 * @param value Any value.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The scalar's display string. Strings keep their quotes (they are part of
 * the data's shape — `ago, "file"` vs `ago` is a URL-or-text distinction).
 *
 * @param value A scalar (string/number/boolean) — containers never reach it.
 */
function displayOf(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * The scalar texts a match can land on: the entry term and the value raw
 * form (the query "number" both "id" the key and "id": "number" value).
 *
 * @param keyName The entry term, when the value is an object entry.
 * @param value The scalar value.
 */
function scalarTextsOf(keyName: string | undefined, value: unknown): string[] {
  const texts: string[] = [];
  if (typeof keyName === 'string') texts.push(keyName);
  if (typeof value === 'string') texts.push(value);
  else if (typeof value === 'number' || typeof value === 'boolean') texts.push(String(value));
  return texts;
}

/**
 * Whether the subtree under (and including) `value` contains a match — the
 * auto-expand rule's test (pure): scalars match on term or value; structures
 * match when any child's subtree does.
 *
 * @param value Any JSON value.
 * @param keyName The entry term, when the value is an object entry.
 * @param queryLower The lowercased query; empty never matches.
 */
function subtreeMatches(value: unknown, keyName: string | undefined, queryLower: string): boolean {
  if (queryLower.length === 0) return false;
  if (scalarTextsOf(keyName, value).some((text) => text.toLowerCase().includes(queryLower))) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => subtreeMatches(item, undefined, queryLower));
  }
  if (isJsonObject(value)) {
    return Object.entries(value).some(([key, child]) => subtreeMatches(child, key, queryLower));
  }
  return false;
}

/**
 * Render one JSON value; recursion is direct (this component renders itself
 * for container children — a function component's own identifier is its call).
 *
 * Contract (one node, four shapes):
 * - scalars render inline (num/bool primary, string with quotes secondary,
 *   null/undefined muted);
 * - empty containers render their braces inline;
 * - non-empty containers render one toggle row (term · chevron · count badge
 *   · opening brace) and, when open, the indented children and the closing
 *   brace;
 * - a non-empty `searchQuery` marks scalar text (`bg-accent/20` under the
 *   token palette) and forces matched branches open — the matched expansion
 *   rules while the query lives; local toggles regain sole control the
 *   moment the query clears. Data values are escaped plain text throughout.
 *
 * @param props.value The value (any JSON value).
 * @param props.keyName The entry term when the value is an object entry.
 * @param props.searchQuery The marking query.
 * @param props.defaultCollapsed Whether containers start collapsed (default `false`).
 * @param props.class Extra classes on the node.
 * @param props.* Native div props (`id`, `aria-*`, …) pass through.
 */
export function JsonValue(props: JsonValueProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'value',
    'keyName',
    'searchQuery',
    'defaultCollapsed',
    'class'
  ]);

  const queryLower = createMemo(() => own.searchQuery?.toLowerCase() ?? '');
  /** A match anywhere in this subtree (including the entry term) — the forcing rule's input. */
  const matched = createMemo(() => subtreeMatches(own.value, own.keyName, queryLower()));
  // One user toggle per container instance; matched-open overrides it while
  // the query filters. The signal keeps ordinal toggling behavior intact per node.
  const [userCollapsed, setUserCollapsed] = createSignal(own.defaultCollapsed ?? false);
  const open = createMemo(() => (matched() ? true : !userCollapsed()));

  /** Immediate entries; scalars have none. */
  const entries = createMemo<Array<{ key: string | undefined; child: unknown }>>(() => {
    if (Array.isArray(own.value)) {
      // `Array.isArray` narrows `unknown` to `any[]` — re-narrow to JSON's
      // array type before mapping (elements stay `unknown`).
      return (own.value as unknown[]).map((child) => ({ key: undefined, child }));
    }
    return isJsonObject(own.value)
      ? Object.entries(own.value).map(([key, child]) => ({ key, child }))
      : [];
  });
  const countLabel = createMemo(() =>
    Array.isArray(own.value)
      ? `${String(entries().length)} items`
      : `${String(entries().length)} keys`
  );

  return (
    <div data-fdt-json-node class="flex min-w-0 items-start gap-x-1 font-mono text-xs" {...rest}>
      <Show when={own.keyName !== undefined}>
        <span data-fdt-json-key class="shrink-0 text-fg-muted">
          <MarkedText
            text={own.keyName ?? ''}
            queryLower={queryLower()}
            unmatchedClass="text-fg-muted"
          />
          <span>:&thinsp;</span>
        </span>
      </Show>
      <Switch>
        <Match
          when={(Array.isArray(own.value) || isJsonObject(own.value)) && entries().length === 0}
        >
          <span data-fdt-json-empty class="text-fg-muted">
            {Array.isArray(own.value) ? '[]' : '{}'}
          </span>
        </Match>
        <Match when={Array.isArray(own.value) || isJsonObject(own.value)}>
          <JsonContainer
            open={open()}
            onToggle={() => setUserCollapsed((value) => !value)}
            entries={entries()}
            countLabel={countLabel()}
            isJsonEntryCountable={Array.isArray(own.value)}
            searchQuery={own.searchQuery}
            defaultCollapsed={own.defaultCollapsed}
          />
        </Match>
        <Match when={own.value === undefined || own.value === null}>
          <span data-fdt-json-scalar class="text-fg-muted">
            {own.value === undefined ? 'undefined' : 'null'}
          </span>
        </Match>
        <Match when={true}>
          <span
            data-fdt-json-scalar
            class={cn('whitespace-pre-wrap break-words', 'text-fg-secondary')}
          >
            <MarkedText
              text={displayOf(own.value)}
              queryLower={queryLower()}
              unmatchedClass="text-fg-secondary"
            />
          </span>
        </Match>
      </Switch>
    </div>
  );
}

/** The recursive-rope inputs of the container branch (read-only view of one node's container half). */
type JsonContainerProps = {
  /** Whether the container branch renders expanded (the node's computed state). */
  open: boolean;
  /** The toggle callback flipping the local collapse state. */
  onToggle: () => void;
  /** The immediate entries in JSON order. */
  entries: Array<{ key: string | undefined; child: unknown }>;
  /** The count badge text ("N items" / "N keys"). */
  countLabel: string;
  /** Whether the container is an array (backets labels) — objects use braces. */
  isJsonEntryCountable: boolean;
  /** Inherited query plumb: reaches the children and their marks. */
  searchQuery?: string;
  /** Inherited collapse default, for the recursive children. */
  defaultCollapsed?: boolean;
};

/**
 * Render the container branch: toggle row + (optional) children + closing
 * brace. The children recurse — each child a fresh `JsonValue` node with its
 * own toggle, marked text and match rule (the query flows down; the collapse
 * default flows down).
 *
 * @param props.open Computed by the parent (auto-expand rules included).
 * @param props.onToggle The user toggle flip.
 * @param props.entries Immediate entries.
 * @param props.countLabel Badge text.
 * @param props.isJsonEntryCountable Whether to render `[`/`]` (`false`: `{`/`}`).
 * @param props.searchQuery The query joining every nested mark field.
 * @param props.defaultCollapsed Recursion default for children.
 */
function JsonContainer(props: JsonContainerProps): JSX.Element {
  const brackets = (): [string, string] => (props.isJsonEntryCountable ? ['[', ']'] : ['{', '}']);
  return (
    <span data-fdt-json-container class="min-w-0">
      <button
        type="button"
        data-fdt-json-toggle
        aria-expanded={props.open}
        onClick={() => {
          props.onToggle();
        }}
        class={cn(
          'inline-flex min-w-0 cursor-pointer select-none items-center gap-1 rounded text-fg-primary',
          'hover:bg-surface-3',
          FOCUS_RING
        )}
      >
        <Show
          when={props.open}
          fallback={<ChevronRight size={12} class="shrink-0 text-fg-muted" />}
        >
          <ChevronDown size={12} class="shrink-0 text-fg-muted" />
        </Show>
        <span data-fdt-json-count class="text-2xs text-fg-muted">
          {props.countLabel}
        </span>
        <span aria-hidden="true" data-fdt-json-bracket class="text-fg-muted">
          {brackets()[0]}
        </span>
      </button>
      <Show when={props.open}>
        <span
          data-fdt-json-children
          class="flex flex-col items-stretch gap-y-1 border-l border-line-1 pl-3"
        >
          <For each={props.entries}>
            {({ key, child }) => (
              <JsonValue
                value={child}
                keyName={key}
                searchQuery={props.searchQuery}
                defaultCollapsed={props.defaultCollapsed}
              />
            )}
          </For>
        </span>
        <span aria-hidden="true" data-fdt-json-bracket data-fdt-json-closing class="text-fg-muted">
          {brackets()[1]}
        </span>
      </Show>
    </span>
  );
}

/**
 * Render a string as text runs — matches wrapped in `<mark>`s, the rest in
 * `unmatchedClass`. Case-insensitive matching comes from the caller's
 * lowercasing both the query and the comparison (pure in `splitMatches`).
 *
 * Also, the marked runs render as solid text (`text-fg-primary`) so the
 * mark is legible in both palettes against its accent tint.
 *
 * @param props.text The full display string.
 * @param props.queryLower The lowercased query (empty: one unmarked segment).
 * @param props.unmatchedClass The class of non-match text runs.
 */
function MarkedText(props: {
  text: string;
  queryLower: string;
  unmatchedClass: string;
}): JSX.Element {
  const parts = createMemo(() => splitMatches(props.text, props.queryLower));
  return (
    <For each={parts()}>
      {(part) =>
        part.match ? (
          <mark data-fdt-json-match class="rounded-sm bg-accent/20 px-px text-fg-primary">
            {part.text}
          </mark>
        ) : (
          <span class={props.unmatchedClass}>{part.text}</span>
        )
      }
    </For>
  );
}
