/**
 * The settings sections: every field has its section, each summary counts
 * what a run reads (blank and repeated lines ignored, singular/plural), the
 * problem words follow the live checks' counts, and only filled advanced
 * sections start open.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUCSS_TESTER_CONFIG, type RucssTesterConfig } from './config';
import { DEFAULT_INLINE_PRESERVES } from './run-plan';
import {
  EMPTY_SECTION_SUMMARY,
  initialRucssSectionsOpen,
  RUCSS_FIELD_SECTION,
  RUCSS_SETTINGS_SECTIONS,
  rucssSectionSummaries
} from './settings-summary';

const BASE: RucssTesterConfig = { ...DEFAULT_RUCSS_TESTER_CONFIG, replacements: [] };
const NO_PROBLEMS = { excludeLines: 0, pairs: 0 } as const;

/**
 * The summaries of a configuration (no problems unless given).
 *
 * @param patch The fields that differ from the defaults.
 * @param problems The live checks' counts.
 */
function summaries(
  patch: Partial<RucssTesterConfig>,
  problems: { excludeLines: number; pairs: number } = NO_PROBLEMS
) {
  return rucssSectionSummaries({ ...BASE, ...patch }, problems);
}

describe('RUCSS_FIELD_SECTION', () => {
  it('places every configuration field in a known section', () => {
    expect(Object.keys(RUCSS_FIELD_SECTION).sort()).toEqual(Object.keys(BASE).sort());
    for (const section of Object.values(RUCSS_FIELD_SECTION)) {
      expect(RUCSS_SETTINGS_SECTIONS).toContain(section);
    }
    expect(RUCSS_FIELD_SECTION.excludeFiles).toBe('keep');
    expect(RUCSS_FIELD_SECTION.prepend).toBe('adjust');
    expect(RUCSS_FIELD_SECTION.replacements).toBe('adjust');
    expect(RUCSS_FIELD_SECTION.safelist).toBe('request');
  });
});

describe('rucssSectionSummaries — request', () => {
  it('says the device, then the home flag and the safelist when set', () => {
    expect(summaries({}).request).toEqual({ text: 'Desktop', problem: null });
    expect(summaries({ mobile: true }).request.text).toBe('Mobile');
    expect(summaries({ home: true }).request.text).toBe('Desktop · Home page');
    expect(summaries({ mobile: true, home: true, safelist: '.a' }).request.text).toBe(
      'Mobile · Home page · 1 safelist entry'
    );
  });

  it('counts safelist entries as a run sends them (blank and repeated lines dropped)', () => {
    expect(summaries({ safelist: '.a\n\n  \r\n.b\n.a\n  .b  ' }).request.text).toBe(
      'Desktop · 2 safelist entries'
    );
    expect(summaries({ safelist: ' \n \n' }).request.text).toBe('Desktop');
  });
});

describe('rucssSectionSummaries — styles to keep', () => {
  it('names the built-in markers while the user added none', () => {
    expect(summaries({}).keep).toEqual({
      text: `${String(DEFAULT_INLINE_PRESERVES.length)} always kept`,
      problem: null
    });
    expect(summaries({ inlinePreserve: '  \n', excludeFiles: '\n' }).keep.text).toBe(
      `${String(DEFAULT_INLINE_PRESERVES.length)} always kept`
    );
  });

  it('counts the user markers and patterns, each part only when present', () => {
    expect(summaries({ inlinePreserve: 'a' }).keep.text).toBe('1 marker');
    expect(summaries({ excludeFiles: 'x\ny\nx' }).keep.text).toBe('2 patterns');
    expect(summaries({ inlinePreserve: 'a\nb', excludeFiles: 'x' }).keep.text).toBe(
      '2 markers · 1 pattern'
    );
  });

  it('carries the invalid stylesheet patterns, never the pairs', () => {
    expect(summaries({ excludeFiles: '(' }, { excludeLines: 1, pairs: 3 }).keep.problem).toBe(
      '1 invalid pattern'
    );
    expect(summaries({ excludeFiles: '(\n[' }, { excludeLines: 2, pairs: 0 }).keep.problem).toBe(
      '2 invalid patterns'
    );
  });
});

describe('rucssSectionSummaries — adjust the result', () => {
  it('is empty with no CSS and no replacement', () => {
    expect(summaries({}).adjust).toEqual({ text: EMPTY_SECTION_SUMMARY, problem: null });
    expect(summaries({ prepend: ' \n ', append: '\t' }).adjust.text).toBe(EMPTY_SECTION_SUMMARY);
  });

  it('names the added CSS and counts every replacement row', () => {
    expect(summaries({ prepend: 'a{}' }).adjust.text).toBe('CSS before');
    expect(summaries({ append: 'a{}' }).adjust.text).toBe('CSS after');
    expect(
      summaries({
        prepend: 'a{}',
        append: 'b{}',
        replacements: [
          { search: 'x', replacement: '' },
          { search: '', replacement: '' }
        ]
      }).adjust.text
    ).toBe('CSS before · CSS after · 2 replacements');
    expect(summaries({ replacements: [{ search: '', replacement: '' }] }).adjust.text).toBe(
      '1 replacement'
    );
  });

  it('carries the invalid replacement patterns, never the stylesheet ones', () => {
    expect(summaries({}, { excludeLines: 4, pairs: 0 }).adjust.problem).toBeNull();
    expect(summaries({}, { excludeLines: 0, pairs: 1 }).adjust.problem).toBe('1 invalid pattern');
  });
});

describe('initialRucssSectionsOpen', () => {
  it('opens only the request on default settings', () => {
    expect(initialRucssSectionsOpen(BASE)).toEqual({ request: true, keep: false, adjust: false });
  });

  it('treats whitespace-only fields as empty', () => {
    expect(
      initialRucssSectionsOpen({
        ...BASE,
        inlinePreserve: ' \n',
        excludeFiles: '\r\n',
        prepend: '  ',
        append: '\n'
      })
    ).toEqual({ request: true, keep: false, adjust: false });
  });

  it.each<[Partial<RucssTesterConfig>, 'keep' | 'adjust']>([
    [{ inlinePreserve: 'marker' }, 'keep'],
    [{ excludeFiles: 'theme' }, 'keep'],
    [{ prepend: 'a{}' }, 'adjust'],
    [{ append: 'a{}' }, 'adjust'],
    [{ replacements: [{ search: '', replacement: '' }] }, 'adjust']
  ])('opens a section holding %o', (patch, section) => {
    const open = initialRucssSectionsOpen({ ...BASE, ...patch });
    expect(open[section]).toBe(true);
    expect(open.request).toBe(true);
    expect(open[section === 'keep' ? 'adjust' : 'keep']).toBe(false);
  });

  it('keeps the request open whatever it holds', () => {
    expect(initialRucssSectionsOpen({ ...BASE, mobile: true, safelist: '' }).request).toBe(true);
  });
});
