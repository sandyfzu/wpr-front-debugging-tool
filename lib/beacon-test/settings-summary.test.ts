/** The beacon settings sections: field owners, folded summaries and the seeded open state. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CANDIDATE_SELECTORS, type BeaconConfigIssue } from './config';
import type { BeaconSettingField } from './outcome-view';
import { DEFAULT_BEACON_TEST_SETTINGS, type BeaconTestSettings } from './settings';
import {
  BEACON_FIELD_SECTION,
  BEACON_SETTINGS_SECTIONS,
  beaconSectionOpenBeforeSeed,
  beaconSectionSummaries,
  initialBeaconSectionsOpen
} from './settings-summary';

/** WP Rocket's defaults with some fields changed. */
function settings(patch: Partial<BeaconTestSettings> = {}): BeaconTestSettings {
  return { ...DEFAULT_BEACON_TEST_SETTINGS, ...patch };
}

describe('BEACON_FIELD_SECTION', () => {
  it('places every field a recovery names in a section of the form', () => {
    const fields: BeaconSettingField[] = [
      'features',
      'widthThreshold',
      'heightThreshold',
      'selectorText',
      'lazyRenderThreshold'
    ];
    expect(Object.keys(BEACON_FIELD_SECTION).sort()).toEqual([...fields].sort());
    for (const field of fields) {
      expect(BEACON_SETTINGS_SECTIONS).toContain(BEACON_FIELD_SECTION[field]);
    }
    expect(BEACON_FIELD_SECTION.widthThreshold).toBe('device');
    expect(BEACON_FIELD_SECTION.heightThreshold).toBe('device');
    expect(BEACON_FIELD_SECTION.selectorText).toBe('aboveTheFold');
    expect(BEACON_FIELD_SECTION.lazyRenderThreshold).toBe('lazyRender');
  });
});

describe('beaconSectionSummaries — features', () => {
  it.each([
    [false, false, '0 of 2 on'],
    [true, false, '1 of 2 on'],
    [false, true, '1 of 2 on'],
    [true, true, '2 of 2 on']
  ])('aboveTheFold %s, lazyRender %s → %s (never a problem)', (aboveTheFold, lazyRender, text) => {
    const issues: BeaconConfigIssue[] = aboveTheFold || lazyRender ? [] : [{ kind: 'no-feature' }];
    expect(beaconSectionSummaries(settings({ aboveTheFold, lazyRender }), issues).features).toEqual(
      { text, problem: null }
    );
  });
});

describe('beaconSectionSummaries — device', () => {
  it('names the device and the viewport thresholds, grouped', () => {
    expect(beaconSectionSummaries(settings(), []).device).toEqual({
      text: 'Desktop · 1,600 × 700 px',
      problem: null
    });
    expect(
      beaconSectionSummaries(
        settings({ mobile: true, widthThreshold: '393', heightThreshold: '830' }),
        []
      ).device
    ).toEqual({ text: 'Mobile · 393 × 830 px', problem: null });
  });

  it('drops the viewport and counts the refused thresholds', () => {
    const width: BeaconConfigIssue = { kind: 'threshold', field: 'widthThreshold' };
    const height: BeaconConfigIssue = { kind: 'threshold', field: 'heightThreshold' };
    expect(beaconSectionSummaries(settings({ widthThreshold: '12a' }), [width]).device).toEqual({
      text: 'Desktop',
      problem: '1 invalid value'
    });
    expect(
      beaconSectionSummaries(settings({ widthThreshold: '', heightThreshold: 'x' }), [
        width,
        height
      ]).device
    ).toEqual({ text: 'Desktop', problem: '2 invalid values' });
  });

  it('ignores the lazy-render distance and the other sections’ issues', () => {
    expect(
      beaconSectionSummaries(settings(), [
        { kind: 'threshold', field: 'lazyRenderThreshold' },
        { kind: 'no-selector' }
      ]).device
    ).toEqual({ text: 'Desktop · 1,600 × 700 px', problem: null });
  });
});

describe('beaconSectionSummaries — critical images', () => {
  it('reads WP Rocket’s selectors as the defaults, off or on', () => {
    expect(beaconSectionSummaries(settings(), []).aboveTheFold).toEqual({
      text: 'Off · Defaults',
      problem: null
    });
    expect(beaconSectionSummaries(settings({ aboveTheFold: true }), []).aboveTheFold).toEqual({
      text: 'Defaults',
      problem: null
    });
  });

  it('counts the selectors a run reads (blank and repeated lines once)', () => {
    expect(
      beaconSectionSummaries(settings({ aboveTheFold: true, selectorText: 'img' }), []).aboveTheFold
        .text
    ).toBe('1 selector');
    expect(
      beaconSectionSummaries(
        settings({ aboveTheFold: true, selectorText: 'img\n\n  img \nvideo\n' }),
        []
      ).aboveTheFold.text
    ).toBe('2 selectors');
    // The default list, reordered, is no longer the defaults.
    expect(
      beaconSectionSummaries(
        settings({
          aboveTheFold: true,
          selectorText: [...DEFAULT_CANDIDATE_SELECTORS].reverse().join('\n')
        }),
        []
      ).aboveTheFold.text
    ).toBe(`${String(DEFAULT_CANDIDATE_SELECTORS.length)} selectors`);
  });

  it('names an empty or oversized list, else counts the refused selectors', () => {
    const summary = (selectorText: string, issues: BeaconConfigIssue[]) =>
      beaconSectionSummaries(settings({ aboveTheFold: true, selectorText }), issues).aboveTheFold;
    expect(summary('  \n', [{ kind: 'no-selector' }])).toEqual({
      text: '',
      problem: 'No selector'
    });
    expect(summary('a\nb', [{ kind: 'too-many-selectors', count: 201 }]).problem).toBe(
      'Too many selectors'
    );
    expect(
      summary('a[\nb(\nc', [
        { kind: 'selector-invalid', selector: 'a[' },
        { kind: 'selector-unclosed', selector: 'b(' }
      ]).problem
    ).toBe('2 invalid selectors');
    expect(summary('x', [{ kind: 'selector-too-long', selector: 'x…' }]).problem).toBe(
      '1 invalid selector'
    );
    expect(summary('a', [{ kind: 'selector-list-invalid' }]).problem).toBe('1 invalid selector');
  });

  it('ignores the thresholds’ and the features’ issues', () => {
    expect(
      beaconSectionSummaries(settings({ aboveTheFold: true }), [
        { kind: 'threshold', field: 'widthThreshold' },
        { kind: 'no-feature' }
      ]).aboveTheFold.problem
    ).toBeNull();
  });
});

describe('beaconSectionSummaries — lazy rendering', () => {
  it('says the distance, off or on', () => {
    expect(beaconSectionSummaries(settings(), []).lazyRender).toEqual({
      text: 'Off · 1,800 px',
      problem: null
    });
    expect(
      beaconSectionSummaries(settings({ lazyRender: true, lazyRenderThreshold: '2400' }), [])
        .lazyRender
    ).toEqual({ text: '2,400 px', problem: null });
  });

  it('drops a refused distance and names it', () => {
    const issue: BeaconConfigIssue = { kind: 'threshold', field: 'lazyRenderThreshold' };
    expect(
      beaconSectionSummaries(settings({ lazyRender: true, lazyRenderThreshold: '-1' }), [issue])
        .lazyRender
    ).toEqual({ text: '', problem: 'Invalid distance' });
    expect(
      beaconSectionSummaries(settings({ lazyRenderThreshold: '' }), [issue]).lazyRender
    ).toEqual({ text: 'Off', problem: 'Invalid distance' });
  });
});

describe('initialBeaconSectionsOpen', () => {
  it('opens the features and the device always; a feature section when it is on or changed', () => {
    expect(initialBeaconSectionsOpen(settings())).toEqual({
      features: true,
      device: true,
      aboveTheFold: false,
      lazyRender: false
    });
    expect(initialBeaconSectionsOpen(settings({ aboveTheFold: true, lazyRender: true }))).toEqual({
      features: true,
      device: true,
      aboveTheFold: true,
      lazyRender: true
    });
    expect(
      initialBeaconSectionsOpen(settings({ selectorText: 'img', lazyRenderThreshold: '900' }))
    ).toEqual({ features: true, device: true, aboveTheFold: true, lazyRender: true });
  });

  it('matches the rule used before the settings load for the two fixed sections', () => {
    for (const section of BEACON_SETTINGS_SECTIONS) {
      expect(beaconSectionOpenBeforeSeed(section)).toBe(
        section === 'features' || section === 'device'
      );
    }
  });
});
