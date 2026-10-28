/**
 * The page notice's host lifecycle, wired for real (a real content-script
 * context, WXT's real shadow-root factory): one shadow UI across
 * show → elapse → show cycles, a notice elapsing before its render
 * resolves never leaks the tree, and the dead-context teardown. The render
 * is the deferred stand-in (the view is `notice.test`'s concern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type * as ShadowRootUi from 'wxt/utils/content-script-ui/shadow-root';
import { createLogger } from '../../../lib/logger';
import {
  renders,
  resetRenders,
  settle
} from '../../../components/injected-ui/deferred-mount.testing';
import { NOTICE_DISMISS_MS, NOTICE_HOST_NAME, createNoticeHost } from './notice';

vi.mock(
  '../../../components/injected-ui/mount',
  () => import('../../../components/injected-ui/deferred-mount.testing')
);

/** WXT's real factory, counted. */
vi.mock('wxt/utils/content-script-ui/shadow-root', async (importOriginal) => {
  const real = await importOriginal<typeof ShadowRootUi>();
  return { createShadowRootUi: vi.fn(real.createShadowRootUi) };
});

const NOTICE = { title: 'Done', body: 'Turned off.' };
const hosts = (): number => document.querySelectorAll(NOTICE_HOST_NAME).length;

let ctx: ContentScriptContext;
let seq = 0;

beforeEach(() => {
  resetRenders();
  vi.mocked(createShadowRootUi).mockClear();
  seq += 1;
  ctx = new ContentScriptContext(`notice-lifecycle-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.querySelectorAll(NOTICE_HOST_NAME).forEach((host) => {
    host.remove();
  });
  vi.useRealTimers();
});

/** Show a notice and wait for its host. */
async function showNotice(host: ReturnType<typeof createNoticeHost>): Promise<void> {
  host.show(NOTICE);
  await vi.waitFor(() => {
    expect(hosts()).toBe(1);
  });
}

describe('page notice host lifecycle', () => {
  it('cycles ONE shadow UI across notices; an early elapse disposes the late render', async () => {
    const host = createNoticeHost(ctx, createLogger('test'));
    // The countdown starts as the host lands: the clock is faked first.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await showNotice(host);
    // Elapses before the render resolved: the late tree goes at once.
    vi.advanceTimersByTime(NOTICE_DISMISS_MS);
    expect(hosts()).toBe(0);
    vi.useRealTimers();
    renders[0]?.resolve();
    await settle();
    expect(renders[0]?.disposals).toBe(1);
    await showNotice(host);
    renders[1]?.resolve();
    await settle();
    expect(createShadowRootUi).toHaveBeenCalledTimes(1);
    expect(renders[1]?.disposals).toBe(0);
  });

  it('dead-context teardown removes the shown notice once; later shows do nothing', async () => {
    const host = createNoticeHost(ctx, createLogger('test'));
    await showNotice(host);
    renders[0]?.resolve();
    await settle();
    ctx.notifyInvalidated();
    expect(hosts()).toBe(0);
    expect(renders[0]?.disposals).toBe(1);
    host.show(NOTICE);
    await settle();
    expect(hosts()).toBe(0);
  });
});
