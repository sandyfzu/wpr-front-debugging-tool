/**
 * Script runtime classification: every Delay JS state WP Rocket's runtime
 * writes (and an unknown one kept raw), both delay types, a replaced element
 * known only by its status, source precedence, case-insensitive theme/plugin
 * groups, inline and base64-converted inline, Other and JSON-LD kept, and
 * bounded, frozen output.
 */
import { describe, expect, it } from 'vitest';
import {
  CLASSES_MAX,
  FIELD_MAX,
  FULL_TEXT_MAX,
  classifyScript,
  isDelayed,
  isStructuredData,
  runtimeState,
  sourceGroup,
  sourceKind,
  sourceUrl,
  type ScriptDescriptor
} from './classify';

/** A plain, undelayed external script with overrides. */
function script(overrides: Partial<ScriptDescriptor> = {}): ScriptDescriptor {
  return {
    type: null,
    status: null,
    delayedSrc: null,
    src: null,
    id: '',
    classes: [],
    text: '',
    ...overrides
  };
}

describe('runtimeState', () => {
  it.each([
    ['executed', 'executed'],
    ['failed-network', 'failed'],
    ['failed-transform', 'failed'],
    ['failed-something-new', 'failed'],
    ['skipped', 'skipped'],
    ['loading', 'unknown'],
    ['', 'unknown'],
    ['toString', 'unknown'],
    ['EXECUTED', 'unknown']
  ])('maps status %j to %s', (status, state) => {
    expect(runtimeState({ type: 'text/rocketlazyloadscript', status })).toBe(state);
  });

  it.each(['text/rocketlazyloadscript', 'rocketlazyloadscript', 'Text/RocketLazyLoadScript'])(
    'reads a %s script without a status as pending',
    (type) => {
      expect(runtimeState({ type, status: null })).toBe('pending');
    }
  );

  it('reads a script without delay type or status as not delayed', () => {
    expect(runtimeState({ type: 'module', status: null })).toBe('not-delayed');
    expect(runtimeState({ type: null, status: null })).toBe('not-delayed');
  });

  it('treats a replaced element (original type restored, status kept) as delayed', () => {
    expect(isDelayed({ type: 'module', status: 'executed' })).toBe(true);
    expect(runtimeState({ type: 'module', status: 'executed' })).toBe('executed');
  });

  it('uses one delayed-type rule for the state and the URL (suffix, like the runtime)', () => {
    const tag = { type: 'text/rocketlazyloadscript-x', status: null };
    expect(runtimeState(tag)).toBe('not-delayed');
    expect(
      sourceUrl({ ...tag, delayedSrc: 'https://e.test/d.js', src: 'https://e.test/s.js' })
    ).toBe('https://e.test/s.js');
  });
});

describe('sourceUrl', () => {
  const DELAYED = 'text/rocketlazyloadscript';

  it('takes a delayed tag’s non-empty delayed URL over src', () => {
    expect(
      sourceUrl({ type: DELAYED, delayedSrc: 'https://e.test/d.js', src: 'https://e.test/s.js' })
    ).toBe('https://e.test/d.js');
    expect(
      sourceUrl({ type: 'ROCKETLAZYLOADSCRIPT', delayedSrc: 'https://e.test/d.js', src: null })
    ).toBe('https://e.test/d.js');
  });

  it('falls back to src for an empty delayed URL (never reads as inline)', () => {
    expect(sourceUrl({ type: DELAYED, delayedSrc: '', src: 'https://e.test/s.js' })).toBe(
      'https://e.test/s.js'
    );
  });

  it('ignores a delayed URL on a tag the runtime never loads from it', () => {
    expect(
      sourceUrl({ type: 'module', delayedSrc: 'https://e.test/d.js', src: 'https://e.test/s.js' })
    ).toBe('https://e.test/s.js');
    expect(sourceUrl({ type: null, delayedSrc: 'https://e.test/d.js', src: null })).toBe('');
  });

  it('is empty when the script names no URL', () => {
    expect(sourceUrl({ type: null, delayedSrc: null, src: 'https://e.test/s.js' })).toBe(
      'https://e.test/s.js'
    );
    expect(sourceUrl({ type: DELAYED, delayedSrc: '', src: null })).toBe('');
    expect(sourceUrl({ type: null, delayedSrc: null, src: null })).toBe('');
  });
});

describe('sourceKind and sourceGroup', () => {
  it('reads no URL as inline, a converted base64 URL as converted inline', () => {
    expect(sourceKind('')).toBe('inline');
    expect(sourceKind('data:text/javascript;base64,YWxlcnQoMSk=')).toBe('converted-inline');
    expect(sourceKind('data:text/javascript,alert(1)')).toBe('url');
  });

  it.each([
    ['https://e.test/wp-content/themes/astra/main.js', 'theme'],
    ['https://e.test/wp-content/THEMES/astra/main.js', 'theme'],
    ['https://e.test/wp-content/plugins/woo/cart.js', 'plugin'],
    ['https://e.test/wp-content/Plugins/woo/cart.js', 'plugin'],
    ['https://e.test/wp-content/plugins/themes-addon/a.js', 'plugin'],
    ['https://e.test/wp-content/themes/t/plugins/a.js', 'theme'],
    ['https://e.test/wp-includes/js/jquery/jquery.min.js', 'other'],
    ['https://cdn.example/lib.js', 'other'],
    ['data:text/javascript,alert(1)', 'other']
  ])('groups %s as %s', (url, group) => {
    expect(sourceGroup(url, 'url')).toBe(group);
  });

  it('groups inline and converted inline as inline whatever the text', () => {
    expect(sourceGroup('', 'inline')).toBe('inline');
    expect(sourceGroup('data:text/javascript;base64,dGhlbWVz', 'converted-inline')).toBe('inline');
  });
});

describe('isStructuredData', () => {
  it('recognizes JSON-LD in any case and padding only', () => {
    expect(isStructuredData('application/ld+json')).toBe(true);
    expect(isStructuredData(' Application/LD+JSON ')).toBe(true);
    expect(isStructuredData('application/json')).toBe(false);
    expect(isStructuredData(null)).toBe(false);
  });
});

describe('classifyScript', () => {
  it('classifies a pending delayed plugin script', () => {
    expect(
      classifyScript(
        script({
          type: 'text/rocketlazyloadscript',
          delayedSrc: 'https://e.test/wp-content/plugins/p/a.js',
          id: 'p-js',
          classes: ['x', 'y']
        })
      )
    ).toEqual({
      state: 'pending',
      rawStatus: null,
      group: 'plugin',
      structuredData: false,
      sourceKind: 'url',
      source: 'https://e.test/wp-content/plugins/p/a.js',
      id: 'p-js',
      classes: ['x', 'y'],
      preview: '',
      fullText: ''
    });
  });

  it('classifies an executed converted inline script without keeping the data URL', () => {
    const record = classifyScript(
      script({
        type: 'text/rocketlazyloadscript',
        status: 'executed',
        src: 'data:text/javascript;base64,Y29uc29sZS5sb2coMSk=',
        text: '  console.log(1)  '
      })
    );
    expect(record).toMatchObject({
      state: 'executed',
      rawStatus: 'executed',
      group: 'inline',
      sourceKind: 'converted-inline',
      source: '',
      preview: 'console.log(1)',
      fullText: 'console.log(1)'
    });
  });

  it('reads an empty delayed URL with a real src as that URL, not as inline', () => {
    expect(
      classifyScript(
        script({
          type: 'text/rocketlazyloadscript',
          delayedSrc: '',
          src: 'https://e.test/wp-content/themes/t/a.js'
        })
      )
    ).toMatchObject({
      group: 'theme',
      sourceKind: 'url',
      source: 'https://e.test/wp-content/themes/t/a.js'
    });
  });

  it('keeps an unknown status raw and a failure detail raw', () => {
    expect(classifyScript(script({ status: 'loading' }))).toMatchObject({
      state: 'unknown',
      rawStatus: 'loading'
    });
    expect(classifyScript(script({ status: 'failed-network' }))).toMatchObject({
      state: 'failed',
      rawStatus: 'failed-network'
    });
  });

  it('keeps structured data and Other scripts (nothing is dropped)', () => {
    expect(
      classifyScript(script({ type: 'application/ld+json', text: '{"@type":"Organization"}' }))
    ).toMatchObject({ state: 'not-delayed', group: 'inline', structuredData: true });
    expect(classifyScript(script({ src: 'https://cdn.example/lib.js' }))).toMatchObject({
      group: 'other',
      sourceKind: 'url'
    });
  });

  it('previews 80 code points of the trimmed text and keeps the full text bounded', () => {
    const text = `\n ${'😀'.repeat(81)} \n`;
    const record = classifyScript(script({ text }));
    expect(record.preview).toBe(`${'😀'.repeat(80)}…`);
    expect(record.fullText).toBe('😀'.repeat(81));
    const huge = classifyScript(script({ text: 'a'.repeat(FULL_TEXT_MAX + 1) }));
    expect(huge.fullText).toBe(`${'a'.repeat(FULL_TEXT_MAX)}…`);
    expect(classifyScript(script({ text: 'short' })).preview).toBe('short');
  });

  it('bounds the URL, id, status and classes, and freezes the record', () => {
    const long = 'x'.repeat(FIELD_MAX + 1);
    const record = classifyScript(
      script({
        src: `https://e.test/${long}`,
        id: long,
        status: long,
        classes: Array.from({ length: CLASSES_MAX + 1 }, () => long)
      })
    );
    expect(record.source).toHaveLength(FIELD_MAX + 1);
    expect(record.id).toHaveLength(FIELD_MAX + 1);
    expect(record.rawStatus).toHaveLength(FIELD_MAX + 1);
    expect(record.classes).toHaveLength(CLASSES_MAX);
    expect(record.classes[0]).toHaveLength(FIELD_MAX + 1);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.classes)).toBe(true);
  });
});
