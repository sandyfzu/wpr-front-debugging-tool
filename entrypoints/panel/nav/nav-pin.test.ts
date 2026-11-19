/**
 * The nav pin at runtime: the boot read never rejects (a failure logs and
 * reads `auto`), and the session state applies a pin at once, persists it,
 * and reports a failed write (log + toast) while keeping the new form.
 */
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { toast, toastItems } from '../../../components/ui/toast-store';
import type { Logger } from '../../../lib/logger';
import type { NavPin } from '../../../lib/panel/nav-mode';
import {
  NAV_PIN_FAILURE_NOTE,
  NAV_PIN_FAILURE_TITLE,
  bootNavPin,
  createNavPinState,
  type NavPinState
} from './nav-pin';

afterEach(() => {
  toast.clear();
  vi.restoreAllMocks();
});

/** A logger whose methods are traced mocks. */
function tracedLog(): {
  [level in keyof Logger]: Mock<(message: string, ...details: unknown[]) => void>;
} {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Build the state inside a root (it owns a signal). */
function stateWith(initial: NavPin, write: (pin: NavPin) => Promise<void>): NavPinState {
  return createRoot(() => createNavPinState(initial, write));
}

/** Let the persistence's promise chain settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('bootNavPin', () => {
  it('resolves the stored pin', async () => {
    const log = tracedLog();
    await expect(bootNavPin(log, () => Promise.resolve('rail'))).resolves.toBe('rail');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('degrades a failed read to auto with a warning', async () => {
    const log = tracedLog();
    await expect(
      bootNavPin(log, () => Promise.reject(new Error('Extension context invalidated')))
    ).resolves.toBe('auto');
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Sidebar pin could not be read'),
      {
        cause: { message: 'Extension context invalidated' }
      }
    );
  });
});

describe('createNavPinState', () => {
  it('starts on the boot pin and applies a set at once, then persists it', async () => {
    const write = vi.fn(() => Promise.resolve());
    const state = stateWith('auto', write);
    expect(state.pin()).toBe('auto');
    state.set('rail');
    expect(state.pin()).toBe('rail');
    expect(write).toHaveBeenCalledWith('rail');
    await settle();
    expect(toastItems()).toEqual([]);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('quota'))],
    [
      'throws synchronously',
      () => {
        throw new Error('storage gone');
      }
    ]
  ])('keeps the new pin and reports when the write %s', async (_case, write) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const state = stateWith('auto', write);
    state.set('labeled');
    expect(state.pin()).toBe('labeled');
    await settle();
    expect(toastItems()).toHaveLength(1);
    expect(toastItems()[0]).toMatchObject({
      tone: 'error',
      title: NAV_PIN_FAILURE_TITLE,
      description: NAV_PIN_FAILURE_NOTE
    });
    expect(warn).toHaveBeenCalled();
  });
});
