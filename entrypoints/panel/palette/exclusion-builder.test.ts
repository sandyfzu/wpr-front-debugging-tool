/**
 * The Exclusion Builder open attempt: the context's feature-detected seams
 * (the same mechanism the background's context menu uses — one tabs.create
 * at the page's packaged URL), a missing browser surface reporting
 * unavailable never a throw, a successful open confirming with the info
 * toast, and a failed open answering with the replacement path. The page
 * path is the registry constant, asserted here so a rename cannot drift the
 * opener away from the background's opener.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, toastItems, type ToastItem } from '../../../components/ui/toast-store';
import { EXCLUSION_BUILDER_PAGE } from '../../../lib/wp-rocket/constants';
import { openExclusionBuilder, type ExclusionBuilderDeps } from './exclusion-builder';

/** The last queued toast (the freshest framing). */
function latest(): ToastItem | undefined {
  const items = toastItems();
  return items[items.length - 1];
}

afterEach(() => {
  toast.clear();
});

/** Deps whose openTab records and optionally rejects. */
function makeDeps(options?: { fail?: Error }): ExclusionBuilderDeps {
  return {
    openTab: vi.fn((): Promise<unknown> =>
      options?.fail === undefined ? Promise.resolve(undefined) : Promise.reject(options.fail)
    ),
    pageUrl: (pagePath: string) => `chrome-extension://test-id/${pagePath}`
  };
}

describe('the packaged page constant', () => {
  it('names the builder page both openers resolve', () => {
    expect(EXCLUSION_BUILDER_PAGE).toBe('exclusion-builder.html');
  });
});

describe('openExclusionBuilder', () => {
  it('opens the packaged page URL at a tab and confirms with the toast', async () => {
    const deps = makeDeps();
    const result = await openExclusionBuilder(deps, EXCLUSION_BUILDER_PAGE);
    expect(result).toBe('opened');
    expect(deps.openTab).toHaveBeenCalledWith('chrome-extension://test-id/exclusion-builder.html');
    expect(latest()?.tone).toBe('info');
  });

  it('reports a failed open as failed with the replacement-path error toast', async () => {
    const deps = makeDeps({ fail: new Error('tab creation refused') });
    const result = await openExclusionBuilder(deps, EXCLUSION_BUILDER_PAGE);
    expect(result).toBe('failed');
    const item = latest();
    expect(item?.tone).toBe('error');
    expect(item?.description).toContain('toolbar');
    expect(item?.description).not.toContain('tab creation refused');
  });

  it('never throws past the attempt (a throw is a wiring bug the result carries)', async () => {
    await expect(
      openExclusionBuilder(
        { openTab: () => Promise.resolve(undefined), pageUrl: () => 'about:blank' },
        EXCLUSION_BUILDER_PAGE
      )
    ).resolves.toBe('opened');
  });
});
