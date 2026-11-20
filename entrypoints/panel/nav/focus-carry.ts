/**
 * Focus continuity for a control the nav renders in two forms: a form
 * switch (labeled sidebar ↔ icon rail) swaps the control's element, and
 * removing a focused element drops focus to `<body>` — the keyboard user
 * loses their place. The carry hands focus from the outgoing element to its
 * successor, so focus stays on the same logical control.
 */
import { onCleanup, onMount } from 'solid-js';

/** The ref callback each rendering of the control binds on its focusable element. */
export type FocusCarryRef = (element: HTMLElement) => void;

/**
 * Create the carry for one logical control. Bind the returned ref on the
 * focusable element of every rendering of that control.
 *
 * The outgoing element records, as its scope is disposed (it is still in
 * the document then), whether it held focus; the successor takes focus once
 * it is in the document — only when it is connected and nothing else holds
 * focus (the removal left it on `<body>`), so the carry never steals focus.
 * Create it inside the scope that owns the control's lifetime: a control
 * that leaves the nav altogether takes its pending hand-off with it.
 *
 * @returns The ref callback to bind on each rendering's focusable element.
 */
export function createFocusCarry(): FocusCarryRef {
  let handOff = false;
  return (element) => {
    // Runs after the rendering is inserted (user effects follow render effects).
    onMount(() => {
      if (!handOff) return;
      handOff = false;
      const doc = element.ownerDocument;
      const current = doc.activeElement;
      if (!element.isConnected || (current !== null && current !== doc.body)) return;
      element.focus({ preventScroll: true });
    });
    // Runs before the element leaves the document (disposal precedes removal).
    onCleanup(() => {
      handOff = element.ownerDocument.activeElement === element;
    });
  };
}
