/**
 * One undefined reference's detail body (the list's side pane or drill-in
 * view): the verdict in words, the single-letter caveat where it applies,
 * then what answers the word — its possible definitions (each script file as
 * a source-link tile with "Copy as exclusion", each inline script as a static
 * tile), or the sentence explaining why there are none.
 */
import type { Accessor, JSX } from 'solid-js';
import { For, Match, Show, Switch, createMemo, createSignal, createUniqueId } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Code from 'lucide-solid/icons/code';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { Button } from '../../../../components/ui/button';
import { MOTION_TURN } from '../../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  type StatusKind
} from '../../../../components/ui/status-badge';
import { SCRIPT_NOUN } from '../../../../lib/detection/count-nouns';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { cn } from '../../../../utils/cn';
import { countNoun } from '../../../../utils/format-count';
import type { OpenResource } from '../open-resource';
import { DetailSection } from '../resource-list/detail-section';
import { SourceLink } from '../resource-list/source-link';
import { COMBINED_EXCLUSION_NOTE, ExclusionCopyButton } from './copy-exclusion';
import { displayWord, isSingleLetterWord, splitScriptUrl, verdictText } from './model';
import { INLINE_DEFINITION_LABEL, definitionCopy, type WordRowView } from './word-view';

/** The vocabulary kind each verdict paints its icon with. */
const VERDICT_KIND: Record<WordRowView['verdict']['kind'], StatusKind> = {
  found: 'info',
  'not-found': 'neutral',
  searching: 'neutral',
  hidden: 'neutral',
  'not-searched': 'neutral'
};

/** Definitions the detail lists before "Show all N" (a generic name can match dozens). */
export const VISIBLE_DEFINITIONS = 5;

/**
 * Why a cross-origin error has no name: the browser hides the details of
 * errors thrown by scripts from another origin.
 */
export const CROSS_ORIGIN_EXPLANATION =
  'Since the error occurred in a file loaded from an external server, the browser limited the information that can be read from it. Make sure to disable CDNs if there are any.';

/**
 * The note a single-letter word opens with: the name has the shape minified
 * code produces, so the found matches are likely coincidental.
 */
export const SINGLE_LETTER_FOUND_NOTE =
  'Single-letter name — usually an artifact of minified code; the matches below are likely coincidental.';

/** The not-found variant: the qualification alone. */
export const SINGLE_LETTER_NOT_FOUND_NOTE =
  'Single-letter name — usually an artifact of minified code.';

/** The inline tile's second line: why it has no action. */
export const INLINE_DEFINITION_NOTE = "In the page's HTML — no file to open";

/** The muted sentence style of the detail's explanations. */
const BODY_NOTE = 'text-2xs leading-snug text-fg-secondary';

/**
 * The not-found sentence; when some scripts could not be read (or the inline
 * scripts were cut) it says the search only covered what it could read.
 *
 * @param unreadable How many scripts the read skipped.
 * @param inlineCut The inline scripts reached the panel cut to size.
 * @returns The sentence.
 */
export function notFoundExplanation(unreadable: number, inlineCut = false): string {
  if (unreadable === 0 && !inlineCut) {
    return "No declaration or assignment of this name was found in the page's scripts.";
  }
  const head =
    "No declaration or assignment of this name was found in the page's readable scripts.";
  const skipped = `${String(unreadable)} ${countNoun(unreadable, SCRIPT_NOUN)}`;
  if (!inlineCut) {
    return `${head} ${skipped} could not be read, so a definition may still be in one of them.`;
  }
  if (unreadable === 0) {
    return `${head} The inline scripts were only partly captured, so a definition may still be in the part that was cut.`;
  }
  return `${head} ${skipped} could not be read and the inline scripts were only partly captured, so a definition may still be in what was not searched.`;
}

/**
 * The single-letter caveat for a verdict, or `null`: only a found or a
 * not-found answer about a one-letter word carries it (the sentinel is never
 * one letter; searching / unsearched words state nothing to qualify).
 *
 * @param view The row.
 * @returns The note, or `null`.
 */
export function singleLetterNote(view: WordRowView): string | null {
  const kind = view.verdict.kind;
  if ((kind !== 'found' && kind !== 'not-found') || !isSingleLetterWord(view.word)) return null;
  return kind === 'found' ? SINGLE_LETTER_FOUND_NOTE : SINGLE_LETTER_NOT_FOUND_NOTE;
}

/**
 * The copy control's accessible name: the visible label first (label in
 * name — voice users say what they see), then the file, and the host for
 * another origin's script, so the same file from two hosts names two
 * controls apart.
 *
 * @param file The script's file name.
 * @param host The script's host when it is not the page's own, else `null`.
 * @returns The accessible name.
 */
export function copyExclusionName(file: string, host: string | null): string {
  return host === null ? `Copy as exclusion: ${file}` : `Copy as exclusion: ${file} (${host})`;
}

/** Props of {@link WordDetail}. */
export interface WordDetailProps {
  /** The selected row (swapped in place when its answer changes). */
  view: Accessor<WordRowView>;
  /** The inspected page's origin, or `null` when unknown (shapes names and patterns). */
  pageOrigin: Accessor<string | null>;
  /** Scripts the read skipped (softens the not-found sentence). */
  unreadable: Accessor<number>;
  /** The inline scripts reached the panel cut to size (softens it too). */
  inlineCut: Accessor<boolean>;
  /** DevTools' "Open in Sources", or `null` (the tiles open a new tab). */
  openResource: OpenResource | null;
}

/**
 * Render the detail body.
 *
 * @param props See {@link WordDetailProps}.
 */
export function WordDetail(props: WordDetailProps): JSX.Element {
  const verdict = (): WordRowView['verdict'] => props.view().verdict;
  const kind = (): StatusKind => VERDICT_KIND[verdict().kind];
  const definitions = (): readonly ScriptOrigin[] => {
    const answer = props.view().answer;
    return answer === null || answer === 'pending' ? [] : answer;
  };
  return (
    <div data-fdt="word-detail" class="flex min-w-0 flex-col gap-3.5">
      <p
        data-fdt-verdict={verdict().kind}
        class="flex items-center gap-1.5 text-2xs text-fg-secondary tabular-nums"
      >
        <Dynamic
          component={STATUS_ICONS[kind()]}
          size={12}
          class={cn('shrink-0', STATUS_TEXT_CLASSES[kind()])}
          aria-hidden="true"
        />
        {verdictText(verdict())}
      </p>
      <Show when={singleLetterNote(props.view())}>
        {(text) => (
          // The note in the warn status color, led by the vocabulary's own
          // warning icon (never color alone).
          <p
            data-fdt="word-single-letter"
            class={cn('flex items-start gap-1.5', BODY_NOTE, STATUS_TEXT_CLASSES.warn)}
          >
            <TriangleAlert size={12} class="mt-px shrink-0" aria-hidden="true" />
            {text()}
          </p>
        )}
      </Show>
      <Switch>
        <Match when={verdict().kind === 'found'}>
          <DetailSection title="Possible definitions" hook="word-definitions">
            <DefinitionList
              word={props.view().word}
              definitions={definitions()}
              pageOrigin={props.pageOrigin()}
              openResource={props.openResource}
            />
          </DetailSection>
        </Match>
        <Match when={verdict().kind === 'hidden'}>
          <p data-fdt="word-explanation" class={BODY_NOTE}>
            {CROSS_ORIGIN_EXPLANATION}
          </p>
        </Match>
        <Match when={verdict().kind === 'not-found'}>
          <p data-fdt="word-explanation" class={BODY_NOTE}>
            {notFoundExplanation(props.unreadable(), props.inlineCut())}
          </p>
        </Match>
      </Switch>
    </div>
  );
}

/** Props of {@link DefinitionList}. */
interface DefinitionListProps {
  /** The word the definitions answer (names the list). */
  word: string;
  /** The definitions, in asset order. */
  definitions: readonly ScriptOrigin[];
  /** The inspected page's origin, or `null`. */
  pageOrigin: string | null;
  /** DevTools' "Open in Sources", or `null`. */
  openResource: OpenResource | null;
}

/**
 * The definitions, capped at {@link VISIBLE_DEFINITIONS} with a
 * "Show all N" disclosure for the rest. The toggle stays mounted when it
 * flips, so focus stays on it; items are keyed by origin object, which the
 * store keeps across re-reads (focus on a copy control survives a refresh).
 *
 * @param props See {@link DefinitionListProps}.
 */
function DefinitionList(props: DefinitionListProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const listId = createUniqueId();
  const capped = (): boolean => props.definitions.length > VISIBLE_DEFINITIONS;
  const shown = (): readonly ScriptOrigin[] =>
    capped() && !expanded() ? props.definitions.slice(0, VISIBLE_DEFINITIONS) : props.definitions;
  return (
    <>
      <ul
        id={listId}
        aria-label={`Possible definitions of ${displayWord(props.word)}`}
        class="flex min-w-0 flex-col gap-3"
      >
        <For each={shown()}>
          {(origin) => (
            <Show when={origin.kind === 'url' ? origin : null} fallback={<InlineDefinition />}>
              {(script) => (
                <ScriptDefinition
                  url={script().url}
                  pageOrigin={props.pageOrigin}
                  openResource={props.openResource}
                />
              )}
            </Show>
          )}
        </For>
      </ul>
      <Show when={capped()}>
        <Button
          variant="ghost"
          size="sm"
          class="-ms-2 self-start"
          aria-expanded={expanded()}
          aria-controls={listId}
          data-fdt="definitions-toggle"
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDown
            size={14}
            class={cn('shrink-0', MOTION_TURN, expanded() && 'rotate-180')}
            aria-hidden="true"
          />
          {expanded() ? 'Show fewer' : `Show all ${String(props.definitions.length)}`}
        </Button>
      </Show>
    </>
  );
}

/**
 * An inline definition: a static tile in the source tile's look (it has no
 * URL, so nothing to open or copy by file).
 */
function InlineDefinition(): JSX.Element {
  return (
    <li
      data-fdt-definition="inline"
      class="flex min-w-0 items-center gap-2.5 rounded-lg border border-line-2 bg-surface-2 py-2.5 pr-2.5 pl-3"
    >
      <span class="grid size-7.5 shrink-0 place-items-center rounded-md bg-surface-3 text-fg-secondary">
        <Code size={14} aria-hidden="true" />
      </span>
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="text-xs font-medium text-fg-primary">{INLINE_DEFINITION_LABEL}</span>
        <span class="text-2xs text-fg-muted">{INLINE_DEFINITION_NOTE}</span>
      </span>
    </li>
  );
}

/** Props of {@link ScriptDefinition}. */
interface ScriptDefinitionProps {
  /** The script URL (page-derived). */
  url: string;
  /** The inspected page's origin, or `null`. */
  pageOrigin: string | null;
  /** DevTools' "Open in Sources", or `null`. */
  openResource: OpenResource | null;
}

/**
 * A script file definition: its source-link tile (opens what actually
 * loaded — only http(s) URLs get an action), then its copy action — the
 * exclusion naming the script's original path ({@link definitionCopy}), or,
 * for a combined bundle, the note giving the working remedy instead. The
 * copy control stays mounted while its payload changes under a refreshed
 * answer (non-keyed `Show`, the payload read per access), so focus survives.
 *
 * @param props See {@link ScriptDefinitionProps}.
 */
function ScriptDefinition(props: ScriptDefinitionProps): JSX.Element {
  const parts = createMemo(() => splitScriptUrl(props.url, props.pageOrigin));
  const copy = createMemo(() => definitionCopy(props.url, props.pageOrigin));
  const pattern = (): string | null => {
    const action = copy();
    return action.kind === 'pattern' ? action.pattern : null;
  };
  return (
    <li data-fdt-definition="url" class="flex min-w-0 flex-col items-start gap-1.5">
      <SourceLink url={props.url} openResource={props.openResource} class="w-full" />
      <Switch>
        <Match when={copy().kind === 'combined'}>
          <p data-fdt="combined-note" class={BODY_NOTE}>
            {COMBINED_EXCLUSION_NOTE}
          </p>
        </Match>
        <Match when={pattern()}>
          {(value) => (
            <ExclusionCopyButton
              pattern={value}
              name={copyExclusionName(parts().file, parts().host)}
              class="-ms-2"
            />
          )}
        </Match>
      </Switch>
    </li>
  );
}
