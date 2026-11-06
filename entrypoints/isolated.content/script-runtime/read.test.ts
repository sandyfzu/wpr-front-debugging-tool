/**
 * The live script read: raw attribute values as written (no lowercasing —
 * the classifier owns case rules), SVG scripts included, the live state at
 * each read (a later read sees the runtime's rewrite), no write to any
 * script, the list cap with the page's total, strings capped at the
 * classifier's caps and the per-answer text budget marking what it cut;
 * only a bounded prefix of a script's text is ever trimmed, with results
 * identical to trimming the whole text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCRIPT_RUNTIME_LIMITS } from '../../../lib/messaging/script-runtime';
import { FIELD_MAX, FULL_TEXT_MAX, PREVIEW_MAX } from '../../../lib/script-runtime/classify';
import { capText } from '../../../utils/cap-text';
import { readLiveScripts, scriptFacts, trimmedPrefix } from './read';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

/** A script element built from attributes and text, appended to the body. */
function script(attributes: Record<string, string>, text = ''): HTMLScriptElement {
  const element = document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.textContent = text;
  document.body.append(element);
  return element;
}

describe('trimmedPrefix', () => {
  const samples = [
    '',
    '   ',
    ' \n\t\u00a0\ufeff\u2028 ',
    'abc',
    '  abc  ',
    `${' '.repeat(500)}abc${' '.repeat(500)}`,
    `abc${' '.repeat(500)}`,
    `abc${' '.repeat(500)}d`,
    'x'.repeat(30),
    ` ${'😀'.repeat(30)} `,
    `${'😀'.repeat(5)}\ud83d`,
    `a${'😀'.repeat(9)} b`,
    'a '.repeat(40)
  ];

  it.each([0, 1, 3, 10, 80])('caps exactly like trimming the whole text (cap %i)', (points) => {
    for (const raw of samples) {
      const prefix = trimmedPrefix(raw, points);
      expect(capText(prefix, points)).toBe(capText(raw.trim(), points));
      // Unchanged whole text ⇔ not cut, as the read's `textCut` reads it.
      expect(capText(prefix, points) !== prefix).toBe(capText(raw.trim(), points) !== raw.trim());
      expect(prefix.length).toBeLessThanOrEqual(Math.min(raw.length, 2 * points + 2));
    }
  });

  it('is the whole trimmed text when it fits', () => {
    expect(trimmedPrefix('  var a = 1;\n', 80)).toBe('var a = 1;');
    expect(trimmedPrefix(`abc${' '.repeat(500)}`, 3)).toBe('abc');
  });
});

describe('scriptFacts', () => {
  it('copies the raw attributes as written', () => {
    const element = script(
      {
        type: 'Text/RocketLazyLoadScript',
        'data-rocket-src': 'https://a.test/wp-content/themes/t/a.js',
        'data-rocket-status': 'failed-network',
        id: 'a-js',
        class: 'one two'
      },
      '  var a = 1;  '
    );
    expect(scriptFacts(element, FULL_TEXT_MAX)).toEqual({
      type: 'Text/RocketLazyLoadScript',
      delayedSrc: 'https://a.test/wp-content/themes/t/a.js',
      src: null,
      status: 'failed-network',
      id: 'a-js',
      classes: ['one', 'two'],
      text: 'var a = 1;',
      textCut: false
    });
  });

  it('caps attribute values at the classifier’s field cap', () => {
    const element = script({ src: `https://a.test/${'x'.repeat(FIELD_MAX)}` });
    expect(scriptFacts(element, FULL_TEXT_MAX).src).toHaveLength(FIELD_MAX + 1);
  });

  it('marks text cut by a budget below the full cap, never by the full cap itself', () => {
    const long = script({}, 'y'.repeat(FULL_TEXT_MAX + 10));
    expect(scriptFacts(long, FULL_TEXT_MAX)).toMatchObject({ textCut: false });
    expect(scriptFacts(long, FULL_TEXT_MAX).text).toHaveLength(FULL_TEXT_MAX + 1);
    const preview = scriptFacts(long, PREVIEW_MAX);
    expect(preview).toMatchObject({ textCut: true, text: `${'y'.repeat(PREVIEW_MAX)}…` });
    expect(scriptFacts(script({}, 'short'), PREVIEW_MAX).textCut).toBe(false);
  });

  it('never trims a large script’s whole text', () => {
    const large = script({}, `  ${'q'.repeat(4 * FULL_TEXT_MAX)}  `);
    const trims = [
      vi.spyOn(String.prototype, 'trim'),
      vi.spyOn(String.prototype, 'trimEnd'),
      vi.spyOn(String.prototype, 'trimStart')
    ];
    const facts = scriptFacts(large, PREVIEW_MAX);
    const longest = Math.max(
      0,
      ...trims.flatMap((spy) => spy.mock.contexts.map((self) => String(self).length))
    );
    for (const spy of trims) spy.mockRestore();
    expect(longest).toBeLessThanOrEqual(2 * PREVIEW_MAX + 2);
    expect(facts).toMatchObject({ text: `${'q'.repeat(PREVIEW_MAX)}…`, textCut: true });
  });

  it('reads an SVG script (no `text` property) by its text content', () => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'script');
    element.id = 's';
    element.append('var b = 2;');
    document.body.append(element);
    expect('text' in element).toBe(false);
    expect(scriptFacts(element, FULL_TEXT_MAX)).toMatchObject({ id: 's', text: 'var b = 2;' });
  });
});

describe('readLiveScripts', () => {
  it('reads the live DOM afresh each time, writing nothing', () => {
    const element = script({ type: 'rocketlazyloadscript', 'data-rocket-src': 'a.js' });
    const before = element.outerHTML;
    expect(readLiveScripts(document).scripts[0]).toMatchObject({ status: null, src: null });
    expect(element.outerHTML).toBe(before);
    expect(Object.keys(element)).toEqual([]);
    // The delay runtime ran the script: type restored, URL moved, status set.
    element.setAttribute('type', 'text/javascript');
    element.setAttribute('src', 'a.js');
    element.setAttribute('data-rocket-status', 'executed');
    expect(readLiveScripts(document).scripts[0]).toMatchObject({
      type: 'text/javascript',
      src: 'a.js',
      status: 'executed'
    });
  });

  it('lists head and body scripts in document order with the page total', () => {
    const head = document.createElement('script');
    head.id = 'head';
    document.head.append(head);
    script({ id: 'body' });
    expect(readLiveScripts(document)).toMatchObject({
      total: 2,
      scripts: [{ id: 'head' }, { id: 'body' }]
    });
  });

  it('lists at most the cap and still counts every script', () => {
    document.body.innerHTML = '<script></script>'.repeat(SCRIPT_RUNTIME_LIMITS.scripts + 3);
    const reply = readLiveScripts(document);
    expect(reply.scripts).toHaveLength(SCRIPT_RUNTIME_LIMITS.scripts);
    expect(reply.total).toBe(SCRIPT_RUNTIME_LIMITS.scripts + 3);
  });

  it('sends full texts while the budget lasts, previews after it', () => {
    const big = 'z'.repeat(FULL_TEXT_MAX);
    const fitting = Math.ceil(SCRIPT_RUNTIME_LIMITS.textBudgetUnits / FULL_TEXT_MAX);
    for (let index = 0; index < fitting + 1; index++) script({}, big);
    const { scripts } = readLiveScripts(document);
    expect(scripts.slice(0, fitting).every((entry) => entry.text === big)).toBe(true);
    expect(scripts[fitting]).toMatchObject({ textCut: true, text: `${'z'.repeat(PREVIEW_MAX)}…` });
  });
});
