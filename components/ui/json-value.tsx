/**
 * The recursive JSON renderer — the structured-data surface for payloads
 * (sidebar objects, tool results). Primitives render inline; arrays/objects
 * collapse under a count-badge toggle; the `searchQuery` prop is plain
 * presentational input (the caller feeds the current query — this component
 * never reaches for a store): matching substrings are marked in place, and a match in
 * a collapsed branch auto-expands its ancestors, so hits cannot hide.
 *
 * Input contract: the value is **JSON-decoded data** (the protocol
 * boundary — `JSON.parse`, structured-clone messaging). Defensively, the
 * root view clamps every payload through `boundedJsonOf`
 * (`json-value-bounds.ts`) before rendering: cyclic re-entries, depth and
 * node-budget excesses are cut and replaced by visible truncation marker
 * nodes — a hostile or pathological composition can neither hang the walk
 * nor render silently wrong (e.g. a `Map`, which is not a JSON object,
 * displays as its string form, never as `{}`).
 *
 * Structured JSON is deliberately not rendered through the code block's
 * syntax highlighter — syntax coloring is for *sources*, not data, and the
 * flat dump sheds every affordance this renderer carries.
 */
import type { ComponentProps, JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  splitProps
} from 'solid-js';
import { ChevronDown, ChevronRight } from 'lucide-solid';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';
import {
  JSON_VIEW_BUDGET,
  boundedJsonOf,
  isPlainJsonObject,
  isTruncationMarker,
  warnTruncations,
  type JsonBudget,
  type JsonTruncationMarker,
  type JsonTruncationReason
} from './json-value-bounds';

export type JsonValueProps = {
  /** The value to render — JSON-decoded data (hostile compositions are bounded defensively). */
  value: unknown;
  /** The term of an object entry; absent at the root and for array items. */
  keyName?: string;
  /** The query whose matches are marked (presentational only). */
  searchQuery?: string;
  /** Whether containers start collapsed (default `false`: expanded, devtools-visible). */
  defaultCollapsed?: boolean;
  /**
   * Internal: the view bounds for the root clamp call. Production callers
   * leave it unset (a bug-level contract violation to fiddle with — the
   * hard defaults own the safety margin); tests pass tiny budgets to reach
   * the truncation branches without building giant payloads.
   */
  viewBudget?: JsonBudget;
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
 * The scalar's display string. Strings keep their quotes (they are part of
 * the data's shape — `a URL` vs `URL` is a text-vs-identifier distinction).
 *
 * Number fidelity caveat, stated because this is a debugging tool: nested
 * scalars arrive as JS numbers, so `String(value)` shows the **parsed**
 * number — JSON source text like `1e999` (→ `Infinity`),exponents beyond
 * double precision (`1.234567890123456789` → rounded digits) or huge powers
 * (`1e21` → `1e+21`) is normalized by the decode *upstream* of this
 * renderer. The display is faithful to the decoded value, not to the raw
 * source text; payloads whose exact source digits matter must be shown
 * through the code block (raw source), not this view.
 *
 * @param value A scalar (string/number/boolean) — containers never reach it.
 */
function displayOf(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * The scalar texts a match can land on: the entry term and the value's raw
 * form — the query `number` matches both the `id` term and the `number`
 * value of an `"id": "number"` entry.
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
 * The subtree is clamped through the same bounds guard the renderer uses, so
 * the walk is finite for any input a deep/cyclic composition can produce
 * (markers in the clamped view match nothing and are never entered).
 *
 * @param value Any JSON value.
 * @param keyName The entry term, when the value is an object entry.
 * @param queryLower The lowercased query; empty never matches.
 */
export function subtreeMatches(
  value: unknown,
  keyName: string | undefined,
  queryLower: string
): boolean {
  if (queryLower.length === 0) return false;
  const bounded = boundedJsonOf(value, JSON_VIEW_BUDGET).value;
  return subtreeMatchesIn(bounded, keyName, queryLower);
}

/**
 * The unguarded recursion of {@link subtreeMatches} — reached only with a
 * clamped view, where cycles/depth/size cannot recurse unboundedly.
 *
 * @param value A clamped subtree root.
 * @param keyName The entry term, when the value is an object entry.
 * @param queryLower The lowercased query.
 */
function subtreeMatchesIn(
  value: unknown,
  keyName: string | undefined,
  queryLower: string
): boolean {
  if (isTruncationMarker(value)) return false;
  if (scalarTextsOf(keyName, value).some((text) => text.toLowerCase().includes(queryLower))) {
    return true;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).some((item) => subtreeMatchesIn(item, undefined, queryLower));
  }
  if (isPlainJsonObject(value)) {
    return Object.entries(value).some(([key, child]) => subtreeMatchesIn(child, key, queryLower));
  }
  return false;
}

/** The visible copy of each truncation reason (the cut must read as fact, not as an error). */
const TRUNCATION_COPY: Record<JsonTruncationReason, string> = {
  depth: 'structure truncated — depth cap',
  nodes: 'structure truncated — node budget',
  cycle: 'structure truncated — cyclic reference'
};

/**
 * Render one truncation marker as its visible info row ("structure
 * truncated — <reason>"). Never silently wrong: the cut point shows itself.
 *
 * @param props.marker The walk's marker (identity-verified by the calling branch).
 */
function TruncationMarkerRow(props: { marker: JsonTruncationMarker }): JSX.Element {
  return (
    <span
      data-fdt-json-truncated
      data-fdt-json-truncation={props.marker.reason}
      class="text-2xs italic text-fg-muted"
    >
      {TRUNCATION_COPY[props.marker.reason]}
    </span>
  );
}

/**
 * Render one JSON payload: clamp through the view guard, then render the
 * clamped structure (`JsonNode`, which recurses freely inside its clamped
 * subtree and never re-clamps — the root clamp is the walk's only pass).
 */
export function JsonValue(props: JsonValueProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'value',
    'keyName',
    'searchQuery',
    'defaultCollapsed',
    'viewBudget',
    'class'
  ]);

  // The root clamp: one pure walk that makes the whole subtree re-walkable
  // (cycles cut, bounds enforced) before any render recursion happens.
  const bounded = createMemo(() => boundedJsonOf(own.value, own.viewBudget ?? JSON_VIEW_BUDGET));

  // Once per truncation event: the markers in the tree are the user-facing
  // feedback; this is the operational record naming the bound that cut.
  createEffect(() => {
    warnTruncations(bounded().truncations);
  });

  return (
    <JsonNode
      value={bounded().value}
      keyName={own.keyName}
      searchQuery={own.searchQuery}
      defaultCollapsed={own.defaultCollapsed}
      class={own.class}
      {...rest}
    />
  );
}

/** The rendering contract of one (clamped) JSON node — the guard's output, never raw input. */
type JsonNodeProps = Omit<JsonValueProps, 'viewBudget'>;

/**
 * Render one clamped JSON value; recursion is direct (this component renders
 * itself for container children — a function component's own identifier is
 * its call). Values reaching here are always clamped (`JsonValue` wraps).
 *
 * Contract (one node, five shapes):
 * - a truncation marker renders the visible "structure truncated" row;
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
 * @param props.value The clamped value.
 * @param props.keyName The entry term when the value is an object entry.
 * @param props.searchQuery The marking query.
 * @param props.defaultCollapsed Whether containers start collapsed (default `false`).
 * @param props.class Extra classes on the node.
 * @param props.* Native div props (`id`, `aria-*`, …) pass through.
 */
function JsonNode(props: JsonNodeProps): JSX.Element {
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
    return isPlainJsonObject(own.value)
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
        <Match when={isTruncationMarker(own.value)}>
          {/* The guard in `when` just verified the type; the marker row is its dedicated shape. */}
          <TruncationMarkerRow marker={own.value as JsonTruncationMarker} />
        </Match>
        <Match
          when={
            (Array.isArray(own.value) || isPlainJsonObject(own.value)) && entries().length === 0
          }
        >
          <span data-fdt-json-empty class="text-fg-muted">
            {Array.isArray(own.value) ? '[]' : '{}'}
          </span>
        </Match>
        <Match when={Array.isArray(own.value) || isPlainJsonObject(own.value)}>
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
            class={cn('whitespace-pre-wrap break-words', 'text-fg-secondary')}
            data-fdt-json-scalar
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
  /** Whether the container is an array (bracket labels) — objects use braces. */
  isJsonEntryCountable: boolean;
  /** Inherited query plumb: reaches the children and their marks. */
  searchQuery?: string;
  /** Inherited collapse default, for the recursive children. */
  defaultCollapsed?: boolean;
};

/**
 * Render the container branch: toggle row + (optional) children + closing
 * brace. The children recurse — each child a fresh `JsonNode` with its own
 * toggle, marked text and match rule (the query flows down; the collapse
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
              <JsonNode
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
