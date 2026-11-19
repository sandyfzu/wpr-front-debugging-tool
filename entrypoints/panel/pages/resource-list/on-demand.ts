/**
 * An on-demand read a detail view starts when it opens (a script's served
 * tag, its complete source): one load per source value, the previous one
 * aborted when the source changes or the view unmounts, so a late answer
 * never lands on the wrong row.
 */
import type { Accessor } from 'solid-js';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';

/** The read's state: nothing to read, in flight, answered, or failed. */
export type OnDemandState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'failed'; readonly error: unknown };

/** The idle state (shared: no per-read allocation). */
const IDLE = { status: 'idle' } as const;

/** The loading state (shared). */
const LOADING = { status: 'loading' } as const;

/**
 * Start a read per source value. Must run inside a Solid owner.
 *
 * @param source What to read; `null` reads nothing (idle). Compared by
 *   identity: a new value aborts the read in flight and starts another.
 * @param load The read; it gets the source and an abort signal, and its
 *   rejection becomes the `failed` state (the caller words and logs it).
 * @returns The read's state.
 */
export function createOnDemand<S, T>(
  source: Accessor<S | null>,
  load: (value: S, signal: AbortSignal) => Promise<T>
): Accessor<OnDemandState<T>> {
  const [state, setState] = createSignal<OnDemandState<T>>(IDLE);
  let controller: AbortController | undefined;
  const abort = (): void => {
    controller?.abort();
    controller = undefined;
  };
  createEffect(
    on(source, (value) => {
      abort();
      if (value === null) {
        setState(IDLE);
        return;
      }
      const current = new AbortController();
      controller = current;
      setState(LOADING);
      load(value, current.signal).then(
        (result) => {
          if (!current.signal.aborted) setState({ status: 'ready', value: result });
        },
        (error: unknown) => {
          if (!current.signal.aborted) setState({ status: 'failed', error });
        }
      );
    })
  );
  onCleanup(abort);
  return state;
}
