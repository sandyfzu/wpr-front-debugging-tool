/**
 * The widget's collapse (card ↔ pill) is session-local, over the real view
 * and mount: opening the card writes no storage, a hide → show (per-site or
 * default-option cycle) comes back collapsed to the pill, and nothing about
 * the open state survives a fresh boot (a reload).
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { mutateOptions, ON_PAGE_INSPECTOR } from '../../../lib/storage/options';
import { INSPECTOR_UI_NAME } from './strip-state';
import { setupInspectorWidget } from './index';

let ctx: ContentScriptContext;
let seq = 0;

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
    manifest_version: 3,
    name: 'test',
    version: '1.0.0'
  });
  // No page-data hub runs here: the widget logs its documented failure copy.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  seq += 1;
  ctx = new ContentScriptContext(`inspector-collapse-${String(seq)}`);
});

afterEach(() => {
  ctx.notifyInvalidated();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The mounted chrome inside the widget's shadow root, once rendered. */
async function chrome(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const element = document
      .querySelector(INSPECTOR_UI_NAME)
      ?.shadowRoot?.querySelector<HTMLElement>('.ins-chrome');
    if (element == null) throw new Error('the widget chrome has not rendered yet');
    return element;
  });
}

/** A user's pointer click on the pill (the view acts on trusted input only). */
function clickPill(element: HTMLElement): void {
  const pill = element.querySelector<HTMLElement>('.ins-pill');
  if (pill === null) throw new Error('the widget pill is missing');
  const event = new MouseEvent('click', { bubbles: true, composed: true, detail: 1 });
  // A test stands in for the user: the view's trust gate reads this flag.
  Object.defineProperty(event, 'isTrusted', { value: true });
  pill.dispatchEvent(event);
}

/** Store the global default option. */
async function setDefault(enabled: boolean): Promise<void> {
  await mutateOptions((options) => ({
    ...options,
    features: { ...options.features, [ON_PAGE_INSPECTOR]: enabled }
  }));
}

describe('collapse is session-local', () => {
  it('opens without a storage write and comes back collapsed after a hide → show', async () => {
    setupInspectorWidget(ctx);
    const first = await chrome();
    const before = JSON.stringify(await fakeBrowser.storage.sync.get(null));
    clickPill(first);
    await vi.waitFor(() => {
      expect(first.classList.contains('ins-open')).toBe(true);
    });
    expect(JSON.stringify(await fakeBrowser.storage.sync.get(null))).toBe(before);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});

    await setDefault(false);
    await vi.waitFor(() => {
      expect(document.querySelector(INSPECTOR_UI_NAME)).toBeNull();
    });
    await setDefault(true);
    const again = await chrome();
    expect(again.classList.contains('ins-open')).toBe(false);
  });

  it('a fresh boot (reload) starts collapsed', async () => {
    setupInspectorWidget(ctx);
    clickPill(await chrome());
    ctx.notifyInvalidated();
    document.body.replaceChildren();
    seq += 1;
    ctx = new ContentScriptContext(`inspector-collapse-${String(seq)}`);
    setupInspectorWidget(ctx);
    expect((await chrome()).classList.contains('ins-open')).toBe(false);
  });
});
