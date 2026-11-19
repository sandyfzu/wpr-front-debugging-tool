/**
 * The tester's settings sections, pure: which section owns each field, the
 * one-line summary a collapsed section shows (what is filled in, counted as
 * a run reads it, plus how many of its patterns do not compile), and which
 * sections start open (the request always; the others only when they hold
 * something — an empty advanced section stays out of the way).
 */
import { countLabel } from '../../utils/format-count';
import { parseLineList } from '../../utils/line-list';
import type { SectionSummary } from '../panel/section-summary';
import type { RucssTesterConfig } from './config';
import { DEFAULT_INLINE_PRESERVES } from './run-plan';

/** The settings' sections, in form order. */
export const RUCSS_SETTINGS_SECTIONS = ['request', 'keep', 'adjust'] as const;

/** One settings section. */
export type RucssSettingsSection = (typeof RUCSS_SETTINGS_SECTIONS)[number];

/** A field a section holds (the text fields, the flags and the replacement pairs). */
export type RucssSettingsField = keyof RucssTesterConfig;

/** The section that holds each field (a recovery opens it before focusing the field). */
export const RUCSS_FIELD_SECTION: Readonly<Record<RucssSettingsField, RucssSettingsSection>> = {
  mobile: 'request',
  home: 'request',
  safelist: 'request',
  inlinePreserve: 'keep',
  excludeFiles: 'keep',
  prepend: 'adjust',
  append: 'adjust',
  replacements: 'adjust'
};

/** Patterns that do not compile, per section that checks them (the form's live checks count them). */
export interface RucssSettingsProblems {
  /** Distinct stylesheet patterns that do not compile (repeats count once, as patterns do). */
  readonly excludeLines: number;
  /** Replacement searches that do not compile. */
  readonly pairs: number;
}

/** A section holding nothing of the user's. */
export const EMPTY_SECTION_SUMMARY = 'Empty';

const INVALID_PATTERN = { one: 'invalid pattern', other: 'invalid patterns' } as const;

/**
 * The problem words for a count.
 *
 * @param count Patterns that do not compile.
 * @returns E.g. "2 invalid patterns", or null at zero.
 */
function problemWords(count: number): string | null {
  return count > 0 ? countLabel(count, INVALID_PATTERN) : null;
}

/**
 * Whether an added-CSS field holds any CSS (whitespace alone changes nothing).
 *
 * @param css The field's text.
 */
function holdsCss(css: string): boolean {
  return css.trim() !== '';
}

/**
 * The request section: the device, the home flag when set, the safelist
 * entries a run sends.
 *
 * @param config The form's settings.
 */
function requestSummary(config: RucssTesterConfig): SectionSummary {
  const safelist = parseLineList(config.safelist).length;
  const parts = [
    config.mobile ? 'Mobile' : 'Desktop',
    config.home ? 'Home page' : null,
    safelist > 0 ? countLabel(safelist, { one: 'safelist entry', other: 'safelist entries' }) : null
  ];
  return { text: parts.filter((part) => part !== null).join(' · '), problem: null };
}

/**
 * The styles-to-keep section: the user's markers and patterns, or the
 * built-in markers every run keeps when the user added none.
 *
 * @param config The form's settings.
 * @param problems The live checks' counts.
 */
function keepSummary(config: RucssTesterConfig, problems: RucssSettingsProblems): SectionSummary {
  const markers = parseLineList(config.inlinePreserve).length;
  const patterns = parseLineList(config.excludeFiles).length;
  const parts = [
    markers > 0 ? countLabel(markers, { one: 'marker', other: 'markers' }) : null,
    patterns > 0 ? countLabel(patterns, { one: 'pattern', other: 'patterns' }) : null
  ].filter((part) => part !== null);
  return {
    text:
      parts.length > 0
        ? parts.join(' · ')
        : `${String(DEFAULT_INLINE_PRESERVES.length)} always kept`,
    problem: problemWords(problems.excludeLines)
  };
}

/**
 * The adjust section: which CSS is added around the result, and the
 * replacements (every row, an unfinished one included — it is on screen).
 *
 * @param config The form's settings.
 * @param problems The live checks' counts.
 */
function adjustSummary(config: RucssTesterConfig, problems: RucssSettingsProblems): SectionSummary {
  const pairs = config.replacements.length;
  const parts = [
    holdsCss(config.prepend) ? 'CSS before' : null,
    holdsCss(config.append) ? 'CSS after' : null,
    pairs > 0 ? countLabel(pairs, { one: 'replacement', other: 'replacements' }) : null
  ].filter((part) => part !== null);
  return {
    text: parts.length > 0 ? parts.join(' · ') : EMPTY_SECTION_SUMMARY,
    problem: problemWords(problems.pairs)
  };
}

/**
 * Every section's summary.
 *
 * @param config The form's settings.
 * @param problems The live checks' counts (never recompiled here).
 * @returns One summary per section.
 */
export function rucssSectionSummaries(
  config: RucssTesterConfig,
  problems: RucssSettingsProblems
): Readonly<Record<RucssSettingsSection, SectionSummary>> {
  return {
    request: requestSummary(config),
    keep: keepSummary(config, problems),
    adjust: adjustSummary(config, problems)
  };
}

/**
 * Which sections start open: the request always; the others when they hold
 * any of the user's settings (whitespace-only text counts as empty).
 *
 * @param config The loaded settings.
 * @returns Open per section.
 */
export function initialRucssSectionsOpen(
  config: RucssTesterConfig
): Readonly<Record<RucssSettingsSection, boolean>> {
  return {
    request: true,
    keep:
      parseLineList(config.inlinePreserve).length > 0 ||
      parseLineList(config.excludeFiles).length > 0,
    adjust: holdsCss(config.prepend) || holdsCss(config.append) || config.replacements.length > 0
  };
}
