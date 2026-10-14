/**
 * The contract-failure reload budget: one claim per streak, remembered in the
 * backing storage (so a reloaded document sees it), re-armed by `reset`, and
 * loop-safe whenever the storage cannot remember (throws or drops writes).
 */
import { describe, expect, it, vi } from 'vitest';
import { makeMemoryStorage } from './fixtures';
import { HARD_RELOAD_SPENT_KEY, createHardReloadBudget } from './hard-reload-budget';

describe('createHardReloadBudget', () => {
  it('grants exactly one claim per streak, shared by every budget over the storage', () => {
    const storage = makeMemoryStorage();
    const onError = vi.fn();
    const first = createHardReloadBudget(() => storage, onError);
    expect(first.claim()).toBe(true);
    expect(storage.getItem(HARD_RELOAD_SPENT_KEY)).not.toBeNull();
    expect(first.claim()).toBe(false);
    // A reloaded document builds a new budget over the same storage.
    const second = createHardReloadBudget(() => storage, onError);
    expect(second.claim()).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('re-arms after reset', () => {
    const storage = makeMemoryStorage();
    const budget = createHardReloadBudget(() => storage, vi.fn());
    expect(budget.claim()).toBe(true);
    budget.reset();
    expect(storage.getItem(HARD_RELOAD_SPENT_KEY)).toBeNull();
    expect(budget.claim()).toBe(true);
  });

  it('denies the claim and reports when the storage accessor throws', () => {
    const cause = new Error('SecurityError');
    const onError = vi.fn();
    const budget = createHardReloadBudget(() => {
      throw cause;
    }, onError);
    expect(budget.claim()).toBe(false);
    budget.reset();
    expect(onError).toHaveBeenNthCalledWith(1, 'claim', cause);
    expect(onError).toHaveBeenNthCalledWith(2, 'reset', cause);
  });

  it('denies the claim when a write throws (quota)', () => {
    const storage = makeMemoryStorage();
    const onError = vi.fn();
    const budget = createHardReloadBudget(
      () => ({
        ...storage,
        setItem: () => {
          throw new Error('QuotaExceededError');
        }
      }),
      onError
    );
    expect(budget.claim()).toBe(false);
    expect(onError).toHaveBeenCalledWith('claim', expect.any(Error));
  });

  it('denies the claim when the storage silently drops writes', () => {
    const budget = createHardReloadBudget(
      () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined }),
      vi.fn()
    );
    // The claim could not be remembered across a reload — refusing it is
    // the only loop-safe answer.
    expect(budget.claim()).toBe(false);
  });
});
