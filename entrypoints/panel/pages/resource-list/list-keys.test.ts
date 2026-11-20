/** The calm list's key and press vocabulary. */
import { afterEach, describe, expect, it } from 'vitest';
import { isEditableTarget, listKeyIntent, pressOpensRow, type ListKeyEvent } from './list-keys';

afterEach(() => {
  document.body.innerHTML = '';
});

/** A plain key press. */
function key(name: string, extra?: Partial<ListKeyEvent>): ListKeyEvent {
  return {
    key: name,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...extra
  };
}

/** An element built from markup, attached to the document. */
function el(html: string): HTMLElement {
  document.body.innerHTML = html;
  const first = document.body.firstElementChild;
  if (!(first instanceof HTMLElement)) throw new Error('no element');
  return first;
}

describe('isEditableTarget', () => {
  it.each(['text', 'search', 'email', 'number', 'url', ''])('takes input type %j', (type) => {
    expect(isEditableTarget(el(`<input type="${type}">`))).toBe(true);
  });

  it.each(['button', 'checkbox', 'radio', 'range', 'submit'])('frees input type %s', (type) => {
    expect(isEditableTarget(el(`<input type="${type}">`))).toBe(false);
  });

  it('takes textareas, selects and contenteditable hosts', () => {
    expect(isEditableTarget(el('<textarea></textarea>'))).toBe(true);
    expect(isEditableTarget(el('<select></select>'))).toBe(true);
    const host = el('<div contenteditable="true"></div>');
    // happy-dom does not derive isContentEditable from the attribute.
    Object.defineProperty(host, 'isContentEditable', { value: true });
    expect(isEditableTarget(host)).toBe(true);
  });

  it('frees buttons, plain elements, null and non-elements', () => {
    expect(isEditableTarget(el('<button></button>'))).toBe(false);
    expect(isEditableTarget(el('<div></div>'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe('listKeyIntent', () => {
  const button = (): HTMLElement => el('<button></button>');

  it('maps ↑/↓ to moves and Esc to dismiss', () => {
    expect(listKeyIntent(key('ArrowUp'), button())).toEqual({ type: 'move', delta: -1 });
    expect(listKeyIntent(key('ArrowDown'), button())).toEqual({ type: 'move', delta: 1 });
    expect(listKeyIntent(key('Escape'), button())).toEqual({ type: 'dismiss' });
  });

  it('leaves Enter, Space and other keys to the native button', () => {
    for (const name of ['Enter', ' ', 'Tab', 'ArrowLeft', 'Home', 'a']) {
      expect(listKeyIntent(key(name), button())).toBeNull();
    }
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing', 'defaultPrevented'] as const)(
    'ignores a press with %s',
    (flag) => {
      expect(listKeyIntent(key('ArrowDown', { [flag]: true }), button())).toBeNull();
    }
  );

  it('never takes keys from an editable field', () => {
    expect(listKeyIntent(key('ArrowDown'), el('<input type="search">'))).toBeNull();
    expect(listKeyIntent(key('Escape'), el('<textarea></textarea>'))).toBeNull();
  });
});

describe('pressOpensRow', () => {
  /** A row with an open button, a copy button and a link. */
  function row() {
    const root = el(
      '<div><button data-open>Name<span data-inner>x</span></button><span data-size>1 KB</span>' +
        '<button data-copy><svg data-icon></svg></button><a href="#" data-link>l</a></div>'
    );
    const q = (selector: string): Element => {
      const found = root.querySelector(selector);
      if (found === null) throw new Error(selector);
      return found;
    };
    return { root, open: q('[data-open]'), q };
  }

  it('opens from the open button, its content and plain row areas', () => {
    const { root, open, q } = row();
    expect(pressOpensRow(open, root, open)).toBe(true);
    expect(pressOpensRow(q('[data-inner]'), root, open)).toBe(true);
    expect(pressOpensRow(q('[data-size]'), root, open)).toBe(true);
    expect(pressOpensRow(root, root, open)).toBe(true);
  });

  it('leaves presses on nested controls to them', () => {
    const { root, open, q } = row();
    expect(pressOpensRow(q('[data-copy]'), root, open)).toBe(false);
    expect(pressOpensRow(q('[data-icon]'), root, open)).toBe(false);
    expect(pressOpensRow(q('[data-link]'), root, open)).toBe(false);
  });

  it('opens nothing without an open button, a target outside the row, or a non-element', () => {
    const { root, open } = row();
    expect(pressOpensRow(root, root, null)).toBe(false);
    const outside = document.createElement('div');
    document.body.append(outside);
    expect(pressOpensRow(outside, root, open)).toBe(false);
    expect(pressOpensRow(null, root, open)).toBe(false);
  });

  it('ignores a control that encloses the whole row (the press is still the row’s)', () => {
    const outer = el(
      '<label><div data-row><span data-cell>c</span><button data-open></button></div></label>'
    );
    const rowEl = outer.querySelector('[data-row]') as Element;
    const open = outer.querySelector('[data-open]');
    expect(pressOpensRow(outer.querySelector('[data-cell]'), rowEl, open)).toBe(true);
  });
});
