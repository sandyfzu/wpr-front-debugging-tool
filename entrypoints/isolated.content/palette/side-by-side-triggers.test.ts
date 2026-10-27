/**
 * The compare module's trigger slot: absent until provided (a named
 * failure, never a guess), provided for the provider's lifetime, emptied by
 * its invalidation — but never by an older provider's.
 */
import { describe, expect, it } from 'vitest';
import {
  provideSideBySideTriggers,
  sideBySideTriggers,
  type SideBySideTriggers
} from './side-by-side-triggers';

/** A provider context whose invalidation the test fires. */
function context() {
  const callbacks: Array<() => void> = [];
  return {
    onInvalidated: (callback: () => void) => {
      callbacks.push(callback);
      return () => undefined;
    },
    invalidate: () => {
      for (const callback of callbacks) callback();
    }
  };
}

/** A trigger pair. */
function triggers(): SideBySideTriggers {
  return { open: () => Promise.resolve(), openPerformance: () => undefined };
}

describe('side-by-side triggers', () => {
  it('names the missing module when nothing provided the triggers', () => {
    expect(() => sideBySideTriggers()).toThrow(
      'The Side-by-Side module is not running on this page'
    );
  });

  it('hands out the provided triggers until the provider dies', () => {
    const ctx = context();
    const provided = triggers();
    provideSideBySideTriggers(ctx, provided);
    expect(sideBySideTriggers()).toBe(provided);
    ctx.invalidate();
    expect(() => sideBySideTriggers()).toThrow();
  });

  it('keeps a newer provider’s triggers when an older one dies', () => {
    const older = context();
    const newer = context();
    provideSideBySideTriggers(older, triggers());
    const current = triggers();
    provideSideBySideTriggers(newer, current);
    older.invalidate();
    expect(sideBySideTriggers()).toBe(current);
    newer.invalidate();
  });
});
