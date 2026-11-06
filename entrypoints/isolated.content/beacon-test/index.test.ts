/**
 * The module's wiring over the fake browser: a run asks the background to
 * load the runner (validated answer), reads the published runner from this
 * world's global and answers over the channel; a refused load answers
 * runner-unavailable; a malformed request is refused; the context's end
 * removes the handler.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onMessage, sendMessage } from '../../../lib/messaging/index';
import { BEACON_TEST_DEFAULTS } from '../../../lib/beacon-test/config';
import {
  BEACON_RUNNER_GLOBAL,
  publishBeaconRunner,
  type BeaconRunner
} from '../../../lib/beacon-test/runner-bridge';
import { setupBeaconTest } from '.';

const REQUEST = {
  config: { ...BEACON_TEST_DEFAULTS, features: { aboveTheFold: false, lazyRender: true } }
};

/** A runner whose runs bail at once. */
const RUNNER: BeaconRunner = {
  alive: () => true,
  start: () => ({
    done: Promise.resolve({ kind: 'bailed', reason: 'screen-size' }),
    partial: () => null,
    cancel: () => undefined
  })
};

/** A minimal live context whose invalidation the test triggers. */
function contextDouble(): ContentScriptContext & { invalidate: () => void } {
  const teardowns: (() => void)[] = [];
  return {
    isInvalid: false,
    onInvalidated: (teardown: () => void) => {
      teardowns.push(teardown);
      return () => undefined;
    },
    invalidate: () => {
      for (const teardown of teardowns) teardown();
    }
  } as unknown as ContentScriptContext & { invalidate: () => void };
}

let ctx: ReturnType<typeof contextDouble>;
let stopBackground = (): void => undefined;

beforeEach(() => {
  fakeBrowser.reset();
  ctx = contextDouble();
});

afterEach(() => {
  ctx.invalidate();
  stopBackground();
  stopBackground = () => undefined;
  Reflect.deleteProperty(globalThis, BEACON_RUNNER_GLOBAL);
  vi.restoreAllMocks();
});

describe('setupBeaconTest', () => {
  it('loads the runner through the background, then runs it over the channel', async () => {
    const load = vi.fn(() => {
      publishBeaconRunner(globalThis, RUNNER);
      return true as const;
    });
    stopBackground = onMessage('loadBeaconRunner', load);
    setupBeaconTest(ctx);
    await expect(sendMessage('runBeaconTest', REQUEST)).resolves.toEqual({
      kind: 'bailed',
      reason: 'screen-size'
    });
    await sendMessage('runBeaconTest', REQUEST);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers runner-unavailable when the background refuses the load (logged)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stopBackground = onMessage('loadBeaconRunner', () => {
      throw new Error('Cannot access contents of the page');
    });
    setupBeaconTest(ctx);
    await expect(sendMessage('runBeaconTest', REQUEST)).resolves.toEqual({
      kind: 'runner-unavailable'
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads a malformed load answer as a failed load', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    stopBackground = onMessage('loadBeaconRunner', () => 'yes' as unknown as true);
    setupBeaconTest(ctx);
    await expect(sendMessage('runBeaconTest', REQUEST)).resolves.toEqual({
      kind: 'runner-unavailable'
    });
  });

  it('refuses a malformed request', async () => {
    setupBeaconTest(ctx);
    await expect(sendMessage('runBeaconTest', { config: {} } as never)).rejects.toThrow(
      'malformed'
    );
  });

  it('stops answering once the context ends', async () => {
    setupBeaconTest(ctx);
    ctx.invalidate();
    await expect(sendMessage('runBeaconTest', REQUEST)).rejects.toThrow();
  });
});
