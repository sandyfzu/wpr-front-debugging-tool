/**
 * The option-name maps are treated as data with a contract: every key in the
 * committed JSON maps to a non-empty label (breaking that would surface raw
 * ids or empty strings in the panel), and lookups exist for all ids the
 * engine can produce.
 */
import { describe, expect, it } from 'vitest';
import optionNames from './option-names.json' with { type: 'json' };
import otherNames from './other-names.json' with { type: 'json' };
import { FEATURE_OPTION_LABELS, getRealOptionName, knownOptionIds } from './get-real-option-name';
import {
  LABEL_DNS_PREFETCH,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_MINIFY_CSS,
  LABEL_MOBILE_CACHE
} from '../detection/labels';

describe('option name maps', () => {
  it('maps every key to a non-empty string', () => {
    for (const [key, label] of Object.entries({ ...optionNames, ...otherNames })) {
      expect(typeof label, `option "${key}"`).toBe('string');
      expect(label.trim().length, `option "${key}"`).toBeGreaterThan(0);
    }
  });

  it('carries the expected set sizes (24 non-feature options + 3 labels + 19 feature ids)', () => {
    expect(Object.keys(optionNames).length).toBe(24);
    expect(Object.keys(otherNames).length).toBe(3);
    expect(Object.keys(FEATURE_OPTION_LABELS).length).toBe(19);
  });

  it('names feature options only through the feature labels (one declaring site)', () => {
    for (const id of Object.keys(FEATURE_OPTION_LABELS)) {
      expect(id in optionNames || id in otherNames, `${id} re-typed in the JSON`).toBe(false);
    }
    expect(getRealOptionName('lazyload')).toBe(LABEL_IMAGE_LAZYLOAD);
    expect(getRealOptionName('minify_css')).toBe(LABEL_MINIFY_CSS);
    expect(getRealOptionName('do_caching_mobile_files')).toBe(LABEL_MOBILE_CACHE);
    // The hidden domains option is the DNS prefetch feature itself.
    expect(getRealOptionName('dns_prefetch')).toBe(LABEL_DNS_PREFETCH);
    // Its sibling option (writing mobile files at all) keeps the plain JSON name.
    expect(getRealOptionName('cache_mobile')).toBe('Enable caching for mobile devices');
    // A sub-option keeps its own plugin wording.
    expect(getRealOptionName('lazyload_youtube')).toBe('Replace YouTube iframe with preview image');
  });

  it('resolves known ids and falls back to the raw id otherwise', () => {
    expect(getRealOptionName('delay_js')).toBe('Delay JavaScript execution');
    expect(getRealOptionName('rocket_cdn')).toBe('Content Delivery Network');
    expect(getRealOptionName('minify_concatenate_js')).toBe('Combine JavaScript files');
    expect(getRealOptionName('not_an_option_at_all')).toBe('not_an_option_at_all');
  });

  it('enumerates all mapped ids, without duplicates', () => {
    const ids = knownOptionIds();
    expect(ids.length).toBe(
      Object.keys(optionNames).length +
        Object.keys(otherNames).length +
        Object.keys(FEATURE_OPTION_LABELS).length
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
