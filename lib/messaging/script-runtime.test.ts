/**
 * The live script read's guard: every script is rebuilt exactly (nullable
 * attributes, capped strings measured as `capText` can produce them,
 * bounded classes), the list is capped and the total cannot undercount it.
 */
import { describe, expect, it } from 'vitest';
import { capText } from '../../utils/cap-text';
import { CLASSES_MAX, FIELD_MAX, FULL_TEXT_MAX } from '../script-runtime/classify';
import {
  SCRIPT_RUNTIME_LIMITS,
  parseScriptRuntimeReply,
  type LiveScriptFacts
} from './script-runtime';

/** A delayed external script. */
const SCRIPT: LiveScriptFacts = {
  type: 'rocketlazyloadscript',
  delayedSrc: 'https://a.test/wp-content/plugins/x/a.js',
  src: null,
  status: null,
  id: 'a-js',
  classes: ['one'],
  text: '',
  textCut: false
};

describe('parseScriptRuntimeReply', () => {
  it('rebuilds a reply', () => {
    const reply = {
      scripts: [SCRIPT, { ...SCRIPT, type: null, delayedSrc: null, src: '' }],
      total: 5
    };
    expect(parseScriptRuntimeReply(reply)).toEqual(reply);
  });

  it('accepts strings capped at the classifier’s caps, astral characters included', () => {
    const field = capText('😀'.repeat(FIELD_MAX + 1), FIELD_MAX);
    const text = capText('😀'.repeat(FULL_TEXT_MAX + 1), FULL_TEXT_MAX);
    const script = { ...SCRIPT, type: field, id: field, classes: [field], text };
    expect(parseScriptRuntimeReply({ scripts: [script], total: 1 })).not.toBeNull();
  });

  it('accepts the list cap and refuses one past it', () => {
    const at = Array<LiveScriptFacts>(SCRIPT_RUNTIME_LIMITS.scripts).fill(SCRIPT);
    expect(parseScriptRuntimeReply({ scripts: at, total: 4000 })).not.toBeNull();
    expect(parseScriptRuntimeReply({ scripts: [...at, SCRIPT], total: 4000 })).toBeNull();
  });

  it.each([
    ['a non-record', []],
    ['an extra key', { scripts: [], total: 0, x: 1 }],
    ['scripts not a list', { scripts: {}, total: 0 }],
    ['a total below the list', { scripts: [SCRIPT], total: 0 }],
    ['a fractional total', { scripts: [], total: 0.5 }],
    ['a script with an extra key', { scripts: [{ ...SCRIPT, outerHTML: '<script>' }], total: 1 }],
    ['a non-string type', { scripts: [{ ...SCRIPT, type: 1 }], total: 1 }],
    [
      'an over-long src',
      { scripts: [{ ...SCRIPT, src: 's'.repeat(2 * FIELD_MAX + 2) }], total: 1 }
    ],
    ['a non-string status', { scripts: [{ ...SCRIPT, status: true }], total: 1 }],
    [
      'an over-long delayed src',
      { scripts: [{ ...SCRIPT, delayedSrc: 's'.repeat(2 * FIELD_MAX + 2) }], total: 1 }
    ],
    ['a null id', { scripts: [{ ...SCRIPT, id: null }], total: 1 }],
    ['an over-long id', { scripts: [{ ...SCRIPT, id: 'i'.repeat(2 * FIELD_MAX + 2) }], total: 1 }],
    ['a non-boolean text cut', { scripts: [{ ...SCRIPT, textCut: 'no' }], total: 1 }],
    ['a null text', { scripts: [{ ...SCRIPT, text: null }], total: 1 }],
    [
      'an over-long text',
      { scripts: [{ ...SCRIPT, text: 't'.repeat(2 * FULL_TEXT_MAX + 2) }], total: 1 }
    ],
    ['classes not a list', { scripts: [{ ...SCRIPT, classes: 'one' }], total: 1 }],
    [
      'too many classes',
      { scripts: [{ ...SCRIPT, classes: Array(CLASSES_MAX + 1).fill('c') }], total: 1 }
    ],
    ['a non-string class', { scripts: [{ ...SCRIPT, classes: [1] }], total: 1 }]
  ])('refuses %s', (_label, input) => {
    expect(parseScriptRuntimeReply(input)).toBeNull();
  });
});
