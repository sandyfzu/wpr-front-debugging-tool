/**
 * The beacon test's run configuration: what the user picks (features,
 * device, viewport thresholds, candidate selectors), its defaults, the
 * per-field validators every trigger runs before a test, and the mapping to
 * the option object WP Rocket's beacon reads.
 *
 * Every run builds a fresh configuration from the validated fields — nothing
 * carries over from an earlier run (a device switched back to desktop really
 * runs as desktop).
 */

import { capText } from '../../utils/cap-text';
import { isRecord, ownValue } from '../../utils/is-record';
import { parseLineList } from '../../utils/line-list';

/** The two beacon features the test runs (WP Rocket's own feature names in the UI). */
export interface BeaconFeatures {
  /** Optimize Critical Images: the above-the-fold image candidates. */
  readonly aboveTheFold: boolean;
  /** Automatic Lazy Rendering: the hashes of elements far enough below the fold. */
  readonly lazyRender: boolean;
}

/** A validated run configuration. */
export interface BeaconTestConfig {
  /** Which features run; at least one is on. */
  readonly features: BeaconFeatures;
  /** Run as the mobile beacon: the viewport must fit inside the thresholds instead of covering them. */
  readonly mobile: boolean;
  /** Viewport width threshold, CSS px. */
  readonly widthThreshold: number;
  /** Viewport height threshold, CSS px. */
  readonly heightThreshold: number;
  /** Lazy-render distance below the fold, CSS px. */
  readonly lazyRenderThreshold: number;
  /**
   * Candidate element selectors (trimmed, non-empty, first occurrence kept,
   * each closed); empty when the above-the-fold scan is off (nothing reads them).
   */
  readonly selectors: readonly string[];
}

/**
 * WP Rocket's default above-the-fold candidate selectors (its 3.24
 * `rocket_atf_elements` defaults): the elements the site's own beacon scans
 * unless a filter changed them, so a test run finds what the real one would.
 */
export const DEFAULT_CANDIDATE_SELECTORS: readonly string[] = Object.freeze([
  'img',
  'video',
  'picture',
  'p',
  'main',
  'div',
  'li',
  'svg',
  'section',
  'header',
  'span'
]);

/** One device's viewport thresholds, CSS px. */
export interface DeviceThresholds {
  readonly widthThreshold: number;
  readonly heightThreshold: number;
}

/** WP Rocket's default desktop thresholds: the viewport must be at least this large. */
export const DESKTOP_THRESHOLDS: DeviceThresholds = Object.freeze({
  widthThreshold: 1600,
  heightThreshold: 700
});

/** WP Rocket's default mobile thresholds: the viewport must fit inside them. */
export const MOBILE_THRESHOLDS: DeviceThresholds = Object.freeze({
  widthThreshold: 393,
  heightThreshold: 830
});

/** WP Rocket's default lazy-render distance below the fold, CSS px (the same on both devices). */
export const LAZY_RENDER_THRESHOLD_DEFAULT = 1800;

/**
 * The default thresholds of a device — what the form switches to when the
 * mobile choice changes, so each device starts from WP Rocket's own values.
 *
 * @param mobile Whether the run is a mobile one.
 * @returns The device's default width/height thresholds.
 */
export function deviceThresholds(mobile: boolean): DeviceThresholds {
  return mobile ? MOBILE_THRESHOLDS : DESKTOP_THRESHOLDS;
}

/** Form defaults: desktop beacon, WP Rocket's defaults, no feature preselected (the user picks). */
export const BEACON_TEST_DEFAULTS: BeaconTestConfig = Object.freeze({
  features: Object.freeze({ aboveTheFold: false, lazyRender: false }),
  mobile: false,
  ...DESKTOP_THRESHOLDS,
  lazyRenderThreshold: LAZY_RENDER_THRESHOLD_DEFAULT,
  selectors: DEFAULT_CANDIDATE_SELECTORS
});

/**
 * Largest accepted threshold (CSS px): far past any real viewport or page
 * distance, small enough that a typo cannot become a meaningless number.
 */
export const THRESHOLD_MAX = 100_000;

/** Most candidate selectors a run accepts. */
export const SELECTOR_COUNT_MAX = 200;

/** Longest accepted selector, UTF-16 code units. */
export const SELECTOR_LENGTH_MAX = 1000;

/** Code points of an over-long selector echoed back in its issue. */
const ISSUE_ECHO_MAX = 80;

/** The threshold fields, by config key. */
export type ThresholdField = 'widthThreshold' | 'heightThreshold' | 'lazyRenderThreshold';

/** One reason a configuration cannot run. */
export type BeaconConfigIssue =
  | { readonly kind: 'malformed' }
  | { readonly kind: 'no-feature' }
  | { readonly kind: 'threshold'; readonly field: ThresholdField }
  | { readonly kind: 'no-selector' }
  | { readonly kind: 'too-many-selectors'; readonly count: number }
  | { readonly kind: 'selector-too-long'; readonly selector: string }
  | { readonly kind: 'selector-invalid'; readonly selector: string }
  /** Parses only because the end of the text closes an open string, comment, escape or bracket. */
  | { readonly kind: 'selector-unclosed'; readonly selector: string }
  /** The joined list the beacon receives does not parse (unreachable once every entry is closed). */
  | { readonly kind: 'selector-list-invalid' };

/**
 * The browser's selector parser verdict — injected so this module stays
 * DOM-free; the caller backs it with the page's own parser.
 *
 * @param selector The selector text.
 * @returns Whether the selector (list) parses.
 */
export type SelectorValidity = (selector: string) => boolean;

/** Separator of the one selector list the beacon receives. */
const SELECTOR_LIST_SEPARATOR = ',';

/**
 * Whether an entry is a closed selector: it parses, and a stray `)` or `]`
 * after it does not. CSS closes an open string, comment, escape, `(` or `[`
 * at the end of the text, so `img[alt="x` parses alone — but joined into the
 * beacon's one list, the open construct swallows or breaks the entries after
 * it (`img[alt="x,video` never matches a video). A closed entry ends at the
 * top level, where a stray closer is always a parse error; an open one
 * absorbs it (string, comment, escape) or is closed by it (bracket), and
 * still parses. Separator-safe by construction: a closed entry followed by
 * `,` starts a new list item.
 *
 * @param selector The entry.
 * @param isValid The selector parser check.
 * @returns `true` when the entry parses without relying on the end of the text.
 */
export function isClosedSelector(selector: string, isValid: SelectorValidity): boolean {
  return isValid(selector) && !isValid(`${selector})`) && !isValid(`${selector}]`);
}

/**
 * The one selector list the beacon hands to `querySelectorAll` — the
 * single declaring site of the join, so the string validated is the string sent.
 *
 * @param selectors The closed entries.
 * @returns The entries joined as one list.
 */
export function joinSelectorList(selectors: readonly string[]): string {
  return selectors.join(SELECTOR_LIST_SEPARATOR);
}

/**
 * Validate a threshold: a whole number of CSS px in `1..`{@link THRESHOLD_MAX}.
 *
 * @param value The untrusted field value.
 * @returns The threshold, or null when it is not one.
 */
export function readThreshold(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= THRESHOLD_MAX
    ? value
    : null;
}

/**
 * Validate the feature choice.
 *
 * @param value The untrusted `features` value.
 * @returns The features when both are booleans and at least one is on, else null.
 */
export function readFeatures(value: unknown): BeaconFeatures | null {
  if (!isRecord(value)) return null;
  const aboveTheFold = ownValue(value, 'aboveTheFold');
  const lazyRender = ownValue(value, 'lazyRender');
  if (typeof aboveTheFold !== 'boolean' || typeof lazyRender !== 'boolean') return null;
  if (!aboveTheFold && !lazyRender) return null;
  return Object.freeze({ aboveTheFold, lazyRender });
}

/**
 * Validate already-split selector entries: a bounded, non-empty list of
 * bounded, closed selectors (see {@link isClosedSelector}), and the joined
 * list the beacon receives. Only the above-the-fold scan reads them, so the
 * caller skips this when that feature is off.
 *
 * @param entries The entries (trimmed, deduplicated by the line-list parser).
 * @param isValid The selector parser check.
 * @returns The issues, in field order (empty when the list can run).
 */
export function selectorIssues(
  entries: readonly string[],
  isValid: SelectorValidity
): BeaconConfigIssue[] {
  if (entries.length === 0) return [{ kind: 'no-selector' }];
  if (entries.length > SELECTOR_COUNT_MAX) {
    return [{ kind: 'too-many-selectors', count: entries.length }];
  }
  const issues: BeaconConfigIssue[] = [];
  for (const selector of entries) {
    if (selector.length > SELECTOR_LENGTH_MAX) {
      issues.push({ kind: 'selector-too-long', selector: capText(selector, ISSUE_ECHO_MAX) });
    } else if (!isValid(selector)) {
      issues.push({ kind: 'selector-invalid', selector });
    } else if (!isClosedSelector(selector, isValid)) {
      issues.push({ kind: 'selector-unclosed', selector });
    }
  }
  // Defense in depth: the exact string the beacon gets must parse too.
  if (issues.length === 0 && !isValid(joinSelectorList(entries))) {
    issues.push({ kind: 'selector-list-invalid' });
  }
  return issues;
}

/** An untrusted selector list, read: its entries, or only its length when over the cap. */
type SelectorList =
  | { readonly kind: 'entries'; readonly entries: readonly string[] }
  | { readonly kind: 'too-many'; readonly count: number };

/**
 * Read the untrusted selector list, bounded before any per-entry work.
 *
 * @param value The untrusted `selectors` value.
 * @returns The entries, or the count of a list past {@link SELECTOR_COUNT_MAX}
 *   (its entries left unread); null when it is not an array of strings.
 */
function readSelectorList(value: unknown): SelectorList | null {
  if (!Array.isArray(value)) return null;
  if (value.length > SELECTOR_COUNT_MAX) return { kind: 'too-many', count: value.length };
  const entries: unknown[] = value;
  return entries.every((entry): entry is string => typeof entry === 'string')
    ? { kind: 'entries', entries }
    : null;
}

/** A configuration check's outcome. */
export type BeaconConfigCheck =
  | { readonly ok: true; readonly config: BeaconTestConfig }
  | { readonly ok: false; readonly issues: readonly BeaconConfigIssue[] };

/** The outcome for a value that is not a configuration at all. */
const MALFORMED: BeaconConfigCheck = Object.freeze({
  ok: false,
  issues: Object.freeze([Object.freeze({ kind: 'malformed' } as const)])
});

/**
 * Re-validate a configuration object that crossed a bundle boundary (the
 * runner's side of the bridge). Its selectors are already line-list
 * entries; they must be strings and pass {@link selectorIssues} when the
 * above-the-fold scan runs — otherwise the beacon reads none, so the
 * configuration carries none.
 *
 * @param value The untrusted configuration.
 * @param isValidSelector The selector parser check.
 * @returns A fresh frozen configuration, or every issue found.
 */
export function readBeaconTestConfig(
  value: unknown,
  isValidSelector: SelectorValidity
): BeaconConfigCheck {
  if (!isRecord(value)) return MALFORMED;
  const mobile = ownValue(value, 'mobile');
  const features = ownValue(value, 'features');
  if (typeof mobile !== 'boolean' || !isRecord(features)) return MALFORMED;
  const list = readSelectorList(ownValue(value, 'selectors'));
  if (list === null) return MALFORMED;
  const issues: BeaconConfigIssue[] = [];
  const checkedFeatures = readFeatures(features);
  if (checkedFeatures === null) issues.push({ kind: 'no-feature' });
  const thresholdOf = (field: ThresholdField): number => {
    const threshold = readThreshold(ownValue(value, field));
    if (threshold === null) issues.push({ kind: 'threshold', field });
    return threshold ?? 0;
  };
  const widthThreshold = thresholdOf('widthThreshold');
  const heightThreshold = thresholdOf('heightThreshold');
  const lazyRenderThreshold = thresholdOf('lazyRenderThreshold');
  // Without a valid feature choice the selectors are checked too: every issue is reported at once.
  const scansSelectors = checkedFeatures?.aboveTheFold !== false;
  if (scansSelectors) {
    issues.push(
      ...(list.kind === 'too-many'
        ? [{ kind: 'too-many-selectors', count: list.count } as const]
        : selectorIssues(list.entries, isValidSelector))
    );
  }
  // Any issue (a missing feature choice included) refuses the whole configuration.
  if (checkedFeatures === null || issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    config: Object.freeze({
      features: checkedFeatures,
      mobile,
      widthThreshold,
      heightThreshold,
      lazyRenderThreshold,
      selectors: Object.freeze(scansSelectors && list.kind === 'entries' ? [...list.entries] : [])
    })
  };
}

/** What the form holds: the configuration, with the selectors as typed (one per line). */
export interface BeaconTestDraft extends Omit<BeaconTestConfig, 'selectors'> {
  /** The selector field's raw text. */
  readonly selectorText: string;
}

/** The default selectors as the form's field text (one per line). */
export const DEFAULT_SELECTOR_TEXT = DEFAULT_CANDIDATE_SELECTORS.join('\n');

/**
 * Check a form draft: its selector text becomes line-list entries (one per
 * line, trimmed, blanks dropped, first repeat kept, commas never split),
 * then the whole configuration goes through {@link readBeaconTestConfig} —
 * the same check the runner repeats.
 *
 * @param draft The form's values.
 * @param isValidSelector The selector parser check.
 * @returns A fresh frozen configuration, or every issue found.
 */
export function checkBeaconDraft(
  draft: BeaconTestDraft,
  isValidSelector: SelectorValidity
): BeaconConfigCheck {
  const { selectorText, ...fields } = draft;
  return readBeaconTestConfig(
    { ...fields, selectors: parseLineList(selectorText) },
    isValidSelector
  );
}

/** The option object WP Rocket's beacon reads (only the keys a test run uses). */
export interface BeaconPackageOptions {
  readonly is_mobile: boolean;
  /**
   * One selector list ({@link joinSelectorList}): the beacon hands this value
   * to `querySelectorAll`, so joining closed entries with `,` matches exactly
   * what a list of selectors coerces to.
   */
  readonly elements: string;
  readonly width_threshold: number;
  readonly height_threshold: number;
  readonly lrc_threshold: number;
  /** The beacon's diagnostic mode (its logger is replaced by a silent one at run time). */
  readonly debug: true;
  readonly status: { readonly atf: boolean; readonly lrc: boolean };
}

/**
 * Map a validated configuration to a fresh beacon option object. Endpoint,
 * nonce and page URL are deliberately absent: a test run never talks to the
 * site.
 *
 * @param config The validated configuration.
 * @returns A new option object (never shared between runs).
 */
export function toPackageOptions(config: BeaconTestConfig): BeaconPackageOptions {
  return {
    is_mobile: config.mobile,
    elements: joinSelectorList(config.selectors),
    width_threshold: config.widthThreshold,
    height_threshold: config.heightThreshold,
    lrc_threshold: config.lazyRenderThreshold,
    debug: true,
    status: { atf: config.features.aboveTheFold, lrc: config.features.lazyRender }
  };
}
