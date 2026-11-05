/**
 * Beacon test configuration: WP Rocket's defaults (desktop + mobile), field
 * validators (thresholds, features, selectors — closed entries only, since
 * an entry the end of the text closes swallows its neighbours once joined),
 * the cross-bundle re-validation (fresh object, every issue reported,
 * hostile shapes refused, bounded before per-entry work) and the beacon
 * option mapping (selector list joined exactly as a list coerces for
 * `querySelectorAll`).
 */
import { describe, expect, it } from 'vitest';
import { isValidSelector } from '../../utils/css-selector';
import {
  BEACON_TEST_DEFAULTS,
  DEFAULT_CANDIDATE_SELECTORS,
  DEFAULT_SELECTOR_TEXT,
  checkBeaconDraft,
  DESKTOP_THRESHOLDS,
  MOBILE_THRESHOLDS,
  SELECTOR_COUNT_MAX,
  SELECTOR_LENGTH_MAX,
  THRESHOLD_MAX,
  deviceThresholds,
  isClosedSelector,
  joinSelectorList,
  readBeaconTestConfig,
  readFeatures,
  readThreshold,
  selectorIssues,
  toPackageOptions,
  type BeaconTestConfig,
  type BeaconTestDraft
} from './config';

/** The test DOM's selector parser. */
const valid = (selector: string): boolean => isValidSelector(document, selector);

/**
 * Real Chromium 156 parser verdicts (`querySelector` on a fragment, headless
 * Playwright probe): happy-dom refuses the entries a real engine closes at
 * the end of the text, so the swallowing cases need the real verdicts.
 */
const CHROMIUM_VERDICTS: Readonly<Record<string, boolean>> = {
  img: true,
  'img)': false,
  'img]': false,
  'a, b': true,
  'a, b)': false,
  'a, b]': false,
  ':is(img, video)': true,
  ':is(img, video))': false,
  ':is(img, video)]': false,
  'img\\)': true,
  'img\\))': false,
  'img\\)]': false,
  video: true,
  'video)': false,
  'video]': false,
  'img[alt="x': true,
  'img[alt="x)': true,
  'img[alt="x]': true,
  'img[alt="x,video': true,
  'img\\': true,
  'img\\]': true,
  'img\\,video': true,
  'img /*': true,
  'img /*)': true,
  'img /*]': true,
  'img /*,video': true,
  'div[x': true,
  'div[x)': false,
  'div[x]': true,
  'div[x,video': false,
  ':not(img': true,
  ':not(img)': true,
  ':not(img]': false,
  ':not(img,video': true,
  'img,video': true,
  'a, b,video': true,
  ':is(img, video),video': true,
  'img\\),video': true,
  'img,a, b,:is(img, video),img\\)': true
};

/**
 * Chromium's verdict for a probed string.
 *
 * @param selector A string the probe judged.
 * @returns Its verdict.
 * @throws {@link Error} For a string the probe never judged (the fixture must cover every call).
 */
function chromium(selector: string): boolean {
  const verdict = CHROMIUM_VERDICTS[selector];
  if (verdict === undefined) throw new Error(`No Chromium verdict for ${JSON.stringify(selector)}`);
  return verdict;
}

/** A runnable configuration with overrides. */
function config(overrides: Partial<Record<keyof BeaconTestConfig, unknown>> = {}): unknown {
  return {
    ...BEACON_TEST_DEFAULTS,
    features: { aboveTheFold: true, lazyRender: false },
    ...overrides
  };
}

describe('defaults', () => {
  it('are WP Rocket 3.24’s desktop beacon defaults, with no preselected feature', () => {
    expect(BEACON_TEST_DEFAULTS).toEqual({
      features: { aboveTheFold: false, lazyRender: false },
      mobile: false,
      widthThreshold: 1600,
      heightThreshold: 700,
      lazyRenderThreshold: 1800,
      selectors: [
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
      ]
    });
    expect(Object.isFrozen(BEACON_TEST_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(BEACON_TEST_DEFAULTS.features)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CANDIDATE_SELECTORS)).toBe(true);
  });

  it('switch to WP Rocket’s mobile thresholds with the mobile choice', () => {
    expect(deviceThresholds(true)).toEqual({ widthThreshold: 393, heightThreshold: 830 });
    expect(deviceThresholds(false)).toEqual({ widthThreshold: 1600, heightThreshold: 700 });
    expect(deviceThresholds(true)).toBe(MOBILE_THRESHOLDS);
    expect(deviceThresholds(false)).toBe(DESKTOP_THRESHOLDS);
    expect(Object.isFrozen(MOBILE_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(DESKTOP_THRESHOLDS)).toBe(true);
  });
});

describe('isClosedSelector', () => {
  it.each(['img', 'a, b', ':is(img, video)', 'img\\)', 'video'])(
    'accepts the closed entry %s (Chromium)',
    (selector) => {
      expect(isClosedSelector(selector, chromium)).toBe(true);
    }
  );

  it.each([
    ['an open string', 'img[alt="x'],
    ['a trailing escape', 'img\\'],
    ['an open comment', 'img /*'],
    ['an open attribute bracket', 'div[x'],
    ['an open function', ':not(img']
  ])('refuses %s the end of the text closes (Chromium)', (_label, selector) => {
    expect(chromium(selector)).toBe(true);
    expect(isClosedSelector(selector, chromium)).toBe(false);
  });

  it('accepts closed entries by the test DOM’s parser too', () => {
    for (const selector of ['img', 'a, b', 'div > p:not(.x)', '[data-x="a,b"]']) {
      expect(isClosedSelector(selector, valid)).toBe(true);
    }
  });

  it('refuses an entry that does not parse at all', () => {
    expect(isClosedSelector('div[', valid)).toBe(false);
  });
});

describe('joinSelectorList', () => {
  it('joins the entries with a comma, commas inside entries kept', () => {
    expect(joinSelectorList(['img', 'a, b'])).toBe('img,a, b');
    expect(joinSelectorList(['img'])).toBe('img');
  });
});

describe('readThreshold', () => {
  it.each([1, 700, THRESHOLD_MAX])('accepts the whole number %d', (value) => {
    expect(readThreshold(value)).toBe(value);
  });

  it.each([0, -1, 1.5, THRESHOLD_MAX + 1, Number.NaN, Infinity, '700', null, undefined])(
    'refuses %s',
    (value) => {
      expect(readThreshold(value)).toBeNull();
    }
  );
});

describe('readFeatures', () => {
  it.each([
    [true, false],
    [false, true],
    [true, true]
  ])('accepts aboveTheFold=%s lazyRender=%s', (aboveTheFold, lazyRender) => {
    expect(readFeatures({ aboveTheFold, lazyRender })).toEqual({ aboveTheFold, lazyRender });
  });

  it('refuses no feature, non-booleans, non-records and inherited flags', () => {
    expect(readFeatures({ aboveTheFold: false, lazyRender: false })).toBeNull();
    expect(readFeatures({ aboveTheFold: 1, lazyRender: false })).toBeNull();
    expect(readFeatures([true, true])).toBeNull();
    expect(readFeatures(null)).toBeNull();
    const inherited = Object.create({ aboveTheFold: true, lazyRender: true }) as object;
    expect(readFeatures(inherited)).toBeNull();
  });
});

describe('selectorIssues', () => {
  it('accepts valid selectors, compound lists included', () => {
    expect(selectorIssues(['img', 'a, b', 'div > p:not(.x)'], valid)).toEqual([]);
  });

  it('requires at least one selector', () => {
    expect(selectorIssues([], valid)).toEqual([{ kind: 'no-selector' }]);
  });

  it('caps the count, reporting it without checking each', () => {
    const many = Array.from({ length: SELECTOR_COUNT_MAX + 1 }, (_, i) => `.c${String(i)}`);
    expect(selectorIssues(many, () => false)).toEqual([
      { kind: 'too-many-selectors', count: SELECTOR_COUNT_MAX + 1 }
    ]);
    expect(selectorIssues(many.slice(1), valid)).toEqual([]);
  });

  it.each([
    // Each one parses alone in Chromium; joined, it swallows or breaks the next entry.
    ['img[alt="x', 'img[alt="x,video'],
    ['img\\', 'img\\,video'],
    ['img /*', 'img /*,video'],
    ['div[x', 'div[x,video']
  ])('refuses %s, which the end of the text closes (joined: %s)', (open) => {
    expect(selectorIssues([open, 'video'], chromium)).toEqual([
      { kind: 'selector-unclosed', selector: open }
    ]);
  });

  it('accepts closed entries whose joined list Chromium parses', () => {
    expect(selectorIssues(['img', 'a, b', ':is(img, video)', 'img\\)'], chromium)).toEqual([]);
  });

  it('validates the exact joined string the beacon receives', () => {
    const seen: string[] = [];
    const parserRefusingTheList = (selector: string): boolean => {
      seen.push(selector);
      return selector === 'img,video' ? false : valid(selector);
    };
    expect(selectorIssues(['img', 'video'], parserRefusingTheList)).toEqual([
      { kind: 'selector-list-invalid' }
    ]);
    expect(seen.at(-1)).toBe(joinSelectorList(['img', 'video']));
  });

  it('names each invalid or over-long selector, in order, echoing a bounded prefix', () => {
    const long = 'a'.repeat(SELECTOR_LENGTH_MAX + 1);
    const issues = selectorIssues(['img', 'div[', long, ':::'], valid);
    expect(issues).toEqual([
      { kind: 'selector-invalid', selector: 'div[' },
      { kind: 'selector-too-long', selector: `${'a'.repeat(80)}…` },
      { kind: 'selector-invalid', selector: ':::' }
    ]);
    expect(selectorIssues(['a'.repeat(SELECTOR_LENGTH_MAX)], valid)).toEqual([]);
  });
});

describe('readBeaconTestConfig', () => {
  it('returns a fresh frozen configuration, never the input object', () => {
    const input = config({ mobile: true, selectors: ['img'] }) as Record<string, unknown>;
    const check = readBeaconTestConfig(input, valid);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.config).toEqual({
      features: { aboveTheFold: true, lazyRender: false },
      mobile: true,
      widthThreshold: 1600,
      heightThreshold: 700,
      lazyRenderThreshold: 1800,
      selectors: ['img']
    });
    expect(check.config).not.toBe(input);
    expect(check.config.selectors).not.toBe(input.selectors);
    expect(Object.isFrozen(check.config)).toBe(true);
    expect(Object.isFrozen(check.config.selectors)).toBe(true);
  });

  it('switching back from mobile really runs desktop (no sticky mobile)', () => {
    const first = readBeaconTestConfig(config({ mobile: true }), valid);
    const second = readBeaconTestConfig(config({ mobile: false }), valid);
    expect(first.ok && first.config.mobile).toBe(true);
    expect(second.ok && second.config.mobile).toBe(false);
  });

  it('reports every issue at once', () => {
    const check = readBeaconTestConfig(
      config({
        features: { aboveTheFold: false, lazyRender: false },
        widthThreshold: 0,
        lazyRenderThreshold: 2.5,
        selectors: ['div[']
      }),
      valid
    );
    expect(check).toEqual({
      ok: false,
      issues: [
        { kind: 'no-feature' },
        { kind: 'threshold', field: 'widthThreshold' },
        { kind: 'threshold', field: 'lazyRenderThreshold' },
        { kind: 'selector-invalid', selector: 'div[' }
      ]
    });
  });

  it('skips selector checks when only lazy render runs (it reads no selector)', () => {
    const check = readBeaconTestConfig(
      config({ features: { aboveTheFold: false, lazyRender: true }, selectors: [] }),
      valid
    );
    expect(check.ok).toBe(true);
  });

  it('carries no selectors when only lazy render runs, whatever the list held', () => {
    for (const selectors of [['div['], Array.from({ length: SELECTOR_COUNT_MAX + 1 }, () => 1)]) {
      const check = readBeaconTestConfig(
        config({ features: { aboveTheFold: false, lazyRender: true }, selectors }),
        valid
      );
      expect(check.ok && check.config.selectors).toEqual([]);
    }
  });

  it('refuses an over-long list on its length alone, never reading its entries', () => {
    const entries = Array.from({ length: SELECTOR_COUNT_MAX + 1 }, () => 'img');
    const hostile = new Proxy(entries, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) throw new Error(`entry ${key} read`);
        return Reflect.get(target, key, receiver) as unknown;
      }
    });
    expect(readBeaconTestConfig(config({ selectors: hostile }), valid)).toEqual({
      ok: false,
      issues: [{ kind: 'too-many-selectors', count: SELECTOR_COUNT_MAX + 1 }]
    });
  });

  it('refuses a selector the end of the text closes (it would swallow its neighbours)', () => {
    expect(readBeaconTestConfig(config({ selectors: ['img[alt="x', 'video'] }), chromium)).toEqual({
      ok: false,
      issues: [{ kind: 'selector-unclosed', selector: 'img[alt="x' }]
    });
  });

  it.each([
    ['a non-record', null],
    ['an array', []],
    ['a non-boolean mobile', config({ mobile: 'yes' })],
    ['a non-array selector list', config({ selectors: 'img' })],
    ['a non-string selector', config({ selectors: ['img', 1] })],
    ['a non-record feature set', config({ features: true })]
  ])('refuses %s as malformed', (_label, value) => {
    expect(readBeaconTestConfig(value, valid)).toEqual({
      ok: false,
      issues: [{ kind: 'malformed' }]
    });
  });

  it('ignores inherited fields (prototype pollution supplies nothing)', () => {
    const polluted = Object.create(config() as object) as object;
    expect(readBeaconTestConfig(polluted, valid)).toEqual({
      ok: false,
      issues: [{ kind: 'malformed' }]
    });
  });
});

describe('toPackageOptions', () => {
  it('maps to fresh beacon options with the selectors as one list', () => {
    const check = readBeaconTestConfig(
      config({
        features: { aboveTheFold: true, lazyRender: true },
        mobile: true,
        widthThreshold: 400,
        heightThreshold: 900,
        lazyRenderThreshold: 1200,
        selectors: ['img', 'a, b']
      }),
      valid
    );
    if (!check.ok) throw new Error('expected a valid configuration');
    const options = toPackageOptions(check.config);
    expect(options).toEqual({
      is_mobile: true,
      elements: 'img,a, b',
      width_threshold: 400,
      height_threshold: 900,
      lrc_threshold: 1200,
      debug: true,
      status: { atf: true, lrc: true }
    });
    expect(toPackageOptions(check.config)).not.toBe(options);
  });

  it('selects exactly what a selector array coerces to in querySelectorAll', () => {
    document.body.innerHTML = '<img id="i"><p id="p"></p><span id="s"></span>';
    const selectors = ['img', 'p'];
    const joined = toPackageOptions({ ...BEACON_TEST_DEFAULTS, selectors }).elements;
    const coerced = document.querySelectorAll(String(selectors));
    expect([...document.querySelectorAll(joined)]).toEqual([...coerced]);
    expect([...coerced].map((element) => element.id)).toEqual(['i', 'p']);
  });
});

describe('checkBeaconDraft', () => {
  /** An above-the-fold draft with the given selector text. */
  function draft(selectorText: string, overrides: Partial<BeaconTestDraft> = {}): BeaconTestDraft {
    return {
      features: { aboveTheFold: true, lazyRender: false },
      mobile: BEACON_TEST_DEFAULTS.mobile,
      widthThreshold: BEACON_TEST_DEFAULTS.widthThreshold,
      heightThreshold: BEACON_TEST_DEFAULTS.heightThreshold,
      lazyRenderThreshold: BEACON_TEST_DEFAULTS.lazyRenderThreshold,
      selectorText,
      ...overrides
    };
  }

  /** The checked selectors, or the issues. */
  function selectorsOf(text: string, isValid = valid): unknown {
    const check = checkBeaconDraft(draft(text), isValid);
    return check.ok ? check.config.selectors : check.issues;
  }

  it('reads the default field text back as the default selectors', () => {
    expect(selectorsOf(DEFAULT_SELECTOR_TEXT)).toEqual(DEFAULT_CANDIDATE_SELECTORS);
  });

  it('trims lines and drops blank ones', () => {
    expect(selectorsOf('  img  \n\n   \n\tvideo\t\n')).toEqual(['img', 'video']);
  });

  it('splits on CRLF, lone CR and LF alike', () => {
    expect(selectorsOf('img\r\nvideo\rp\ndiv')).toEqual(['img', 'video', 'p', 'div']);
  });

  it('keeps the first of repeated entries, in typed order', () => {
    expect(selectorsOf('video\nimg\n video\nimg')).toEqual(['video', 'img']);
  });

  it('keeps a comma list on one line as one entry', () => {
    expect(selectorsOf('a, b\nimg')).toEqual(['a, b', 'img']);
  });

  it('reports no selector for empty or blank text when above-the-fold runs', () => {
    expect(selectorsOf('')).toEqual([{ kind: 'no-selector' }]);
    expect(selectorsOf(' \r\n \n')).toEqual([{ kind: 'no-selector' }]);
  });

  it('accepts empty text when only lazy render runs', () => {
    const check = checkBeaconDraft(
      draft('', { features: { aboveTheFold: false, lazyRender: true } }),
      valid
    );
    expect(check.ok && check.config.selectors).toEqual([]);
  });

  it('refuses a line the end of the text closes (Chromium verdicts)', () => {
    expect(selectorsOf('img[alt="x\nvideo', chromium)).toEqual([
      { kind: 'selector-unclosed', selector: 'img[alt="x' }
    ]);
    expect(selectorsOf('div[x\r\nvideo', chromium)).toEqual([
      { kind: 'selector-unclosed', selector: 'div[x' }
    ]);
  });

  it('carries the other fields through the same checks', () => {
    expect(checkBeaconDraft(draft('img', { widthThreshold: 0 }), valid)).toEqual({
      ok: false,
      issues: [{ kind: 'threshold', field: 'widthThreshold' }]
    });
  });
});
