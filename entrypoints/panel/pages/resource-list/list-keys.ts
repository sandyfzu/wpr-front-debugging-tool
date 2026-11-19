/**
 * The calm list's keyboard and pointer vocabulary, pure: which keys a list
 * row answers (↑/↓ move, Esc dismisses — Enter/Space are the row button's
 * native click), and which presses belong to a nested control instead.
 * Keys typed into editable fields are never taken.
 */
import type { StepDelta } from '../../../../lib/panel/list-selection';

/** What a key press asks of the list. */
export type ListKeyIntent =
  { readonly type: 'move'; readonly delta: StepDelta } | { readonly type: 'dismiss' };

/** The parts of a keyboard event the intent depends on. */
export type ListKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'
>;

/** Input types that take no typed text (their arrow keys are free). */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit'
]);

/**
 * Whether a key event's target edits text (or picks from a native list):
 * its arrows and Esc are the field's own.
 *
 * @param target The event target.
 * @returns True for text inputs, textareas, selects and contenteditable hosts.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/**
 * The list intent of a key press, or null when the list leaves it alone: a
 * modified chord (shortcuts, selection extension), a composing IME, a key
 * another handler already took, or a press inside an editable field.
 *
 * @param event The key event.
 * @param target Where it was pressed.
 * @returns `move` ±1 for ↑/↓, `dismiss` for Esc, else null.
 */
export function listKeyIntent(
  event: ListKeyEvent,
  target: EventTarget | null
): ListKeyIntent | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (isEditableTarget(target)) return null;
  switch (event.key) {
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'Escape':
      return { type: 'dismiss' };
    default:
      return null;
  }
}

/** Elements that act on their own press (a row's copy button, a link…). */
const CONTROL_SELECTOR = 'a[href],button,input,select,textarea,label,summary,[role="button"]';

/**
 * Whether a press on a row opens it: anywhere on the row except a nested
 * control other than the row's own open button (that control acts instead).
 *
 * @param target The pressed node.
 * @param row The row element (the press's bubbling owner).
 * @param openControl The row's open button (null for a row without one).
 * @returns True when the press should open the row.
 */
export function pressOpensRow(
  target: EventTarget | null,
  row: Element,
  openControl: Element | null
): boolean {
  if (openControl === null || !(target instanceof Element) || !row.contains(target)) return false;
  const control = target.closest(CONTROL_SELECTOR);
  return control === null || control === openControl || !row.contains(control);
}
