/**
 * The scan surface's DB seam over the fake browser: storage reads win, the
 * background ask is the fallback (validated — broken answers are not
 * adopted), no background resolves empty without crashing, and storage
 * writes arrive through the watch until unsubscribed.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConflictsDb, readStoredConflicts } from './conflicts-db';
import { knownConflictsStore } from '../../../lib/storage/known-conflicts';
import { onMessage } from '../../../lib/messaging/index';
import type { KnownConflict } from '../../../lib/storage/known-conflicts';

function row(id: string): KnownConflict {
  return {
    id,
    type: 'Plugin',
    name: `Conflict ${id}`,
    detection_pattern: null,
    summary: null,
    issue_description: '',
    url: `https://conflict.test/${id}`
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('readStoredConflicts', () => {
  it('accepts only row-shaped arrays', () => {
    expect(readStoredConflicts([row('a')])).toHaveLength(1);
    expect(readStoredConflicts([{ id: 'x' }])).toBeNull();
    expect(readStoredConflicts(null)).toBeNull();
    expect(readStoredConflicts('nope')).toBeNull();
  });
});

describe('createConflictsDb().load', () => {
  it('prefers the stored value and skips the background ask', async () => {
    await knownConflictsStore.setValue([row('stored')]);
    // No listener registered: a background send would reject the ask in this
    // test, and the load would notice at once if it asked.
    const ask = vi.fn();
    const removeListener = onMessage('getKnownConflictsDb', () => {
      ask();
      return [row('asked')];
    });
    try {
      expect(await createConflictsDb().load()).toEqual([row('stored')]);
      expect(ask).not.toHaveBeenCalled();
    } finally {
      removeListener();
    }
  });

  it('asks the background when nothing is stored and adopts valid answers', async () => {
    const removeListener = onMessage('getKnownConflictsDb', () => [row('asked')]);
    try {
      expect(await createConflictsDb().load()).toEqual([row('asked')]);
    } finally {
      removeListener();
    }
  });

  it('rejects broken background answers (rows stay empty, no adoption)', async () => {
    const removeListener = onMessage('getKnownConflictsDb', () => [
      { name: 'half a row' } as unknown as KnownConflict
    ]);
    try {
      expect(await createConflictsDb().load()).toEqual([]);
    } finally {
      removeListener();
    }
  });

  it('resolves empty (never throws) when the background is not listening', async () => {
    await expect(createConflictsDb().load()).resolves.toEqual([]);
  });

  it('treats corrupt stored values like an absence (background can recover)', async () => {
    await knownConflictsStore.setValue([{ bogus: true }] as never);
    const removeListener = onMessage('getKnownConflictsDb', () => [row('after')]);
    try {
      expect(await createConflictsDb().load()).toEqual([row('after')]);
    } finally {
      removeListener();
    }
  });
});

describe('createConflictsDb().watch', () => {
  it('delivers storage writes as validated rows until unsubscribed', async () => {
    const seen: Array<readonly KnownConflict[] | null> = [];
    const db = createConflictsDb();
    const unwatch = db.watch((rows) => {
      seen.push(rows);
    });
    try {
      // The background's updater is the writer; same storage, same watcher.
      await knownConflictsStore.setValue([row('fresh')]);
      await vi.waitFor(() => {
        expect(seen).toHaveLength(1);
      });
      expect(seen[0]).toEqual([row('fresh')]);
      // The handle's rows adopt the write for the next scan.
      expect(db.rows).toEqual([row('fresh')]);
      unwatch();
      await knownConflictsStore.setValue([row('fresh-2')]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toHaveLength(1);
    } finally {
      unwatch();
    }
  });

  it('reports unreadable writes as null without throwing', async () => {
    const seen: Array<readonly KnownConflict[] | null> = [];
    const db = createConflictsDb();
    const unwatch = db.watch((rows) => {
      seen.push(rows);
    });
    try {
      await knownConflictsStore.setValue([{ id: 'broken' }] as never);
      await vi.waitFor(() => {
        expect(seen).toHaveLength(1);
      });
      expect(seen[0]).toBeNull();
      // The previous snapshot stays in force for scans.
      expect(db.rows).toEqual([]);
    } finally {
      unwatch();
    }
  });
});
