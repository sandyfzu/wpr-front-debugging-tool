/**
 * The detection widget's opt-in wiring, for real (a real content-script
 * context, WXT's real shadow-root factory, the options/per-site/gate items in
 * fake storage): the global default option × the per-origin entry decides
 * the mount at boot, a live option flip mounts or hides the widget on an
 * entryless page (and never on one with an entry), the shared toggle flips
 * the visible state under both defaults, a disabled origin does no widget
 * work at all, the boot read yields to a racing write and survives one
 * item's read failure, and a dead context follows no further writes. The render is
 * the deferred stand-in (the view is `strip-builder.test`'s concern).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type * as ShadowRootUi from 'wxt/utils/content-script-ui/shadow-root';
import { mutateOptions, DETECTION_WIDGET, optionsStore } from '../../../lib/storage/options';
import {
  detectionWidgetSitesStore,
  toggleDetectionWidgetSite
} from '../../../lib/storage/detection-widget-sites';
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

const ORIGIN = window.location.origin;
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
  ctx = new ContentScriptContext(`inspector-opt-in-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** Store the global default option (the options page's Save). */
async function setDefault(enabled: boolean): Promise<void> {
  await mutateOptions((options) => ({
    ...options,
    features: { ...options.features, [DETECTION_WIDGET]: enabled }
  }));
}

/** Store this origin's explicit entry. */
async function setEntry(enabled: boolean): Promise<void> {
  await detectionWidgetSitesStore.setValue({ [ORIGIN]: { enabled } });
}

/** Wait for the host count to land. */
async function expectHosts(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(hosts()).toBe(count);
  });
}

/** Let the boot reads and any watch settle, then assert a stable count. */
async function expectSteadyHosts(count: number): Promise<void> {
  await settle();
  await settle();
  expect(hosts()).toBe(count);
}

describe('boot: default option × per-origin entry', () => {
  const cases: [boolean, boolean | undefined, number][] = [
    [true, undefined, 1],
    [false, undefined, 0],
    [true, false, 0],
    [false, true, 1],
    [true, true, 1],
    [false, false, 0]
  ];
  it.each(cases)('default %s, entry %s → %i host(s)', async (defaultOn, entry, expected) => {
    await setDefault(defaultOn);
    if (entry !== undefined) await setEntry(entry);
    setupInspectorWidget(ctx);
    await (expected === 1 ? expectHosts(1) : expectSteadyHosts(0));
  });
});

/**
 * Hold one item's boot read until released (it resolves with the value read
 * before the hold, i.e. the stale one).
 */
function holdBootRead(store: { getValue: () => Promise<unknown> }): () => void {
  const real = store.getValue.bind(store);
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(store, 'getValue').mockImplementationOnce(async () => {
    const stale = await real();
    await held;
    return stale;
  });
  return release;
}

describe('boot read vs racing writes and failures', () => {
  it('an entry write racing the boot read wins over the stale read', async () => {
    const release = holdBootRead(detectionWidgetSitesStore);
    setupInspectorWidget(ctx);
    await settle();
    await setEntry(false);
    release();
    await expectSteadyHosts(0);
  });

  it('an options write racing the boot read wins over the stale read', async () => {
    const release = holdBootRead(optionsStore);
    setupInspectorWidget(ctx);
    await settle();
    await setDefault(false);
    release();
    await expectSteadyHosts(0);
  });

  it('a failed options read keeps the entry read: a later option write alone mounts', async () => {
    vi.spyOn(optionsStore, 'getValue').mockRejectedValueOnce(new Error('options read'));
    setupInspectorWidget(ctx);
    await expectSteadyHosts(0);
    await setDefault(true);
    await expectHosts(1);
  });

  it('a failed entry read keeps the options read: a later entry write alone decides', async () => {
    await setDefault(false);
    vi.spyOn(detectionWidgetSitesStore, 'getValue').mockRejectedValueOnce(new Error('sites read'));
    setupInspectorWidget(ctx);
    await expectSteadyHosts(0);
    await setEntry(true);
    await expectHosts(1);
  });

  it('both reads failing stays hidden until both inputs are written', async () => {
    vi.spyOn(optionsStore, 'getValue').mockRejectedValueOnce(new Error('options read'));
    vi.spyOn(detectionWidgetSitesStore, 'getValue').mockRejectedValueOnce(new Error('sites read'));
    setupInspectorWidget(ctx);
    await expectSteadyHosts(0);
    await setDefault(true);
    await expectSteadyHosts(0);
    await setEntry(true);
    await expectHosts(1);
  });
});

describe('live default option flips (no reload)', () => {
  it('mount/hide an entryless page as the option flips', async () => {
    setupInspectorWidget(ctx);
    await expectHosts(1);
    renders[0]?.resolve();
    await setDefault(false);
    await expectHosts(0);
    await setDefault(true);
    await expectHosts(1);
    // One shadow UI cycled across the flips.
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
  });

  it('never move a page whose origin has an entry (precedence holds both ways)', async () => {
    await setEntry(true);
    setupInspectorWidget(ctx);
    await expectHosts(1);
    await setDefault(false);
    await expectSteadyHosts(1);
    await setEntry(false);
    await expectHosts(0);
    await setDefault(true);
    await expectSteadyHosts(0);
  });

  it('an unrelated options write (appearance) neither remounts nor re-reads', async () => {
    setupInspectorWidget(ctx);
    await expectHosts(1);
    await mutateOptions((options) => ({ ...options, appearance: 'dark' }));
    await expectSteadyHosts(1);
    expect(renders).toHaveLength(1);
  });

  it('a corrupt options write degrades to the documented default (on)', async () => {
    await setDefault(false);
    setupInspectorWidget(ctx);
    await expectSteadyHosts(0);
    await fakeBrowser.storage.sync.set({ options: 'corrupted' });
    await expectHosts(1);
  });
});

describe('the shared toggle flips the visible state live', () => {
  it.each([true, false])('under default %s: hide ↔ show, every flip lands', async (defaultOn) => {
    await setDefault(defaultOn);
    setupInspectorWidget(ctx);
    await (defaultOn ? expectHosts(1) : expectSteadyHosts(0));
    await toggleDetectionWidgetSite(ORIGIN);
    await expectHosts(defaultOn ? 0 : 1);
    await toggleDetectionWidgetSite(ORIGIN);
    await expectHosts(defaultOn ? 1 : 0);
  });
});

describe('a disabled origin does no widget work', () => {
  it('no shadow UI, no render, no window listener — only the watches', async () => {
    const listen = vi.spyOn(window, 'addEventListener');
    await setEntry(false);
    setupInspectorWidget(ctx);
    await expectSteadyHosts(0);
    expect(createShadowRootUi).not.toHaveBeenCalled();
    expect(renders).toHaveLength(0);
    expect(listen.mock.calls.map(([type]) => type)).not.toContain('resize');
  });
});

describe('context cleanup', () => {
  it('a dead context follows neither the option nor the entry', async () => {
    await setDefault(false);
    setupInspectorWidget(ctx);
    await expectSteadyHosts(0);
    ctx.notifyInvalidated();
    await setDefault(true);
    await setEntry(true);
    await expectSteadyHosts(0);
    expect(createShadowRootUi).not.toHaveBeenCalled();
  });

  it('a mounted widget is removed on invalidation and stays gone across later writes', async () => {
    setupInspectorWidget(ctx);
    await expectHosts(1);
    renders[0]?.resolve();
    await settle();
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    await setDefault(false);
    await setDefault(true);
    await expectSteadyHosts(0);
    expect(renders).toHaveLength(1);
  });
});
