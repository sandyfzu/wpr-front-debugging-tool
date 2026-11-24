/**
 * The host-body style guard: each library close-time write it undoes (the
 * removed attribute, the reassigned `pointer-events`), the page edits it
 * keeps, and the microtask timing it relies on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { guardBodyStyleThroughClose, restoreBodyStyle } from './host-body-style';

/** A detached body-like element (no shared document state between tests). */
function element(style: string | null): HTMLElement {
  const node = document.createElement('div');
  if (style !== null) node.setAttribute('style', style);
  return node;
}

describe('restoreBodyStyle', () => {
  it.each(['', ' ', 'foo:bar', 'pointer-events: auto;'])(
    'puts back the removed attribute text %j verbatim',
    (text) => {
      const body = element(null);
      restoreBodyStyle(body, { attribute: text, pointerEvents: '' });
      expect(body.getAttribute('style')).toBe(text);
    }
  );

  it('puts back a reassigned pointer-events and keeps the other declarations', () => {
    const body = element('color: red; pointer-events: none;');
    restoreBodyStyle(body, {
      attribute: 'color: red; pointer-events: auto;',
      pointerEvents: 'auto'
    });
    expect(body.style.pointerEvents).toBe('auto');
    expect(body.style.color).toBe('red');
  });

  it('removes a pointer-events the body did not have, leaving no empty attribute behind', () => {
    const body = element('pointer-events: none;');
    restoreBodyStyle(body, { attribute: null, pointerEvents: '' });
    expect(body.hasAttribute('style')).toBe(false);
  });

  it('removes only the added pointer-events when other declarations remain', () => {
    const body = element('color: red; pointer-events: none;');
    restoreBodyStyle(body, { attribute: null, pointerEvents: '' });
    expect(body.style.pointerEvents).toBe('');
    expect(body.style.color).toBe('red');
  });

  it('puts the attribute back when removing pointer-events dropped it', () => {
    const body = element('pointer-events: none;');
    restoreBodyStyle(body, { attribute: ' ', pointerEvents: '' });
    expect(body.getAttribute('style')).toBe(' ');
  });

  it('changes nothing when the body is as it was', () => {
    const body = element('color: red;');
    restoreBodyStyle(body, { attribute: 'color: red;', pointerEvents: '' });
    expect(body.getAttribute('style')).toBe('color: red;');
    const bare = element(null);
    restoreBodyStyle(bare, { attribute: null, pointerEvents: '' });
    expect(bare.hasAttribute('style')).toBe(false);
  });
});

describe('guardBodyStyleThroughClose', () => {
  afterEach(() => {
    document.body.style.cssText = '';
    document.body.removeAttribute('style');
  });

  it('undoes a synchronous attribute removal a microtask later', async () => {
    document.body.setAttribute('style', 'foo:bar');
    guardBodyStyleThroughClose(document.body);
    document.body.removeAttribute('style');
    expect(document.body.hasAttribute('style')).toBe(false);
    await Promise.resolve();
    expect(document.body.getAttribute('style')).toBe('foo:bar');
  });

  it('keeps an edit made before the guard reads the body', async () => {
    document.body.setAttribute('style', ' ');
    document.body.style.color = 'red';
    guardBodyStyleThroughClose(document.body);
    await Promise.resolve();
    expect(document.body.getAttribute('style')).toBe('color: red;');
  });

  it('is a no-op without a body', () => {
    expect(() => {
      guardBodyStyleThroughClose(null);
      guardBodyStyleThroughClose(undefined);
    }).not.toThrow();
  });
});
