/**
 * The detection widget's mount lifecycle, wired for real (a real
 * content-script context, WXT's real shadow-root factory, the gate and
 * per-site items in fake storage): one shadow UI across gate and per-site
 * hide → show cycles, a hide landing before the render resolves never leaks
 * the tree, a show refused when a hide wins the creation wait, and the
 * dead-context teardown. The render is the deferred stand-in (the view is
 * `strip-builder.test`'s concern).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type * as ShadowRootUi from 'wxt/utils/content-script-ui/shadow-root';
import { setPageUiGate } from '../../../lib/storage/page-ui-gate';
import { detectionWidgetSitesStore } from '../../../lib/storage/detection-widget-sites';
import {
  renders,
  resetRenders,
  settle
} from '../../../components/injected-ui/deferred-mount.testing';
import { INSPECTOR_UI_NAME } from './strip-state';
import { setupInspectorWidget } from './index';

vi.mock(
  '../../../components/injected-ui/mount',
  () => import('../../../components/injected-ui/deferred-mount.testing')
);

/** WXT's real factory, counted. */
vi.mock('wxt/utils/content-script-ui/shadow-root', async (importOriginal) => {
  const real = await importOriginal<typeof ShadowRootUi>();
  return { createShadowRootUi: vi.fn(real.createShadowRootUi) };
});

const hosts = (): number => document.querySelectorAll(INSPECTOR_UI_NAME).length;

let ctx: ContentScriptContext;
let seq = 0;

beforeEach(() => {
  fakeBrowser.reset();
  resetRenders();
  vi.mocked(createShadowRootUi).mockClear();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'test',
    version: '1.0.0'
  });
  // No page-data hub runs here: the widget logs its documented failure copy.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  seq += 1;
  ctx = new ContentScriptContext(`inspector-lifecycle-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Boot the widget and wait for its first mount. */
async function bootShown(): Promise<void> {
  setupInspectorWidget(ctx);
  await vi.waitFor(() => {
    expect(hosts()).toBe(1);
  });
}

/** Store this origin's per-site entry (the context menu's write). */
async function setSiteEnabled(enabled: boolean): Promise<void> {
  await detectionWidgetSitesStore.setValue({ [window.location.origin]: { enabled } });
}

describe('detection widget mount lifecycle', () => {
  it('cycles ONE shadow UI across gate and per-site hide → show', async () => {
    await bootShown();
    renders[0]?.resolve();
    await settle();
    await setPageUiGate(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    await setPageUiGate(true);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[1]?.resolve();
    await settle();
    await setSiteEnabled(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    await setSiteEnabled(true);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
    expect(renders.map((render) => render.disposals)).toEqual([1, 1, 0]);
  });

  it('a hide before the render resolves aborts it; the late tree is disposed, never kept', async () => {
    await bootShown();
    await setSiteEnabled(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    expect(renders[0]?.signal?.aborted).toBe(true);
    renders[0]?.resolve();
    await settle();
    expect(renders[0]?.disposals).toBe(1);
    await setSiteEnabled(true);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    renders[1]?.resolve();
    await settle();
    await setSiteEnabled(false);
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    expect(renders.map((render) => render.disposals)).toEqual([1, 1]);
  });

  it('a hide winning the first creation wait mounts nothing', async () => {
    let release: () => void = () => undefined;
    const factory = vi.mocked(createShadowRootUi);
    const real = factory.getMockImplementation();
    if (real === undefined) throw new Error('the factory spy lost its implementation');
    factory.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return real(...args);
    });
    setupInspectorWidget(ctx);
    await vi.waitFor(() => {
      expect(factory).toHaveBeenCalledTimes(1);
    });
    await setPageUiGate(false);
    await settle();
    release();
    await settle();
    expect(hosts()).toBe(0);
    expect(renders).toHaveLength(0);
  });

  it('dead-context teardown removes the host once and mounts nothing afterwards', async () => {
    await bootShown();
    renders[0]?.resolve();
    await settle();
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    expect(renders[0]?.disposals).toBe(1);
    await setSiteEnabled(false);
    await setSiteEnabled(true);
    await settle();
    expect(hosts()).toBe(0);
    expect(renders).toHaveLength(1);
  });

  it('a failed render removes the empty host; the next show mounts it again', async () => {
    await bootShown();
    renders[0]?.reject(new Error('render exploded'));
    await vi.waitFor(() => {
      expect(hosts()).toBe(0);
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Mounting the detection widget view'),
      'render exploded'
    );
    await setSiteEnabled(false);
    await setSiteEnabled(true);
    await vi.waitFor(() => {
      expect(hosts()).toBe(1);
    });
    expect(renders).toHaveLength(2);
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
  });
});
