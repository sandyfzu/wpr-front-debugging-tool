/**
 * The panel's search relay: the raw DevTools `onSearch` event narrows to the
 * four typed protocol actions, every relayed action is one `panelSearch`
 * message, and a send with no receiver is a logged expected case — never an
 * unhandled rejection.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onMessage, sendMessage } from '../../lib/messaging/index';
import { PANEL_SEARCH_ACTIONS } from '../../lib/wp-rocket/types';
import type { PanelSearchAction } from '../../lib/wp-rocket/types';
import { registerSearchRelay, toPanelSearchPayload } from './search-relay';

/**
 * The messaging library allows one listener per channel per context, so
 * every test installs its receiver through here and `afterEach` removes it.
 */
let removeRelayListener: (() => void) | undefined;
const relayedPayloads: PanelSearchAction[] = [];

/**
 * A panel double exposing exactly what the relay wiring touches.
 *
 * @returns The fake plus an `emit` that fires the registered listener.
 */
function fakePanel(): {
  onSearch: { addListener: (callback: unknown) => void };
  emit: (action: string, queryString?: string) => void;
} {
  let listener: ((action: string, queryString?: string) => void) | undefined;
  return {
    onSearch: {
      addListener: (callback) => {
        listener = callback as (action: string, queryString?: string) => void;
      }
    },
    emit: (action, queryString) => {
      if (listener === undefined) throw new Error('search relay never registered its listener');
      listener(action, queryString);
    }
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  relayedPayloads.length = 0;
  removeRelayListener = undefined;
});

afterEach(() => {
  removeRelayListener?.();
  vi.restoreAllMocks();
});

describe('toPanelSearchPayload', () => {
  it('maps the four DevTools actions to the typed protocol payloads', () => {
    expect(toPanelSearchPayload(PANEL_SEARCH_ACTIONS.performSearch, 'abc')).toEqual({
      action: 'performSearch',
      query: 'abc'
    });
    expect(toPanelSearchPayload(PANEL_SEARCH_ACTIONS.cancelSearch, undefined)).toEqual({
      action: 'cancelSearch'
    });
    expect(toPanelSearchPayload('nextSearchResult', undefined)).toEqual({
      action: 'nextSearchResult'
    });
    expect(toPanelSearchPayload('previousSearchResult', undefined)).toEqual({
      action: 'previousSearchResult'
    });
  });

  it('keeps an absent query a string for the boundary validator', () => {
    expect(toPanelSearchPayload(PANEL_SEARCH_ACTIONS.performSearch, undefined)).toEqual({
      action: 'performSearch',
      query: ''
    });
  });

  it('rejects everything outside the four actions', () => {
    expect(toPanelSearchPayload('findNext', undefined)).toBeNull();
    expect(toPanelSearchPayload('', undefined)).toBeNull();
  });
});

describe('registerSearchRelay', () => {
  it('relays every event it receives as an acknowledged panelSearch message', async () => {
    removeRelayListener = onMessage('panelSearch', (message) => {
      relayedPayloads.push(message.data);
      return true;
    });
    const panel = fakePanel();
    registerSearchRelay(panel);
    panel.emit('performSearch', 'asynccss');
    panel.emit('cancelSearch');
    await vi.waitFor(() => {
      expect(relayedPayloads).toEqual([
        { action: 'performSearch', query: 'asynccss' },
        { action: 'cancelSearch' }
      ]);
    });
  });

  it('drops unknown actions with a warning instead of sending', async () => {
    removeRelayListener = onMessage('panelSearch', (message) => {
      relayedPayloads.push(message.data);
      return true;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const panel = fakePanel();
    registerSearchRelay(panel);
    panel.emit('findNext', 'x');
    panel.emit('performSearch', 'kept');
    await vi.waitFor(() => {
      expect(relayedPayloads).toEqual([{ action: 'performSearch', query: 'kept' }]);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('[WPR FDT]');
    expect(debug).not.toHaveBeenCalled();
  });

  it('logs the expected no-receiver failure at debug, never unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    // Sanity: with no receiver registered, the same send the relay makes
    // really does reject in this context.
    await expect(
      sendMessage('panelSearch', { action: PANEL_SEARCH_ACTIONS.cancelSearch })
    ).rejects.toThrow();
    const panel = fakePanel();
    registerSearchRelay(panel);
    expect(() => {
      panel.emit('cancelSearch');
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(debug).toHaveBeenCalledTimes(1);
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('survives a receiver that throws — failures warn, the relay keeps relaying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    removeRelayListener = onMessage('panelSearch', () => {
      throw new Error('panel exploded');
    });
    const panel = fakePanel();
    registerSearchRelay(panel);
    expect(() => {
      panel.emit('performSearch', 'x');
    }).not.toThrow();
    panel.emit('cancelSearch');
    // Each relay still sends; both failures surface as one warn each (a
    // reached-but-failing receiver is not the expected no-receiver case),
    // none unhandled.
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(2);
    });
    expect(debug).not.toHaveBeenCalled();
  });
});
