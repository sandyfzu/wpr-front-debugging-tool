/**
 * The Side-by-Side overlay's mount lifecycle, wired for real (a real
 * content-script context, WXT's real shadow-root factory, the gate item in
 * fake storage, the palette's open trigger): one shadow UI across gate
 * hide → show cycles (the gate-on re-open reuses it), a gate-off landing
 * before the render resolves never leaks the tree, and the dead-context
 * teardown. The render is the deferred stand-in (the view is `ui`'s
 * concern; no frames load here).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type * as ShadowRootUi from 'wxt/utils/content-script-ui/shadow-root';
import type * as Messaging from '../../../lib/messaging/index';
import { setPageUiGate } from '../../../lib/storage/page-ui-gate';
import {
  renders,
  resetRenders,
  settle
} from '../../../components/injected-ui/deferred-mount.testing';
import { sideBySideTriggers } from '../palette/side-by-side-triggers';
import { setupSideBySide } from './index';

vi.mock(
  '../../../components/injected-ui/mount',
  () => import('../../../components/injected-ui/deferred-mount.testing')
);

/** No background here: every ask is refused the way a missing receiver is. */
vi.mock('../../../lib/messaging/index', async (importOriginal) => {
  const real = await importOriginal<typeof Messaging>();
  return {
    ...real,
    sendMessage: () =>
      Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'))
  };
});

/** WXT's real factory, counted. */
vi.mock('wxt/utils/content-script-ui/shadow-root', async (importOriginal) => {
  const real = await importOriginal<typeof ShadowRootUi>();
  return { createShadowRootUi: vi.fn(real.createShadowRootUi) };
});

const HOST = 'wpr-fdt-side-by-side';
const hosts = (): number => document.querySelectorAll(HOST).length;
/** The open overlay's tell: the page's scroll lock. */
const scrollLocked = (): boolean => document.documentElement.style.overflow === 'hidden';

let ctx: ContentScriptContext;
let seq = 0;

beforeEach(() => {
  fakeBrowser.reset();
  resetRenders();
  vi.mocked(createShadowRootUi).mockClear();
  // The simulation ask finds no background here: logged degrades only.
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
  seq += 1;
  ctx = new ContentScriptContext(`sbs-lifecycle-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/**
 * Boot the module, let the gate's boot read land, then start an open.
 * Returns the open wrapped: an async function returning the bare promise
 * would adopt it (and wait for the render the caller has yet to resolve).
 */
async function bootAndOpen(): Promise<{ opening: Promise<void> }> {
  setupSideBySide(ctx);
  await settle();
  const opening = sideBySideTriggers().open();
  await vi.waitFor(() => {
    expect(hosts()).toBe(1);
  });
  return { opening };
}

describe('Side-by-Side mount lifecycle', () => {
  it('cycles ONE shadow UI across gate off → on (the re-open reuses it)', async () => {
    const { opening } = await bootAndOpen();
    renders[0]?.resolve();
    await opening;
    expect(scrollLocked()).toBe(true);
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await setPageUiGate(false);
      await vi.waitFor(() => {
        expect(hosts()).toBe(0);
      });
      expect(scrollLocked()).toBe(false);
      expect(renders[cycle - 1]?.disposals).toBe(1);
      await setPageUiGate(true);
      await vi.waitFor(() => {
        expect(renders).toHaveLength(cycle + 1);
      });
      expect(hosts()).toBe(1);
      renders[cycle]?.resolve();
      await vi.waitFor(() => {
        expect(scrollLocked()).toBe(true);
      });
    }
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
  });

  it('a gate-off before the render resolves aborts it; the late tree is disposed, never kept', async () => {
    const { opening } = await bootAndOpen();
    await setPageUiGate(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    expect(renders[0]?.signal?.aborted).toBe(true);
    renders[0]?.resolve();
    await opening;
    expect(renders[0]?.disposals).toBe(1);
    // The dropped open shows nothing.
    expect(scrollLocked()).toBe(false);
  });

  it('dead-context teardown removes the host once and releases the scroll lock', async () => {
    const { opening } = await bootAndOpen();
    renders[0]?.resolve();
    await opening;
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    expect(renders[0]?.disposals).toBe(1);
    expect(scrollLocked()).toBe(false);
  });
});
