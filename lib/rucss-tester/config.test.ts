/** The tester configuration's two readers: tolerant per-field parse and the strict writer gate. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUCSS_TESTER_CONFIG,
  RUCSS_CONFIG_BYTE_BUDGET,
  RUCSS_CONFIG_LIMITS,
  findRucssTesterConfigProblem,
  parseRucssTesterConfig,
  type RucssTesterConfig
} from './config';

/** A fully populated valid configuration. */
const FULL: RucssTesterConfig = {
  safelist: '.keep\n#also',
  inlinePreserve: 'my-inline',
  excludeFiles: 'theme\\.css',
  prepend: 'body{margin:0}',
  append: 'p{color:red}',
  replacements: [
    { search: 'a', replacement: 'b' },
    { search: 'c', replacement: '' }
  ],
  mobile: true,
  home: false
};

describe('DEFAULT_RUCSS_TESTER_CONFIG', () => {
  it('is empty text, no pairs, both flags off, and frozen', () => {
    expect(DEFAULT_RUCSS_TESTER_CONFIG).toEqual({
      safelist: '',
      inlinePreserve: '',
      excludeFiles: '',
      prepend: '',
      append: '',
      replacements: [],
      mobile: false,
      home: false
    });
    expect(Object.isFrozen(DEFAULT_RUCSS_TESTER_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RUCSS_TESTER_CONFIG.replacements)).toBe(true);
  });

  it('passes the strict gate', () => {
    expect(findRucssTesterConfigProblem(DEFAULT_RUCSS_TESTER_CONFIG)).toBeNull();
  });
});

describe('parseRucssTesterConfig', () => {
  it('round-trips a valid configuration as a fresh copy', () => {
    const parsed = parseRucssTesterConfig(FULL);
    expect(parsed).toEqual(FULL);
    expect(parsed).not.toBe(FULL);
    expect(parsed.replacements[0]).not.toBe(FULL.replacements[0]);
  });

  it('reads non-objects as the defaults', () => {
    for (const junk of [undefined, null, 0, 'x', true, [], [FULL]]) {
      expect(parseRucssTesterConfig(junk)).toEqual(DEFAULT_RUCSS_TESTER_CONFIG);
    }
  });

  it('defaults each junk field alone, keeping the valid ones', () => {
    const parsed = parseRucssTesterConfig({
      ...FULL,
      safelist: 42,
      prepend: null,
      mobile: 'yes',
      home: 1,
      replacements: 'nope'
    });
    expect(parsed).toEqual({
      ...FULL,
      safelist: '',
      prepend: '',
      mobile: false,
      home: false,
      replacements: []
    });
  });

  it('defaults over-cap text and keeps text exactly at the cap', () => {
    const atCap = 'x'.repeat(RUCSS_CONFIG_LIMITS.listChars);
    expect(parseRucssTesterConfig({ ...FULL, safelist: atCap }).safelist).toBe(atCap);
    expect(parseRucssTesterConfig({ ...FULL, safelist: `${atCap}x` }).safelist).toBe('');
    const cssOver = 'x'.repeat(RUCSS_CONFIG_LIMITS.cssChars + 1);
    expect(parseRucssTesterConfig({ ...FULL, append: cssOver }).append).toBe('');
  });

  it('drops invalid pairs, ignores extra pair keys, keeps the first ones up to the cap', () => {
    const many = Array.from({ length: RUCSS_CONFIG_LIMITS.replacements + 5 }, (_, i) => ({
      search: `s${String(i)}`,
      replacement: 'r'
    }));
    const parsed = parseRucssTesterConfig({
      ...FULL,
      replacements: [
        null,
        { search: 'x' },
        { search: 1, replacement: 'y' },
        { search: 'q'.repeat(RUCSS_CONFIG_LIMITS.searchChars + 1), replacement: '' },
        { search: '', replacement: 'r'.repeat(RUCSS_CONFIG_LIMITS.replacementChars + 1) },
        { search: 'ok', replacement: 'fine', extra: true },
        ...many
      ]
    });
    expect(parsed.replacements).toHaveLength(RUCSS_CONFIG_LIMITS.replacements);
    expect(parsed.replacements[0]).toEqual({ search: 'ok', replacement: 'fine' });
    expect(parsed.replacements[1]).toEqual({ search: 's0', replacement: 'r' });
  });

  it('drops unknown keys and never reads inherited or prototype-planted fields', () => {
    const planted = JSON.parse(
      '{"__proto__": {"mobile": true, "safelist": "evil"}, "constructor": "x", "extra": 1}'
    ) as unknown;
    expect(parseRucssTesterConfig(planted)).toEqual(DEFAULT_RUCSS_TESTER_CONFIG);

    const inherited = Object.create({ home: true, safelist: 'evil' }) as object;
    expect(parseRucssTesterConfig(inherited)).toEqual(DEFAULT_RUCSS_TESTER_CONFIG);

    const parsed = parseRucssTesterConfig({ ...FULL, extra: 'gone' });
    expect(parsed).not.toHaveProperty('extra');
  });

  it('skips holes in a sparse pair array', () => {
    const sparse = [, { search: 'a', replacement: 'b' }];
    expect(parseRucssTesterConfig({ ...FULL, replacements: sparse }).replacements).toEqual([
      { search: 'a', replacement: 'b' }
    ]);
  });
});

describe('findRucssTesterConfigProblem', () => {
  it('accepts a valid configuration', () => {
    expect(findRucssTesterConfigProblem(FULL)).toBeNull();
  });

  it('refuses non-objects', () => {
    for (const junk of [null, [], 'x']) {
      expect(findRucssTesterConfigProblem(junk)).toBe('the configuration is not an object');
    }
  });

  it('names unknown fields', () => {
    expect(findRucssTesterConfigProblem({ ...FULL, extra: 1, other: 2 })).toBe(
      'unknown field(s): extra, other'
    );
  });

  it('names a missing, mistyped or over-cap text field', () => {
    const missing: Record<string, unknown> = { ...FULL };
    Reflect.deleteProperty(missing, 'safelist');
    expect(findRucssTesterConfigProblem(missing)).toMatch(/^safelist must be a string/);
    expect(findRucssTesterConfigProblem({ ...FULL, excludeFiles: 3 })).toMatch(/^excludeFiles/);
    expect(
      findRucssTesterConfigProblem({
        ...FULL,
        prepend: 'x'.repeat(RUCSS_CONFIG_LIMITS.cssChars + 1)
      })
    ).toBe(
      `prepend must be a string of at most ${String(RUCSS_CONFIG_LIMITS.cssChars)} characters`
    );
  });

  it('names a non-boolean flag', () => {
    expect(findRucssTesterConfigProblem({ ...FULL, home: 'true' })).toBe('home must be a boolean');
  });

  it('refuses a non-array or over-long pair list', () => {
    expect(findRucssTesterConfigProblem({ ...FULL, replacements: {} })).toMatch(
      /^replacements must be an array/
    );
    const tooMany = Array.from({ length: RUCSS_CONFIG_LIMITS.replacements + 1 }, () => ({
      search: 'a',
      replacement: 'b'
    }));
    expect(findRucssTesterConfigProblem({ ...FULL, replacements: tooMany })).toMatch(
      /^replacements must be an array/
    );
  });

  it('names the first bad pair (wrong type, over cap, extra key, hole)', () => {
    const ok = { search: 'a', replacement: 'b' };
    for (const bad of [
      null,
      { search: 'a' },
      { search: 'a', replacement: 1 },
      { search: 'a', replacement: 'b', extra: 1 },
      { search: 'q'.repeat(RUCSS_CONFIG_LIMITS.searchChars + 1), replacement: 'b' }
    ]) {
      expect(findRucssTesterConfigProblem({ ...FULL, replacements: [ok, bad] })).toBe(
        'replacements[1] must be { search, replacement } strings within their caps'
      );
    }
    expect(findRucssTesterConfigProblem({ ...FULL, replacements: [, ok] })).toMatch(
      /^replacements\[0\]/
    );
  });

  it('accepts every field at its cap in plain ASCII (the budget never bites typed text)', () => {
    const L = RUCSS_CONFIG_LIMITS;
    const maxed: RucssTesterConfig = {
      safelist: 'a'.repeat(L.listChars),
      inlinePreserve: 'a'.repeat(L.listChars),
      excludeFiles: 'a'.repeat(L.listChars),
      prepend: 'a'.repeat(L.cssChars),
      append: 'a'.repeat(L.cssChars),
      replacements: Array.from({ length: L.replacements }, () => ({
        search: 'a'.repeat(L.searchChars),
        replacement: 'a'.repeat(L.replacementChars)
      })),
      mobile: true,
      home: true
    };
    expect(findRucssTesterConfigProblem(maxed)).toBeNull();
  });

  it('refuses a config whose stored JSON passes the byte budget, naming the size', () => {
    // Within every field cap, but each control character escapes to 6 JSON bytes.
    const escaped = '\u0001'.repeat(RUCSS_CONFIG_LIMITS.cssChars);
    const over = { ...FULL, prepend: escaped, append: escaped };
    const bytes = new TextEncoder().encode(JSON.stringify(over)).length;
    expect(bytes).toBeGreaterThan(RUCSS_CONFIG_BYTE_BUDGET);
    expect(findRucssTesterConfigProblem(over)).toBe(
      `the configuration takes ${String(bytes)} bytes as stored JSON, over the 1048576-byte budget`
    );
    // Multi-byte UTF-8 counts by bytes, not characters: 3 bytes per CJK character.
    const cjk = '\u6587'.repeat(RUCSS_CONFIG_LIMITS.cssChars);
    expect(findRucssTesterConfigProblem({ ...FULL, prepend: cjk, append: cjk })).toBeNull();
    const cjkList = '\u6587'.repeat(RUCSS_CONFIG_LIMITS.listChars);
    expect(
      findRucssTesterConfigProblem({
        ...FULL,
        prepend: cjk,
        append: cjk,
        safelist: cjkList,
        inlinePreserve: cjkList,
        excludeFiles: cjkList
      })
    ).toMatch(/over the 1048576-byte budget$/);
  });
});
