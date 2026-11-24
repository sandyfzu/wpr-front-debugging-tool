/** The shared recovery words: pinned, since every tool page's buttons read them. */
import { describe, expect, it } from 'vitest';
import { RELOAD_PAGE_LABEL, RUN_AGAIN_LABEL } from './recovery-words';

describe('recovery words', () => {
  it('names the two shared recoveries', () => {
    expect(RUN_AGAIN_LABEL).toBe('Run again');
    expect(RELOAD_PAGE_LABEL).toBe('Reload page');
  });
});
