/** The inspected address: label, state decisions and the follow-the-settle reader. */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { makeFdtData } from '../state/fixtures';
import type { DataState } from '../state/fdt-state-machine';
import { addressAction, createPageAddress, pageAddressLabel } from './page-address';

describe('pageAddressLabel', () => {
  it.each([
    ['https://example.com/', 'example.com'],
    ['https://example.com', 'example.com'],
    ['http://127.0.0.1:8493/?fdt-delay=1', '127.0.0.1:8493/?fdt-delay=1'],
    ['https://example.com/shop/cart/?p=2#top', 'example.com/shop/cart/?p=2'],
    ['https://user:pw@example.com/a', 'example.com/a']
  ])('%s → %s', (url, label) => {
    expect(pageAddressLabel(url)).toBe(label);
  });

  it.each(['chrome://settings/', 'file:///tmp/a.html', 'not a url', ''])(
    'rejects a non-http(s) answer (%s)',
    (url) => {
      expect(pageAddressLabel(url)).toBeNull();
    }
  );
});

describe('addressAction', () => {
  const data = makeFdtData();
  it.each([
    [
      { status: 'ready', data, fetchedAt: 5 },
      { kind: 'read', stamp: 5 }
    ],
    [{ status: 'idle' }, { kind: 'keep' }],
    [{ status: 'fetching' }, { kind: 'keep' }],
    [{ status: 'refreshing', data, requestedAt: 5 }, { kind: 'keep' }],
    [{ status: 'error', cause: 'x', hardReload: false }, { kind: 'clear' }],
    [{ status: 'unavailable', reason: 'x' }, { kind: 'clear' }]
  ] as Array<[DataState, ReturnType<typeof addressAction>]>)('%o', (state, action) => {
    expect(addressAction(state)).toEqual(action);
  });
});

describe('createPageAddress', () => {
  it('reads again after a flight even when the settle stamp repeats', async () => {
    const data = makeFdtData();
    const read = vi.fn(() => Promise.resolve('https://example.com/'));
    await createRoot(async (dispose) => {
      const [state, setState] = createSignal<DataState>({ status: 'fetching' });
      const address = createPageAddress(state, read);
      setState({ status: 'ready', data, fetchedAt: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(read).toHaveBeenCalledTimes(1);
      expect(address()).toEqual({ url: 'https://example.com/', label: 'example.com' });
      // A push: same settle, no read.
      setState({ status: 'ready', data: makeFdtData(), fetchedAt: 1 });
      expect(read).toHaveBeenCalledTimes(1);
      // A flight, then a settle on the very same millisecond: read again.
      setState({ status: 'refreshing', data, requestedAt: 1 });
      expect(address()).not.toBeNull(); // kept while the flight is up
      setState({ status: 'ready', data, fetchedAt: 1 });
      expect(read).toHaveBeenCalledTimes(2);
      dispose();
    });
  });
});
