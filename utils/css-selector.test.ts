/** Selector validity by the DOM's own parser, with no effect on the document. */
import { describe, expect, it } from 'vitest';
import { isValidSelector } from './css-selector';

describe('isValidSelector', () => {
  it.each(['img', 'a, b', 'div > p:not(.x)', '[data-x="1"]', '*'])('accepts %s', (selector) => {
    expect(isValidSelector(document, selector)).toBe(true);
  });

  it.each(['', 'div[', ':::', 'a,,b'])('refuses %j', (selector) => {
    expect(isValidSelector(document, selector)).toBe(false);
  });

  it('never touches the document', () => {
    document.body.innerHTML = '<img>';
    const before = document.body.innerHTML;
    isValidSelector(document, 'img');
    expect(document.body.innerHTML).toBe(before);
  });
});
