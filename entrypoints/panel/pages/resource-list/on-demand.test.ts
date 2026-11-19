import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createOnDemand, type OnDemandState } from './on-demand';

/** A load the test settles by hand, recording each call's source and signal. */
function manualLoad<T>(): {
  load: (value: string, signal: AbortSignal) => Promise<T>;
  calls: {
    value: string;
    signal: AbortSignal;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  }[];
} {
  const calls: {
    value: string;
    signal: AbortSignal;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  }[] = [];
  return {
    calls,
    load: (value, signal) =>
      new Promise<T>((resolve, reject) => {
        calls.push({ value, signal, resolve, reject });
      })
  };
}

/** Let the effect run and promise reactions settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createOnDemand', () => {
  it('stays idle without a source, then loads and answers', async () => {
    const { load, calls } = manualLoad<number>();
    const [source, setSource] = createSignal<string | null>(null);
    let state!: () => OnDemandState<number>;
    const dispose = createRoot((done) => {
      state = createOnDemand(source, load);
      return done;
    });
    await flush();
    expect(state()).toEqual({ status: 'idle' });
    setSource('a');
    await flush();
    expect(state()).toEqual({ status: 'loading' });
    calls[0]?.resolve(7);
    await flush();
    expect(state()).toEqual({ status: 'ready', value: 7 });
    dispose();
  });

  it('turns a rejection into failed', async () => {
    const { load, calls } = manualLoad<number>();
    let state!: () => OnDemandState<number>;
    const dispose = createRoot((done) => {
      state = createOnDemand(() => 'a', load);
      return done;
    });
    await flush();
    const error = new Error('boom');
    calls[0]?.reject(error);
    await flush();
    expect(state()).toEqual({ status: 'failed', error });
    dispose();
  });

  it('aborts the read in flight on a new source, ignoring its late answer', async () => {
    const { load, calls } = manualLoad<string>();
    const [source, setSource] = createSignal<string | null>('a');
    let state!: () => OnDemandState<string>;
    const dispose = createRoot((done) => {
      state = createOnDemand(source, load);
      return done;
    });
    await flush();
    setSource('b');
    await flush();
    expect(calls.map((call) => call.value)).toEqual(['a', 'b']);
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.resolve('late');
    calls[1]?.resolve('fresh');
    await flush();
    expect(state()).toEqual({ status: 'ready', value: 'fresh' });
    setSource(null);
    await flush();
    expect(state()).toEqual({ status: 'idle' });
    dispose();
  });

  it('aborts on unmount and never writes after it', async () => {
    const { load, calls } = manualLoad<string>();
    let state!: () => OnDemandState<string>;
    const dispose = createRoot((done) => {
      state = createOnDemand(() => 'a', load);
      return done;
    });
    await flush();
    dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    calls[0]?.reject(new Error('late'));
    await flush();
    expect(state()).toEqual({ status: 'loading' });
  });
});
