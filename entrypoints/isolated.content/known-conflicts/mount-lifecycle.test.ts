/**
 * The Known Conflicts card's mount lifecycle, wired for real (a real
 * content-script context, WXT's real shadow-root factory, the gate item in
 * fake storage): one shadow UI across gate hide → show cycles, a gate-off
 * landing before the render resolves never leaks the tree, and the
 * dead-context teardown removes the host once. The render is the deferred
 * stand-in (the view itself is `ui.test`'s concern).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type * as ShadowRootUi from 'wxt/utils/content-script-ui/shadow-root';
import { setPageUiGate } from '../../../lib/storage/page-ui-gate';
import {
  renders,
  resetRenders,
  settle
} from '../../../components/injected-ui/deferred-mount.testing';
import { setupKnownConflicts } from './index';

vi.mock(
  '../../../components/injected-ui/mount',
  () => import('../../../components/injected-ui/deferred-mount.testing')
);

/** WXT's real factory, counted. */
vi.mock('wxt/utils/content-script-ui/shadow-root', async (importOriginal) => {
  const real = await importOriginal<typeof ShadowRootUi>();
  return { createShadowRootUi: vi.fn(real.createShadowRootUi) };
});

const HOST = 'wpr-fdt-known-conflicts';
const hosts = (): number => document.querySelectorAll(HOST).length;

let ctx: ContentScriptContext;
let seq = 0;

beforeEach(() => {
  fakeBrowser.reset();
  resetRenders();
  vi.mocked(createShadowRootUi).mockClear();
  // The plugins screen is one of the card's two modes.
  window.history.replaceState(null, '', '/wp-admin/plugins.php');
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  seq += 1;
  ctx = new ContentScriptContext(`kc-lifecycle-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

/** Boot the module and wait for its first mount. */
async function bootShown(): Promise<void> {
  setupKnownConflicts(ctx);
  await vi.waitFor(() => {
    expect(hosts()).toBe(1);
  });
}

describe('Known Conflicts mount lifecycle', () => {
  it('cycles ONE shadow UI across gate off → on, each render disposed exactly once', async () => {
    await bootShown();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      renders[cycle]?.resolve();
      await settle();
      await setPageUiGate(false);
      await vi.waitFor(() => {
        expect(hosts()).toBe(0);
      });
      expect(renders[cycle]?.disposals).toBe(1);
      await setPageUiGate(true);
      await vi.waitFor(() => {
        expect(hosts()).toBe(1);
      });
    }
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
    expect(renders).toHaveLength(4);
  });

  it('a gate-off before the render resolves aborts it; the late tree is disposed, never kept', async () => {
    await bootShown();
    await setPageUiGate(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    expect(renders[0]?.signal?.aborted).toBe(true);
    renders[0]?.resolve();
    await settle();
    expect(renders[0]?.disposals).toBe(1);
    // The next show's render is the only live one; its removal disposes it alone.
    await setPageUiGate(true);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[1]?.resolve();
    await settle();
    await setPageUiGate(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    expect(renders.map((render) => render.disposals)).toEqual([1, 1]);
  });

  it('dead-context teardown removes the host once and mounts nothing afterwards', async () => {
    await bootShown();
    renders[0]?.resolve();
    await settle();
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    expect(renders[0]?.disposals).toBe(1);
    await setPageUiGate(false);
    await setPageUiGate(true);
    await settle();
    expect(hosts()).toBe(0);
    expect(renders).toHaveLength(1);
  });
});
