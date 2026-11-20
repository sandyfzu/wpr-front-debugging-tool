import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { DataConsentPageQuery } from '../../lib/data-consent/consent-page-url';
import { createConsentFlow, type ConsentFlowDeps } from './consent-flow';

const NEXT = 'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2F';
const RUCSS: DataConsentPageQuery = { feature: 'rucss', next: null };
const PAGESPEED: DataConsentPageQuery = { feature: 'pagespeed', next: NEXT };

/** A logger double. */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** Deps over doubles; the removal and grant watches hand their listeners to `removed`/`added`. */
function deps(query: DataConsentPageQuery, overrides: Partial<ConsentFlowDeps> = {}) {
  const removed: { emit?: (dataCollection: readonly string[]) => void } = {};
  const added: { emit?: (dataCollection: readonly string[]) => void } = {};
  const stopWatch = vi.fn();
  const stopAdded = vi.fn();
  const base = {
    query,
    hasConsent: vi.fn<ConsentFlowDeps['hasConsent']>(() => Promise.resolve(false)),
    request: vi.fn<ConsentFlowDeps['request']>(() => Promise.resolve(true)),
    watchRemoved: vi.fn<ConsentFlowDeps['watchRemoved']>((onRemoved) => {
      removed.emit = onRemoved;
      return stopWatch;
    }),
    watchAdded: vi.fn<ConsentFlowDeps['watchAdded']>((onAdded) => {
      added.emit = onAdded;
      return stopAdded;
    }),
    sendAnswer: vi.fn<ConsentFlowDeps['sendAnswer']>(() => Promise.resolve()),
    closeTab: vi.fn<ConsentFlowDeps['closeTab']>(() => Promise.resolve()),
    navigate: vi.fn<ConsentFlowDeps['navigate']>(),
    log: logDouble()
  } satisfies ConsentFlowDeps;
  // Overrides here are doubles too (the tests pass `vi.fn`s).
  const d = { ...base, ...overrides } as typeof base;
  return { d, removed, added, stopWatch, stopAdded };
}

/** Create the flow in a root (disposed by the test's end). */
function flowOf(d: ConsentFlowDeps) {
  return createRoot(() => createConsentFlow(d));
}

describe('createConsentFlow — the check', () => {
  it('asks when the grant is missing (nothing sent, nothing closed)', async () => {
    const { d } = deps(RUCSS);
    const flow = flowOf(d);
    await flow.start();
    expect(flow.state()).toEqual({ status: 'asking' });
    expect(d.sendAnswer).not.toHaveBeenCalled();
    expect(d.closeTab).not.toHaveBeenCalled();
  });

  it('already granted: the RUCSS ask tells the tool and closes the tab', async () => {
    const { d } = deps(RUCSS, { hasConsent: vi.fn(() => Promise.resolve(true)) });
    const flow = flowOf(d);
    await flow.start();
    expect(flow.state()).toEqual({ status: 'granted' });
    expect(d.sendAnswer).toHaveBeenCalledWith(true);
    expect(d.closeTab).toHaveBeenCalledOnce();
  });

  it('already granted: the PageSpeed ask tells the tools, then goes on to its analysis', async () => {
    const { d } = deps(PAGESPEED, { hasConsent: vi.fn(() => Promise.resolve(true)) });
    const flow = flowOf(d);
    await flow.start();
    expect(d.sendAnswer).toHaveBeenCalledWith(true);
    expect(d.navigate).toHaveBeenCalledWith(NEXT);
    // Told first: the background forgets this tab before it leaves the consent page.
    expect(d.sendAnswer.mock.invocationCallOrder[0]).toBeLessThan(
      d.navigate.mock.invocationCallOrder[0] ?? 0
    );
    expect(d.closeTab).not.toHaveBeenCalled();
  });

  it('a failed read is logged and still asks', async () => {
    const { d } = deps(RUCSS, { hasConsent: vi.fn(() => Promise.reject(new Error('dead'))) });
    const flow = flowOf(d);
    await flow.start();
    expect(flow.state()).toEqual({ status: 'asking' });
    expect(d.log.warn).toHaveBeenCalledWith('Reading the data-sharing consent failed', 'dead');
  });
});

describe('createConsentFlow — Allow', () => {
  it('requests synchronously, before any await (Firefox needs the live input handler)', async () => {
    const { d } = deps(RUCSS);
    const flow = flowOf(d);
    await flow.start();
    const pending = flow.allow();
    // Called within the same synchronous turn as the click.
    expect(d.request).toHaveBeenCalledWith({ data_collection: ['browsingActivity'] });
    expect(flow.state()).toEqual({ status: 'requesting' });
    await pending;
  });

  it('granted: tells the RUCSS Tester and closes the tab', async () => {
    const { d } = deps(RUCSS);
    const flow = flowOf(d);
    await flow.start();
    await flow.allow();
    expect(flow.state()).toEqual({ status: 'granted' });
    expect(d.sendAnswer).toHaveBeenCalledWith(true);
    expect(d.closeTab).toHaveBeenCalledOnce();
  });

  it('granted: PageSpeed Insights continues in this tab', async () => {
    const { d } = deps(PAGESPEED);
    const flow = flowOf(d);
    await flow.start();
    await flow.allow();
    expect(d.navigate).toHaveBeenCalledWith(NEXT);
  });

  it('declined in the prompt: tells the tool, stays with Ask again', async () => {
    const { d } = deps(RUCSS, { request: vi.fn(() => Promise.resolve(false)) });
    const flow = flowOf(d);
    await flow.start();
    await flow.allow();
    expect(flow.state()).toEqual({ status: 'declined' });
    expect(d.sendAnswer).toHaveBeenCalledWith(false);
    expect(d.closeTab).not.toHaveBeenCalled();
    // Ask again: a new request from the declined state.
    d.request.mockResolvedValueOnce(true);
    await flow.allow();
    expect(d.request).toHaveBeenCalledTimes(2);
    expect(flow.state()).toEqual({ status: 'granted' });
  });

  it('a rejected request fails with its message; Ask again retries', async () => {
    const { d } = deps(RUCSS, {
      request: vi.fn(() =>
        Promise.reject(new Error('may only be called from a user input handler'))
      )
    });
    const flow = flowOf(d);
    await flow.start();
    await flow.allow();
    expect(flow.state()).toEqual({
      status: 'failed',
      message: 'may only be called from a user input handler'
    });
    expect(d.sendAnswer).not.toHaveBeenCalled();
    d.request.mockResolvedValueOnce(true);
    await flow.allow();
    expect(flow.state()).toEqual({ status: 'granted' });
  });

  it('does nothing before the check or while the prompt is up', async () => {
    let resolve: (granted: boolean) => void = () => undefined;
    const { d } = deps(RUCSS, {
      request: vi.fn(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          })
      )
    });
    const flow = flowOf(d);
    await flow.allow();
    expect(d.request).not.toHaveBeenCalled();
    await flow.start();
    const first = flow.allow();
    await flow.allow();
    expect(d.request).toHaveBeenCalledOnce();
    resolve(true);
    await first;
  });
});

describe('createConsentFlow — Not now, close, revoke', () => {
  it('Not now declines without the prompt and tells the tool', async () => {
    const { d } = deps(RUCSS);
    const flow = flowOf(d);
    await flow.start();
    await flow.decline();
    expect(flow.state()).toEqual({ status: 'declined' });
    expect(d.request).not.toHaveBeenCalled();
    expect(d.sendAnswer).toHaveBeenCalledWith(false);
    // A second Not now changes nothing and tells no one again.
    await flow.decline();
    expect(d.sendAnswer).toHaveBeenCalledOnce();
  });

  it('a tab that will not close is logged and offers a Close that tries again', async () => {
    const { d } = deps(RUCSS, {
      hasConsent: vi.fn(() => Promise.resolve(true)),
      closeTab: vi.fn(() => Promise.reject(new Error('no tab')))
    });
    const flow = flowOf(d);
    await flow.start();
    expect(flow.closeFailed()).toBe(true);
    expect(d.log.warn).toHaveBeenCalledWith('Closing the consent tab failed', 'no tab');
    d.closeTab.mockResolvedValueOnce(undefined);
    await flow.close();
    expect(d.closeTab).toHaveBeenCalledTimes(2);
  });

  it('a grant removed while the page is open asks again; other removals change nothing', async () => {
    const { d, removed, stopWatch } = deps(RUCSS, {
      hasConsent: vi.fn(() => Promise.resolve(true)),
      closeTab: vi.fn(() => Promise.reject(new Error('no tab')))
    });
    const flow = flowOf(d);
    await flow.start();
    removed.emit?.(['websiteContent']);
    expect(flow.state()).toEqual({ status: 'granted' });
    removed.emit?.(['browsingActivity']);
    expect(flow.state()).toEqual({ status: 'asking' });
    flow.dispose();
    expect(stopWatch).toHaveBeenCalledOnce();
  });
});

describe('createConsentFlow — a grant given elsewhere', () => {
  it('settles an asking RUCSS page: tells the tool, closes the tab', async () => {
    const { d, added, stopAdded } = deps(RUCSS);
    const flow = flowOf(d);
    await flow.start();
    added.emit?.(['websiteContent']);
    expect(flow.state()).toEqual({ status: 'asking' });
    added.emit?.(['browsingActivity']);
    expect(flow.state()).toEqual({ status: 'granted' });
    await vi.waitFor(() => {
      expect(d.closeTab).toHaveBeenCalledOnce();
    });
    expect(d.sendAnswer).toHaveBeenCalledWith(true);
    flow.dispose();
    expect(stopAdded).toHaveBeenCalledOnce();
  });

  it('settles a declined PageSpeed page: goes on to its analysis', async () => {
    const { d, added } = deps(PAGESPEED);
    const flow = flowOf(d);
    await flow.start();
    await flow.decline();
    added.emit?.(['browsingActivity']);
    await vi.waitFor(() => {
      expect(d.navigate).toHaveBeenCalledWith(NEXT);
    });
  });

  it("leaves this page's own prompt to answer (no second proceed)", async () => {
    let resolve: (granted: boolean) => void = () => undefined;
    const { d, added } = deps(RUCSS, {
      request: vi.fn(
        () =>
          new Promise<boolean>((done) => {
            resolve = done;
          })
      )
    });
    const flow = flowOf(d);
    await flow.start();
    const pending = flow.allow();
    added.emit?.(['browsingActivity']);
    expect(flow.state()).toEqual({ status: 'requesting' });
    resolve(true);
    await pending;
    expect(d.closeTab).toHaveBeenCalledOnce();
    expect(d.sendAnswer).toHaveBeenCalledOnce();
  });
});
