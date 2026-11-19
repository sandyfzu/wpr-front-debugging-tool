/**
 * Stable choice lists for {@link ChoiceGroup}: a derivation that rebuilds its
 * option objects on every input change (counts, availability) would make the
 * group's `For` drop and rebuild every segment — and the focused radio with
 * it, so a click or an arrow key leaves focus on the body. Reconciling by
 * `value` keeps each option's object (so its DOM and focus) and patches only
 * the fields that changed.
 *
 * Kept out of `choice-group.tsx`: groups whose options are static (injected
 * UIs) never pay for the store.
 */
import { createComputed } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { ChoiceOption } from './choice-group';

/**
 * A reactive option list whose entries keep their identity per `value`
 * across recomputations of `source`. Call inside a component or root (it
 * owns a computation); values must be unique within one list.
 *
 * @param source Derives the current options (may return fresh objects each run).
 * @returns The store-backed list to pass as `options`; read it, never write it.
 */
export function createKeyedChoices<T extends string, O extends ChoiceOption<T>>(
  source: () => readonly O[]
): readonly O[] {
  const [options, setOptions] = createStore<O[]>([]);
  // Synchronous (before render): the first paint already has the options.
  createComputed(() => {
    setOptions(reconcile([...source()], { key: 'value' }));
  });
  return options;
}
