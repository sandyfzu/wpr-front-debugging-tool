/** The pattern step: kept links, the built CSS and every failure, as plain data. */
import { describe, expect, it, vi } from 'vitest';
import { buildRucssResult, parseRucssBuildInput } from './build';
import { DEFAULT_RUCSS_TESTER_CONFIG, type RucssTesterConfig } from './config';

/** A configuration with overrides. */
function config(overrides: Partial<RucssTesterConfig> = {}): RucssTesterConfig {
  return { ...DEFAULT_RUCSS_TESTER_CONFIG, ...overrides };
}

describe('buildRucssResult', () => {
  it('keeps the links an exclusion pattern matches and builds the CSS', () => {
    const result = buildRucssResult({
      config: config({
        excludeFiles: 'fonts\\.css\n^https://cdn\\.',
        prepend: '/*p*/',
        append: '/*a*/',
        replacements: [{ search: 'red', replacement: 'blue' }]
      }),
      shakenCss: 'a{color:red}b{color:red}',
      links: ['https://a.test/fonts.css', 'https://a.test/x.css', '', 'https://cdn.test/y.css']
    });
    expect(result).toEqual({
      ok: true,
      css: '/*p*/a{color:blue}b{color:blue}/*a*/',
      applied: [{ index: 0, count: 2 }],
      keepLinks: [0, 3]
    });
  });

  it('keeps nothing and passes the CSS through without patterns', () => {
    expect(buildRucssResult({ config: config(), shakenCss: 'a{}', links: ['u'] })).toEqual({
      ok: true,
      css: 'a{}',
      applied: [],
      keepLinks: []
    });
  });

  it('answers the CSS build failure as-is', () => {
    const result = buildRucssResult({
      config: config({ replacements: [{ search: 'a', replacement: 'x'.repeat(5_000) }] }),
      shakenCss: 'a'.repeat(5_000),
      links: []
    });
    expect(result).toEqual({ ok: false, problem: 'oversize', index: 0 });
  });

  it('stops at the first link an exclusion pattern fails on, naming the line', () => {
    const throwing = vi.spyOn(RegExp.prototype, 'test').mockImplementation(function (
      this: RegExp,
      href: string
    ) {
      if (this.source === 'bad' && href.endsWith('2.css')) throw new RangeError('overflow');
      return false;
    });
    try {
      expect(
        buildRucssResult({
          config: config({ excludeFiles: 'ok\nbad' }),
          shakenCss: 'a{}',
          links: ['https://a.test/1.css', 'https://a.test/2.css']
        })
      ).toEqual({ ok: false, problem: 'exclusion-failed', line: 'bad', message: 'overflow' });
    } finally {
      throwing.mockRestore();
    }
  });

  it('refuses a configuration whose patterns do not compile', () => {
    expect(
      buildRucssResult({ config: config({ excludeFiles: '(' }), shakenCss: '', links: [] })
    ).toEqual({ ok: false, problem: 'invalid-config' });
  });
});

describe('parseRucssBuildInput', () => {
  it('reads the configuration tolerantly and keeps the CSS and links', () => {
    const parsed = parseRucssBuildInput({
      config: { ...config({ mobile: true }), junk: 1 },
      shakenCss: 'a{}',
      links: ['u']
    });
    expect(parsed).toEqual({ config: config({ mobile: true }), shakenCss: 'a{}', links: ['u'] });
  });

  it('refuses hostile shapes', () => {
    for (const input of [
      null,
      { config: config(), shakenCss: 1, links: [] },
      { config: config(), shakenCss: '', links: 'u' },
      { config: config(), shakenCss: '', links: [1] },
      { config: config(), shakenCss: '', links: [], extra: 1 }
    ]) {
      expect(parseRucssBuildInput(input)).toBeNull();
    }
  });
});
