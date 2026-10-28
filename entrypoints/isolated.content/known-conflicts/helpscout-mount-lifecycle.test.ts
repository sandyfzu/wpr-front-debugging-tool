// @vitest-environment-options {"url":"https://secure.helpscout.net/conversation/123"}
/**
 * The Known Conflicts card's mount lifecycle in HelpScout mode, where a
 * MutationObserver on `<body>` drives rescans and the card's host mounts
 * under that same `<body>`: the card's own mount/unmount never counts as
 * page churn, and a render that always fails is attempted once per gate
 * cycle — never in a self-feeding loop (one error, not one per rescan).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { setPageUiGate } from '../../../lib/storage/page-ui-gate';
import { renders, resetRenders } from '../../../components/injected-ui/deferred-mount.testing';
import { extractScanText } from './extract';
import type * as Extract from './extract';
import { setupKnownConflicts } from './index';

vi.mock(
  '../../../components/injected-ui/mount',
  () => import('../../../components/injected-ui/deferred-mount.testing')
);

/** The pass's extraction, counted: one call = one scan pass ran. */
vi.mock('./extract', async (importOriginal) => {
  const real = await importOriginal<typeof Extract>();
  return { ...real, extractScanText: vi.fn(real.extractScanText) };
});

const HOST = 'wpr-fdt-known-conflicts';
const hosts = (): number => document.querySelectorAll(HOST).length;
/** Past the HelpScout rescan debounce. */
const PAST_DEBOUNCE_MS = 600;

let ctx: ContentScriptContext;
let seq = 0;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  fakeBrowser.reset();
  resetRenders();
  vi.mocked(extractScanText).mockClear();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  seq += 1;
  ctx = new ContentScriptContext(`kc-helpscout-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The card's render-failure log lines so far. */
const renderErrors = (): number =>
  error.mock.calls.filter((call: unknown[]) => String(call[0]).includes('Known Conflicts view'))
    .length;

/** Boot the module and wait for the first render to start. */
async function bootRendering(): Promise<void> {
  setupKnownConflicts(ctx);
  await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
  await vi.waitFor(() => {
    expect(renders).toHaveLength(1);
  });
}

describe('Known Conflicts in HelpScout mode', () => {
  it('an always-failing render is tried once, not re-mounted by its own host churn', async () => {
    await bootRendering();
    renders[0]?.reject(new Error('render exploded'));
    for (let cycle = 0; cycle < 6; cycle += 1) {
      // Real page churn keeps rescanning; the failure stays latched.
      document.body.append(document.createElement('div'));
      await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
    }
    expect(hosts()).toBe(0);
    expect(renders).toHaveLength(1);
    expect(renderErrors()).toBe(1);
    // A gate cycle (the owner's hide) retries — once.
    await setPageUiGate(false);
    await setPageUiGate(true);
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
    await vi.waitFor(() => {
      expect(renders).toHaveLength(2);
    });
  });

  it('the card host joining or leaving triggers no rescan; page churn still does', async () => {
    await bootRendering();
    renders[0]?.resolve();
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
    expect(hosts()).toBe(1);
    const passes = vi.mocked(extractScanText).mock.calls.length;
    // Only the card's own host moves: no pass.
    const host = document.querySelector(HOST);
    if (host === null) throw new Error('the card host is missing');
    host.remove();
    document.body.append(host);
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
    expect(vi.mocked(extractScanText).mock.calls.length).toBe(passes);
    // A page node: one debounced pass.
    document.body.append(document.createElement('table'));
    await vi.advanceTimersByTimeAsync(PAST_DEBOUNCE_MS);
    expect(vi.mocked(extractScanText).mock.calls.length).toBe(passes + 1);
  });
});
