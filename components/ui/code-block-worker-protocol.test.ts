/**
 * The worker message contract: request and response guards (id, code type,
 * the language allow-list, the token-style shape) and the handler's answers.
 */
import { describe, expect, it } from 'vitest';
import {
  answerHighlight,
  isHighlightRequest,
  isHighlightResponse
} from './code-block-worker-protocol';

describe('isHighlightRequest', () => {
  it.each([
    [{ id: 1, code: 'x', lang: 'javascript' }, true],
    [{ id: 7, code: '', lang: 'json' }, true],
    [{ id: 0, code: 'x', lang: 'javascript' }, false],
    [{ id: -1, code: 'x', lang: 'javascript' }, false],
    [{ id: 1.5, code: 'x', lang: 'javascript' }, false],
    [{ id: Number.NaN, code: 'x', lang: 'javascript' }, false],
    [{ id: '1', code: 'x', lang: 'javascript' }, false],
    [{ id: 1, code: 3, lang: 'javascript' }, false],
    [{ id: 1, lang: 'javascript' }, false],
    [{ id: 1, code: 'x', lang: 'perl' }, false],
    [{ id: 1, code: 'x', lang: 'JavaScript' }, false],
    [{ id: 1, code: 'x' }, false],
    [null, false],
    ['request', false],
    [42, false]
  ])('%j → %s', (data, expected) => {
    expect(isHighlightRequest(data)).toBe(expected);
  });
});

describe('isHighlightResponse', () => {
  it.each([
    [{ id: 1, html: '<pre/>', styles: [] }, true],
    [{ id: 1, html: '<pre/>', styles: [['fdt-tk-a1', 'color:light-dark(#fff, #000)']] }, true],
    [{ id: 1, error: 'boom' }, true],
    [{ id: 1, error: 'boom', html: '<pre/>' }, false],
    [{ id: 1, html: '<pre/>' }, false],
    [{ id: 1, html: 3, styles: [] }, false],
    [{ id: 1, html: '<pre/>', styles: 'x' }, false],
    [{ id: 1, html: '<pre/>', styles: [['evil', 'color:red']] }, false],
    [{ id: 1, html: '<pre/>', styles: [['fdt-tk-a', 'color:red}body{display:none']] }, false],
    [{ id: 1, html: '<pre/>', styles: [['fdt-tk-a', 'color:url("x")']] }, false],
    [{ id: 0, html: '<pre/>', styles: [] }, false],
    [{ id: '1', error: 'x' }, false],
    [{ html: '<pre/>', styles: [] }, false],
    [undefined, false]
  ])('%j → %s', (data, expected) => {
    expect(isHighlightResponse(data)).toBe(expected);
  });
});

describe('answerHighlight', () => {
  it('answers with the block, keeping the request id', async () => {
    const response = await answerHighlight(
      () =>
        Promise.resolve({
          highlight: (code: string) => ({ html: `<pre>${code}</pre>`, styles: [] })
        }),
      { id: 5, code: 'x', lang: 'json' }
    );
    expect(response).toEqual({ id: 5, html: '<pre>x</pre>', styles: [] });
  });

  it('answers a throwing highlighter or loader with its message', async () => {
    const throwing = await answerHighlight(
      () =>
        Promise.resolve({
          highlight: () => {
            throw new Error('bad lang');
          }
        }),
      { id: 6, code: 'x', lang: 'javascript' }
    );
    expect(throwing).toEqual({ id: 6, error: 'bad lang' });
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection must still answer
    const odd = await answerHighlight(() => Promise.reject('gone'), {
      id: 8,
      code: 'x',
      lang: 'javascript'
    });
    expect(odd).toEqual({ id: 8, error: 'gone' });
  });
});
