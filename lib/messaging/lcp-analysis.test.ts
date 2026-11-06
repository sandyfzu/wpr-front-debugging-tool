/**
 * The LCP analysis contract's guards: the request is one boolean; the
 * reply's facts are rebuilt exactly (finite non-negative timings, capped
 * strings measured as `capText` can produce them, bounded lists) and
 * anything else is refused.
 */
import { describe, expect, it } from 'vitest';
import { capText } from '../../utils/cap-text';
import {
  LCP_ANALYSIS_LIMITS,
  parseLcpAnalysisReply,
  parseLcpAnalysisRequest,
  type LcpCandidateFacts
} from './lcp-analysis';

/** An image candidate. */
const IMAGE: LcpCandidateFacts = {
  startTime: 900,
  renderTime: 900,
  loadTime: 850,
  size: 120_000,
  url: 'https://a.test/hero.jpg',
  element: { tag: 'img', id: 'hero', classes: ['wp-image', 'lazy'] }
};

/** A measured answer. */
const MEASURED = {
  kind: 'measured',
  navigation: { responseStart: 200 },
  candidates: [{ ...IMAGE, startTime: 400, url: '', element: null }, IMAGE],
  resource: { name: IMAGE.url, startTime: 300, requestStart: 320, responseEnd: 700 },
  highlight: 'off'
} as const;

describe('parseLcpAnalysisRequest', () => {
  it('reads the highlight choice', () => {
    expect(parseLcpAnalysisRequest({ highlight: true })).toEqual({ highlight: true });
    expect(parseLcpAnalysisRequest({ highlight: false })).toEqual({ highlight: false });
  });

  it.each([[null], [{}], [{ highlight: 'yes' }], [{ highlight: true, tabId: 1 }]])(
    'refuses %j',
    (input) => {
      expect(parseLcpAnalysisRequest(input)).toBeNull();
    }
  );
});

describe('parseLcpAnalysisReply', () => {
  it('reads unsupported', () => {
    expect(parseLcpAnalysisReply({ kind: 'unsupported' })).toEqual({ kind: 'unsupported' });
  });

  it('rebuilds a measured answer', () => {
    expect(parseLcpAnalysisReply(MEASURED)).toEqual(MEASURED);
  });

  it('accepts a navigation with or without its activation offset', () => {
    const prerendered = { ...MEASURED, navigation: { responseStart: 200, activationStart: 80 } };
    expect(parseLcpAnalysisReply(prerendered)).toEqual(prerendered);
    expect(parseLcpAnalysisReply(MEASURED)).toMatchObject({ navigation: { responseStart: 200 } });
  });

  it('accepts no navigation, no resource and no candidates', () => {
    expect(
      parseLcpAnalysisReply({ ...MEASURED, navigation: null, resource: null, candidates: [] })
    ).toMatchObject({ navigation: null, resource: null, candidates: [] });
  });

  it('accepts strings capped at the limits, astral characters included', () => {
    const url = capText(
      '😀'.repeat(LCP_ANALYSIS_LIMITS.urlPoints + 5),
      LCP_ANALYSIS_LIMITS.urlPoints
    );
    const name = capText('😀'.repeat(300), LCP_ANALYSIS_LIMITS.namePoints);
    const candidate = { ...IMAGE, url, element: { tag: name, id: name, classes: [name] } };
    expect(parseLcpAnalysisReply({ ...MEASURED, candidates: [candidate] })).not.toBeNull();
  });

  it('accepts the candidate cap and refuses one past it', () => {
    const at = Array<LcpCandidateFacts>(LCP_ANALYSIS_LIMITS.candidates).fill(IMAGE);
    expect(parseLcpAnalysisReply({ ...MEASURED, candidates: at })).not.toBeNull();
    expect(parseLcpAnalysisReply({ ...MEASURED, candidates: [...at, IMAGE] })).toBeNull();
  });

  /** A measured answer with one candidate replaced. */
  const withCandidate = (candidate: unknown): unknown => ({ ...MEASURED, candidates: [candidate] });

  it.each([
    ['a non-record', 'measured'],
    ['an unknown kind', { kind: 'other' }],
    ['unsupported with a field', { kind: 'unsupported', x: 1 }],
    ['an extra key', { ...MEASURED, x: 1 }],
    ['an unknown highlight', { ...MEASURED, highlight: 'on' }],
    ['candidates not a list', { ...MEASURED, candidates: {} }],
    ['a negative timing', withCandidate({ ...IMAGE, startTime: -1 })],
    ['an infinite timing', withCandidate({ ...IMAGE, size: Infinity })],
    ['a NaN timing', withCandidate({ ...IMAGE, loadTime: NaN })],
    ['a non-string URL', withCandidate({ ...IMAGE, url: 1 })],
    [
      'an over-long URL',
      withCandidate({ ...IMAGE, url: 'u'.repeat(2 * LCP_ANALYSIS_LIMITS.urlPoints + 2) })
    ],
    ['a candidate with markup', withCandidate({ ...IMAGE, outerHTML: '<img>' })],
    [
      'an element with markup',
      withCandidate({ ...IMAGE, element: { ...IMAGE.element, html: '<img>' } })
    ],
    ['an empty tag', withCandidate({ ...IMAGE, element: { tag: '', id: '', classes: [] } })],
    ['a non-string id', withCandidate({ ...IMAGE, element: { tag: 'img', id: 1, classes: [] } })],
    ['an empty class', withCandidate({ ...IMAGE, element: { tag: 'img', id: '', classes: [''] } })],
    [
      'too many classes',
      withCandidate({ ...IMAGE, element: { tag: 'img', id: '', classes: Array(11).fill('c') } })
    ],
    [
      'classes not a list',
      withCandidate({ ...IMAGE, element: { tag: 'img', id: '', classes: 'c' } })
    ],
    ['a malformed element', withCandidate({ ...IMAGE, element: 'img' })],
    ['a malformed navigation', { ...MEASURED, navigation: { responseStart: -1 } }],
    ['a navigation with an extra key', { ...MEASURED, navigation: { responseStart: 1, x: 1 } }],
    [
      'a negative activation offset',
      { ...MEASURED, navigation: { responseStart: 1, activationStart: -1 } }
    ],
    [
      'a non-number activation offset',
      { ...MEASURED, navigation: { responseStart: 1, activationStart: '0' } }
    ],
    [
      'an undefined activation offset key',
      { ...MEASURED, navigation: { responseStart: 1, activationStart: undefined } }
    ],
    ['a malformed resource', { ...MEASURED, resource: { ...MEASURED.resource, responseEnd: '1' } }],
    ['a resource without a name', { ...MEASURED, resource: { ...MEASURED.resource, name: 1 } }],
    ['a resource with an extra key', { ...MEASURED, resource: { ...MEASURED.resource, x: 1 } }]
  ])('refuses %s', (_label, input) => {
    expect(parseLcpAnalysisReply(input)).toBeNull();
  });
});
