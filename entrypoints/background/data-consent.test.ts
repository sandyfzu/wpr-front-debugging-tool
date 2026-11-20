import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConsentTabs } from '../../lib/data-consent/consent-tabs';
import { DATA_CONSENT_ASK_DEADLINE_MS } from '../../lib/messaging/data-consent';
import type { Logger } from '../../lib/logger';

const messenger = vi.hoisted(() => ({
  handlers: new Map<string, (message: { sender: unknown; data: unknown }) => unknown>(),
  sendMessage: vi.fn<(type: string, data: unknown) => Promise<unknown>>()
}));
vi.mock('../../lib/messaging', () => ({
  onMessage: (type: string, handler: (message: { sender: unknown; data: unknown }) => unknown) => {
    messenger.handlers.set(type, handler);
    return vi.fn();
  },
  sendMessage: messenger.sendMessage
}));

const {
  answerDataConsentAsk,
  backgroundConsentCheck,
  CONSENT_SHOW_WAIT_MS,
  consentOpenerTab,
  consentPageSenderTab,
  isConsentPageUrl,
  openTabNextTo,
  recordConsentAnswer,
  registerDataConsent,
  tellLeft,
  waitForEarlierShow
} = await import('./data-consent');
type Deps = Parameters<typeof answerDataConsentAsk>[2];
type TabApi = Deps['tabs'];

const ID = 'own-extension-id';
const ROOT = 'moz-extension://5f1d2c3b-aaaa-bbbb-cccc-123456789abc/';
const CONSENT_PAGE = `${ROOT}data-consent.html`;
const RUCSS_PAGE = `${CONSENT_PAGE}?feature=rucss`;
const PANEL = { id: ID, url: `${ROOT}panel.html` };
const TOP_FRAME = { id: ID, tab: { id: 12 }, frameId: 0, url: 'https://example.com/page' };
const PSI_FRAME = {
  id: ID,
  tab: { id: 30 },
  frameId: 0,
  url: 'https://pagespeed.web.dev/?wpr-sbs=x'
};
const NEXT = 'https://pagespeed.web.dev/?wpr-sbs=https%3A%2F%2Fexample.com%2Fpage';
const RUCSS_ASK = { feature: 'rucss', tabId: 7 };
const OPEN_TAB_ASK = { feature: 'pagespeed', next: NEXT, mode: 'open-tab' };
const CHECK_ASK = { feature: 'pagespeed', next: NEXT, mode: 'check' };
const ASK_HERE = { feature: 'pagespeed', next: NEXT, mode: 'ask-here' };

/** A logger double (no console noise; calls assertable). */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** Tab API doubles: every tab sits at index 2 of window 1 and shows `urls[id]`. */
function tabsDouble(urls: Record<number, string> = {}) {
  return {
    get: vi.fn<TabApi['get']>((tabId) =>
      Promise.resolve({ index: 2, windowId: 1, url: urls[tabId] })
    ),
    create: vi.fn<TabApi['create']>(() => Promise.resolve({ id: 99 })),
    update: vi.fn<TabApi['update']>(() => Promise.resolve({})),
    focusWindow: vi.fn<TabApi['focusWindow']>(() => Promise.resolve({}))
  };
}

/**
 * Deps whose grant read answers `granted` (the `data_collection` list, or
 * `unsupported`: no such key) and whose tabs open.
 */
function deps(granted: readonly string[] | 'unsupported' = [], overrides: Partial<Deps> = {}) {
  const all: { data_collection?: readonly string[] } =
    granted === 'unsupported' ? {} : { data_collection: granted };
  const base = {
    api: { getAll: vi.fn<Deps['api']['getAll']>(() => Promise.resolve(all)) },
    extensionId: ID,
    extensionRootUrl: ROOT,
    consentPageUrl: CONSENT_PAGE,
    tabs: tabsDouble(),
    shownTabs: createConsentTabs(),
    pendingShows: new Map(),
    schedule: vi.fn<Deps['schedule']>(() => () => undefined),
    tell: vi.fn<Deps['tell']>(() => Promise.resolve()),
    log: logDouble()
  } satisfies Deps;
  // Overrides here are doubles too (the tests pass `vi.fn`s).
  return { ...base, ...overrides } as typeof base;
}

describe('consentOpenerTab — the sender gates', () => {
  it('the RUCSS ask: our tab-less page, opening next to the tab it names', () => {
    const ask = { feature: 'rucss', tabId: 7 } as const;
    expect(consentOpenerTab(ask, PANEL, deps())).toBe(7);
    // A content script (it carries a tab), another extension, a foreign page: refused.
    expect(consentOpenerTab(ask, TOP_FRAME, deps())).toBeNull();
    expect(consentOpenerTab(ask, { ...PANEL, id: 'other' }, deps())).toBeNull();
    expect(consentOpenerTab(ask, { id: ID, url: 'https://evil.test/' }, deps())).toBeNull();
    expect(consentOpenerTab(ask, undefined, deps())).toBeNull();
  });

  it('the open-tab ask: a top frame of an http(s) page, opening next to its own tab', () => {
    const ask = { feature: 'pagespeed', next: NEXT, mode: 'open-tab' } as const;
    expect(consentOpenerTab(ask, TOP_FRAME, deps())).toBe(12);
    expect(consentOpenerTab(ask, { ...TOP_FRAME, frameId: 3 }, deps())).toBeNull();
    expect(consentOpenerTab(ask, PANEL, deps())).toBeNull();
  });

  it('the check and ask-here asks: only the analysis page itself, over https', () => {
    for (const mode of ['check', 'ask-here'] as const) {
      const ask = { feature: 'pagespeed', next: NEXT, mode } as const;
      expect(consentOpenerTab(ask, PSI_FRAME, deps())).toBe(30);
      expect(consentOpenerTab(ask, TOP_FRAME, deps())).toBeNull();
      expect(
        consentOpenerTab(ask, { ...PSI_FRAME, url: 'http://pagespeed.web.dev/' }, deps())
      ).toBeNull();
      expect(consentOpenerTab(ask, { ...PSI_FRAME, frameId: 1 }, deps())).toBeNull();
    }
  });
});

describe('isConsentPageUrl', () => {
  it('matches the consent page with any query, nothing else', () => {
    expect(isConsentPageUrl(CONSENT_PAGE, CONSENT_PAGE)).toBe(true);
    expect(isConsentPageUrl(`${CONSENT_PAGE}?feature=pagespeed&next=x`, CONSENT_PAGE)).toBe(true);
    expect(isConsentPageUrl(`${ROOT}panel.html`, CONSENT_PAGE)).toBe(false);
    expect(isConsentPageUrl('moz-extension://other/data-consent.html', CONSENT_PAGE)).toBe(false);
    expect(isConsentPageUrl('https://example.com/data-consent.html', CONSENT_PAGE)).toBe(false);
    expect(isConsentPageUrl('not a url', CONSENT_PAGE)).toBe(false);
    expect(isConsentPageUrl(undefined, CONSENT_PAGE)).toBe(false);
  });
});

describe('openTabNextTo', () => {
  it('opens right after the opener, in its window', async () => {
    const d = deps();
    await expect(openTabNextTo('https://x.test/', 7, d)).resolves.toBe(99);
    expect(d.tabs.create).toHaveBeenCalledWith({
      url: 'https://x.test/',
      openerTabId: 7,
      active: true,
      index: 3,
      windowId: 1
    });
  });

  it('opens where the browser puts it when the opener cannot be read (logged)', async () => {
    const d = deps();
    d.tabs.get.mockRejectedValueOnce(new Error('Invalid tab ID: 7'));
    d.tabs.create.mockResolvedValueOnce({});
    await expect(openTabNextTo('https://x.test/', 7, d)).resolves.toBeNull();
    expect(d.tabs.create).toHaveBeenCalledWith({
      url: 'https://x.test/',
      openerTabId: 7,
      active: true
    });
    expect(d.log.warn).toHaveBeenCalledOnce();
  });

  it('rejects when the tab does not open', async () => {
    const d = deps();
    d.tabs.create.mockRejectedValueOnce(new Error('no'));
    await expect(openTabNextTo('https://x.test/', 7, d)).rejects.toThrow('no');
  });
});

describe('answerDataConsentAsk — granted', () => {
  it('answers granted without opening anything (RUCSS, check, ask-here)', async () => {
    for (const [sender, ask] of [
      [PANEL, RUCSS_ASK],
      [PSI_FRAME, CHECK_ASK],
      [PSI_FRAME, ASK_HERE]
    ] as const) {
      const d = deps(['browsingActivity']);
      await expect(answerDataConsentAsk(sender, ask, d)).resolves.toEqual({ status: 'granted' });
      expect(d.tabs.create).not.toHaveBeenCalled();
      expect(d.tabs.update).not.toHaveBeenCalled();
    }
  });

  it('opens the analysis tab next to the page for an open-tab ask', async () => {
    const d = deps(['browsingActivity']);
    await expect(answerDataConsentAsk(TOP_FRAME, OPEN_TAB_ASK, d)).resolves.toEqual({
      status: 'granted'
    });
    expect(d.tabs.create).toHaveBeenCalledWith({
      url: NEXT,
      openerTabId: 12,
      active: true,
      index: 3,
      windowId: 1
    });
    expect(d.shownTabs.entryFor('pagespeed')).toBeNull();
  });

  it('answers failed (logged) when the analysis tab does not open', async () => {
    const d = deps(['browsingActivity']);
    d.tabs.create.mockRejectedValueOnce(new Error('blocked'));
    await expect(answerDataConsentAsk(TOP_FRAME, OPEN_TAB_ASK, d)).resolves.toEqual({
      status: 'failed'
    });
    expect(d.log.error).toHaveBeenCalledWith(
      'Opening the PageSpeed Insights tab failed',
      'blocked'
    );
  });

  it('counts a browser without built-in consent as granted', async () => {
    const d = deps('unsupported');
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({
      status: 'granted'
    });
  });
});

describe('answerDataConsentAsk — missing', () => {
  it('opens the RUCSS consent page next to the inspected tab, remembered', async () => {
    const d = deps([]);
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({ status: 'asking' });
    expect(d.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: RUCSS_PAGE, openerTabId: 7, index: 3 })
    );
    expect(d.shownTabs.entryFor('rucss')).toEqual({ tabId: 99, answered: false });
  });

  it('opens the PageSpeed consent page with its continue address next to the page', async () => {
    const d = deps([]);
    await expect(answerDataConsentAsk(TOP_FRAME, OPEN_TAB_ASK, d)).resolves.toEqual({
      status: 'asking'
    });
    const url = new URL(d.tabs.create.mock.calls[0]?.[0].url ?? '');
    expect(url.searchParams.get('feature')).toBe('pagespeed');
    expect(url.searchParams.get('next')).toBe(NEXT);
    expect(d.tabs.create.mock.calls[0]?.[0].openerTabId).toBe(12);
  });

  it('a check answers missing and shows nothing', async () => {
    const d = deps([]);
    await expect(answerDataConsentAsk(PSI_FRAME, CHECK_ASK, d)).resolves.toEqual({
      status: 'missing'
    });
    expect(d.tabs.create).not.toHaveBeenCalled();
    expect(d.tabs.update).not.toHaveBeenCalled();
  });

  it('ask-here shows the consent page in the asking tab itself', async () => {
    const d = deps([]);
    await expect(answerDataConsentAsk(PSI_FRAME, ASK_HERE, d)).resolves.toEqual({
      status: 'asking'
    });
    const [tabId, props] = d.tabs.update.mock.calls[0] ?? [];
    expect(tabId).toBe(30);
    expect(new URL(props?.url ?? '').searchParams.get('next')).toBe(NEXT);
    expect(d.tabs.create).not.toHaveBeenCalled();
    // Tracked (its leaving tells the tool), never offered to another ask.
    expect(d.shownTabs.entryFor('pagespeed')).toBeNull();
    expect(d.shownTabs.left(30)).toBe('pagespeed');
  });

  it("never reloads the user's own asking tab for another site's open-tab ask", async () => {
    const d = deps([], { tabs: tabsDouble({ 30: `${CONSENT_PAGE}?feature=pagespeed&next=x` }) });
    await answerDataConsentAsk(PSI_FRAME, ASK_HERE, d);
    d.tabs.update.mockClear();
    await expect(answerDataConsentAsk(TOP_FRAME, OPEN_TAB_ASK, d)).resolves.toEqual({
      status: 'asking'
    });
    expect(d.tabs.update).not.toHaveBeenCalled();
    expect(d.tabs.create).toHaveBeenCalledOnce();
    expect(d.shownTabs.entryFor('pagespeed')).toEqual({ tabId: 99, answered: false });
  });

  it('two asks before the first tab opens share one consent tab', async () => {
    const d = deps([], { tabs: tabsDouble({ 99: RUCSS_PAGE }) });
    let open: (tab: { id: number }) => void = () => undefined;
    d.tabs.create.mockReturnValueOnce(
      new Promise((resolve) => {
        open = resolve;
      })
    );
    const first = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    const second = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await vi.waitFor(() => {
      expect(d.tabs.create).toHaveBeenCalledOnce();
    });
    open({ id: 99 });
    await expect(first).resolves.toEqual({ status: 'asking' });
    await expect(second).resolves.toEqual({ status: 'asking' });
    expect(d.tabs.create).toHaveBeenCalledOnce();
    expect(d.tabs.update).toHaveBeenCalledWith(99, { active: true });
    expect(d.pendingShows.size).toBe(0);
  });

  it('an ask queued behind a failed show still opens its tab', async () => {
    const d = deps([]);
    let fail: (cause: Error) => void = () => undefined;
    d.tabs.create.mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      })
    );
    const first = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    const second = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await vi.waitFor(() => {
      expect(d.tabs.create).toHaveBeenCalledOnce();
    });
    fail(new Error('no tab'));
    await expect(first).resolves.toEqual({ status: 'failed' });
    await expect(second).resolves.toEqual({ status: 'asking' });
    expect(d.tabs.create).toHaveBeenCalledTimes(2);
    expect(d.shownTabs.entryFor('rucss')).toEqual({ tabId: 99, answered: false });
    expect(d.pendingShows.size).toBe(0);
  });

  it('a third ask waits for the second when the first failed meanwhile: still one tab', async () => {
    const d = deps([], { tabs: tabsDouble({ 99: RUCSS_PAGE }) });
    let fail: (cause: Error) => void = () => undefined;
    let open: (tab: { id: number }) => void = () => undefined;
    d.tabs.create
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          fail = reject;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          open = resolve;
        })
      );
    const first = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    const second = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await vi.waitFor(() => {
      expect(d.tabs.create).toHaveBeenCalledOnce();
    });
    fail(new Error('no tab'));
    await expect(first).resolves.toEqual({ status: 'failed' });
    await vi.waitFor(() => {
      expect(d.tabs.create).toHaveBeenCalledTimes(2);
    });
    const third = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    open({ id: 99 });
    await expect(second).resolves.toEqual({ status: 'asking' });
    await expect(third).resolves.toEqual({ status: 'asking' });
    expect(d.tabs.create).toHaveBeenCalledTimes(2);
    expect(d.tabs.update).toHaveBeenCalledWith(99, { active: true });
    expect(d.pendingShows.size).toBe(0);
  });

  it('an ask behind a show that never settles opens its own tab once the wait runs out', async () => {
    const timers: (() => void)[] = [];
    const d = deps([], {
      schedule: vi.fn<Deps['schedule']>((run) => {
        timers.push(run);
        return () => undefined;
      })
    });
    d.tabs.create.mockReturnValueOnce(new Promise(() => undefined));
    void answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await vi.waitFor(() => {
      expect(d.tabs.create).toHaveBeenCalledOnce();
    });
    const later = answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await vi.waitFor(() => {
      expect(timers).toHaveLength(1);
    });
    expect(d.schedule).toHaveBeenCalledWith(expect.any(Function), CONSENT_SHOW_WAIT_MS);
    expect(d.tabs.create).toHaveBeenCalledOnce();
    timers[0]?.();
    await expect(later).resolves.toEqual({ status: 'asking' });
    expect(d.tabs.create).toHaveBeenCalledTimes(2);
    expect(d.shownTabs.entryFor('rucss')).toEqual({ tabId: 99, answered: false });
    expect(d.log.warn).toHaveBeenCalledWith(
      'An earlier consent tab show never settled; showing this ask anyway'
    );
    // The hung show is no longer the entry: the next ask waits for nothing stale.
    expect(d.pendingShows.size).toBe(0);
  });

  it('a second ask focuses the open consent tab instead of opening another', async () => {
    const d = deps([], { tabs: tabsDouble({ 99: RUCSS_PAGE }) });
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({ status: 'asking' });
    expect(d.tabs.create).toHaveBeenCalledOnce();
    // Same ask, unanswered: focused as is (its prompt may be up), window raised.
    expect(d.tabs.update).toHaveBeenCalledWith(99, { active: true });
    expect(d.tabs.focusWindow).toHaveBeenCalledWith(1);
  });

  it('reloads the open tab for another continue address, or after a decline', async () => {
    const d = deps([], { tabs: tabsDouble({ 99: RUCSS_PAGE }) });
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    d.shownTabs.answered(99, false);
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    expect(d.tabs.update).toHaveBeenLastCalledWith(99, { url: RUCSS_PAGE, active: true });
    expect(d.shownTabs.entryFor('rucss')).toEqual({ tabId: 99, answered: false });

    const p = deps([], { tabs: tabsDouble({ 99: `${CONSENT_PAGE}?feature=pagespeed&next=old` }) });
    await answerDataConsentAsk(TOP_FRAME, OPEN_TAB_ASK, p);
    await answerDataConsentAsk(TOP_FRAME, OPEN_TAB_ASK, p);
    expect(p.tabs.create).toHaveBeenCalledOnce();
    const [, props] = p.tabs.update.mock.calls[0] ?? [];
    expect(new URL(props?.url ?? '').searchParams.get('next')).toBe(NEXT);
  });

  it('still answers asking when only the window focus fails (logged)', async () => {
    const d = deps([], { tabs: tabsDouble({ 99: RUCSS_PAGE }) });
    d.tabs.focusWindow.mockRejectedValue(new Error('no window'));
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({ status: 'asking' });
    expect(d.log.warn).toHaveBeenCalledWith('Focusing the consent tab window failed', {
      cause: 'no window'
    });
  });

  it('never takes over a remembered tab the user moved on from: tells the tool, opens anew', async () => {
    const d = deps([], { tabs: tabsDouble({ 99: 'https://elsewhere.test/' }) });
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    d.tabs.create.mockResolvedValueOnce({ id: 100 });
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    expect(d.tabs.update).not.toHaveBeenCalled();
    expect(d.tell).toHaveBeenCalledWith({ feature: 'rucss', granted: false });
    expect(d.tabs.create).toHaveBeenCalledTimes(2);
    expect(d.shownTabs.entryFor('rucss')).toEqual({ tabId: 100, answered: false });
  });

  it('opens anew when the remembered tab is gone', async () => {
    const d = deps([]);
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    d.tabs.get.mockRejectedValueOnce(new Error('Invalid tab ID: 99'));
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    expect(d.tabs.create).toHaveBeenCalledTimes(2);
  });

  it('checks again on every ask: a revoked grant asks again', async () => {
    const d = deps(['browsingActivity']);
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    d.api.getAll.mockResolvedValueOnce({ data_collection: [] });
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({ status: 'asking' });
    expect(d.api.getAll).toHaveBeenCalledTimes(2);
    expect(d.tabs.create).toHaveBeenCalledOnce();
  });
});

describe('waitForEarlierShow', () => {
  /** A timer double: `fire` runs the armed timer; `cancel` is its cancel. */
  function timerDouble() {
    const cancel = vi.fn<() => void>();
    let armed: () => void = () => undefined;
    const schedule = vi.fn<Deps['schedule']>((run) => {
      armed = run;
      return cancel;
    });
    return {
      schedule,
      cancel,
      fire: () => {
        armed();
      }
    };
  }

  it('settles with the earlier show, done or failed, and cancels its timer', async () => {
    for (const earlier of [Promise.resolve(), Promise.reject(new Error('no tab'))]) {
      const timer = timerDouble();
      const log = logDouble();
      await expect(waitForEarlierShow(earlier, { schedule: timer.schedule, log })).resolves.toBe(
        true
      );
      expect(timer.schedule).toHaveBeenCalledWith(expect.any(Function), CONSENT_SHOW_WAIT_MS);
      expect(timer.cancel).toHaveBeenCalledOnce();
      expect(log.warn).not.toHaveBeenCalled();
    }
  });

  it('gives up on a show that never settles once the wait runs out (logged)', async () => {
    const timer = timerDouble();
    const log = logDouble();
    const waited = waitForEarlierShow(new Promise(() => undefined), {
      schedule: timer.schedule,
      log
    });
    timer.fire();
    await expect(waited).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('waits less than the tool waits for its answer', () => {
    expect(CONSENT_SHOW_WAIT_MS).toBeGreaterThan(0);
    expect(CONSENT_SHOW_WAIT_MS).toBeLessThan(DATA_CONSENT_ASK_DEADLINE_MS);
  });
});

describe('answerDataConsentAsk — failures', () => {
  it('refuses an invalid ask or sender without reading or opening anything', async () => {
    for (const [sender, data] of [
      [PANEL, { feature: 'rucss' }],
      [TOP_FRAME, RUCSS_ASK],
      [PANEL, OPEN_TAB_ASK],
      [TOP_FRAME, CHECK_ASK],
      [TOP_FRAME, { feature: 'pagespeed', next: 'https://evil.test/', mode: 'open-tab' }]
    ] as const) {
      const d = deps([]);
      await expect(answerDataConsentAsk(sender, data, d)).resolves.toEqual({ status: 'failed' });
      expect(d.api.getAll).not.toHaveBeenCalled();
      expect(d.tabs.create).not.toHaveBeenCalled();
      expect(d.log.warn).toHaveBeenCalledOnce();
    }
  });

  it('answers failed (logged) when the grant cannot be read', async () => {
    const d = deps([], { api: { getAll: vi.fn(() => Promise.reject(new Error('dead'))) } });
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({ status: 'failed' });
    expect(d.tabs.create).not.toHaveBeenCalled();
    expect(d.log.error).toHaveBeenCalledWith('Reading the data-sharing consent failed', 'dead');
  });

  it('answers failed (logged) when the consent page cannot be shown', async () => {
    const d = deps([]);
    d.tabs.create.mockRejectedValueOnce(new Error('Invalid tab ID: 7'));
    await expect(answerDataConsentAsk(PANEL, RUCSS_ASK, d)).resolves.toEqual({ status: 'failed' });
    const here = deps([]);
    here.tabs.update.mockRejectedValueOnce(new Error('gone'));
    await expect(answerDataConsentAsk(PSI_FRAME, ASK_HERE, here)).resolves.toEqual({
      status: 'failed'
    });
    expect(here.shownTabs.entryFor('pagespeed')).toBeNull();
    expect(d.log.error).toHaveBeenCalledWith(
      'Showing the data-sharing consent page failed',
      'Invalid tab ID: 7'
    );
  });
});

describe('the consent tab lifecycle', () => {
  const PAGE_SENDER = { id: ID, tab: { id: 99 }, url: RUCSS_PAGE };

  it('recognizes only our consent page in a tab as an answering sender', () => {
    const d = deps();
    expect(consentPageSenderTab(PAGE_SENDER, d)).toBe(99);
    expect(consentPageSenderTab({ ...PAGE_SENDER, id: 'other' }, d)).toBeNull();
    expect(consentPageSenderTab({ ...PAGE_SENDER, url: `${ROOT}panel.html` }, d)).toBeNull();
    expect(consentPageSenderTab({ id: ID, url: RUCSS_PAGE }, d)).toBeNull();
    expect(consentPageSenderTab(undefined, d)).toBeNull();
  });

  it('a consent tab closed unanswered tells the tool "not allowed", once', async () => {
    const d = deps([]);
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    await tellLeft(99, d);
    await tellLeft(99, d);
    expect(d.tell).toHaveBeenCalledOnce();
    expect(d.tell).toHaveBeenCalledWith({ feature: 'rucss', granted: false });
  });

  it('an answered tab tells nobody when it leaves; junk answers are ignored', async () => {
    const d = deps([]);
    await answerDataConsentAsk(PANEL, RUCSS_ASK, d);
    recordConsentAnswer({ ...PAGE_SENDER, id: 'other' }, { feature: 'rucss', granted: false }, d);
    recordConsentAnswer(PAGE_SENDER, { feature: 'rucss', granted: 'no' }, d);
    expect(d.shownTabs.entryFor('rucss')).toEqual({ tabId: 99, answered: false });
    recordConsentAnswer(PAGE_SENDER, { feature: 'rucss', granted: false }, d);
    await tellLeft(99, d);
    expect(d.tell).not.toHaveBeenCalled();
  });

  it('a tab that is no consent tab tells nobody', async () => {
    const d = deps();
    await tellLeft(5, d);
    expect(d.tell).not.toHaveBeenCalled();
  });
});

describe('registerDataConsent — the production wiring', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    messenger.handlers.clear();
    messenger.sendMessage.mockReset();
    messenger.sendMessage.mockResolvedValue(true);
  });

  /** A registered handler, called as the messenger would. */
  function call(type: string, sender: unknown, data: unknown): Promise<unknown> {
    const handler = messenger.handlers.get(type);
    if (handler === undefined) throw new Error(`${type} is not registered`);
    return Promise.resolve(handler({ sender, data }));
  }

  /** Register over a missing grant and a consent tab (id 41) at index 2. */
  function register() {
    const getAll = vi.fn(() => Promise.resolve({ data_collection: [] as string[] }));
    Object.assign(fakeBrowser.permissions, { getAll });
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ index: 2, windowId: 3 } as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 41 } as never);
    registerDataConsent();
    return { create, root: fakeBrowser.runtime.getURL('/') };
  }

  it('answers the ask and opens the consent tab next to the opener', async () => {
    const { create, root } = register();
    const reply = await call(
      'askDataConsent',
      { id: fakeBrowser.runtime.id, url: `${root}panel.html` },
      RUCSS_ASK
    );
    expect(reply).toEqual({ status: 'asking' });
    expect(create).toHaveBeenCalledWith({
      url: `${fakeBrowser.runtime.getURL('/data-consent.html')}?feature=rucss`,
      openerTabId: 7,
      active: true,
      index: 3,
      windowId: 3
    });
  });

  it('tells the panel when the consent tab closes unanswered — not after an answer', async () => {
    const { root } = register();
    const panel = { id: fakeBrowser.runtime.id, url: `${root}panel.html` };
    await call('askDataConsent', panel, RUCSS_ASK);
    await fakeBrowser.tabs.onRemoved.trigger(41, { windowId: 3, isWindowClosing: false });
    await vi.waitFor(() => {
      expect(messenger.sendMessage).toHaveBeenCalledWith('dataConsentAnswered', {
        feature: 'rucss',
        granted: false
      });
    });
    messenger.sendMessage.mockClear();
    await call('askDataConsent', panel, RUCSS_ASK);
    const page = {
      id: fakeBrowser.runtime.id,
      tab: { id: 41 },
      url: `${fakeBrowser.runtime.getURL('/data-consent.html')}?feature=rucss`
    };
    await expect(
      call('dataConsentAnswered', page, { feature: 'rucss', granted: true })
    ).resolves.toBe(true);
    await fakeBrowser.tabs.onRemoved.trigger(41, { windowId: 3, isWindowClosing: false });
    expect(messenger.sendMessage).not.toHaveBeenCalled();
  });

  it('a consent tab navigated to a site counts as left; its own reload does not', async () => {
    const { root } = register();
    await call(
      'askDataConsent',
      { id: fakeBrowser.runtime.id, url: `${root}panel.html` },
      RUCSS_ASK
    );
    const tab = { id: 41 } as never;
    await fakeBrowser.tabs.onUpdated.trigger(
      41,
      { url: fakeBrowser.runtime.getURL('/data-consent.html') },
      tab
    );
    await fakeBrowser.tabs.onUpdated.trigger(41, { status: 'complete' }, tab);
    expect(messenger.sendMessage).not.toHaveBeenCalled();
    await fakeBrowser.tabs.onUpdated.trigger(41, { url: 'https://site.test/' }, tab);
    await vi.waitFor(() => {
      expect(messenger.sendMessage).toHaveBeenCalledOnce();
    });
  });

  it('a push nobody hears is quiet', async () => {
    const { root } = register();
    messenger.sendMessage.mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    );
    await call(
      'askDataConsent',
      { id: fakeBrowser.runtime.id, url: `${root}panel.html` },
      RUCSS_ASK
    );
    await expect(
      fakeBrowser.tabs.onRemoved.trigger(41, { windowId: 3, isWindowClosing: false })
    ).resolves.not.toThrow();
  });

  it('the background check reads the real grant', async () => {
    Object.assign(fakeBrowser.permissions, {
      getAll: () => Promise.resolve({ data_collection: ['browsingActivity'] })
    });
    await expect(backgroundConsentCheck()()).resolves.toBe(true);
    Object.assign(fakeBrowser.permissions, {
      getAll: () => Promise.resolve({ data_collection: [] })
    });
    await expect(backgroundConsentCheck()()).resolves.toBe(false);
  });
});
