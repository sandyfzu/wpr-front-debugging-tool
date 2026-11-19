/**
 * The beacon tester's settings sections, pure: which section owns each
 * field a recovery can name, the one-line summary a folded section shows
 * (what it holds, as a run reads it, plus the run check's problems in it),
 * and which sections start open (the features and the device always; a
 * feature's own section when the feature is on or its value is not WP
 * Rocket's default — a section of defaults for a feature that is off stays
 * out of the way).
 */
import { countLabel, formatCount } from '../../utils/format-count';
import { parseLineList } from '../../utils/line-list';
import type { SectionSummary } from '../panel/section-summary';
import type { BeaconConfigIssue, ThresholdField } from './config';
import type { BeaconSettingField } from './outcome-view';
import { BEACON_FEATURE_KEYS } from './runner-bridge';
import { DEFAULT_BEACON_TEST_SETTINGS, thresholdOf, type BeaconTestSettings } from './settings';

/** The settings' sections, in form order. */
export const BEACON_SETTINGS_SECTIONS = [
  'features',
  'device',
  'aboveTheFold',
  'lazyRender'
] as const;

/** One settings section. */
export type BeaconSettingsSection = (typeof BEACON_SETTINGS_SECTIONS)[number];

/** The section holding each field a recovery focuses (it opens before the focus). */
export const BEACON_FIELD_SECTION: Readonly<Record<BeaconSettingField, BeaconSettingsSection>> = {
  features: 'features',
  widthThreshold: 'device',
  heightThreshold: 'device',
  selectorText: 'aboveTheFold',
  lazyRenderThreshold: 'lazyRender'
};

/** A section's words. */
export const SUMMARY_WORDS = {
  off: 'Off',
  defaults: 'Defaults',
  mobile: 'Mobile',
  desktop: 'Desktop',
  noSelector: 'No selector',
  tooManySelectors: 'Too many selectors',
  invalidDistance: 'Invalid distance'
} as const;

const INVALID_VALUE = { one: 'invalid value', other: 'invalid values' } as const;
const INVALID_SELECTOR = { one: 'invalid selector', other: 'invalid selectors' } as const;
const SELECTOR = { one: 'selector', other: 'selectors' } as const;

/**
 * Join the present parts with the summaries' separator.
 *
 * @param parts The parts (null: left out).
 */
function joined(parts: readonly (string | null)[]): string {
  return parts.filter((part) => part !== null).join(' · ');
}

/**
 * Whether the run check refuses a threshold.
 *
 * @param issues The live issues.
 * @param field The threshold.
 */
function thresholdRefused(issues: readonly BeaconConfigIssue[], field: ThresholdField): boolean {
  return issues.some((issue) => issue.kind === 'threshold' && issue.field === field);
}

/**
 * The features section: how many of the two are on.
 *
 * @param settings The form's settings.
 */
function featuresSummary(settings: BeaconTestSettings): SectionSummary {
  const on = BEACON_FEATURE_KEYS.filter((key) => settings[key]).length;
  return {
    text: `${formatCount(on)} of ${formatCount(BEACON_FEATURE_KEYS.length)} on`,
    // None on holds Run with a hint in the section, never an error.
    problem: null
  };
}

/**
 * The device section: the device, then the viewport thresholds once both read.
 *
 * @param settings The form's settings.
 * @param issues The live issues.
 */
function deviceSummary(
  settings: BeaconTestSettings,
  issues: readonly BeaconConfigIssue[]
): SectionSummary {
  const refused = (['widthThreshold', 'heightThreshold'] as const).filter((field) =>
    thresholdRefused(issues, field)
  ).length;
  const viewport =
    refused === 0
      ? `${formatCount(thresholdOf(settings.widthThreshold))} × ${formatCount(thresholdOf(settings.heightThreshold))} px`
      : null;
  return {
    text: joined([settings.mobile ? SUMMARY_WORDS.mobile : SUMMARY_WORDS.desktop, viewport]),
    problem: refused > 0 ? countLabel(refused, INVALID_VALUE) : null
  };
}

/**
 * The selector problems' words: an empty or oversized list by name, else
 * how many selectors the run refuses.
 *
 * @param issues The live issues.
 * @returns The words, or null without a selector issue.
 */
function selectorProblem(issues: readonly BeaconConfigIssue[]): string | null {
  if (issues.some((issue) => issue.kind === 'no-selector')) return SUMMARY_WORDS.noSelector;
  if (issues.some((issue) => issue.kind === 'too-many-selectors')) {
    return SUMMARY_WORDS.tooManySelectors;
  }
  const refused = issues.filter(
    (issue) =>
      issue.kind === 'selector-invalid' ||
      issue.kind === 'selector-unclosed' ||
      issue.kind === 'selector-too-long' ||
      issue.kind === 'selector-list-invalid'
  ).length;
  return refused > 0 ? countLabel(refused, INVALID_SELECTOR) : null;
}

/**
 * The critical images section: off or on, then WP Rocket's default selectors
 * or how many the run reads.
 *
 * @param settings The form's settings.
 * @param issues The live issues (the run checks selectors only while the scan is on).
 */
function aboveTheFoldSummary(
  settings: BeaconTestSettings,
  issues: readonly BeaconConfigIssue[]
): SectionSummary {
  const count = parseLineList(settings.selectorText).length;
  const selectors =
    settings.selectorText === DEFAULT_BEACON_TEST_SETTINGS.selectorText
      ? SUMMARY_WORDS.defaults
      : count > 0
        ? countLabel(count, SELECTOR)
        : null;
  return {
    text: joined([settings.aboveTheFold ? null : SUMMARY_WORDS.off, selectors]),
    problem: selectorProblem(issues)
  };
}

/**
 * The lazy-render section: off or on, then the distance once it reads.
 *
 * @param settings The form's settings.
 * @param issues The live issues.
 */
function lazyRenderSummary(
  settings: BeaconTestSettings,
  issues: readonly BeaconConfigIssue[]
): SectionSummary {
  const refused = thresholdRefused(issues, 'lazyRenderThreshold');
  return {
    text: joined([
      settings.lazyRender ? null : SUMMARY_WORDS.off,
      refused ? null : `${formatCount(thresholdOf(settings.lazyRenderThreshold))} px`
    ]),
    problem: refused ? SUMMARY_WORDS.invalidDistance : null
  };
}

/**
 * Every section's summary.
 *
 * @param settings The form's settings.
 * @param issues The run check's live issues for them.
 * @returns The summaries, by section.
 */
export function beaconSectionSummaries(
  settings: BeaconTestSettings,
  issues: readonly BeaconConfigIssue[]
): Readonly<Record<BeaconSettingsSection, SectionSummary>> {
  return {
    features: featuresSummary(settings),
    device: deviceSummary(settings, issues),
    aboveTheFold: aboveTheFoldSummary(settings, issues),
    lazyRender: lazyRenderSummary(settings, issues)
  };
}

/**
 * Whether a section is open before the loaded settings seed the defaults.
 *
 * @param section The section.
 */
export function beaconSectionOpenBeforeSeed(section: BeaconSettingsSection): boolean {
  return section === 'features' || section === 'device';
}

/**
 * Which sections start open for loaded settings.
 *
 * @param settings The loaded settings.
 * @returns Open per section.
 */
export function initialBeaconSectionsOpen(
  settings: BeaconTestSettings
): Readonly<Record<BeaconSettingsSection, boolean>> {
  return {
    features: true,
    device: true,
    aboveTheFold:
      settings.aboveTheFold || settings.selectorText !== DEFAULT_BEACON_TEST_SETTINGS.selectorText,
    lazyRender:
      settings.lazyRender ||
      settings.lazyRenderThreshold !== DEFAULT_BEACON_TEST_SETTINGS.lazyRenderThreshold
  };
}
