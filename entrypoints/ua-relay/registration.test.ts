/**
 * The relay entrypoint's registration envelope: the document-start pins are
 * read off the real definition the bundler registers — every http/https
 * document, in every frame (the overlay halves redirect cross-origin, and
 * the answer must live inside redirected frames too).
 */
import { describe, expect, it } from 'vitest';
import relayDefinition from '../ua-relay.content';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';

describe('the isolated-world relay registration envelope', () => {
  it('runs at document start in every frame, on the default isolated world, on every http/https document', () => {
    expect(relayDefinition.matches).toEqual(URL_PATTERNS);
    expect(relayDefinition.runAt).toBe('document_start');
    expect(relayDefinition.allFrames).toBe(true);
    // The world option is deliberately unset: the default ISOLATED world is
    // the only correct one, and the absence of the key pins that.
    expect('world' in relayDefinition).toBe(false);
    expect(typeof relayDefinition.main).toBe('function');
  });
});
