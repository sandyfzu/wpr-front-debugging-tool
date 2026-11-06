/**
 * The beacon tester's settings form: which WP Rocket features the beacon
 * runs (their own names), the device and its viewport thresholds, the
 * candidate elements of the critical-images scan and the lazy-render
 * distance. Every setting is checked live with the run's own check (the
 * issue names the field), every field holds at most its stored cap, and the
 * save state is always in view — a save the store refuses or the storage
 * rejects is shown, never swallowed.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import RotateCcw from 'lucide-solid/icons/rotate-ccw';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { Switch } from '../../../../components/ui/switch';
import { Textarea } from '../../../../components/ui/textarea';
import type { BeaconConfigIssue, ThresholdField } from '../../../../lib/beacon-test/config';
import {
  BEACON_FEATURE_LABELS,
  describeConfigIssue,
  issueField,
  THRESHOLD_NAMES,
  type BeaconSettingField
} from '../../../../lib/beacon-test/outcome-view';
import {
  DEFAULT_BEACON_TEST_SETTINGS,
  settingsFieldMax
} from '../../../../lib/beacon-test/settings';
import type { BeaconFeatureKey } from '../../../../lib/beacon-test/runner-bridge';
import { cn } from '../../../../utils/cn';
import { SaveLine } from '../settings/save-line';
import type { BeaconTesterSession } from './session';

/**
 * The element id a setting's recovery focuses (the features: their group).
 *
 * @param field The setting.
 */
export function beaconFieldId(field: BeaconSettingField): string {
  return `beacon-field-${field}`;
}

/** What each feature switch explains. */
export const FEATURE_HINTS: Readonly<Record<BeaconFeatureKey, string>> = {
  aboveTheFold: 'Finds the above-the-fold images WP Rocket would preload, the LCP image first.',
  lazyRender: 'Finds the elements far enough below the fold for WP Rocket to render lazily.'
};

/** The device switch's hint. */
export const DEVICE_HINT =
  "Switching the device resets the viewport thresholds to WP Rocket's values for it.";

/** The viewport thresholds' hint per device. */
export const VIEWPORT_HINTS = {
  desktop: 'The desktop beacon measures only in a viewport at least this large.',
  mobile: 'The mobile beacon measures only in a viewport at most this large.'
} as const;

/** The candidate selectors' label and hint. */
export const SELECTORS_COPY = {
  label: 'Candidate elements',
  hint: `CSS selectors, one per line: the elements the ${BEACON_FEATURE_LABELS.aboveTheFold} scan considers. WP Rocket's defaults are prefilled.`
} as const;

/** The lazy-render distance's hint. */
export const DISTANCE_HINT =
  'Elements starting at least this far below the fold are lazy-render candidates.';

/** The feature section's note while no feature is on (a hint, not an error: nothing ran yet). */
export const NO_FEATURE_NOTE = 'Turn on at least one feature to run the test.';

/** The two features, in form order. */
const FEATURES: readonly BeaconFeatureKey[] = ['aboveTheFold', 'lazyRender'];

/** A section heading (`h2`) and its body column; the form card's hairline divides sections. */
function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <section class="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <h2 class="text-sm font-semibold text-fg-primary">{props.title}</h2>
      {props.children}
    </section>
  );
}

/** The issues' lines of one field. */
function FieldErrors(props: { issues: readonly BeaconConfigIssue[] }): JSX.Element {
  return (
    <For each={props.issues}>
      {(issue) => (
        <p data-fdt-field-error class={cn('text-2xs break-words', STATUS_TEXT_CLASSES.error)}>
          {describeConfigIssue(issue)}
        </p>
      )}
    </For>
  );
}

/** Props of {@link ThresholdInput}. */
interface ThresholdInputProps {
  session: BeaconTesterSession;
  field: ThresholdField;
  issues: readonly BeaconConfigIssue[];
}

/**
 * One labelled px field (text, digits expected: what was typed stays visible).
 *
 * @param props See {@link ThresholdInputProps}.
 */
function ThresholdInput(props: ThresholdInputProps): JSX.Element {
  const id = (): string => beaconFieldId(props.field);
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <label for={id()} class="text-xs font-medium text-fg-primary">
        {THRESHOLD_NAMES[props.field]} (px)
      </label>
      <Input
        id={id()}
        data-fdt-beacon-field={props.field}
        class="w-full font-mono tabular-nums @regular:w-32"
        inputMode="numeric"
        value={props.session.form[props.field]}
        maxLength={settingsFieldMax(props.field)}
        spellcheck={false}
        autocomplete="off"
        aria-invalid={props.issues.length > 0 || undefined}
        onInput={(event) => {
          props.session.setText(props.field, event.currentTarget.value);
        }}
      />
      <FieldErrors issues={props.issues} />
    </div>
  );
}

/** Props of {@link BeaconForm}. */
export interface BeaconFormProps {
  /** The session (its settings are loaded: the page shows the form only then). */
  session: BeaconTesterSession;
}

/**
 * Render the form: one card (sections divided by hairlines, the save line in
 * its footer), so every line of text sits on a solid surface.
 *
 * @param props See {@link BeaconFormProps}.
 */
export function BeaconForm(props: BeaconFormProps): JSX.Element {
  /** The live issues by the field they are about (the features' own note aside). */
  const byField = createMemo(() => {
    const grouped = new Map<BeaconSettingField | null, BeaconConfigIssue[]>();
    for (const issue of props.session.issues()) {
      const field = issueField(issue);
      grouped.set(field, [...(grouped.get(field) ?? []), issue]);
    }
    return grouped;
  });
  /** One field's live issues. */
  const issuesOf = (field: BeaconSettingField): readonly BeaconConfigIssue[] =>
    byField().get(field) ?? [];
  const mobile = (): boolean => props.session.form.mobile;
  return (
    <Card level={1} footer={<SaveLine state={props.session.save()} />}>
      <div data-fdt="beacon-form" class="flex min-w-0 flex-col divide-y divide-line-1">
        <Section title="Features">
          <div id={beaconFieldId('features')} class="grid gap-3 @wide:grid-cols-2">
            <For each={FEATURES}>
              {(feature) => (
                <div class="flex min-w-0 flex-col gap-1">
                  <Switch
                    label={BEACON_FEATURE_LABELS[feature]}
                    aria-describedby={`beacon-hint-${feature}`}
                    checked={props.session.form[feature]}
                    onChange={(checked) => {
                      props.session.setFlag(feature, checked);
                    }}
                    class="text-xs"
                  />
                  <p id={`beacon-hint-${feature}`} class="text-2xs text-fg-muted">
                    {FEATURE_HINTS[feature]}
                  </p>
                </div>
              )}
            </For>
          </div>
          <Show when={issuesOf('features').length > 0}>
            <p data-fdt-beacon-no-feature class="text-2xs text-fg-secondary">
              {NO_FEATURE_NOTE}
            </p>
          </Show>
        </Section>
        <Section title="Device and viewport">
          <div class="flex min-w-0 flex-col gap-1">
            <Switch
              label="Mobile"
              aria-describedby="beacon-hint-device"
              checked={mobile()}
              onChange={(checked) => {
                props.session.setFlag('mobile', checked);
              }}
              class="text-xs"
            />
            <p id="beacon-hint-device" class="text-2xs text-fg-muted">
              {DEVICE_HINT}
            </p>
          </div>
          <div class="grid gap-3 @regular:grid-cols-2 @regular:max-w-md">
            <ThresholdInput
              session={props.session}
              field="widthThreshold"
              issues={issuesOf('widthThreshold')}
            />
            <ThresholdInput
              session={props.session}
              field="heightThreshold"
              issues={issuesOf('heightThreshold')}
            />
          </div>
          <p class="text-2xs text-fg-muted">
            {mobile() ? VIEWPORT_HINTS.mobile : VIEWPORT_HINTS.desktop}
          </p>
        </Section>
        <Section title={BEACON_FEATURE_LABELS.aboveTheFold}>
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <label
                for={beaconFieldId('selectorText')}
                class="text-xs font-medium text-fg-primary"
              >
                {SELECTORS_COPY.label}
              </label>
              <Button
                size="sm"
                variant="ghost"
                disabled={
                  props.session.form.selectorText === DEFAULT_BEACON_TEST_SETTINGS.selectorText
                }
                onClick={() => {
                  props.session.resetSelectors();
                }}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Restore defaults
              </Button>
            </div>
            <Textarea
              id={beaconFieldId('selectorText')}
              data-fdt-beacon-field="selectorText"
              class="h-28 resize-y font-mono"
              value={props.session.form.selectorText}
              maxLength={settingsFieldMax('selectorText')}
              spellcheck={false}
              autocomplete="off"
              aria-invalid={issuesOf('selectorText').length > 0 || undefined}
              aria-describedby="beacon-hint-selectors"
              onInput={(event) => {
                props.session.setText('selectorText', event.currentTarget.value);
              }}
            />
            <p id="beacon-hint-selectors" class="text-2xs text-fg-muted">
              {SELECTORS_COPY.hint}
            </p>
            <FieldErrors issues={issuesOf('selectorText')} />
          </div>
        </Section>
        <Section title={BEACON_FEATURE_LABELS.lazyRender}>
          <div class="grid gap-1 @regular:max-w-md">
            <ThresholdInput
              session={props.session}
              field="lazyRenderThreshold"
              issues={issuesOf('lazyRenderThreshold')}
            />
            <p class="text-2xs text-fg-muted">{DISTANCE_HINT}</p>
          </div>
        </Section>
      </div>
    </Card>
  );
}
