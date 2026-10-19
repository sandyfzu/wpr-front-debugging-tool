/**
 * One undefined reference as a card: the word, a text verdict, and the body
 * that answers it — the possible definitions (inline scripts as chips, script
 * files as links with "Copy as exclusion"), or the sentence explaining why
 * there are none. A single-letter word (the minified-code shape) opens its
 * body with a note qualifying the search's answer.
 */
import type { JSX } from 'solid-js';
import { For, Match, Show, Switch, createMemo, createSignal, createUniqueId } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Code from 'lucide-solid/icons/code';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { FOCUS_RING, MOTION_TURN } from '../../../../components/ui/classes';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  StatusBadge,
  type StatusKind
} from '../../../../components/ui/status-badge';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { cn } from '../../../../utils/cn';
import { recoverOriginalScript } from '../../../../lib/wp-rocket/minify-url-recovery';
import { COMBINED_EXCLUSION_NOTE, ExclusionCopyButton } from './copy-exclusion';
import {
  displayWord,
  exclusionPattern,
  exclusionPatternFromOriginalPath,
  isCrossOriginSentinel,
  isSingleLetterWord,
  scriptLocation,
  splitScriptUrl,
  verdictText,
  wordVerdict,
  type DefinitionAnswer,
  type WordVerdict
} from './model';

/** The vocabulary kind each verdict paints its icon with. */
const VERDICT_KIND: Record<WordVerdict['kind'], StatusKind> = {
  found: 'info',
  'not-found': 'neutral',
  searching: 'neutral',
  hidden: 'neutral',
  'not-searched': 'neutral'
};

/** Verdicts whose card is the heading row alone (nothing to explain per word). */
const HEADER_ONLY: ReadonlySet<WordVerdict['kind']> = new Set(['searching', 'not-searched']);

/** Definition rows a card lists before "Show all N" (the rest is one click away). */
export const VISIBLE_DEFINITIONS = 5;

/**
 * Why a cross-origin error has no name: the browser hides the details of
 * errors thrown by scripts from another origin.
 */
export const CROSS_ORIGIN_EXPLANATION =
  'Since the error occurred in a file loaded from an external server, the browser limited the information that can be read from it. Make sure to disable CDNs if there are any.';

/**
 * The not-found body sentence; when some scripts could not be read it says
 * the search only covered the readable ones.
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
  const skipped = unreadable === 1 ? '1 script' : `${String(unreadable)} scripts`;
  if (!inlineCut) {
    return `${head} ${skipped} could not be read, so a definition may still be in one of them.`;
  }
  if (unreadable === 0) {
    return `${head} The inline scripts were only partly captured, so a definition may still be in the part that was cut.`;
  }
  return `${head} ${skipped} could not be read and the inline scripts were only partly captured, so a definition may still be in what was not searched.`;
}

/** The muted sentence style of a card body without definitions. */
const BODY_NOTE = 'text-2xs leading-snug text-fg-secondary';

/**
 * The note a single-letter word's card opens with: the name has the shape
 * minified code produces, so the found matches are likely coincidental. The
 * not-found body carries the qualification without the matches sentence.
 */
export const SINGLE_LETTER_FOUND_NOTE =
  'Single-letter name — usually an artifact of minified code; the matches below are likely coincidental.';

/** The not-found variant: the qualification alone. */
export const SINGLE_LETTER_NOT_FOUND_NOTE =
  'Single-letter name — usually an artifact of minified code.';

/** Props of {@link WordCard}. */
export interface WordCardProps {
  /** The undefined-reference word (page-controlled text; rendered as text only). */
  word: string;
  /** Its search answer. */
  answer: DefinitionAnswer;
  /** The inspected page's origin, or `null` when unknown (shapes rows and patterns). */
  pageOrigin: string | null;
  /** Scripts the read had to skip (softens a not-found verdict; default 0). */
  unreadable?: number;
  /** The inline scripts reached the panel cut to size (softens a not-found verdict too). */
  inlineCut?: boolean;
}

/**
 * Render one word card. Non-interactive itself (no lift, no tab stop); only
 * the links, copy buttons and the "Show all" toggle inside take focus.
 *
 * Heading row: badge · word · verdict on one line from the regular tier;
 * below it the word takes its own full-width line under badge and verdict,
 * so a long identifier wraps across the card instead of being crushed. The
 * cross-origin "Script error." card wears a neutral badge — it reports a
 * hidden error, not an undefined name.
 *
 * @param props See {@link WordCardProps}.
 */
export function WordCard(props: WordCardProps): JSX.Element {
  const verdict = createMemo(() =>
    wordVerdict(props.word, props.answer, props.unreadable ?? 0, props.inlineCut ?? false)
  );
  const kind = (): StatusKind => VERDICT_KIND[verdict().kind];
  const definitions = (): readonly ScriptOrigin[] => {
    const answer = props.answer;
    return answer === null || answer === 'pending' ? [] : answer;
  };
  /**
   * The note above the body's content, or `null` when this card carries
   * none: a single-letter name gets the minified-code note wherever the
   * card answers it (a found or a not-found body); the sentinel (never one
   * letter) and the body-less verdicts carry none.
   */
  const note = (): string | null => {
    const kind = verdict().kind;
    if ((kind === 'found' || kind === 'not-found') && isSingleLetterWord(props.word)) {
      return kind === 'found' ? SINGLE_LETTER_FOUND_NOTE : SINGLE_LETTER_NOT_FOUND_NOTE;
    }
    return null;
  };
  const heading = (): JSX.Element => (
    <div class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <Show
        when={isCrossOriginSentinel(props.word)}
        fallback={
          <StatusBadge kind="warn" class="shrink-0">
            Undefined
          </StatusBadge>
        }
      >
        <StatusBadge kind="neutral" class="shrink-0">
          Cross-origin
        </StatusBadge>
      </Show>
      <span
        data-fdt-word
        class="min-w-0 flex-1 font-mono text-xs font-semibold break-all text-fg-primary @max-regular:order-last @max-regular:basis-full"
      >
        {displayWord(props.word)}
      </span>
      <span
        data-fdt-verdict={verdict().kind}
        class="ms-auto inline-flex shrink-0 items-center gap-1 text-2xs text-fg-secondary tabular-nums"
      >
        <Dynamic
          component={STATUS_ICONS[kind()]}
          size={12}
          class={STATUS_TEXT_CLASSES[kind()]}
          aria-hidden="true"
        />
        {verdictText(verdict())}
      </span>
    </div>
  );
  return (
    <Show
      when={!HEADER_ONLY.has(verdict().kind)}
      // Searching or unsearched: nothing to explain per word (the page says
      // why once), so the card is its heading row alone.
      fallback={<Card>{heading()}</Card>}
    >
      <Card header={heading()}>
        <Show when={note()}>
          {(text) => (
            // The body-note line in the warn status color, led by the vocabulary's
            // own warning icon (the caller-wins merge swaps the muted text token).
            <p class={cn('flex items-start gap-1.5', BODY_NOTE, STATUS_TEXT_CLASSES.warn, 'mb-2')}>
              <TriangleAlert size={12} class="mt-px shrink-0" aria-hidden="true" />
              {text()}
            </p>
          )}
        </Show>
        <Switch>
          <Match when={verdict().kind === 'found'}>
            <DefinitionList
              word={props.word}
              definitions={definitions()}
              pageOrigin={props.pageOrigin}
            />
          </Match>
          <Match when={verdict().kind === 'hidden'}>
            <p class={BODY_NOTE}>{CROSS_ORIGIN_EXPLANATION}</p>
          </Match>
          <Match when={verdict().kind === 'not-found'}>
            <p class={BODY_NOTE}>
              {notFoundExplanation(props.unreadable ?? 0, props.inlineCut ?? false)}
            </p>
          </Match>
        </Switch>
      </Card>
    </Show>
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
}

/**
 * The definition rows, capped at {@link VISIBLE_DEFINITIONS} with a
 * "Show all N" disclosure for the rest (a generic name can match dozens of
 * scripts). The toggle stays mounted when it flips, so focus stays on it.
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
        class="-my-1 flex flex-col"
      >
        <For each={shown()}>
          {(origin) => <DefinitionRow origin={origin} pageOrigin={props.pageOrigin} />}
        </For>
      </ul>
      <Show when={capped()}>
        <Button
          variant="ghost"
          size="sm"
          class="mt-1.5 -ms-2"
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

/** Props of {@link DefinitionRow}. */
interface DefinitionRowProps {
  /** Where the definition lives. */
  origin: ScriptOrigin;
  /** The inspected page's origin, or `null`. */
  pageOrigin: string | null;
}

/**
 * One definition: an inline script as a chip (it has no URL to open), a
 * script file as its link plus the copy action.
 *
 * @param props See {@link DefinitionRowProps}.
 */
function DefinitionRow(props: DefinitionRowProps): JSX.Element {
  return (
    <li
      data-fdt-definition={props.origin.kind}
      class="flex min-h-8 min-w-0 items-center gap-2 border-b border-line-1 py-1 last:border-b-0"
    >
      <Show
        when={props.origin.kind === 'url' ? props.origin : null}
        fallback={
          <Badge variant="outline">
            <Code size={12} class="shrink-0" aria-hidden="true" />
            Inline Script
          </Badge>
        }
      >
        {(origin) => <ScriptRow url={origin().url} pageOrigin={props.pageOrigin} />}
      </Show>
    </li>
  );
}

/** Props of {@link ScriptRow}. */
interface ScriptRowProps {
  /** The script URL (page-derived). */
  url: string;
  /** The inspected page's origin, or `null`. */
  pageOrigin: string | null;
}

/**
 * A script file as a network panel lists it: the file name (the identifying
 * part) as the link text with its query muted, where it lives on a muted
 * line below (the page's own host dropped), and the copy action through the
 * action's own vocabulary ({@link ExclusionCopyButton}). The full URL rides
 * `title`; the link's accessible name carries the location too, so the same
 * file from two hosts reads apart. It keeps the external-link contract (new
 * tab, `noopener noreferrer`, "(opens in a new tab)") and only `http(s):`
 * URLs become links or get a copy action.
 *
 * The copy payload names the script's ORIGINAL path: a served minified-URL
 * row recovers the original path the cache URL mirrors (the exclusion that
 * survives minify off/on) — page-origin composed when the host is the
 * site's own, hostless for a host the URL hides (the path is the one
 * identifier both minify states spell; a host the URL does not carry is
 * never fabricated) — and a combined-bundle row, whose URL carries no
 * original path, says so in place of a copy control
 * ({@link COMBINED_EXCLUSION_NOTE}). The link itself is untouched by all of
 * this: it opens what actually loaded.
 *
 * @param props See {@link ScriptRowProps}.
 */
function ScriptRow(props: ScriptRowProps): JSX.Element {
  const parts = createMemo(() => splitScriptUrl(props.url, props.pageOrigin));
  const recovery = createMemo(() => recoverOriginalScript(props.url));
  // The copy payload per recovery class.
  const pattern = createMemo(() => {
    const recovered = recovery();
    if (recovered.kind === 'combined') return null;
    if (recovered.kind === 'untouched') return exclusionPattern(props.url, props.pageOrigin);
    if (recovered.hostKnown === 'site') {
      return props.pageOrigin === null
        ? exclusionPatternFromOriginalPath(recovered.originalPath)
        : exclusionPattern(`${props.pageOrigin}/${recovered.originalPath}`, props.pageOrigin);
    }
    // Host hidden by the served URL: the original path alone — it matches the
    // served minified tag and the un-minified one alike (both spell the path),
    // while a fabricated host could never be verified from the URL.
    return exclusionPatternFromOriginalPath(recovered.originalPath);
  });
  // A combined row's URL is http(s) by construction (it matched the cache
  // shape); every other row is linkable exactly when its pattern exists.
  const linkable = createMemo(() => recovery().kind === 'combined' || pattern() !== null);
  const location = (): string => scriptLocation(parts());
  const name = (): JSX.Element => (
    <span class="truncate" title={props.url}>
      {parts().file}
      <span class="text-fg-muted">{parts().query}</span>
    </span>
  );
  return (
    <>
      <div class="flex min-w-0 flex-1 flex-col">
        <Show
          when={linkable()}
          fallback={
            <span data-fdt="script-link" class="flex min-w-0 font-mono text-xs text-fg-primary">
              {name()}
            </span>
          }
        >
          <a
            data-fdt="script-link"
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            class={cn(
              'inline-flex max-w-full min-w-0 items-center gap-1 self-start rounded-sm font-mono text-xs text-accent hover:underline',
              FOCUS_RING
            )}
          >
            {name()}
            <ExternalLinkIcon size={12} class="shrink-0" aria-hidden="true" />
            <Show when={location()}>
              <span class="sr-only">, {location()}</span>
            </Show>
            <span class="sr-only"> (opens in a new tab)</span>
          </a>
        </Show>
        <Show when={location()}>
          <span
            data-fdt="script-location"
            aria-hidden="true"
            class="truncate font-mono text-2xs text-fg-muted"
            title={props.url}
          >
            {location()}
          </span>
        </Show>
      </div>
      <Switch>
        <Match when={recovery().kind === 'combined'}>
          <p data-fdt="combined-note" class={cn(BODY_NOTE, 'max-w-56 shrink')}>
            {COMBINED_EXCLUSION_NOTE}
          </p>
        </Match>
      </Switch>
      {/* Non-keyed Show: the control mounts on truthiness and its payload
          accessor re-reads per access — a refreshed answer's payload swap
          happens under the same mounted control, focus kept. */}
      <Show when={pattern()}>
        {(value) => (
          <ExclusionCopyButton
            pattern={value}
            name={copyExclusionName(parts().file, parts().host)}
            class="shrink-0"
          />
        )}
      </Show>
    </>
  );
}

/**
 * The copy control's accessible name: the visible label first (WCAG 2.5.3,
 * label in name — voice users say what they see), then the file, and the
 * host for another origin's script, so the same file from two hosts names
 * two controls apart.
 *
 * @param file The script's file name.
 * @param host The script's host when it is not the page's own, else `null`.
 * @returns The accessible name.
 */
export function copyExclusionName(file: string, host: string | null): string {
  return host === null ? `Copy as exclusion: ${file}` : `Copy as exclusion: ${file} (${host})`;
}
