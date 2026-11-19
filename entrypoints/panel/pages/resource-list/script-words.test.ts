/** The shared script words: kind labels and the URL copy's name. */
import { describe, expect, it } from 'vitest';
import { SCRIPT_KIND_LABELS, SCRIPT_URL_COPY_LABEL } from './script-words';

describe('script words', () => {
  it('names a script by where its code lives, and its URL copy', () => {
    expect(SCRIPT_KIND_LABELS).toEqual({ inline: 'Inline script', external: 'External script' });
    expect(SCRIPT_URL_COPY_LABEL).toBe('Script URL');
  });
});
