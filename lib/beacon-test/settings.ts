/**
 * The beacon test form's stored settings: what the form shows, exactly as
 * typed (thresholds as their text, selectors one per line), so a reload of
 * the panel brings back the form as it was — invalid values included. A run
 * turns them into a draft ({@link toBeaconDraft}) that the run's own check
 * refuses with every issue named; storing never judges a run, only the
 * value's shape and size.
 */
import { cutToUnits } from '../../utils/cap-text';
import { isRecord, ownValue } from '../../utils/is-record';
import {
  BEACON_TEST_DEFAULTS,
  DEFAULT_SELECTOR_TEXT,
  deviceThresholds,
  SELECTOR_COUNT_MAX,
  SELECTOR_LENGTH_MAX,
  type BeaconTestDraft
} from './config';

/** The form's settings. */
export interface BeaconTestSettings {
  /** Run the above-the-fold (critical images) scan. */
  readonly aboveTheFold: boolean;
  /** Run the lazy-render scan. */
  readonly lazyRender: boolean;
  /** Run as the mobile beacon. */
  readonly mobile: boolean;
  /** Viewport width threshold, as typed. */
  readonly widthThreshold: string;
  /** Viewport height threshold, as typed. */
  readonly heightThreshold: string;
  /** Lazy-render distance, as typed. */
  readonly lazyRenderThreshold: string;
  /** Candidate selectors, one per line, as typed. */
  readonly selectorText: string;
}

/** The text fields. */
export type BeaconSettingsTextField =
  'widthThreshold' | 'heightThreshold' | 'lazyRenderThreshold' | 'selectorText';

/** The switches. */
export type BeaconSettingsFlag = 'aboveTheFold' | 'lazyRender' | 'mobile';

/** Field caps (UTF-16 units): what a field holds and what the store accepts. */
export const BEACON_SETTINGS_LIMITS = {
  /** A threshold's text: room for any accepted number plus stray typing. */
  thresholdChars: 16,
  /** Every runnable selector list fits (one line per selector at its cap). */
  selectorChars: SELECTOR_COUNT_MAX * (SELECTOR_LENGTH_MAX + 1)
} as const;

/**
 * Where the settings are stored (WXT key: `local:` area — machine-local,
 * never synced). Declared here, beside the value's shape, so a reader
 * without WXT storage (the browser-test harness) names the same key.
 */
export const BEACON_TEST_SETTINGS_KEY = 'local:beacon-test-settings';

/** The fresh-install settings: WP Rocket's defaults, no feature preselected (the user picks). */
export const DEFAULT_BEACON_TEST_SETTINGS: BeaconTestSettings = /*#__PURE__*/ Object.freeze({
  aboveTheFold: BEACON_TEST_DEFAULTS.features.aboveTheFold,
  lazyRender: BEACON_TEST_DEFAULTS.features.lazyRender,
  mobile: BEACON_TEST_DEFAULTS.mobile,
  widthThreshold: String(BEACON_TEST_DEFAULTS.widthThreshold),
  heightThreshold: String(BEACON_TEST_DEFAULTS.heightThreshold),
  lazyRenderThreshold: String(BEACON_TEST_DEFAULTS.lazyRenderThreshold),
  selectorText: DEFAULT_SELECTOR_TEXT
});

/** Each text field's cap. */
const TEXT_CAPS: Readonly<Record<BeaconSettingsTextField, number>> = {
  widthThreshold: BEACON_SETTINGS_LIMITS.thresholdChars,
  heightThreshold: BEACON_SETTINGS_LIMITS.thresholdChars,
  lazyRenderThreshold: BEACON_SETTINGS_LIMITS.thresholdChars,
  selectorText: BEACON_SETTINGS_LIMITS.selectorChars
};

/** The fields, by kind. */
const FLAGS: readonly BeaconSettingsFlag[] = ['aboveTheFold', 'lazyRender', 'mobile'];
const TEXT_FIELDS = Object.keys(TEXT_CAPS) as BeaconSettingsTextField[];

/**
 * The cap of a text field (the form's `maxlength`).
 *
 * @param field The field.
 */
export function settingsFieldMax(field: BeaconSettingsTextField): number {
  return TEXT_CAPS[field];
}

/**
 * Read stored settings tolerantly: a missing or wrong-typed field reads as
 * its default, an over-long text is cut to its cap, unknown keys are dropped.
 *
 * @param input The stored value (untrusted).
 * @returns Fresh settings.
 */
export function parseBeaconTestSettings(input: unknown): BeaconTestSettings {
  const record = isRecord(input) ? input : {};
  const flags = {} as Record<BeaconSettingsFlag, boolean>;
  for (const flag of FLAGS) {
    const value = ownValue(record, flag);
    flags[flag] = typeof value === 'boolean' ? value : DEFAULT_BEACON_TEST_SETTINGS[flag];
  }
  const texts = {} as Record<BeaconSettingsTextField, string>;
  for (const field of TEXT_FIELDS) {
    const value = ownValue(record, field);
    texts[field] =
      typeof value === 'string'
        ? cutToUnits(value, TEXT_CAPS[field])
        : DEFAULT_BEACON_TEST_SETTINGS[field];
  }
  return { ...flags, ...texts };
}

/**
 * Why a value cannot be stored (shape and caps only — a run checks the rest).
 *
 * @param input The candidate (untrusted).
 * @returns The problem, or null when it can be stored.
 */
export function findBeaconSettingsProblem(input: unknown): string | null {
  if (!isRecord(input)) return 'not an object';
  for (const flag of FLAGS) {
    if (typeof ownValue(input, flag) !== 'boolean') return `${flag} is not a boolean`;
  }
  for (const field of TEXT_FIELDS) {
    const value = ownValue(input, field);
    if (typeof value !== 'string') return `${field} is not text`;
    if (value.length > TEXT_CAPS[field])
      return `${field} is over ${String(TEXT_CAPS[field])} characters`;
  }
  return null;
}

/** A threshold's accepted text: plain decimal digits (surrounding spaces ignored). */
const DIGITS = /^\d+$/;

/**
 * A threshold's number as typed: digits only (no sign, decimals, exponent
 * or separators — what the run accepts is a whole number of px).
 *
 * @param text The field's text.
 * @returns The number, or `NaN` for anything else (the run's check names it).
 */
export function thresholdOf(text: string): number {
  const trimmed = text.trim();
  return DIGITS.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/**
 * The run draft of the settings (the run's check validates it).
 *
 * @param settings The form's settings.
 * @returns The draft.
 */
export function toBeaconDraft(settings: BeaconTestSettings): BeaconTestDraft {
  return {
    features: { aboveTheFold: settings.aboveTheFold, lazyRender: settings.lazyRender },
    mobile: settings.mobile,
    widthThreshold: thresholdOf(settings.widthThreshold),
    heightThreshold: thresholdOf(settings.heightThreshold),
    lazyRenderThreshold: thresholdOf(settings.lazyRenderThreshold),
    selectorText: settings.selectorText
  };
}

/**
 * The viewport threshold texts of a device's WP Rocket defaults — what the
 * form switches to with the device, so each device starts from its own values.
 *
 * @param mobile The device.
 * @returns The width and height texts.
 */
export function deviceThresholdTexts(
  mobile: boolean
): Pick<BeaconTestSettings, 'widthThreshold' | 'heightThreshold'> {
  const thresholds = deviceThresholds(mobile);
  return {
    widthThreshold: String(thresholds.widthThreshold),
    heightThreshold: String(thresholds.heightThreshold)
  };
}
