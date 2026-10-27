import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import { tabExists } from './tab-exists';

/** A logger double. */
function logDouble() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

describe('tabExists', () => {
  it('is true when the tab read succeeds', async () => {
    const get = vi.spyOn(browser.tabs, 'get').mockResolvedValueOnce({ id: 4 } as never);
    await expect(tabExists(4, logDouble())).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(4);
  });

  it('is false (logged at debug) when the read rejects — a closed tab', async () => {
    vi.spyOn(browser.tabs, 'get').mockRejectedValueOnce(new Error('No tab with id: 4.'));
    const log = logDouble();
    await expect(tabExists(4, log)).resolves.toBe(false);
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
