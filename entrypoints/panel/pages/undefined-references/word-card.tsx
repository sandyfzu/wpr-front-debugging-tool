/**
 * One undefined reference as a card: the word, a text verdict, and the body
 * that answers it — the possible definitions (inline scripts as chips, script
 * files as links with "Copy as exclusion"), or the sentence explaining why
 * there are none.
 */
import type { JSX } from 'solid-js';
import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import Code from 'lucide-solid/icons/code';
import Copy from 'lucide-solid/icons/copy';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { FOCUS_RING, MOTION_TURN } from '../../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  StatusBadge,
  type StatusKind
} from '../../../../components/ui/status-badge';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';
import { createLogger } from '../../../../lib/logger';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { cn } from '../../../../utils/cn';
import { copyAsExclusion } from './copy-exclusion';
import {
  displayWord,
  exclusionPattern,
  isCrossOriginSentinel,
  splitScriptUrl,
  verdictText,
  wordVerdict,
  type DefinitionAnswer,
  type WordVerdict
} from './model';

const log = createLogger('panel');

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

/** How long the copy control shows its "Copied" check (ms) — as long as the shared copy button's. */
export const COPIED_FLASH_MS = 1600;

/**
 * Why a cross-origin error has no name: the browser hides the details of
 * errors thrown by scripts from another origin.
 */
export const CROSS_ORIGIN_EXPLANATION =
  'Since the error occurred in a file loaded from an external server, the browser limited the information that can be read from it. Make sure to disable CDNs if there are any.';

/** The not-found body sentence. */
export const NOT_FOUND_EXPLANATION =
  "No declaration or assignment of this name was found in the page's scripts.";

/** The copy control's hover hint (its purpose, in full). */
const COPY_TITLE = `Copy an exclusion for this script, to exclude it from ${LABEL_DELAY_JAVASCRIPT_EXECUTION}`;

/** The muted sentence style of a card body without definitions. */
const BODY_NOTE = 'text-2xs leading-snug text-fg-secondary';

/** A copy handler: copies the pattern and reports the outcome. */
export type CopyExclusion = (pattern: string) => Promise<'copied' | 'failed'>;

/** Props of {@link WordCard}. */
export interface WordCardProps {
  /** The undefined-reference word (page-controlled text; rendered as text only). */
  word: string;
  /** Its search answer. */
  answer: DefinitionAnswer;
  /** The inspected page's origin, or `null` when unknown (shapes rows and patterns). */
  pageOrigin: string | null;
  /** Copy an exclusion (default: {@link copyAsExclusion}); injected by tests. */
  onCopy?: CopyExclusion;
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
  const verdict = createMemo(() => wordVerdict(props.word, props.answer));
  const kind = (): StatusKind => VERDICT_KIND[verdict().kind];
  const definitions = (): readonly ScriptOrigin[] => {
    const answer = props.answer;
    return answer === null || answer === 'pending' ? [] : answer;
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
        <Switch>
          <Match when={verdict().kind === 'found'}>
            <DefinitionList
              word={props.word}
              definitions={definitions()}
              pageOrigin={props.pageOrigin}
              onCopy={props.onCopy}
            />
          </Match>
          <Match when={verdict().kind === 'hidden'}>
            <p class={BODY_NOTE}>{CROSS_ORIGIN_EXPLANATION}</p>
          </Match>
          <Match when={verdict().kind === 'not-found'}>
            <p class={BODY_NOTE}>{NOT_FOUND_EXPLANATION}</p>
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
  /** The copy handler override (tests). */
  onCopy?: CopyExclusion;
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
          {(origin) => (
            <DefinitionRow origin={origin} pageOrigin={props.pageOrigin} onCopy={props.onCopy} />
          )}
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
  /** The copy handler override (tests). */
  onCopy?: CopyExclusion;
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
        {(origin) => (
          <ScriptRow url={origin().url} pageOrigin={props.pageOrigin} onCopy={props.onCopy} />
        )}
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
  /** The copy handler override (tests). */
  onCopy?: CopyExclusion;
}

/**
 * A script file as a network panel lists it: the file name (the identifying
 * part) as the link text with its query muted, where it lives on a muted
 * line below (the page's own host dropped), and the copy action. The full
 * URL rides `title`; the link's accessible name carries the location too, so
 * the same file from two hosts reads apart. It keeps the external-link
 * contract (new tab, `noopener noreferrer`, "(opens in a new tab)") and only
 * `http(s):` URLs become links or get a copy action.
 *
 * @param props See {@link ScriptRowProps}.
 */
function ScriptRow(props: ScriptRowProps): JSX.Element {
  const parts = createMemo(() => splitScriptUrl(props.url, props.pageOrigin));
  const pattern = createMemo(() => exclusionPattern(props.url, props.pageOrigin));
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
          when={pattern() !== null}
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
            <Show when={parts().location}>
              <span class="sr-only">, {parts().location}</span>
            </Show>
            <span class="sr-only"> (opens in a new tab)</span>
          </a>
        </Show>
        <Show when={parts().location}>
          <span
            data-fdt="script-location"
            aria-hidden="true"
            class="truncate font-mono text-2xs text-fg-muted"
            title={props.url}
          >
            {parts().location}
          </span>
        </Show>
      </div>
      <Show when={pattern()}>
        {(value) => (
          <CopyExclusionButton pattern={value()} file={parts().file} onCopy={props.onCopy} />
        )}
      </Show>
    </>
  );
}

/**
 * The copy control's accessible name: the visible label first (WCAG 2.5.3,
 * label in name — voice users say what they see), then the file, so every
 * row's control is distinguishable.
 *
 * @param file The script's file name.
 * @returns The accessible name.
 */
export function copyExclusionName(file: string): string {
  return `Copy as exclusion: ${file}`;
}

/** Props of {@link CopyExclusionButton}. */
interface CopyExclusionButtonProps {
  /** The exclusion pattern to copy. */
  pattern: string;
  /** The script's file name (the control's accessible name). */
  file: string;
  /** The copy handler override (tests). */
  onCopy?: CopyExclusion;
}

/**
 * The row's copy control: labeled at regular widths, icon-only below them;
 * its accessible name adds the file (see {@link copyExclusionName}). A confirmed copy
 * flashes a check and "Copied" in place — feedback at the pointer, beside
 * the toast that says where to paste.
 *
 * @param props See {@link CopyExclusionButtonProps}.
 */
function CopyExclusionButton(props: CopyExclusionButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let resetFlash: ReturnType<typeof setTimeout> | undefined;
  // The flash never outlives the control.
  onCleanup(() => {
    clearTimeout(resetFlash);
  });
  /** Copy and flash on success; never rejects (an override that throws is logged). */
  const copy = async (): Promise<void> => {
    let outcome: 'copied' | 'failed';
    try {
      outcome = await (props.onCopy ?? copyAsExclusion)(props.pattern);
    } catch (cause) {
      log.warn('The copy action failed unexpectedly', cause);
      return;
    }
    if (outcome !== 'copied') return;
    setCopied(true);
    clearTimeout(resetFlash);
    resetFlash = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      class="shrink-0"
      title={COPY_TITLE}
      aria-label={copyExclusionName(props.file)}
      data-fdt-copy-exclusion
      data-fdt-copied={copied() ? '' : undefined}
      onClick={() => {
        void copy();
      }}
    >
      <Show when={copied()} fallback={<Copy size={14} class="shrink-0" aria-hidden="true" />}>
        <Check size={14} class={cn('shrink-0', STATUS_TEXT_CLASSES.ok)} aria-hidden="true" />
      </Show>
      <span class="@max-regular:sr-only" aria-hidden="true">
        {copied() ? 'Copied' : 'Copy as exclusion'}
      </span>
    </Button>
  );
}
