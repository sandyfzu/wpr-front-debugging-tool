/**
 * The in-page search field's binding to the panel's one search store: "one
 * query, two inputs". The field and the DevTools search box drive the same
 * store; the page keeps no query of its own — only the field's raw text,
 * which must show keystrokes before the store's debounced commit lands.
 */
import { createEffect, createSignal, on, type Accessor } from 'solid-js';
import type { SearchStore } from '../../state/search';

/** The field's side of the binding. */
export interface SearchFieldBinding {
  /** The text the field shows. */
  readonly value: Accessor<string>;
  /** Field input: show it now, stream it to the store (which debounces). */
  input(raw: string): void;
  /** Clear the field and the store now (✕, Esc, "Clear search"). */
  clear(): void;
}

/**
 * Bind a field to the store. Must run inside a Solid owner (a component).
 *
 * Re-sync rule: when the committed query changes to something other than
 * the field's text, the change came from elsewhere (the DevTools box, a
 * cancel, a clear) and the field adopts it. The field's own commits always
 * equal its text — every keystroke restarts the store's debounce, so the
 * commit that lands is the latest keystroke — and never overwrite typing.
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
      search.perform(raw);
    },
    clear() {
      setValue('');
      search.cancel();
    }
  };
}
