/** The beacon form's stored settings: defaults, tolerant reads, store checks, the run draft, device swaps. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELECTOR_TEXT,
  DESKTOP_THRESHOLDS,
  LAZY_RENDER_THRESHOLD_DEFAULT,
  MOBILE_THRESHOLDS
} from './config';
import {
  BEACON_SETTINGS_LIMITS,
  DEFAULT_BEACON_TEST_SETTINGS,
  deviceThresholdTexts,
  findBeaconSettingsProblem,
  parseBeaconTestSettings,
  settingsFieldMax,
  thresholdOf,
  toBeaconDraft,
  type BeaconTestSettings
} from './settings';

const SETTINGS: BeaconTestSettings = {
  aboveTheFold: true,
  lazyRender: false,
  mobile: true,
  widthThreshold: '393',
  heightThreshold: '830',
  lazyRenderThreshold: '1800',
  selectorText: 'img\nvideo'
};

describe('DEFAULT_BEACON_TEST_SETTINGS', () => {
  it("is WP Rocket's desktop defaults with no feature preselected", () => {
    expect(DEFAULT_BEACON_TEST_SETTINGS).toEqual({
      aboveTheFold: false,
      lazyRender: false,
      mobile: false,
      widthThreshold: String(DESKTOP_THRESHOLDS.widthThreshold),
      heightThreshold: String(DESKTOP_THRESHOLDS.heightThreshold),
      lazyRenderThreshold: String(LAZY_RENDER_THRESHOLD_DEFAULT),
      selectorText: DEFAULT_SELECTOR_TEXT
    });
    expect(Object.isFrozen(DEFAULT_BEACON_TEST_SETTINGS)).toBe(true);
  });
});

describe('parseBeaconTestSettings', () => {
  it('returns a fresh copy of valid settings, unknown keys dropped', () => {
    const parsed = parseBeaconTestSettings({ ...SETTINGS, extra: 1 });
    expect(parsed).toEqual(SETTINGS);
    expect(parsed).not.toBe(SETTINGS);
  });

  it('reads each junk field as its default and junk as all defaults', () => {
    expect(
      parseBeaconTestSettings({
        ...SETTINGS,
        mobile: 'yes',
        widthThreshold: 1600,
        selectorText: null
      })
    ).toEqual({
      ...SETTINGS,
      mobile: false,
      widthThreshold: DEFAULT_BEACON_TEST_SETTINGS.widthThreshold,
      selectorText: DEFAULT_SELECTOR_TEXT
    });
    expect(parseBeaconTestSettings('junk')).toEqual(DEFAULT_BEACON_TEST_SETTINGS);
    expect(parseBeaconTestSettings(null)).toEqual(DEFAULT_BEACON_TEST_SETTINGS);
  });

  it('cuts an over-long text to its cap and ignores inherited fields', () => {
    const long = 'x'.repeat(BEACON_SETTINGS_LIMITS.thresholdChars + 5);
    expect(parseBeaconTestSettings({ ...SETTINGS, heightThreshold: long }).heightThreshold).toBe(
      'x'.repeat(BEACON_SETTINGS_LIMITS.thresholdChars)
    );
    const inherited = Object.create({ mobile: true }) as object;
    expect(parseBeaconTestSettings(inherited).mobile).toBe(false);
  });
});

describe('findBeaconSettingsProblem', () => {
  it('accepts valid settings, invalid runs included (stored as typed)', () => {
    expect(findBeaconSettingsProblem(SETTINGS)).toBeNull();
    expect(
      findBeaconSettingsProblem({ ...SETTINGS, widthThreshold: 'abc', selectorText: '' })
    ).toBeNull();
  });

  it('names the first field of the wrong type or over its cap', () => {
    expect(findBeaconSettingsProblem('x')).toBe('not an object');
    expect(findBeaconSettingsProblem({ ...SETTINGS, lazyRender: 1 })).toBe(
      'lazyRender is not a boolean'
    );
    expect(findBeaconSettingsProblem({ ...SETTINGS, selectorText: 5 })).toBe(
      'selectorText is not text'
    );
    expect(
      findBeaconSettingsProblem({
        ...SETTINGS,
        lazyRenderThreshold: '1'.repeat(BEACON_SETTINGS_LIMITS.thresholdChars + 1)
      })
    ).toBe('lazyRenderThreshold is over 16 characters');
  });

  it('fits every runnable selector list under the selector cap', () => {
    expect(settingsFieldMax('selectorText')).toBe(200 * 1001);
    expect(settingsFieldMax('widthThreshold')).toBe(16);
  });
});

describe('thresholdOf', () => {
  it.each([
    ['1600', 1600],
    [' 700 ', 700],
    ['0', 0],
    ['', Number.NaN],
    ['-5', Number.NaN],
    ['1.5', Number.NaN],
    ['1e3', Number.NaN],
    ['1,600', Number.NaN],
    ['0x10', Number.NaN],
    ['١٢', Number.NaN]
  ])('reads %j as %d', (text, expected) => {
    expect(thresholdOf(text)).toBe(expected);
  });
});

describe('toBeaconDraft', () => {
  it('maps the switches to features and the texts to numbers, selectors as typed', () => {
    expect(toBeaconDraft(SETTINGS)).toEqual({
      features: { aboveTheFold: true, lazyRender: false },
      mobile: true,
      widthThreshold: 393,
      heightThreshold: 830,
      lazyRenderThreshold: 1800,
      selectorText: 'img\nvideo'
    });
  });
});

describe('deviceThresholdTexts', () => {
  it("gives each device WP Rocket's own viewport thresholds", () => {
    expect(deviceThresholdTexts(true)).toEqual({
      widthThreshold: String(MOBILE_THRESHOLDS.widthThreshold),
      heightThreshold: String(MOBILE_THRESHOLDS.heightThreshold)
    });
    expect(deviceThresholdTexts(false)).toEqual({ widthThreshold: '1600', heightThreshold: '700' });
  });
});
