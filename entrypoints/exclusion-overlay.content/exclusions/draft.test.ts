import { describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import { EXCLUSION_SET_LIMITS } from '../../../lib/messaging/exclusion-session';
import { validSet } from '../../../lib/messaging/exclusion-session.fixtures';
import {
  LANE_ORDER,
  addCandidate,
  createIdSource,
  createRowValidator,
  draftChars,
  draftFromSet,
  draftToSet,
  insertRows,
  laneFeature,
  removeRow,
  sameSet,
  setDisable,
  splitLines,
  updateRow
} from './draft';

describe('draft ↔ set', () => {
  it('round-trips a set exactly', () => {
    const draft = draftFromSet(validSet(), createIdSource());
    expect(draftToSet(draft)).toEqual(validSet());
    expect(sameSet(draftToSet(draft), validSet())).toBe(true);
  });

  it('gives every row a unique id', () => {
    const draft = draftFromSet(validSet(), createIdSource());
    const ids = LANE_ORDER.flatMap((lane) => draft.rows[lane].map((row) => row.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops blank rows from the set, keeps every other row as typed', () => {
    const nextId = createIdSource();
    const { draft } = insertRows(
      draftFromSet(EMPTY_EXCLUSION_SET, nextId),
      'delayJs',
      ['  ', ' gtag ', ''],
      null,
      nextId
    );
    expect(draftToSet(draft).rows.delayJs).toEqual([' gtag ']);
  });

  it('tells sets apart by rows, order and disables', () => {
    const base = validSet();
    expect(sameSet(base, { ...base, disable: { ...base.disable, delayJs: true } })).toBe(false);
    const reordered = {
      ...base,
      rows: { ...base.rows, delayJs: [...base.rows.delayJs].reverse() }
    };
    expect(sameSet(base, reordered)).toBe(false);
    expect(sameSet(base, { ...base, rows: { ...base.rows, lazyload: [] } })).toBe(false);
  });

  it('follows the pipeline order', () => {
    expect(LANE_ORDER).toEqual(['delayJs', 'deferJs', 'lazyRender', 'lazyload']);
    expect(laneFeature('lazyRender').id).toBe('automatic_lazy_rendering');
  });
});

describe('row edits', () => {
  const nextId = createIdSource('t');
  const start = draftFromSet(validSet(), nextId);

  it('inserts after a row or at the end', () => {
    const firstId = start.rows.delayJs[0]?.id ?? null;
    const after = insertRows(start, 'delayJs', ['a', 'b'], firstId, nextId);
    expect(after.draft.rows.delayJs.map((row) => row.text)).toEqual([
      'jquery\\.min\\.js',
      'a',
      'b',
      'gtag'
    ]);
    const end = insertRows(start, 'delayJs', ['z'], null, nextId);
    expect(end.draft.rows.delayJs.at(-1)?.text).toBe('z');
    expect(end.ids).toHaveLength(1);
  });

  it('appends when the anchor row is gone', () => {
    const inserted = insertRows(start, 'deferJs', ['x'], 'missing', nextId);
    expect(inserted.draft.rows.deferJs.at(-1)?.text).toBe('x');
  });

  it('stops at the per-lane cap', () => {
    const full = insertRows(
      start,
      'lazyload',
      Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature + 5 }, (_, i) => `r${String(i)}`),
      null,
      nextId
    );
    expect(full.draft.rows.lazyload).toHaveLength(EXCLUSION_SET_LIMITS.rowsPerFeature);
    const more = insertRows(full.draft, 'lazyload', ['over'], null, nextId);
    expect(more.ids).toEqual([]);
    expect(more.draft).toBe(full.draft);
  });

  it('updates one row and leaves the draft identical for no-ops', () => {
    const id = start.rows.deferJs[0]?.id ?? '';
    const next = updateRow(start, 'deferJs', id, '/new/');
    expect(next.rows.deferJs[0]).toEqual({ id, text: '/new/' });
    expect(updateRow(start, 'deferJs', id, '/wp-includes/js/')).toBe(start);
    expect(updateRow(start, 'deferJs', 'missing', 'x')).toBe(start);
  });

  it('removes a row and hands focus to its previous neighbor, else the next', () => {
    const [first, second] = start.rows.delayJs;
    const removedSecond = removeRow(start, 'delayJs', second?.id ?? '');
    expect(removedSecond.focusId).toBe(first?.id);
    const removedFirst = removeRow(start, 'delayJs', first?.id ?? '');
    expect(removedFirst.focusId).toBe(second?.id);
    const only = removeRow(start, 'deferJs', start.rows.deferJs[0]?.id ?? '');
    expect(only.focusId).toBeNull();
    expect(removeRow(start, 'deferJs', 'missing')).toEqual({ draft: start, focusId: null });
  });

  it('sets a disable, identity when unchanged', () => {
    expect(setDisable(start, 'delayJs', true).disable.delayJs).toBe(true);
    expect(setDisable(start, 'deferJs', true)).toBe(start);
  });

  it('adds a candidate once', () => {
    const added = addCandidate(start, 'lazyload', 'logo.png', nextId);
    expect(added.added).toBe(true);
    const again = addCandidate(added.draft, 'lazyload', 'logo.png', nextId);
    expect(again).toEqual({ draft: added.draft, id: added.id, added: false });
  });

  it('counts the wire characters of non-blank rows', () => {
    const blankAdded = insertRows(start, 'delayJs', ['   '], null, nextId).draft;
    expect(draftChars(blankAdded)).toBe(draftChars(start));
    expect(draftChars(start)).toBe(
      'jquery\\.min\\.js'.length +
        4 +
        '/wp-includes/js/'.length +
        9 +
        '<section class="footer">'.length
    );
  });
});

describe('splitLines', () => {
  it('splits on both newline styles and drops blank lines', () => {
    expect(splitLines('a\r\nb\n\n  \nc ')).toEqual(['a', 'b', 'c ']);
  });
});

describe('createRowValidator', () => {
  it('names invalid and risky patterns, accepts literals as text', () => {
    const validate = createRowValidator();
    expect(validate('delayJs', '(')).toMatch(/^Invalid regular expression: /);
    expect(validate('deferJs', '(a+)+$')).toMatch(/^Risky regular expression/);
    expect(validate('lazyload', '(')).toBeNull();
    expect(validate('delayJs', 'gtag')).toBeNull();
  });

  it('names rows the session cannot store: over the row cap or with control characters', () => {
    const validate = createRowValidator();
    expect(validate('lazyload', 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars + 1))).toMatch(
      /longer than 2048/
    );
    expect(validate('lazyload', 'a\u0007b')).toMatch(/control character/);
    expect(validate('delayJs', `x${String.fromCharCode(0xd83c)}`)).toMatch(/control character/);
    expect(validate('lazyload', 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars))).toBeNull();
  });

  it('treats blank rows as unfinished, never as errors', () => {
    expect(createRowValidator()('delayJs', '   ')).toBeNull();
  });

  it('serves repeated rows from its cache and restarts past capacity', () => {
    const validate = createRowValidator(2);
    expect(validate('delayJs', '(')).toBe(validate('delayJs', '('));
    validate('delayJs', 'a');
    validate('delayJs', 'b');
    expect(validate('delayJs', '(')).toMatch(/^Invalid/);
  });
});
