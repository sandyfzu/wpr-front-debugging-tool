/**
 * The beacon test contract's guards: the request's configuration shape is
 * rebuilt exactly (bounds, feature choice, thresholds), and the reply guard
 * validates every arm — raw results through the results validator, a
 * timed-out run's partial results nullable — refusing anything else.
 */
import { describe, expect, it } from 'vitest';
import {
  BEACON_TEST_DEFAULTS,
  SELECTOR_COUNT_MAX,
  SELECTOR_LENGTH_MAX,
  THRESHOLD_MAX
} from '../beacon-test/config';
import { RESULT_RECORDS_MAX } from '../beacon-test/results';
import { parseBeaconTestReply, parseBeaconTestRequest, readBeaconConfigShape } from './beacon-test';

/** A runnable configuration (above-the-fold on). */
const CONFIG = {
  ...BEACON_TEST_DEFAULTS,
  features: { aboveTheFold: true, lazyRender: false },
  selectors: ['img', 'div']
};

/** One raw above-the-fold record as the beacon reports it. */
const RECORD = { type: 'img', label: 'hero', src: 'https://a.test/h.jpg' };

describe('readBeaconConfigShape', () => {
  it('rebuilds a valid configuration, frozen and detached from the input', () => {
    const input = { ...CONFIG, selectors: [...CONFIG.selectors] };
    const config = readBeaconConfigShape(input);
    expect(config).toEqual(CONFIG);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config?.selectors)).toBe(true);
    input.selectors.push('p');
    expect(config?.selectors).toEqual(['img', 'div']);
  });

  it('accepts an empty selector list (the runner checks it against the feature choice)', () => {
    expect(readBeaconConfigShape({ ...CONFIG, selectors: [] })?.selectors).toEqual([]);
  });

  it.each([
    ['a non-record', 'config'],
    ['null', null],
    ['an unknown key', { ...CONFIG, extra: 1 }],
    ['no feature on', { ...CONFIG, features: { aboveTheFold: false, lazyRender: false } }],
    ['a non-boolean feature', { ...CONFIG, features: { aboveTheFold: 1, lazyRender: false } }],
    ['a non-boolean mobile', { ...CONFIG, mobile: 'yes' }],
    ['a zero threshold', { ...CONFIG, widthThreshold: 0 }],
    ['a fractional threshold', { ...CONFIG, heightThreshold: 1.5 }],
    ['a threshold past the cap', { ...CONFIG, lazyRenderThreshold: THRESHOLD_MAX + 1 }],
    ['a missing threshold', { ...CONFIG, lazyRenderThreshold: undefined }],
    ['selectors not a list', { ...CONFIG, selectors: 'img' }],
    ['a non-string selector', { ...CONFIG, selectors: ['img', 3] }],
    ['an over-long selector', { ...CONFIG, selectors: ['a'.repeat(SELECTOR_LENGTH_MAX + 1)] }],
    ['too many selectors', { ...CONFIG, selectors: Array(SELECTOR_COUNT_MAX + 1).fill('img') }]
  ])('refuses %s', (_label, input) => {
    expect(readBeaconConfigShape(input)).toBeNull();
  });

  it('keeps the bounds inclusive', () => {
    const selectors = Array<string>(SELECTOR_COUNT_MAX).fill('a'.repeat(SELECTOR_LENGTH_MAX));
    expect(
      readBeaconConfigShape({ ...CONFIG, selectors, widthThreshold: THRESHOLD_MAX })
    ).not.toBeNull();
  });
});

describe('parseBeaconTestRequest', () => {
  it('rebuilds the request', () => {
    expect(parseBeaconTestRequest({ config: CONFIG })).toEqual({ config: CONFIG });
  });

  it.each([
    ['a non-record', []],
    ['an extra key', { config: CONFIG, tabId: 1 }],
    ['a broken configuration', { config: { ...CONFIG, mobile: 1 } }],
    ['no configuration', {}]
  ])('refuses %s', (_label, input) => {
    expect(parseBeaconTestRequest(input)).toBeNull();
  });
});

describe('parseBeaconTestReply', () => {
  it('validates a completed run’s results and script errors', () => {
    const reply = parseBeaconTestReply({
      kind: 'completed',
      results: { lcp: [RECORD, { label: 'untyped' }], lrc: ['h1'] },
      scriptErrors: ['lazyRender']
    });
    expect(reply).toMatchObject({
      kind: 'completed',
      scriptErrors: ['lazyRender'],
      results: {
        aboveTheFold: { kind: 'ok', dropped: 1, truncated: false, items: [{ label: 'hero' }] },
        lazyRender: { kind: 'ok', items: ['h1'] }
      }
    });
  });

  it('marks a list past the validator’s cap as truncated', () => {
    const lcp = Array.from({ length: RESULT_RECORDS_MAX + 1 }, () => RECORD);
    const reply = parseBeaconTestReply({ kind: 'completed', results: { lcp }, scriptErrors: [] });
    expect(reply).toMatchObject({ results: { aboveTheFold: { truncated: true } } });
  });

  it('reads a timed-out run with and without partial results', () => {
    expect(parseBeaconTestReply({ kind: 'timed-out', partial: null })).toEqual({
      kind: 'timed-out',
      partial: null
    });
    expect(
      parseBeaconTestReply({ kind: 'timed-out', partial: { lcp: [RECORD], lrc: null } })
    ).toMatchObject({ partial: { aboveTheFold: { kind: 'ok' }, lazyRender: null } });
  });

  it('reads the bare and simple arms', () => {
    expect(parseBeaconTestReply({ kind: 'busy' })).toEqual({ kind: 'busy' });
    expect(parseBeaconTestReply({ kind: 'runner-unavailable' })).toEqual({
      kind: 'runner-unavailable'
    });
    expect(parseBeaconTestReply({ kind: 'bailed', reason: 'page-scrolled' })).toEqual({
      kind: 'bailed',
      reason: 'page-scrolled'
    });
    expect(parseBeaconTestReply({ kind: 'failed', message: 'x' })).toEqual({
      kind: 'failed',
      message: 'x'
    });
  });

  it.each([
    ['a non-record', 'busy'],
    ['an unknown kind', { kind: 'done' }],
    ['a bare arm with a field', { kind: 'busy', x: 1 }],
    ['completed with non-record results', { kind: 'completed', results: [], scriptErrors: [] }],
    ['completed with an extra key', { kind: 'completed', results: {}, scriptErrors: [], x: 1 }],
    ['an unknown script error', { kind: 'completed', results: {}, scriptErrors: ['fonts'] }],
    [
      'a repeated script error',
      { kind: 'completed', results: {}, scriptErrors: ['lazyRender', 'lazyRender'] }
    ],
    ['too many script errors', { kind: 'completed', results: {}, scriptErrors: ['a', 'b', 'c'] }],
    ['script errors not a list', { kind: 'completed', results: {}, scriptErrors: 'lazyRender' }],
    ['non-record partial results', { kind: 'timed-out', partial: 'x' }],
    ['timed-out with an extra key', { kind: 'timed-out', partial: null, x: 1 }],
    ['an unknown bail reason', { kind: 'bailed', reason: 'tired' }],
    ['a bail with an extra key', { kind: 'bailed', reason: 'screen-size', x: 1 }],
    ['an over-long failure message', { kind: 'failed', message: 'm'.repeat(1025) }],
    ['a non-string failure message', { kind: 'failed', message: 3 }],
    ['a failure with an extra key', { kind: 'failed', message: 'm', x: 1 }]
  ])('refuses %s', (_label, input) => {
    expect(parseBeaconTestReply(input)).toBeNull();
  });
});
