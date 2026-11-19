/** The master–detail's pure helpers (the controller is covered on the page harness, `calm-list.test.tsx`). */
import { afterEach, describe, expect, it } from 'vitest';
import { positionLabel, ROW_KEY_ATTRIBUTE, rowKeyOf } from './master-detail';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('rowKeyOf', () => {
  it('reads the key of the row an event came from, through nested content', () => {
    document.body.innerHTML = `<div ${ROW_KEY_ATTRIBUTE}="https://x/a.js#2"><button><span id="in">a</span></button></div><p id="out"></p>`;
    expect(rowKeyOf(document.getElementById('in'))).toBe('https://x/a.js#2');
    expect(rowKeyOf(document.getElementById('out'))).toBeNull();
    expect(rowKeyOf(null)).toBeNull();
    expect(rowKeyOf(document)).toBeNull();
  });

  it('names the attribute the calm list stamps', () => {
    expect(ROW_KEY_ATTRIBUTE).toBe('data-fdt-row-key');
  });
});

describe('positionLabel', () => {
  it('is 1-based with grouped digits', () => {
    expect(positionLabel({ index: 0, count: 1 })).toBe('1 of 1');
    expect(positionLabel({ index: 1203, count: 5000 })).toBe('1,204 of 5,000');
  });
});
