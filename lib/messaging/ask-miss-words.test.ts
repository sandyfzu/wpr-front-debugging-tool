/** The shared miss titles: one distinct, non-empty headline per miss kind. */
import { describe, expect, it } from 'vitest';
import { ASK_MISS_TITLES } from './ask-miss-words';

describe('ASK_MISS_TITLES', () => {
  it('names every miss kind with its own headline', () => {
    expect(ASK_MISS_TITLES).toEqual({
      'no-receiver': "The page isn't listening",
      timeout: "The page didn't answer in time",
      'invalid-reply': "The page's answer was unreadable",
      failed: "Couldn't reach the page"
    });
    expect(new Set(Object.values(ASK_MISS_TITLES)).size).toBe(4);
  });
});
