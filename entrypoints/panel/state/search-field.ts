/**
 * The in-page search field's binding to the panel's one search store: "one
 * query, two inputs". The field and the DevTools search box drive the same
 * store; a field keeps no query of its own — only its raw text, which must
 * show keystrokes before the store's debounced commit lands. Every list page
 * binds through this seam, so the re-sync and Escape rules exist once.
 */
import { createComputed, createEffect, createSignal, on, type Accessor } from 'solid-js';
import type { SearchStore } from './search';

/** The field's side of the binding. */
export interface SearchFieldBinding {
  /** The text the field shows. */
  readonly value: Accessor<string>;
  /** Field input: show it now, stream it to the store (which debounces). */
  input(raw: string): void;
  /** Clear the field and the store now (✕, Esc, "Clear search"). */
  clear(): void;
  /**
   * Keydown handler for the field's wrapping controls: Escape in this
   * binding's search input clears it while it shows text (the panel-wide Esc
   * rule). Attach per page — each page owns one field.
   */
  readonly onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Bind a field to the store. Must run inside a Solid owner (a component).
 * Production binds exactly one field per page; a second binding on the same
 * store merely mirrors the committed store query.
 *
 * Re-sync rules, against two store events:
 *
 * - **Committed query changed** — the query came from the DevTools box, a
 *   cancel or a route reset unless it equals the field's own text (every
 *   keystroke restarts the store's debounce, so a field-driven commit always
 *   lands equal to the field); the field adopts anything else, typing is
 *   never clobbered.
 * - **Delivery revision changed without this field's write** — the store was
 *   driven elsewhere while this field's text may still be uncommitted
 *   (pending debounce). The field adopts the committed query at once: a
 *   find-bar cancel drops a field's pending echo even when the committed
 *   query is already empty and fires no query change, and a find-bar keystroke
 *   is the query's new owner from that keystroke on.
 *
 * Limitation: the other direction has no channel — the platform offers no
 * setter for the DevTools search box's text, so typing here never shows
 * there.
 *
 * @param search The panel's search store.
 * @returns The field binding.
 */
export function bindSearchField(search: SearchStore): SearchFieldBinding {
  const [value, setValue] = createSignal(search.query());
  // One-shot marker for a delivery the field itself drove: the store bumps
  // its revision synchronously inside `input`/`clear`, and this computed runs
  // inside that same call — after the bump but before any post-call
  // bookkeeping could run. The flag is set before the store call and consumed
  // by the first resulting run, so the field never adopts its own write.
  let ownWrite = false;
  /** Reset the field and the store now (✕, Esc, "Clear search"). */
  const clear = (): void => {
    setValue('');
    ownWrite = true;
    search.cancel();
  };
  // Derived-phase rule (createComputed, not an effect): a foreign delivery
  // must re-sync the field text in the same reactive wave, before the input
  // attribute reads the value — an effect would render the stale echo first.
  createComputed(
    on(
      search.revision,
      () => {
        if (ownWrite) {
          ownWrite = false;
          return;
        }
        // A foreign delivery owns the query from its keystroke/cancel on:
        // adopt the committed query, pending echo or not.
        setValue(search.query());
      },
      { defer: true }
    )
  );
  // A committed query that differs from the field's text came from elsewhere
  // (the commit never lands ahead of its own echo). Belt for the revision rule
  // above: `on` runs untracked, so that computed tracks exactly `revision` —
  // and the query a delivery commits one debounce window later never bumps it
  // (commits never bump). Solely this effect lands it: a foreign
  // `perform('x')` delivers the then-committed echo, and when the debounced
  // commit lands `'x'` it is adopted here. The field's own commits always land
  // equal to its echo and stay no-ops.
  createEffect(
    on(
      search.query,
      (committed) => {
        if (committed !== value()) setValue(committed);
      },
      { defer: true }
    )
  );
  return {
    value,
    input(raw) {
      setValue(raw);
      ownWrite = true;
      search.perform(raw);
    },
    clear,
    onKeyDown(event) {
      if (event.key !== 'Escape' || value() === '') return;
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'search') return;
      event.preventDefault();
      clear();
    }
  };
}
