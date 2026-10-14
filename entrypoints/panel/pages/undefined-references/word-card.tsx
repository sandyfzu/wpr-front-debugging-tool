/**
 * One undefined reference as a card: the word, a text verdict, and the body
 * that answers it — the possible definitions (inline scripts as chips, script
 * files as links with "Copy as exclusion"), or the sentence explaining why
 * there are none.
 */
import type { JSX } from 'solid-js';
import { For, Match, Show, Switch, createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import Code from 'lucide-solid/icons/code';
import Copy from 'lucide-solid/icons/copy';
import ExternalLinkIcon from 'lucide-solid/icons/external-link';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { FOCUS_RING } from '../../../../components/ui/classes';
import {
  STATUS_ICONS,
  STATUS_TEXT_CLASSES,
  StatusBadge,
  type StatusKind
} from '../../../../components/ui/status-badge';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';
import type { ScriptOrigin } from '../../../../lib/panel/undefined-refs';
import { cn } from '../../../../utils/cn';
import { isHttpUrl } from '../../../../utils/urls';
import { copyAsExclusion } from './copy-exclusion';
import { displayWord, splitScriptUrl, verdictText, wordVerdict, type WordVerdict } from './model';

/** The vocabulary kind each verdict paints its icon with. */
const VERDICT_KIND: Record<WordVerdict['kind'], StatusKind> = {
  found: 'info',
  'not-found': 'neutral',
  hidden: 'neutral',
  'not-searched': 'neutral'
};

/**
 * Why a cross-origin error has no name: the browser hides the details of
 * errors thrown by scripts from another origin.
 */
export const CROSS_ORIGIN_EXPLANATION =
  'Since the error occurred in a file loaded from an external server, the browser limited the information that can be read from it. Make sure to disable CDNs if there are any.';

/** The not-found body sentence. */
export const NOT_FOUND_EXPLANATION =
  "No declaration or assignment of this name was found in the page's scripts.";

/** The copy control's visible label (also its accessible name when icon-only). */
export const COPY_LABEL = 'Copy as exclusion';

/** The copy control's hover hint (its purpose, in full). */
const COPY_TITLE = `Copy the script URL to exclude it from ${LABEL_DELAY_JAVASCRIPT_EXECUTION}`;

/** The muted sentence style of a card body without definitions. */
const BODY_NOTE = 'text-2xs leading-snug text-fg-secondary';

/** Props of {@link WordCard}. */
export interface WordCardProps {
  /** The undefined-reference word (page-controlled text; rendered as text only). */
  word: string;
  /** Its possible definitions, or `null` when no search ran. */
  definitions: readonly ScriptOrigin[] | null;
  /** Copy a script URL (default: {@link copyAsExclusion}); injected by tests. */
  onCopy?: (url: string) => void;
}

/**
 * Render one word card. Non-interactive itself (no lift, no tab stop); only
 * the links and copy buttons inside take focus.
 *
 * Heading row: badge · word · verdict on one line from the regular tier;
 * below it the word takes its own full-width line under badge and verdict,
 * so a long identifier wraps across the card instead of being crushed into
 * a sliver.
 *
 * @param props See {@link WordCardProps}.
 */
export function WordCard(props: WordCardProps): JSX.Element {
  const verdict = createMemo(() => wordVerdict(props.word, props.definitions));
  const kind = (): StatusKind => VERDICT_KIND[verdict().kind];
  const heading = (): JSX.Element => (
    <div class="flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <StatusBadge kind="warn" class="shrink-0">
        Undefined
      </StatusBadge>
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
      when={verdict().kind !== 'not-searched'}
      // Unsearched (feature absent): the page's notice already says why, so
      // the card is its heading row alone — no repeated sentence per word.
      fallback={<Card>{heading()}</Card>}
    >
      <Card header={heading()}>
        <Switch>
          <Match when={verdict().kind === 'found'}>
            <ul
              aria-label={`Possible definitions of ${displayWord(props.word)}`}
              class="-my-1 flex flex-col"
            >
              <For each={props.definitions ?? []}>
                {(origin) => <DefinitionRow origin={origin} onCopy={props.onCopy} />}
              </For>
            </ul>
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

/** Props of {@link DefinitionRow}. */
interface DefinitionRowProps {
  /** Where the definition lives. */
  origin: ScriptOrigin;
  /** The copy handler override (tests). */
  onCopy?: (url: string) => void;
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
          <>
            <ScriptLink url={origin().url} />
            <CopyExclusionButton url={origin().url} onCopy={props.onCopy} />
          </>
        )}
      </Show>
    </li>
  );
}

/**
 * A script file as a network panel lists it: the file name (the identifying
 * part) as the link text, its host and directory on a muted line below.
 * A truncated full URL would hide the file name behind the ellipsis on
 * narrow panels. The full URL rides `title` on hover; the link keeps the
 * external-link contract (new tab, `noopener noreferrer`, "(opens in a new
 * tab)" in its name) and only `http(s):` URLs become links — anything else
 * renders as plain text.
 *
 * @param props.url The script URL.
 */
function ScriptLink(props: { url: string }): JSX.Element {
  const parts = createMemo(() => splitScriptUrl(props.url));
  const name = (): JSX.Element => (
    <span class="truncate" title={props.url}>
      {parts().name}
    </span>
  );
  return (
    <div class="flex min-w-0 flex-1 flex-col">
      <Show
        when={isHttpUrl(props.url)}
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
          <span class="sr-only"> (opens in a new tab)</span>
        </a>
      </Show>
      <Show when={parts().location}>
        <span
          data-fdt="script-location"
          class="truncate font-mono text-2xs text-fg-muted"
          title={props.url}
        >
          {parts().location}
        </span>
      </Show>
    </div>
  );
}

/** Props of {@link CopyExclusionButton}. */
interface CopyExclusionButtonProps {
  /** The script URL to copy. */
  url: string;
  /** The copy handler override (tests). */
  onCopy?: (url: string) => void;
}

/**
 * The row's copy control: labeled at regular widths, icon-only below them
 * (the label stays as its accessible name).
 *
 * @param props See {@link CopyExclusionButtonProps}.
 */
function CopyExclusionButton(props: CopyExclusionButtonProps): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      class="shrink-0"
      title={COPY_TITLE}
      data-fdt-copy-exclusion
      onClick={() => {
        if (props.onCopy) {
          props.onCopy(props.url);
          return;
        }
        void copyAsExclusion(props.url);
      }}
    >
      <Copy size={14} class="shrink-0" aria-hidden="true" />
      <span class="@max-regular:sr-only">{COPY_LABEL}</span>
    </Button>
  );
}
