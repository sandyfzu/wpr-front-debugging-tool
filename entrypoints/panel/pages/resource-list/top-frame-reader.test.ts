/** The detail reads' shared failure words, and both detail tables carrying them. */
import { describe, expect, it } from 'vitest';
import { SERVED_TAG_NOTES } from '../javascript/script-detail';
import { STYLE_SOURCE_NOTES } from '../stylesheets/style-detail';
import { READ_FAILURE_NOTES } from './top-frame-reader';

describe('READ_FAILURE_NOTES', () => {
  it('words each transport failure with its way back', () => {
    expect(READ_FAILURE_NOTES).toEqual({
      'invalid-request': 'The page refused the request — refresh to try again.',
      unreachable: 'The page did not answer — refresh to try again.',
      unreadable: 'The page answered something unreadable — refresh to try again.'
    });
  });

  it('is the one wording of both detail reads', () => {
    for (const [failure, note] of Object.entries(READ_FAILURE_NOTES)) {
      expect(SERVED_TAG_NOTES[failure as keyof typeof SERVED_TAG_NOTES]).toBe(note);
      expect(STYLE_SOURCE_NOTES[failure as keyof typeof STYLE_SOURCE_NOTES]).toBe(note);
    }
  });
});
