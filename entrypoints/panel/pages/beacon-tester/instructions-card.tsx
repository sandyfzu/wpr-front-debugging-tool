/**
 * The beacon instructions row at the top of the Beacon Tester: what WP
 * Rocket told its beacon on the inspected page — one compact info row
 * (title, summary: features on, device; Details), expanded under it into
 * Features / Elements checked / Exclusions with counts, and the raw JSON on
 * demand (with copy). It follows
 * the page: the shell's payload drives it, so a reload or navigation swaps
 * it in place; instructions the new load no longer carries read as such
 * until dismissed.
 *
 * State matrix (see `./instructions-view`): none (the row's words) ·
 * unreadable (the row's words) · instructions · stale (the earlier load's
 * row + a notice under it).
 * The expansion, raw view and dismissal live in the panel-lifetime
 * tracker, so a data refresh or a route change keeps them.
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Match, Show, Switch, type Accessor } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import RadioTower from 'lucide-solid/icons/radio-tower';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { MOTION_REVEAL, MOTION_TURN } from '../../../../components/ui/classes';
import { CodeBlock } from '../../../../components/ui/code-block';
import { CopyButton } from '../../../../components/ui/copy-button';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { cn } from '../../../../utils/cn';
import { formatCount } from '../../../../utils/format-count';
import { OutcomeNotice } from '../outcome-notice';
import {
  EMPTY_LIST_COPY,
  GROUP_TITLES,
  hiddenEntriesNote,
  INSTRUCTIONS_TITLE,
  instructionsCardState,
  NO_INSTRUCTIONS_COPY,
  NOTHING_SENT_COPY,
  rawCutNote,
  rawDisplay,
  rememberInstructions,
  STALE_INSTRUCTIONS_COPY,
  STALE_INSTRUCTIONS_TITLE,
  UNREADABLE_INSTRUCTIONS_COPY,
  type InstructionGroup,
  type InstructionList,
  type InstructionsCardState,
  type InstructionsMemory,
  type InstructionsSource,
  type InstructionsView
} from './instructions-view';

/** The row's words beside the title (they wrap under it when narrow). */
const ROW_TEXT = 'min-w-0 flex-1 basis-40 text-2xs text-fg-secondary';

/** The disclosure's label (the chevron shows its state). */
export const DETAILS_LABEL = 'Details';

/** The raw view toggle's labels. */
export const RAW_LABELS = { show: 'Show raw', hide: 'Hide raw' } as const;

/** The stale notice's action. */
export const DISMISS_LABEL = 'Dismiss';

/** The copy control's subject (toast: "Beacon instructions copied"). */
export const COPY_SUBJECT = 'Beacon instructions';

/** The card's state plus the view state that outlives the page body. */
export interface InstructionsTracker {
  readonly state: Accessor<InstructionsCardState>;
  /** The payload's load identity (null when unknown), stamped on the card root. */
  readonly page: Accessor<string | null>;
  readonly expanded: Accessor<boolean>;
  readonly setExpanded: (open: boolean) => void;
  readonly rawOpen: Accessor<boolean>;
  readonly setRawOpen: (open: boolean) => void;
  /** Stop showing the earlier load's instructions. */
  readonly dismiss: () => void;
}

/**
 * Create the tracker (call inside a reactive root that outlives the page
 * body). Collapsed and raw closed by default.
 *
 * @param source The payload's beacon row and load identity (reactive).
 */
export function createInstructionsTracker(
  source: Accessor<InstructionsSource>
): InstructionsTracker {
  const memory = createMemo<InstructionsMemory | null>(
    (previous) => rememberInstructions(previous, source()),
    null
  );
  const [dismissed, setDismissed] = createSignal<InstructionsMemory | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [rawOpen, setRawOpen] = createSignal(false);
  const state = createMemo(() => instructionsCardState(source(), memory(), dismissed()));
  return {
    state,
    page: () => source().page,
    expanded,
    setExpanded,
    rawOpen,
    setRawOpen,
    dismiss: () => setDismissed(memory())
  };
}

/** A group's heading: title and count. */
function GroupHeading(props: { title: string; count: string }): JSX.Element {
  return (
    <h3 class="flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold text-fg-primary">
      {props.title}
      <span class="text-2xs font-normal tabular-nums text-fg-muted">{props.count}</span>
    </h3>
  );
}

/** The Features group: each toggle on/off, then the device. */
function FeaturesGroup(props: { view: InstructionsView }): JSX.Element {
  return (
    <section data-fdt-beacon-instructions-group="features" class="flex flex-col gap-1.5">
      <GroupHeading title={GROUP_TITLES.features} count={props.view.featuresCount} />
      <ul class="flex flex-col gap-1">
        <For each={props.view.features}>
          {(row) => (
            <li class="flex min-w-0 items-center justify-between gap-2 text-xs">
              <span class={cn('min-w-0 break-words text-fg-secondary', row.rawKey && 'font-mono')}>
                {row.label}
              </span>
              <StatusBadge kind={row.on ? 'ok' : 'neutral'} class="shrink-0">
                {row.on ? 'On' : 'Off'}
              </StatusBadge>
            </li>
          )}
        </For>
        <li class="flex min-w-0 items-center justify-between gap-2 text-xs">
          <span class="text-fg-secondary">Device</span>
          <span data-fdt-beacon-instructions-device class="text-fg-primary">
            {props.view.device}
          </span>
        </li>
      </ul>
    </section>
  );
}

/** One list: label, count, entries as code chips (cut, with the rest's note). */
function ListBlock(props: { list: InstructionList }): JSX.Element {
  return (
    <div data-fdt-beacon-instructions-list={props.list.id} class="flex min-w-0 flex-col gap-1">
      <p class="flex flex-wrap items-baseline gap-x-1.5 text-2xs text-fg-secondary">
        {props.list.label}
        <span class="tabular-nums text-fg-muted">{formatCount(props.list.count)}</span>
      </p>
      <Show
        when={props.list.count > 0}
        fallback={<p class="text-2xs text-fg-muted">{EMPTY_LIST_COPY}</p>}
      >
        <ul class="flex min-w-0 flex-wrap gap-1">
          <For each={props.list.shown}>
            {(entry) => (
              <li class="min-w-0 rounded bg-surface-2 px-1 py-0.5 font-mono text-2xs break-all text-fg-primary">
                {entry}
              </li>
            )}
          </For>
        </ul>
        <Show when={props.list.hidden > 0}>
          <p class="text-2xs text-fg-muted">{hiddenEntriesNote(props.list.hidden)}</p>
        </Show>
      </Show>
    </div>
  );
}

/** A list group (Elements checked, Exclusions). */
function ListGroup(props: { group: InstructionGroup }): JSX.Element {
  return (
    <section data-fdt-beacon-instructions-group={props.group.id} class="flex flex-col gap-1.5">
      <GroupHeading title={props.group.title} count={formatCount(props.group.count)} />
      <Show
        when={props.group.lists.length > 0}
        fallback={<p class="text-2xs text-fg-muted">{NOTHING_SENT_COPY}</p>}
      >
        <For each={props.group.lists}>{(list) => <ListBlock list={list} />}</For>
      </Show>
    </section>
  );
}

/** The raw JSON view with copy (whole text copied even when the view is cut). */
function RawView(props: { raw: string }): JSX.Element {
  const shown = createMemo(() => rawDisplay(props.raw));
  return (
    <div data-fdt-beacon-instructions-raw class="flex min-w-0 flex-col gap-1.5">
      <CodeBlock text={shown().text} lang="json" label={COPY_SUBJECT} class="min-w-0" />
      <Show when={shown().cut}>
        <p class="text-2xs text-fg-muted">{rawCutNote()}</p>
      </Show>
    </div>
  );
}

/** The Details toggle (the chevron shows its state). */
function DetailsToggle(props: { tracker: InstructionsTracker }): JSX.Element {
  return (
    <Button
      size="sm"
      variant="ghost"
      class="ms-auto shrink-0"
      aria-expanded={props.tracker.expanded()}
      data-fdt-beacon-instructions-toggle
      onClick={() => {
        props.tracker.setExpanded(!props.tracker.expanded());
      }}
    >
      <ChevronRight
        size={12}
        aria-hidden="true"
        class={cn(MOTION_TURN, props.tracker.expanded() && 'rotate-90')}
      />
      {DETAILS_LABEL}
    </Button>
  );
}

/** The expanded view: the groups, then the raw view on demand. */
function InstructionsDetails(props: {
  view: InstructionsView;
  tracker: InstructionsTracker;
}): JSX.Element {
  return (
    <div data-fdt-beacon-instructions-details class={cn('flex flex-col gap-3', MOTION_REVEAL)}>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-3">
        <FeaturesGroup view={props.view} />
        <For each={props.view.groups}>{(group) => <ListGroup group={group} />}</For>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={props.tracker.rawOpen()}
          data-fdt-beacon-instructions-raw-toggle
          onClick={() => {
            props.tracker.setRawOpen(!props.tracker.rawOpen());
          }}
        >
          {props.tracker.rawOpen() ? RAW_LABELS.hide : RAW_LABELS.show}
        </Button>
        <CopyButton text={props.view.raw} label={COPY_SUBJECT} />
      </div>
      <Show when={props.tracker.rawOpen()}>
        <RawView raw={props.view.raw} />
      </Show>
    </div>
  );
}

/** Props of {@link InstructionsCard}. */
export interface InstructionsCardProps {
  tracker: InstructionsTracker;
}

/**
 * Render the card.
 *
 * @param props See {@link InstructionsCardProps}.
 */
export function InstructionsCard(props: InstructionsCardProps): JSX.Element {
  const state = () => props.tracker.state();
  /** The instructions to detail (current or earlier), else undefined. */
  const view = () => {
    const current = state();
    return current.kind === 'instructions' || current.kind === 'stale' ? current.view : undefined;
  };
  return (
    <Card level={1}>
      <div
        data-fdt="beacon-instructions"
        data-fdt-beacon-instructions={state().kind}
        data-fdt-beacon-instructions-load={props.tracker.page() ?? undefined}
        class="flex flex-col gap-2"
      >
        <div class="-my-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <RadioTower size={14} class="shrink-0 text-fg-muted" aria-hidden="true" />
          <h2 class="shrink-0 text-xs font-semibold text-fg-primary">{INSTRUCTIONS_TITLE}</h2>
          <Switch>
            <Match when={state().kind === 'none'}>
              <p class={ROW_TEXT}>{NO_INSTRUCTIONS_COPY}</p>
            </Match>
            <Match when={state().kind === 'unreadable'}>
              <p class={ROW_TEXT}>{UNREADABLE_INSTRUCTIONS_COPY}</p>
            </Match>
            <Match when={view()}>
              {(shown) => (
                <>
                  <p
                    data-fdt-beacon-instructions-summary
                    class={cn(ROW_TEXT, 'tabular-nums')}
                    title={shown().summaryTitle}
                  >
                    {shown().summary}
                  </p>
                  <DetailsToggle tracker={props.tracker} />
                </>
              )}
            </Match>
          </Switch>
        </div>
        <Show when={state().kind === 'stale'}>
          <OutcomeNotice
            data-fdt-beacon-instructions-stale
            kind="neutral"
            title={STALE_INSTRUCTIONS_TITLE}
            message={STALE_INSTRUCTIONS_COPY}
          >
            <div class="ps-5">
              <Button
                size="sm"
                variant="secondary"
                data-fdt-beacon-instructions-dismiss
                onClick={() => {
                  props.tracker.dismiss();
                }}
              >
                {DISMISS_LABEL}
              </Button>
            </div>
          </OutcomeNotice>
        </Show>
        <Show when={props.tracker.expanded() ? view() : undefined}>
          {(shown) => <InstructionsDetails view={shown()} tracker={props.tracker} />}
        </Show>
      </div>
    </Card>
  );
}
