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
  reinsertRow,
  updateRow,
  type Draft
} from './draft';
import {
  EMPTY_DRAFT_NOTES,
  copiedRow,
  forgetRow,
  isConversion,
  isNews,
  laneKeyIndex,
  recordCommits,
  restoreIndex,
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
  it('notes kept rows (undoable when changed), lists removals with their anchors', () => {
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
    // Both removed rows followed `gtag`; the second goes back after the first.
    expect(lane.removed).toEqual([
      {
        id: ids[2],
        anchor: ids[1],
        before: [],
        index: 2,
        diff: { state: 'dropped', reason: 'duplicate', typed: 'a.*' }
      },
      {
        id: ids[3],
        anchor: ids[1],
        before: [ids[2]],
        index: 3,
        diff: { state: 'dropped', reason: 'zero', typed: '0' }
      }
    ]);
    expect(lane.summary).toEqual({ source: 'paste', changed: 1, removed: 2 });
    expect(notes.latest?.source).toBe('paste');
    expect(notes.latest?.news.map((item) => [item.position, item.diff.state, item.copyOf])).toEqual(
      [
        [1, 'stored-as', null],
        [3, 'dropped', 1],
        [4, 'dropped', null],
        [3, 'unchanged', null]
      ]
    );
  });

  it('keeps every note when rows are committed again unchanged (a commit is not an edit)', () => {
    const one = committed('delayJs', [' a* ', 'x', 'x']);
    const again = recordCommits(
      one.notes,
      commitRows(one.draft, 'delayJs', one.ids).commits,
      'apply',
      one.draft
    );
    // No news: the very same notes, undo and removals included.
    expect(again).toBe(one.notes);
    expect(again.lanes.delayJs.rows.get(one.ids[0] ?? '')?.undoable).toBe(true);
    expect(again.lanes.delayJs.removed).toHaveLength(1);
  });

  it('gives no summary to a batch that changed one row, keeping an earlier one', () => {
    const one = committed('lazyload', [' a.png ']);
    expect(one.notes.lanes.lazyload.summary).toBeNull();
    expect(one.notes.latest?.news).toHaveLength(1);
    const batch = committed('lazyload', [' b.png ', ' c.png '], one.draft, one.notes);
    expect(batch.notes.lanes.lazyload.summary).toEqual({ source: 'paste', changed: 2, removed: 0 });
    const single = committed('lazyload', [' d.png '], batch.draft, batch.notes);
    expect(single.notes.lanes.lazyload.summary).toBe(batch.notes.lanes.lazyload.summary);
  });
});

describe('row numbers read from the lane as it is', () => {
  it('names the copied row and the Restore place from the current lane', () => {
    // [x, typed-x, typed-x, z]: both copies removed, anchored on x.
    const { notes, draft } = committed('delayJs', ['x', 'x', 'x', 'z']);
    const [first, second] = notes.lanes.delayJs.removed;
    if (first === undefined || second === undefined) throw new Error('two removals expected');
    const rows = draft.rows.delayJs;
    const keys = laneKeyIndex('delayJs', rows);
    expect(copiedRow('delayJs', keys, first.diff)).toBe(1);
    expect(restoreIndex(second, notes.lanes.delayJs.removed, rows)).toBe(1);
    // Restoring the first moves `z` and puts the second after the first.
    const restored = undoAll(notes, draft, 'delayJs', [first.id]);
    const now = restored.draft.rows.delayJs;
    expect(now.map((row) => row.text)).toEqual(['x', 'x', 'z']);
    expect(restoreIndex(second, restored.notes.lanes.delayJs.removed, now)).toBe(2);
    expect(copiedRow('delayJs', keys, { ...first.diff, reason: 'zero' })).toBeNull();
    expect(copiedRow('delayJs', laneKeyIndex('delayJs', []), first.diff)).toBeNull();
  });

  it('falls back to the former place when an anchor left for another reason', () => {
    const { notes, draft } = committed('lazyload', ['a', '0', 'b']);
    const [removed] = notes.lanes.lazyload.removed;
    if (removed === undefined) throw new Error('a removal expected');
    const withoutAnchor = draft.rows.lazyload.filter((row) => row.text !== 'a');
    expect(restoreIndex(removed, [removed], withoutAnchor)).toBe(1);
    expect(restoreIndex({ ...removed, index: 9 }, [removed], withoutAnchor)).toBe(1);
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
    expect(takeUndo(retired, 'delayJs', delay.ids[0] ?? '', both.draft.rows.delayJs)).toBeNull();
  });

  it("forgets an edited row's note (and retires its lane)", () => {
    const { notes, ids } = committed('delayJs', ['a*', 'b*']);
    const forgotten = forgetRow(notes, 'delayJs', ids[0] ?? '');
    expect(forgotten.lanes.delayJs.rows.has(ids[0] ?? '')).toBe(false);
    expect(forgotten.lanes.delayJs.rows.get(ids[1] ?? '')?.undoable).toBe(false);
    expect(forgetRow(EMPTY_DRAFT_NOTES, 'delayJs', 'none')).toBe(EMPTY_DRAFT_NOTES);
  });
});

/**
 * Take each undo in order and apply it to the draft (as the controller does).
 */
function undoAll(
  notes: DraftNotes,
  draft: Draft,
  lane: 'delayJs' | 'lazyload',
  order: readonly string[]
): { notes: DraftNotes; draft: Draft } {
  let current = { notes, draft };
  for (const id of order) {
    const taken = takeUndo(current.notes, lane, id, current.draft.rows[lane]);
    if (taken === null || taken.target.kind !== 'removed') throw new Error(`no removal ${id}`);
    const next = reinsertRow(
      current.draft,
      lane,
      { id, text: taken.target.typed },
      taken.target.at
    );
    if (next === null) throw new Error('reinsert refused');
    current = { notes: taken.notes, draft: next };
  }
  return current;
}

describe('takeUndo', () => {
  it('gives a kept row its typed text back, once', () => {
    const { notes, ids, draft } = committed('delayJs', ['a*']);
    const rows = draft.rows.delayJs;
    const taken = takeUndo(notes, 'delayJs', ids[0] ?? '', rows);
    expect(taken?.target).toEqual({ kind: 'row', id: ids[0], typed: 'a*' });
    expect(taken?.notes.lanes.delayJs.rows.size).toBe(0);
    expect(takeUndo(taken?.notes ?? notes, 'delayJs', ids[0] ?? '', rows)).toBeNull();
    expect(takeUndo(notes, 'delayJs', 'unknown', rows)).toBeNull();
  });

  it('puts removed rows of one batch back where they were, in either order', () => {
    // Before the commit: a, X1, b, X2 → after: a, b.
    const { notes, ids, draft } = committed('lazyload', ['a', '0', 'b', 'a']);
    const typed = ['a', '0', 'b', 'a'];
    for (const order of [
      [ids[1] ?? '', ids[3] ?? ''],
      [ids[3] ?? '', ids[1] ?? '']
    ]) {
      const done = undoAll(notes, draft, 'lazyload', order);
      expect(done.draft.rows.lazyload.map((row) => row.text)).toEqual(typed);
      expect(done.notes.lanes.lazyload.removed).toEqual([]);
      expect(done.notes.lanes.lazyload.summary).toBeNull();
    }
  });

  it('puts removed rows of different batches back in place, in either order', () => {
    // [x, X1, b, X2, tail]: the paste's batch removes X1, the caret row's commit X2.
    const base = committed('lazyload', ['x', '', 'tail']);
    const [, middle = ''] = base.ids;
    const pasted = insertRows(base.draft, 'lazyload', ['b', 'x'], middle, nextId);
    let draft = pasted.draft;
    const typedX1 = draft.rows.lazyload.map((row) =>
      row.id === middle ? { id: row.id, text: 'x' } : row
    );
    draft = { ...draft, rows: { ...draft.rows, lazyload: typedX1 } };
    const first = commitRows(draft, 'lazyload', [middle, pasted.ids[0] ?? '']);
    let notes = recordCommits(base.notes, first.commits, 'paste', first.draft);
    const second = commitRows(first.draft, 'lazyload', [pasted.ids[1] ?? '']);
    notes = recordCommits(notes, second.commits, 'row', second.draft);
    expect(second.draft.rows.lazyload.map((row) => row.text)).toEqual(['x', 'b', 'tail']);
    for (const order of [
      [middle, pasted.ids[1] ?? ''],
      [pasted.ids[1] ?? '', middle]
    ]) {
      const done = undoAll(notes, second.draft, 'lazyload', order);
      expect(done.draft.rows.lazyload.map((row) => row.text)).toEqual(['x', 'x', 'b', 'x', 'tail']);
    }
  });

  it('puts a row back where its removed anchor goes', () => {
    // Batch 1 removes X (anchor a); batch 2 removes a itself.
    const { notes, ids, draft } = committed('lazyload', ['a', '0', 'b']);
    const [a = ''] = ids;
    const edited = updateRow(draft, 'lazyload', a, '<i></i>');
    const later = commitRows(edited, 'lazyload', [a]);
    const both = recordCommits(notes, later.commits, 'row', later.draft);
    const [x] = both.lanes.lazyload.removed;
    if (x === undefined) throw new Error('removal expected');
    expect(restoreIndex(x, both.lanes.lazyload.removed, later.draft.rows.lazyload)).toBe(0);
  });

  it('has no undo for a note that changed nothing', () => {
    const { notes, ids, draft } = committed('delayJs', ['js-(before|after)']);
    expect(takeUndo(notes, 'delayJs', ids[0] ?? '', draft.rows.delayJs)).toBeNull();
  });
});
