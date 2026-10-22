/**
 * The live-region announcer: every announcement is a change the region can
 * report — an identical repeat is cleared first, then written a frame
 * later; a newer announcement within the frame wins.
 */
import { describe, expect, it } from 'vitest';
import { createAnnouncer } from './announcer';

/** An announcer over a recorded region and a manual frame queue. */
function harness() {
  const writes: string[] = [];
  const frames: (() => void)[] = [];
  const announce = createAnnouncer(
    (text) => {
      writes.push(text);
    },
    (run) => {
      frames.push(run);
    }
  );
  const flush = (): void => {
    for (const run of frames.splice(0)) run();
  };
  return { writes, announce, flush };
}

describe('createAnnouncer', () => {
  it('clears the region, then writes the text on the next frame', () => {
    const { writes, announce, flush } = harness();
    announce('Copied 2 exclusions');
    expect(writes).toEqual(['']);
    flush();
    expect(writes).toEqual(['', 'Copied 2 exclusions']);
  });

  it('re-announces an identical text as a fresh change', () => {
    const { writes, announce, flush } = harness();
    announce('Copied 1 exclusion');
    flush();
    announce('Copied 1 exclusion');
    flush();
    expect(writes).toEqual(['', 'Copied 1 exclusion', '', 'Copied 1 exclusion']);
  });

  it('lets the newest announcement of a frame win', () => {
    const { writes, announce, flush } = harness();
    announce('first');
    announce('second');
    flush();
    expect(writes).toEqual(['', '', 'second']);
  });
});
