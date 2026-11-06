/** The shared settings-store shape over a toy spec: tolerant reads, strict snapshot writes, watch. */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineValidatedConfigStore } from './validated-config-store';

/** A toy settings value. */
interface Toy {
  readonly name: string;
}

const KEY = 'local:toy-settings';
const FALLBACK: Toy = { name: 'default' };

/** Tolerant: a non-string name reads as the default. */
function parse(input: unknown): Toy {
  const name = (input as { name?: unknown } | null)?.name;
  return { name: typeof name === 'string' ? name : FALLBACK.name };
}

/** Strict: names over 5 characters are refused. */
function findProblem(input: unknown): string | null {
  const name = (input as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') return 'name is not text';
  return name.length > 5 ? 'name is over 5 characters' : null;
}

const store = defineValidatedConfigStore<Toy>({
  key: KEY,
  fallback: FALLBACK,
  parse,
  findProblem,
  label: 'toy settings'
});

beforeEach(() => {
  fakeBrowser.reset();
});

describe('defineValidatedConfigStore', () => {
  it('reads the fallback fresh, round-trips under the key, and parses a corrupt value', async () => {
    expect(await store.get()).toEqual(FALLBACK);
    await store.set({ name: 'abc' });
    expect(await fakeBrowser.storage.local.get('toy-settings')).toEqual({
      'toy-settings': { name: 'abc' }
    });
    await fakeBrowser.storage.local.set({ 'toy-settings': { name: 7, extra: true } });
    expect(await store.get()).toEqual(FALLBACK);
  });

  it('refuses an invalid value with the labelled problem and keeps the stored one', async () => {
    await store.set({ name: 'ok' });
    await expect(store.set({ name: 'too long' })).rejects.toThrow(
      new RangeError('Invalid toy settings: name is over 5 characters')
    );
    expect(await store.get()).toEqual({ name: 'ok' });
  });

  it('validates and stores one snapshot (an accessor is read once) and refuses non-plain data', async () => {
    let reads = 0;
    const shifty = {
      get name(): string {
        reads += 1;
        return reads === 1 ? 'a' : 'way too long';
      }
    };
    await store.set(shifty);
    expect(reads).toBe(1);
    expect(await store.get()).toEqual({ name: 'a' });
    await expect(store.set({ name: (() => 'x') as unknown as string })).rejects.toThrow(
      new RangeError('Invalid toy settings: not plain data')
    );
  });

  it('delivers parsed values to watchers (a removal as the fallback) until unsubscribed', async () => {
    const seen = vi.fn<(value: Toy) => void>();
    const stop = store.watch(seen);
    await store.set({ name: 'b' });
    await fakeBrowser.storage.local.remove('toy-settings');
    await vi.waitFor(() => {
      expect(seen).toHaveBeenCalledTimes(2);
    });
    expect(seen.mock.calls.map(([value]) => value)).toEqual([{ name: 'b' }, FALLBACK]);
    stop();
    await store.set({ name: 'c' });
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
