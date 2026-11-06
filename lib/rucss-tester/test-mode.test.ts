/** TEST MODE words: the repeat-run warning's count forms. */
import { describe, expect, it } from 'vitest';
import { RUCSS_UNCONFIRMED_REPEAT_WARNING, rucssRepeatRunWarning } from './test-mode';

describe('rucssRepeatRunWarning', () => {
  it('names one earlier test, or how many', () => {
    expect(rucssRepeatRunWarning(1)).toBe(
      "A test already replaced this page's styles. Reload for a clean run, or run this test on top of the current result."
    );
    expect(rucssRepeatRunWarning(3)).toMatch(/^3 tests already replaced this page's styles\./);
  });

  it('words an unconfirmed earlier test as a possibility, with the same two choices', () => {
    expect(RUCSS_UNCONFIRMED_REPEAT_WARNING).toMatch(/^An earlier test may have replaced/);
    expect(RUCSS_UNCONFIRMED_REPEAT_WARNING).toContain('Reload for a clean run');
  });
});
