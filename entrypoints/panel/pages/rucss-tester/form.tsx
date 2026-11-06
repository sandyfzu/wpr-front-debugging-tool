/**
 * The tester's settings form: what is sent (Mobile, Home, the safelist),
 * which page styles stay (inline markers, stylesheet patterns), and how the
 * returned CSS is adjusted (before/after CSS, ordered replacements). Every
 * pattern is checked live exactly as a run compiles it, every pair states
 * its effect (an empty replacement deletes its matches), every field holds
 * at most its stored cap, and the save state is always in view — a save the
 * store refuses or the storage rejects is shown, never swallowed.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Index, Match, Show, Switch as SolidSwitch } from 'solid-js';
import Plus from 'lucide-solid/icons/plus';
import Trash from 'lucide-solid/icons/trash';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { IconButton } from '../../../../components/ui/icon-button';
import { Input } from '../../../../components/ui/input';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { Switch } from '../../../../components/ui/switch';
import { Textarea } from '../../../../components/ui/textarea';
import { RUCSS_CONFIG_LIMITS } from '../../../../lib/rucss-tester/config';
import {
  checkExcludeLines,
  checkReplacementPair,
  type RucssPairCheck
} from '../../../../lib/rucss-tester/form-check';
import { DEFAULT_INLINE_PRESERVES } from '../../../../lib/rucss-tester/run-plan';
import { formatCount } from '../../../../utils/format-count';
import { cn } from '../../../../utils/cn';
import type { ConfigSaveState } from './config-writer';
import type { RucssTesterSession, RucssTextField } from './session';

/** The element id of a text field (the `review-patterns` recovery focuses it). */
export function fieldId(field: RucssTextField): string {
  return `rucss-field-${field}`;
}

/** The element id of a pair's search input. */
export function pairSearchId(index: number): string {
  return `rucss-pair-${String(index)}-search`;
}

/** Field labels and hints (one declaring site for the form's words). */
export const FIELD_COPY: Readonly<Record<RucssTextField, { label: string; hint: string }>> = {
  safelist: {
    label: 'Safelist',
    hint: 'One pattern per line. Sent to the service: matching rules stay in the used CSS.'
  },
  inlinePreserve: {
    label: 'Inline styles to keep',
    hint: `One marker per line: an inline style whose markup contains it stays. Always kept: ${DEFAULT_INLINE_PRESERVES.join(', ')}.`
  },
  excludeFiles: {
    label: 'Stylesheets to keep',
    hint: 'One regular expression per line, matched against each stylesheet URL (case-sensitive): a match stays.'
  },
  prepend: {
    label: 'CSS before the result',
    hint: 'Added before the used CSS, untouched by the replacements.'
  },
  append: {
    label: 'CSS after the result',
    hint: 'Added after the used CSS, untouched by the replacements.'
  }
};

/** The replacements' hint. */
export const PAIRS_HINT =
  'Applied in order to the used CSS. Each search is a regular expression (all matches, case-sensitive); $& and $1… insert what matched. A search that can match empty text also matches between characters and can split emoji.';

/** The words of each pair effect worth stating. */
export const PAIR_EFFECT_COPY: Readonly<Record<'deletes' | 'skipped', string>> = {
  deletes: 'Empty replacement: every match is deleted.',
  skipped: 'No search yet: this replacement is skipped.'
};

/** The save line's words per state (failures carry their own message). */
export const SAVE_COPY: Readonly<Record<'saved' | 'pending' | 'saving', string>> = {
  saved: 'Settings saved for every site.',
  pending: 'Unsaved changes…',
  saving: 'Saving…'
};

/** The field caps (the textarea `maxlength`s). */
const FIELD_MAX: Readonly<Record<RucssTextField, number>> = {
  safelist: RUCSS_CONFIG_LIMITS.listChars,
  inlinePreserve: RUCSS_CONFIG_LIMITS.listChars,
  excludeFiles: RUCSS_CONFIG_LIMITS.listChars,
  prepend: RUCSS_CONFIG_LIMITS.cssChars,
  append: RUCSS_CONFIG_LIMITS.cssChars
};

/** A section heading (`h2`) and its body column; the form card's hairline divides sections. */
function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <h2 class="text-sm font-semibold text-fg-primary">{props.title}</h2>
      {props.children}
    </section>
  );
}

/** One error line (icon-free: the field's red border and the words carry it). */
function ErrorLine(props: { children: JSX.Element }): JSX.Element {
  return (
    <p data-fdt-field-error class={cn('text-2xs break-words', STATUS_TEXT_CLASSES.error)}>
      {props.children}
    </p>
  );
}

/** Props of {@link TextField}. */
interface TextFieldProps {
  session: RucssTesterSession;
  field: RucssTextField;
  /** Lines that do not compile (the exclusion field only). */
  errors?: readonly string[];
  /** The textarea's height class. */
  height: string;
}

/**
 * One labelled multi-line field with its hint and errors.
 *
 * @param props See {@link TextFieldProps}.
 */
function TextField(props: TextFieldProps): JSX.Element {
  const id = (): string => fieldId(props.field);
  const copy = (): { label: string; hint: string } => FIELD_COPY[props.field];
  const invalid = (): boolean => (props.errors?.length ?? 0) > 0;
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={id()} class="text-xs font-medium text-fg-primary">
        {copy().label}
      </label>
      <Textarea
        id={id()}
        data-fdt-rucss-field={props.field}
        class={cn('resize-y', props.height)}
        value={props.session.form[props.field]}
        maxLength={FIELD_MAX[props.field]}
        spellcheck={false}
        autocomplete="off"
        aria-invalid={invalid() || undefined}
        aria-describedby={`${id()}-hint`}
        onInput={(event) => {
          props.session.setText(props.field, event.currentTarget.value);
        }}
      />
      <p id={`${id()}-hint`} class="text-2xs text-fg-muted">
        {copy().hint}
      </p>
      <For each={props.errors ?? []}>{(error) => <ErrorLine>{error}</ErrorLine>}</For>
    </div>
  );
}

/** Props of {@link PairRow}. */
interface PairRowProps {
  session: RucssTesterSession;
  index: number;
  check: RucssPairCheck;
}

/**
 * One ordered replacement: its number, search and replacement inputs, the
 * remove control, then its effect note and pattern error.
 *
 * @param props See {@link PairRowProps}.
 */
function PairRow(props: PairRowProps): JSX.Element {
  const number = (): string => formatCount(props.index + 1);
  const pair = () => props.session.form.replacements[props.index];
  /** What this pair does when it does not simply replace, else `null`. */
  const note = (): string | null =>
    props.check.effect === 'replaces' ? null : PAIR_EFFECT_COPY[props.check.effect];
  return (
    <li data-fdt-rucss-pair={props.index} class="flex min-w-0 flex-col gap-1">
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <span class="w-5 shrink-0 text-end text-2xs tabular-nums text-fg-muted" aria-hidden="true">
          {number()}
        </span>
        <Input
          id={pairSearchId(props.index)}
          class="min-w-32 flex-1 font-mono"
          placeholder="Search (regular expression)"
          aria-label={`Replacement ${number()} search`}
          value={pair()?.search ?? ''}
          maxLength={RUCSS_CONFIG_LIMITS.searchChars}
          spellcheck={false}
          autocomplete="off"
          aria-invalid={props.check.problem !== null || undefined}
          onInput={(event) => {
            props.session.setPair(props.index, 'search', event.currentTarget.value);
          }}
        />
        <Input
          class="min-w-32 flex-1 font-mono"
          placeholder="Replace with"
          aria-label={`Replacement ${number()} text`}
          value={pair()?.replacement ?? ''}
          maxLength={RUCSS_CONFIG_LIMITS.replacementChars}
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => {
            props.session.setPair(props.index, 'replacement', event.currentTarget.value);
          }}
        />
        <IconButton
          label={`Remove replacement ${number()}`}
          variant="ghost"
          onClick={() => {
            props.session.removePair(props.index);
          }}
        >
          <Trash size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <div class="flex flex-col gap-0.5 ps-6.5">
        <Show when={note()}>
          {(text) => (
            <p data-fdt-rucss-pair-note={props.check.effect} class="text-2xs text-fg-secondary">
              {text()}
            </p>
          )}
        </Show>
        <Show when={props.check.problem}>
          {(problem) => <ErrorLine>{`Invalid pattern: ${problem()}`}</ErrorLine>}
        </Show>
      </div>
    </li>
  );
}

/**
 * The ordered replacements with their add control (held at the cap).
 *
 * @param props.session The session.
 */
function Replacements(props: { session: RucssTesterSession }): JSX.Element {
  const checks = createMemo(() => props.session.form.replacements.map(checkReplacementPair));
  /** Whether the pair cap is reached (Add is then held). */
  const full = (): boolean =>
    props.session.form.replacements.length >= RUCSS_CONFIG_LIMITS.replacements;
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="text-xs font-medium text-fg-primary">Replacements</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={full()}
          title={
            full()
              ? `At most ${formatCount(RUCSS_CONFIG_LIMITS.replacements)} replacements`
              : undefined
          }
          onClick={() => {
            props.session.addPair();
            // The new row's search takes the typing.
            const index = props.session.form.replacements.length - 1;
            queueMicrotask(() => document.getElementById(pairSearchId(index))?.focus());
          }}
        >
          <Plus size={12} aria-hidden="true" />
          Add replacement
        </Button>
      </div>
      <p class="text-2xs text-fg-muted">{PAIRS_HINT}</p>
      <Show
        when={props.session.form.replacements.length > 0}
        fallback={<p class="text-2xs text-fg-secondary">No replacements.</p>}
      >
        {/* By index: a row keeps its inputs (and focus) while its text changes. */}
        <ol class="flex flex-col gap-2">
          <Index each={props.session.form.replacements}>
            {(_, index) => (
              <PairRow
                session={props.session}
                index={index}
                check={checks()[index] ?? { effect: 'skipped', problem: null }}
              />
            )}
          </Index>
        </ol>
      </Show>
    </div>
  );
}

/**
 * The save line: where the form stands against the store.
 *
 * @param props.state The writer's state.
 */
export function SaveLine(props: { state: ConfigSaveState }): JSX.Element {
  return (
    <SolidSwitch>
      <Match
        when={
          props.state.status === 'refused' || props.state.status === 'failed'
            ? props.state
            : undefined
        }
      >
        {(failure) => (
          <p data-fdt-rucss-save="failed" class={cn('text-2xs', STATUS_TEXT_CLASSES.error)}>
            {failure().message}
          </p>
        )}
      </Match>
      <Match
        when={
          props.state.status === 'saved' ||
          props.state.status === 'pending' ||
          props.state.status === 'saving'
            ? props.state.status
            : undefined
        }
      >
        {(status) => (
          <p data-fdt-rucss-save={status()} class="text-2xs text-fg-muted">
            {SAVE_COPY[status()]}
          </p>
        )}
      </Match>
    </SolidSwitch>
  );
}

/** Props of {@link RucssForm}. */
export interface RucssFormProps {
  /** The session (its settings are loaded: the page shows the form only then). */
  session: RucssTesterSession;
}

/**
 * Render the form: one card (sections divided by hairlines, the save line in
 * its footer). The card's solid surface also sits behind every line of text,
 * so text scrolled past the panel's fold keeps a resolvable background.
 *
 * @param props See {@link RucssFormProps}.
 */
export function RucssForm(props: RucssFormProps): JSX.Element {
  const excludeErrors = createMemo(() =>
    checkExcludeLines(props.session.form.excludeFiles).map(
      (problem) =>
        `Line ${formatCount(problem.lineNumber)} (“${problem.line}”) is not a valid pattern: ${problem.message}`
    )
  );
  return (
    <Card level={1} footer={<SaveLine state={props.session.save()} />}>
      <div data-fdt="rucss-form" class="flex min-w-0 flex-col divide-y divide-line-1">
        <Section title="Request">
          <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            <Switch
              label="Mobile"
              checked={props.session.form.mobile}
              onChange={(checked) => {
                props.session.setFlag('mobile', checked);
              }}
            />
            <Switch
              label="Home page"
              checked={props.session.form.home}
              onChange={(checked) => {
                props.session.setFlag('home', checked);
              }}
            />
          </div>
          <TextField session={props.session} field="safelist" height="h-20" />
        </Section>
        <Section title="Styles to keep">
          <div class="grid gap-3 @wide:grid-cols-2">
            <TextField session={props.session} field="inlinePreserve" height="h-20" />
            <TextField
              session={props.session}
              field="excludeFiles"
              errors={excludeErrors()}
              height="h-20"
            />
          </div>
        </Section>
        <Section title="Adjust the result">
          <div class="grid gap-3 @wide:grid-cols-2">
            <TextField session={props.session} field="prepend" height="h-20" />
            <TextField session={props.session} field="append" height="h-20" />
          </div>
          <Replacements session={props.session} />
        </Section>
      </div>
    </Card>
  );
}
