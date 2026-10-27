/**
 * The in-page executor contract, over the shipped mechanisms: the storage
 * rows run the real `toggleInspectorOrigin` / `setPageUiGate` against the
 * fake extension storage (the same writes the menu and the gate followers
 * see), the compare and builder rows call their injected triggers exactly
 * once, every builder open outcome maps to its user-facing result, and a
 * throwing mechanism becomes a failed outcome — never a rejection.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInspectorOrigins } from '../storage/inspector-origins';
import { readPageUiEnabled } from '../storage/page-ui-gate';
import type { ExclusionOverlayOpenOutcome } from '../messaging/exclusion-panel';
import {
  STORAGE_MECHANISMS,
  createPageCommandExecutors,
  runPageCommand,
  type PageCommandMechanisms
} from './executors';

const SITE = { origin: 'https://example.test' } as const;

/** The mechanisms: real storage writers, recorded triggers. */
function mechanisms(overrides: Partial<PageCommandMechanisms> = {}) {
  const triggers = {
    openSideBySide: vi.fn(() => Promise.resolve()),
    openSideBySidePerformance: vi.fn(),
    openExclusionBuilder: vi.fn((): Promise<ExclusionOverlayOpenOutcome> =>
      Promise.resolve('injected')
    )
  };
  const bound: PageCommandMechanisms = { ...STORAGE_MECHANISMS, ...triggers, ...overrides };
  return { triggers, executors: createPageCommandExecutors(bound) };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('storage-backed rows (the real writers)', () => {
  it('toggles the detection widget for the page origin, flipping on every run', async () => {
    const { executors } = mechanisms();
    await expect(executors['toggle-detection-widget'](SITE)).resolves.toEqual({ ok: true });
    expect(await getInspectorOrigins()).toEqual({ [SITE.origin]: { enabled: false } });
    await executors['toggle-detection-widget'](SITE);
    expect(await getInspectorOrigins()).toEqual({ [SITE.origin]: { enabled: true } });
  });

  it('refuses an opaque origin instead of writing a "null" site key', async () => {
    const { executors } = mechanisms();
    await expect(executors['toggle-detection-widget']({ origin: 'null' })).resolves.toEqual({
      ok: false,
      failure: 'This page has no web address to toggle.'
    });
    expect(await getInspectorOrigins()).toEqual({});
  });

  it('turns the on-page UI gate off (the off direction only)', async () => {
    const { executors } = mechanisms();
    expect(await readPageUiEnabled()).toBe(true);
    await expect(executors['page-ui-gate'](SITE)).resolves.toEqual({ ok: true });
    expect(await readPageUiEnabled()).toBe(false);
    // A second run stays off (never a toggle back on).
    await executors['page-ui-gate'](SITE);
    expect(await readPageUiEnabled()).toBe(false);
  });
});

describe('trigger rows', () => {
  it('opens Side-by-Side through its trigger, once', async () => {
    const { executors, triggers } = mechanisms();
    await expect(executors['side-by-side'](SITE)).resolves.toEqual({ ok: true });
    expect(triggers.openSideBySide).toHaveBeenCalledTimes(1);
    expect(triggers.openSideBySidePerformance).not.toHaveBeenCalled();
  });

  it('starts the PageSpeed Insights flow through its trigger, once', async () => {
    const { executors, triggers } = mechanisms();
    await expect(executors['psi-side-by-side'](SITE)).resolves.toEqual({ ok: true });
    expect(triggers.openSideBySidePerformance).toHaveBeenCalledTimes(1);
    expect(triggers.openSideBySide).not.toHaveBeenCalled();
  });

  it.each([
    ['injected', { ok: true }],
    ['revealed', { ok: true }],
    [
      'unsupported-page',
      { ok: false, failure: 'The browser does not let extensions open it on this page.' }
    ],
    ['not-html', { ok: false, failure: 'This page is not an HTML page.' }],
    ['tab-gone', { ok: false, failure: 'The tab closed before it opened.' }],
    [
      'failed',
      { ok: false, failure: 'Opening it failed. Try again from the toolbar button’s menu.' }
    ]
  ] as const)('maps the builder open outcome %s', async (outcome, expected) => {
    const { executors } = mechanisms({
      openExclusionBuilder: () => Promise.resolve(outcome)
    });
    await expect(executors['exclusion-builder'](SITE)).resolves.toEqual(expected);
  });
});

describe('runPageCommand', () => {
  it('passes a settled outcome through untouched', async () => {
    const { executors } = mechanisms();
    const onError = vi.fn();
    await expect(runPageCommand(executors, 'side-by-side', SITE, onError)).resolves.toEqual({
      ok: true
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('turns a rejecting mechanism into a failed outcome and reports the cause', async () => {
    const cause = new Error('module not running');
    const { executors } = mechanisms({ openSideBySide: () => Promise.reject(cause) });
    const onError = vi.fn();
    await expect(runPageCommand(executors, 'side-by-side', SITE, onError)).resolves.toEqual({
      ok: false,
      failure: 'Something went wrong. Try again from the right-click menu.'
    });
    expect(onError).toHaveBeenCalledWith(cause);
  });

  it('turns a synchronously throwing mechanism into a failed outcome', async () => {
    const { executors } = mechanisms({
      openSideBySidePerformance: () => {
        throw new Error('no trigger');
      }
    });
    const onError = vi.fn();
    const outcome = await runPageCommand(executors, 'psi-side-by-side', SITE, onError);
    expect(outcome.ok).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected storage write as a failure (the platform rejecting)', async () => {
    const { executors } = mechanisms({
      setPageUiGate: () => Promise.reject(new Error('Extension context invalidated.'))
    });
    const onError = vi.fn();
    const outcome = await runPageCommand(executors, 'page-ui-gate', SITE, onError);
    expect(outcome.ok).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
