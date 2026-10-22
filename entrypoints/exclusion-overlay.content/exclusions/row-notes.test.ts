import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StoredRowDiff } from '../../../lib/exclusion-builder/field-text';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import {
  parseParityTable,
  type SaveRow
} from '../../../lib/exclusion-builder/wp-rocket-parity-table';
import {
  LANE_ORDER,
  commitRows,
  createIdSource,
  draftFromSet,
  insertRows,
  isBlankRow,
  laneFeature,
  nonBlankRows,
  type Draft
} from './draft';
import {
  EMPTY_DRAFT_NOTES,
  forgetRow,
  isConversion,
  isNews,
  recordCommits,
  retireLane,
  takeUndo,
  type DraftNotes
} from './row-notes';

/** The PHP-derived parity table (its save rows: typed → stored + dropped). */
const table = parseParityTable(
  JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../lib/exclusion-builder/wp-rocket-parity.fixtures.json'
      ),
      'utf8'
    )
  )
);

const nextId = createIdSource('n');
const empty = draftFromSet(EMPTY_EXCLUSION_SET, nextId);

/** Insert typed rows into a lane and commit them; record the batch. */
function committed(
  lane: 'delayJs' | 'deferJs' | 'lazyload' | 'lazyRender',
  typed: readonly string[],
  base: Draft = empty,
  notes: DraftNotes = EMPTY_DRAFT_NOTES
) {
  const inserted = insertRows(base, lane, typed, null, nextId);
  const result = commitRows(inserted.draft, lane, inserted.ids);
  return {
    ids: inserted.ids,
    draft: result.draft,
    notes: recordCommits(notes, result.commits, 'paste', result.draft)
  };
}

describe('isNews / isConversion', () => {
  const cases: readonly [StoredRowDiff, boolean, boolean][] = [
    [{ state: 'unchanged', typed: 'a' }, false, false],
    [{ state: 'unchanged', typed: 'a', dropsInSafeMode: true }, true, false],
    [{ state: 'stored-as', stored: 'a', typed: ' a' }, true, true],
    [{ state: 'unverified', stored: 'a', construct: 'x', detail: 'd', typed: 'a' }, true, false],
    [{ state: 'unverified', stored: 'a', construct: 'x', detail: 'd', typed: 'a ' }, true, true],
    [{ state: 'dropped', reason: 'zero', typed: '0' }, true, true]
  ];
  it.each(cases)('%j → news %s, conversion %s', (diff, news, conversion) => {
    expect(isNews(diff)).toBe(news);
    expect(isConversion(diff)).toBe(conversion);
  });
});

describe('the PHP save fixtures, committed as one paste', () => {
  // Text lines only (an input holds text), and safe mode unknown: the page
  // cannot read that setting, so the editor keeps its rows (flagged).
  const saves = table.rows.filter(
    (row): row is SaveRow =>
      row.kind === 'save' &&
      row.safeMode !== true &&
      row.typed.every((line) => typeof line === 'string')
  );

  it('covers the table', () => {
    expect(saves.length).toBeGreaterThan(40);
  });

  it.each(saves.map((row) => [row.id, row] as const))(
    '%s: rows = PHP stored, removal notes = PHP dropped, row notes = changed rows',
    (_id, fixture) => {
      const lane = LANE_ORDER.find((key) => laneFeature(key).id === fixture.feature);
      if (lane === undefined) throw new Error(`no lane for ${fixture.feature}`);
      const typed = fixture.typed as readonly string[];
      const inserted = insertRows(empty, lane, typed, null, nextId);
      const result = commitRows(inserted.draft, lane, inserted.ids);
      const notes = recordCommits(EMPTY_DRAFT_NOTES, result.commits, 'paste', result.draft);
      // Blank lines are unfinished edits here; PHP drops them as empty.
      const blank = new Set(typed.flatMap((text, index) => (isBlankRow(text) ? [index] : [])));
      expect(nonBlankRows(result.draft.rows[lane].map((row) => row.text))).toEqual(fixture.stored);
      expect(notes.lanes[lane].removed.map((note) => [note.index, note.diff.reason])).toEqual(
        fixture.dropped
          .filter((drop) => !blank.has(drop.index))
          .map((drop) => [drop.index, drop.reason])
      );
      for (const [id, note] of notes.lanes[lane].rows) {
        const row = result.draft.rows[lane].find((candidate) => candidate.id === id);
        expect(note.undoable).toBe(row?.text !== note.diff.typed);
      }
    }
  );
});

describe('recordCommits', () => {
  it('notes kept rows (undoable when changed), lists removals with the copied row', () => {
    const { ids, notes, draft } = committed('delayJs', [
      'a*',
      'gtag',
      'a.*',
      '0',
      'js-(before|after)'
    ]);
    const lane = notes.lanes.delayJs;
    expect(draft.rows.delayJs.map((row) => row.text)).toEqual([
      'a(.*)',
      'gtag',
      'js-(before|after)'
    ]);
    expect(lane.rows.get(ids[0] ?? '')).toEqual({
      diff: { state: 'stored-as', stored: 'a(.*)', typed: 'a*' },
      undoable: true
    });
    // Stored as typed: no note.
    expect(lane.rows.has(ids[1] ?? '')).toBe(false);
    // Flagged only: a note, nothing to undo.
    expect(lane.rows.get(ids[4] ?? '')).toEqual({
      diff: { state: 'unchanged', typed: 'js-(before|after)', dropsInSafeMode: true },
      undoable: false
    });
    expect(lane.removed).toEqual([
      {
        id: ids[2],
        index: 2,
        batch: 1,
        diff: { state: 'dropped', reason: 'duplicate', typed: 'a.*' },
        copyOf: 1
      },
      {
        id: ids[3],
        index: 3,
        batch: 1,
        diff: { state: 'dropped', reason: 'zero', typed: '0' },
        copyOf: null
      }
    ]);
    expect(lane.summary).toEqual({ source: 'paste', changed: 1, removed: 2 });
    expect(notes.latest?.source).toBe('paste');
    expect(notes.latest?.news.map((item) => [item.position, item.diff.state])).toEqual([
      [1, 'stored-as'],
      [3, 'dropped'],
      [4, 'dropped'],
      [3, 'unchanged']
    ]);
  });

  it('gives no summary to a batch that changed one row, and no latest to a batch without news', () => {
    const one = committed('lazyload', [' a.png ']);
    expect(one.notes.lanes.lazyload.summary).toBeNull();
    expect(one.notes.latest?.news).toHaveLength(1);
    const quiet = recordCommits(
      one.notes,
      commitRows(one.draft, 'lazyload', one.ids).commits,
      'row',
      one.draft
    );
    expect(quiet.latest).toBe(one.notes.latest);
    expect(quiet.batch).toBe(one.notes.batch);
    // Recommitted unchanged: the stale note leaves.
    expect(quiet.lanes.lazyload.rows.size).toBe(0);
  });
});

describe('lifetimes', () => {
  it('retires undo and removals on a lane edit, keeping row notes; other lanes untouched', () => {
    const delay = committed('delayJs', ['a*', '0']);
    const both = committed('lazyload', [' b.png '], delay.draft, delay.notes);
    const retired = retireLane(both.notes, 'delayJs');
    expect([...retired.lanes.delayJs.rows.values()].map((note) => note.undoable)).toEqual([false]);
    expect(retired.lanes.delayJs.removed).toEqual([]);
    expect(retired.lanes.delayJs.summary).toBeNull();
    expect(retired.lanes.lazyload).toBe(both.notes.lanes.lazyload);
    expect(retireLane(retired, 'delayJs')).toBe(retired);
    expect(takeUndo(retired, 'delayJs', delay.ids[0] ?? '')).toBeNull();
  });

  it("forgets an edited row's note (and retires its lane)", () => {
    const { notes, ids } = committed('delayJs', ['a*', 'b*']);
    const forgotten = forgetRow(notes, 'delayJs', ids[0] ?? '');
    expect(forgotten.lanes.delayJs.rows.has(ids[0] ?? '')).toBe(false);
    expect(forgotten.lanes.delayJs.rows.get(ids[1] ?? '')?.undoable).toBe(false);
    expect(forgetRow(EMPTY_DRAFT_NOTES, 'delayJs', 'none')).toBe(EMPTY_DRAFT_NOTES);
  });
});

describe('takeUndo', () => {
  it('gives a kept row its typed text back, once', () => {
    const { notes, ids } = committed('delayJs', ['a*']);
    const taken = takeUndo(notes, 'delayJs', ids[0] ?? '');
    expect(taken?.target).toEqual({ kind: 'row', id: ids[0], typed: 'a*' });
    expect(taken?.notes.lanes.delayJs.rows.size).toBe(0);
    expect(takeUndo(taken?.notes ?? notes, 'delayJs', ids[0] ?? '')).toBeNull();
    expect(takeUndo(notes, 'delayJs', 'unknown')).toBeNull();
  });

  it('puts removed rows back where they were, in any order', () => {
    // Lane before the commit: keep, X1, keep, X2 → after: keep, keep.
    const { notes, ids } = committed('lazyload', ['a', '0', 'b', 'a']);
    const second = takeUndo(notes, 'lazyload', ids[3] ?? '');
    // X1 (index 1) is still out: X2 goes back at 3 − 1.
    expect(second?.target).toEqual({ kind: 'removed', id: ids[3], typed: 'a', at: 2 });
    const first = takeUndo(second?.notes ?? notes, 'lazyload', ids[1] ?? '');
    expect(first?.target).toEqual({ kind: 'removed', id: ids[1], typed: '0', at: 1 });
    expect(first?.notes.lanes.lazyload.removed).toEqual([]);
    expect(second?.notes.lanes.lazyload.summary).toBeNull();
  });

  it('has no undo for a note that changed nothing', () => {
    const { notes, ids } = committed('delayJs', ['js-(before|after)']);
    expect(takeUndo(notes, 'delayJs', ids[0] ?? '')).toBeNull();
  });
});
