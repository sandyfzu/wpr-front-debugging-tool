/** Fetch rejections classified: an abort or timeout signal vs a transport failure. */
import { describe, expect, it } from 'vitest';
import { fetchFailureKind } from './fetch-failure';

describe('fetchFailureKind', () => {
  it.each([
    [new DOMException('timed out', 'TimeoutError'), 'timeout'],
    [new DOMException('aborted', 'AbortError'), 'timeout'],
    [new DOMException('other', 'NetworkError'), 'network-error'],
    [new TypeError('Failed to fetch'), 'network-error'],
    ['a string', 'network-error'],
    [undefined, 'network-error']
  ])('reads %s as %s', (cause, kind) => {
    expect(fetchFailureKind(cause)).toBe(kind);
  });
});
