/**
 * The panel's LCP analysis: the page's facts become the breakdown of the
 * last candidate (resource matched, text and missing resources explicit,
 * gaps for no navigation / no candidate), `unsupported` and every ask miss
 * are their own outcomes; the tab step is bounded and guards the answer.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logger';
import type { AskOutcome } from '../messaging/bounded-ask';
import type { LcpAnalysisReply, LcpCandidateFacts } from '../messaging/lcp-analysis';
import { analysisOf, lcpTabStep, runLcpAnalysis, type LcpAnalysisDeps } from './run-analysis';

/** The page's LCP: an image. */
const IMAGE: LcpCandidateFacts = {
  startTime: 1000,
  renderTime: 1000,
  loadTime: 800,
  size: 50_000,
  url: 'https://a.test/hero.jpg',
  element: { tag: 'img', id: 'hero', classes: [] }
};

/** An earlier text candidate. */
const TEXT: LcpCandidateFacts = { ...IMAGE, startTime: 400, loadTime: 0, url: '', element: null };

/** The image's resource timing. */
const IMAGE_RESOURCE = { name: IMAGE.url, startTime: 300, requestStart: 400, responseEnd: 700 };

/** A measured answer. */
const MEASURED: Extract<LcpAnalysisReply, { kind: 'measured' }> = {
  kind: 'measured',
  navigation: { responseStart: 200 },
  candidates: [TEXT, IMAGE],
  resource: IMAGE_RESOURCE,
  highlight: 'shown'
};

/** A logger whose levels are spies the test reads (properties, so reads stay bound). */
interface LogSpies {
  readonly debug: Mock<Logger['debug']>;
  readonly info: Mock<Logger['info']>;
  readonly warn: Mock<Logger['warn']>;
  readonly error: Mock<Logger['error']>;
}

/** A silent logger recording its calls. */
function logDouble(): LogSpies {
  return {
    debug: vi.fn<Logger['debug']>(),
    info: vi.fn<Logger['info']>(),
    warn: vi.fn<Logger['warn']>(),
    error: vi.fn<Logger['error']>()
  };
}

/** Deps whose analysis answers `outcome`. */
function deps(outcome: AskOutcome<LcpAnalysisReply>): Omit<LcpAnalysisDeps, 'analyse' | 'log'> & {
  analyse: Mock<LcpAnalysisDeps['analyse']>;
  log: LogSpies;
} {
  return {
    analyse: vi.fn<LcpAnalysisDeps['analyse']>(() => Promise.resolve(outcome)),
    log: logDouble()
  };
}

describe('analysisOf', () => {
  it('breaks the last candidate down over its resource', () => {
    const analysis = analysisOf(MEASURED);
    expect(analysis.candidates).toBe(MEASURED.candidates);
    expect(analysis.highlight).toBe('shown');
    expect(analysis.activationStart).toBe(0);
    expect(analysis.breakdown).toMatchObject({
      kind: 'breakdown',
      total: 1000,
      resource: 'found',
      parts: [
        { key: 'timeToFirstByte', duration: 200, percent: 20 },
        { key: 'resourceLoadDelay', duration: 200, percent: 20 },
        { key: 'resourceLoadDuration', duration: 300, percent: 30 },
        { key: 'elementRenderDelay', duration: 300, percent: 30 }
      ]
    });
  });

  it('carries the prerender activation and measures the breakdown from it', () => {
    const analysis = analysisOf({
      ...MEASURED,
      navigation: { responseStart: 200, activationStart: 250 }
    });
    expect(analysis.activationStart).toBe(250);
    expect(analysis.breakdown).toMatchObject({ kind: 'breakdown', total: 750 });
    expect(analysisOf({ ...MEASURED, navigation: null }).activationStart).toBe(0);
  });

  it('reads an image without a resource entry as missing', () => {
    expect(analysisOf({ ...MEASURED, resource: null }).breakdown).toMatchObject({
      resource: 'missing'
    });
  });

  it('never matches a resource of another URL', () => {
    const resource = { ...IMAGE_RESOURCE, name: 'https://a.test/other.jpg' };
    expect(analysisOf({ ...MEASURED, resource }).breakdown).toMatchObject({ resource: 'missing' });
  });

  it('reads a text LCP as text', () => {
    expect(analysisOf({ ...MEASURED, candidates: [TEXT], resource: null }).breakdown).toMatchObject(
      {
        resource: 'text'
      }
    );
  });

  it('names the gaps', () => {
    expect(analysisOf({ ...MEASURED, candidates: [] }).breakdown).toEqual({ kind: 'no-lcp' });
    expect(analysisOf({ ...MEASURED, navigation: null }).breakdown).toEqual({
      kind: 'no-navigation'
    });
  });
});

describe('runLcpAnalysis', () => {
  it('analyses a measured answer', async () => {
    const d = deps({ kind: 'reply', reply: MEASURED });
    await expect(runLcpAnalysis({ highlight: true }, d)).resolves.toEqual(analysisOf(MEASURED));
    expect(d.analyse).toHaveBeenCalledWith({ highlight: true });
  });

  it('passes unsupported through', async () => {
    const d = deps({ kind: 'reply', reply: { kind: 'unsupported' } });
    await expect(runLcpAnalysis({ highlight: false }, d)).resolves.toEqual({ kind: 'unsupported' });
  });

  it('reads a miss as an unreachable page, logged', async () => {
    const d = deps({ kind: 'failed', cause: 'x' });
    await expect(runLcpAnalysis({ highlight: false }, d)).resolves.toEqual({
      kind: 'page-unreachable',
      miss: 'failed'
    });
    expect(d.log.warn).toHaveBeenCalledWith('LCP analysis failed', 'x');
  });
});

describe('lcpTabStep', () => {
  it('asks the tab and guards its answer', async () => {
    const runLcpAnalysis = vi.fn(() => Promise.resolve({ kind: 'unsupported' }));
    await expect(lcpTabStep({ runLcpAnalysis }, 4)({ highlight: true })).resolves.toEqual({
      kind: 'reply',
      reply: { kind: 'unsupported' }
    });
    expect(runLcpAnalysis).toHaveBeenCalledWith(4, { highlight: true });
    const broken = lcpTabStep({ runLcpAnalysis: () => Promise.resolve({ kind: 'x' }) }, 4);
    await expect(broken({ highlight: false })).resolves.toEqual({ kind: 'invalid-reply' });
  });
});
