import { describe, expect, it } from 'vitest';
import { storedExclusionRows } from '../../../lib/exclusion-builder/field-text';
import { EMPTY_EXCLUSION_SET, type ExclusionFeatureId } from '../../../lib/exclusion-builder/set';
import { featureRowWarnings } from '../../../lib/exclusion-builder/validate';
import { EXCLUSION_SET_LIMITS } from '../../../lib/messaging/exclusion-session';
import { validSet } from '../../../lib/messaging/exclusion-session.fixtures';
import {
  LANE_ORDER,
  addCandidate,
  commitAll,
  commitRows,
  createIdSource,
  createRowValidator,
  draftChars,
  draftFromSet,
  draftToSet,
  holdsCandidate,
  insertRows,
  isBlankRow,
  laneFeature,
  laneRowSet,
  pasteIntoRow,
  reinsertRow,
  removeRow,
  restoreDraft,
  blankRowWarning,
  sameSet,
  setDisable,
  splitLines,
  startCommit,
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

  it('drops blank rows from the set and sends committed rows in their stored form', () => {
    const nextId = createIdSource();
    const { draft, ids } = insertRows(
      draftFromSet(EMPTY_EXCLUSION_SET, nextId),
      'delayJs',
      ['  ', ' gtag ', '', '\tjquery\r', 'a b'],
      null,
      nextId
    );
    expect(draftToSet(commitRows(draft, 'delayJs', ids).draft).rows.delayJs).toEqual([
      'gtag',
      'jquery',
      'a b'
    ]);
    // Rows are sent as they are: an uncommitted row is not rewritten here.
    expect(draftToSet(draft).rows.delayJs).toEqual([' gtag ', '\tjquery\r', 'a b']);
  });

  it('restores a set in its stored form, saying what changed per row', () => {
    const typed = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['x%41*', '', 'xA(.*)', '(', 'ok'] }
    };
    const restored = restoreDraft(typed, createIdSource());
    expect(restored.draft.rows.delayJs.map((row) => row.text)).toEqual(['x(.*)', 'xA(.*)', 'ok']);
    expect(restored.commits.map(({ index, diff }) => [index, diff.state])).toEqual([
      [0, 'stored-as'],
      [1, 'unchanged'],
      [2, 'dropped'],
      [3, 'unchanged']
    ]);
    // A stored set restores as is.
    const again = restoreDraft(draftToSet(restored.draft), createIdSource());
    expect(draftToSet(again.draft)).toEqual(draftToSet(restored.draft));
    expect(again.commits.every(({ diff }) => diff.state === 'unchanged')).toBe(true);
  });

  it('dedupes Defer JS rows on restore, so duplicate named groups never turn the page off', () => {
    const typed = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: ["(?'n'a)x", " (?'n'a)x "] }
    };
    const set = draftToSet(draftFromSet(typed, createIdSource()));
    expect(set.rows.deferJs).toEqual(["(?'n'a)x"]);
    const pageOff = (rows: readonly string[]): boolean =>
      featureRowWarnings('defer_all_js', 'pattern', rows).some(
        ({ problem }) => problem === 'joined-page-off'
      );
    // Joined twice, the repeated group name fails WP Rocket's pre-check; stored once, it cannot.
    expect(pageOff(["(?'n'a)x", "(?'n'a)x"])).toBe(true);
    expect(pageOff(set.rows.deferJs)).toBe(false);
  });

  it('loads a set in its trimmed form, so a stored untrimmed row reads as an edit', () => {
    const untrimmed = {
      ...EMPTY_EXCLUSION_SET,
      rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: [' logo.png '] }
    };
    const draft = draftFromSet(untrimmed, createIdSource());
    expect(draft.rows.lazyload.map((row) => row.text)).toEqual(['logo.png']);
    expect(sameSet(draftToSet(draft), untrimmed)).toBe(false);
  });

  it('reads blankness with the settings trim (a no-break space is text)', () => {
    expect(isBlankRow(' \t\r\n')).toBe(true);
    expect(isBlankRow('\u00a0')).toBe(false);
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
    expect(added).toMatchObject({ added: true, diff: { state: 'unchanged', typed: 'logo.png' } });
    const again = addCandidate(added.draft, 'lazyload', 'logo.png', nextId);
    expect(again).toMatchObject({ draft: added.draft, id: added.id, added: false });
    expect(again.diff).toMatchObject({ state: 'dropped', reason: 'duplicate' });
  });

  it('adds a candidate stored, and finds it again whatever its surrounding whitespace', () => {
    const added = addCandidate(start, 'lazyload', ' hero.webp\t', nextId);
    expect(added.draft.rows.lazyload.at(-1)?.text).toBe('hero.webp');
    const typed = updateRow(start, 'lazyload', start.rows.lazyload[0]?.id ?? '', 'logo.png  ');
    const again = addCandidate(typed, 'lazyload', 'logo.png', nextId);
    expect(again).toMatchObject({ draft: typed, id: start.rows.lazyload[0]?.id, added: false });
  });

  it('adds a candidate in its stored form, never one the save drops, never twice once stored', () => {
    const typed = insertRows(start, 'delayJs', ['x%41y.js'], null, nextId).draft;
    // `xy.js` is how WP Rocket stores `x%41y.js` (the row is still typed).
    const held = addCandidate(typed, 'delayJs', 'xy.js', nextId);
    expect(held).toMatchObject({ draft: typed, added: false });
    expect(held.id).toBe(typed.rows.delayJs.at(-1)?.id);
    const star = addCandidate(start, 'delayJs', 'a.*', nextId);
    expect(star.draft.rows.delayJs.at(-1)?.text).toBe('a(.*)');
    expect(addCandidate(star.draft, 'delayJs', 'a*', nextId).added).toBe(false);
    const literal = addCandidate(start, 'lazyload', 'a.*', nextId);
    expect(addCandidate(literal.draft, 'lazyload', 'a*', nextId).added).toBe(true);
    const dropped = addCandidate(start, 'delayJs', '(', nextId);
    expect(dropped).toMatchObject({ draft: start, id: null, added: false });
    expect(dropped.diff).toMatchObject({ state: 'dropped', reason: 'invalid-pattern' });
  });

  it('answers "already held" per lane by the candidate\'s stored form', () => {
    const rows = laneRowSet(start, 'deferJs');
    const held = [...rows][0] ?? '';
    expect(holdsCandidate(rows, 'deferJs', ` ${held} `)).toBe(true);
    expect(holdsCandidate(rows, 'deferJs', 'other.js')).toBe(false);
    expect(holdsCandidate(rows, 'deferJs', '<b></b>')).toBe(false);
  });

  it('commits a row into its stored form; idempotent, identity when nothing changes', () => {
    const id = start.rows.delayJs[0]?.id ?? '';
    const typed = updateRow(start, 'delayJs', id, '  g%41tag*\t');
    const committed = commitRows(typed, 'delayJs', [id]);
    expect(committed.draft.rows.delayJs[0]).toEqual({ id, text: 'gtag(.*)' });
    expect(committed.commits).toEqual([
      {
        lane: 'delayJs',
        id,
        index: 0,
        diff: { state: 'stored-as', stored: 'gtag(.*)', typed: '  g%41tag*\t' }
      }
    ]);
    const again = commitRows(committed.draft, 'delayJs', [id]);
    expect(again.draft).toBe(committed.draft);
    expect(again.commits.map(({ diff }) => diff.state)).toEqual(['unchanged']);
    expect(commitRows(committed.draft, 'delayJs', ['missing']).draft).toBe(committed.draft);
    expect(commitAll(committed.draft).draft).toBe(committed.draft);
  });

  it('removes a committed row the save drops, keeping the typed text for an undo', () => {
    const { draft, ids } = insertRows(start, 'delayJs', ['(', '<b></b>', '0'], null, nextId);
    const committed = commitRows(draft, 'delayJs', ids);
    expect(committed.draft.rows.delayJs).toEqual(start.rows.delayJs);
    expect(committed.commits.map(({ diff }) => diff)).toEqual([
      expect.objectContaining({ state: 'dropped', reason: 'invalid-pattern', typed: '(' }),
      { state: 'dropped', reason: 'empty', typed: '<b></b>' },
      { state: 'dropped', reason: 'zero', typed: '0' }
    ]);
  });

  it('drops the committed row as a duplicate: the rows already there win', () => {
    const existing = start.rows.delayJs[0];
    const { draft, ids } = insertRows(
      start,
      'delayJs',
      [` ${existing?.text ?? ''} `],
      null,
      nextId
    );
    const committed = commitRows(draft, 'delayJs', ids);
    expect(committed.draft.rows.delayJs).toEqual(start.rows.delayJs);
    expect(committed.commits[0]?.diff).toMatchObject({ state: 'dropped', reason: 'duplicate' });
  });

  it('names a second copy of a row the pattern check drops a duplicate, as WP Rocket does', () => {
    // WP Rocket dedupes before its pattern check: the second `(` is a copy.
    const { draft, ids } = insertRows(start, 'deferJs', ['(', ' ( '], null, nextId);
    const committed = commitRows(draft, 'deferJs', ids);
    expect(committed.commits.map(({ diff }) => diff)).toEqual([
      expect.objectContaining({ state: 'dropped', reason: 'invalid-pattern', typed: '(' }),
      { state: 'dropped', reason: 'duplicate', typed: ' ( ' }
    ]);
    // Same verdicts as the one save function over the whole field.
    expect(
      restoreDraft(
        { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: ['(', ' ( '] } },
        createIdSource('r')
      ).commits.map(({ diff }) => diff.state === 'dropped' && diff.reason)
    ).toEqual(['invalid-pattern', 'duplicate']);
    // An emptied row has no form: a later empty row is empty, not a copy.
    const empties = insertRows(start, 'deferJs', ['<b></b>', '<i></i>'], null, nextId);
    expect(
      commitRows(empties.draft, 'deferJs', empties.ids).commits.map(
        ({ diff }) => diff.state === 'dropped' && diff.reason
      )
    ).toEqual(['empty', 'empty']);
  });

  it('reinserts a removed row at its place, keeping its id; refuses a full lane or a held id', () => {
    const lane = start.rows.lazyload;
    const back = reinsertRow(start, 'lazyload', { id: 'gone', text: ' typed ' }, 1);
    expect(back?.rows.lazyload.map((row) => row.id)).toEqual([
      ...lane.slice(0, 1).map((row) => row.id),
      'gone',
      ...lane.slice(1).map((row) => row.id)
    ]);
    expect(back?.rows.lazyload[1]?.text).toBe(' typed ');
    // Clamped to the lane.
    expect(
      reinsertRow(start, 'lazyload', { id: 'z', text: 'z' }, 99)?.rows.lazyload.at(-1)?.id
    ).toBe('z');
    expect(reinsertRow(start, 'lazyload', { id: 'z', text: 'z' }, -3)?.rows.lazyload[0]?.id).toBe(
      'z'
    );
    expect(reinsertRow(start, 'lazyload', { id: lane[0]?.id ?? '', text: 'x' }, 0)).toBeNull();
    const full = insertRows(
      start,
      'lazyload',
      Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature }, (_, n) => `r${String(n)}`),
      null,
      nextId
    ).draft;
    expect(reinsertRow(full, 'lazyload', { id: 'z', text: 'z' }, 0)).toBeNull();
  });

  it('keeps unverified and safe-mode rows on commit, flagged', () => {
    const { draft, ids } = insertRows(
      start,
      'delayJs',
      ['(?+1)(x)', 'js-(before|after)'],
      null,
      nextId
    );
    const committed = commitRows(draft, 'delayJs', ids);
    expect(committed.draft.rows.delayJs.slice(-2).map((row) => row.text)).toEqual([
      '(?+1)(x)',
      'js-(before|after)'
    ]);
    expect(committed.commits.map(({ diff }) => diff)).toEqual([
      expect.objectContaining({ state: 'unverified', stored: '(?+1)(x)' }),
      { state: 'unchanged', typed: 'js-(before|after)', dropsInSafeMode: true }
    ]);
  });

  it('leaves blank rows alone on commit (unfinished edits)', () => {
    const { draft, ids } = insertRows(start, 'delayJs', ['  '], null, nextId);
    expect(commitRows(draft, 'delayJs', ids)).toEqual({ draft, commits: [] });
  });

  it('counts the wire characters of non-blank rows, as they are', () => {
    const blankAdded = insertRows(start, 'delayJs', ['   '], null, nextId).draft;
    expect(draftChars(blankAdded)).toBe(draftChars(start));
    const added = insertRows(start, 'delayJs', ['a*'], null, nextId);
    const stored = commitRows(added.draft, 'delayJs', added.ids).draft;
    // Stored as `a(.*)`: the wire carries 5 characters, not the 2 typed.
    expect(draftChars(stored)).toBe(draftChars(start) + 5);
    expect(draftChars(start)).toBe(
      'jquery\\.min\\.js'.length +
        4 +
        '/wp-includes/js/'.length +
        9 +
        '<section class="footer">'.length
    );
  });
});

/**
 * What WP Rocket stores for a row after a paste: the field's text (before +
 * pasted + after) as a textarea holds it (every CR or CRLF read as LF),
 * split on LF — derived from the textarea rules, independently of the paste
 * code — then through the settings save.
 */
function wpRocketLines(
  feature: ExclusionFeatureId,
  row: string,
  start: number,
  end: number,
  pasted: string
): readonly string[] {
  const lines = (row.slice(0, start) + pasted + row.slice(end)).split(/\r\n|\r|\n/);
  return storedExclusionRows(feature, lines);
}

describe('pasteIntoRow', () => {
  const nextId = createIdSource('p');
  const start = draftFromSet(validSet(), nextId);
  const first = start.rows.delayJs[0];
  const texts = (draft: ReturnType<typeof draftFromSet>): string[] =>
    draft.rows.delayJs.map((row) => row.text);

  it('splits the row at the caret, keeping its text on both sides', () => {
    // 'jquery\\.min\\.js' with the caret after 'jquery'.
    const pasted = pasteIntoRow(
      start,
      'delayJs',
      first?.id ?? '',
      'a\n\nb',
      { start: 6, end: 6 },
      nextId
    );
    expect(texts(pasted.draft)).toEqual(['jquerya', 'b\\.min\\.js', 'gtag']);
    expect(pasted.ids[0]).toBe(first?.id);
    expect(pasted.ids).toHaveLength(2);
  });

  it('keeps the row and adds the lines after it from a caret at the end', () => {
    const end = first?.text.length ?? 0;
    const pasted = pasteIntoRow(
      start,
      'delayJs',
      first?.id ?? '',
      'a\r\nb',
      { start: end, end },
      nextId
    );
    expect(texts(pasted.draft)).toEqual(['jquery\\.min\\.jsa', 'b', 'gtag']);
  });

  it('replaces the selected text only', () => {
    const pasted = pasteIntoRow(
      start,
      'delayJs',
      first?.id ?? '',
      'x\ny',
      { start: 0, end: 6 },
      nextId
    );
    expect(texts(pasted.draft)).toEqual(['x', 'y\\.min\\.js', 'gtag']);
  });

  it("drops lines past the lane cap, never the row's own text", () => {
    const filled = insertRows(
      start,
      'delayJs',
      Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature - 3 }, () => 'f'),
      null,
      nextId
    ).draft;
    const pasted = pasteIntoRow(
      filled,
      'delayJs',
      first?.id ?? '',
      'a\nb\nc',
      { start: 0, end: 0 },
      nextId
    );
    expect(pasted.draft.rows.delayJs).toHaveLength(EXCLUSION_SET_LIMITS.rowsPerFeature);
    // Lines a, b, cjquery… — the cap drops the pasted b, keeps the row's text.
    expect(texts(pasted.draft).slice(0, 2)).toEqual(['a', 'cjquery\\.min\\.js']);
    expect(pasted.dropped).toBe(1);
  });

  it('takes no multi-line paste into a full lane', () => {
    const full = insertRows(
      start,
      'delayJs',
      Array.from({ length: EXCLUSION_SET_LIMITS.rowsPerFeature - 2 }, () => 'f'),
      null,
      nextId
    ).draft;
    expect(
      pasteIntoRow(full, 'delayJs', first?.id ?? '', 'a\nb', { start: 0, end: 0 }, nextId)
    ).toEqual({ draft: full, ids: [], dropped: 1, caret: null });
  });

  it('trims whole lines of the joined text like the settings save, never fragments', () => {
    const pasted = pasteIntoRow(
      start,
      'delayJs',
      first?.id ?? '',
      ' a \n  b  \r\n\tc ',
      { start: 0, end: 0 },
      nextId
    );
    // The edited row is stored when committed (left, or before an apply).
    expect(texts(pasted.draft)).toEqual([' a ', 'b', 'c jquery\\.min\\.js', 'gtag']);
    expect(draftToSet(commitAll(pasted.draft).draft).rows.delayJs).toEqual(
      wpRocketLines('delay_js', first?.text ?? '', 0, 0, ' a \n  b  \r\n\tc ').concat('gtag')
    );
  });

  it.each([
    ' foo \n bar ',
    '\tc \n',
    '\n foo',
    'a  \n',
    'x \ny',
    '\n',
    '\n  \n',
    'a\rb\nc',
    'p\rq',
    'x\r\ny\r'
  ])('stores what WP Rocket would for %j pasted between a|b', (text) => {
    const ids = createIdSource('w');
    const {
      draft,
      ids: [row]
    } = insertRows(draftFromSet(EMPTY_EXCLUSION_SET, ids), 'lazyload', ['ab'], null, ids);
    const pasted = pasteIntoRow(draft, 'lazyload', row ?? '', text, { start: 1, end: 1 }, ids);
    expect(draftToSet(commitAll(pasted.draft).draft).rows.lazyload).toEqual(
      wpRocketLines('lazyload', 'ab', 1, 1, text)
    );
  });

  it('leaves no CR in any row (CR and CRLF break lines like LF)', () => {
    const pasted = pasteIntoRow(
      start,
      'delayJs',
      first?.id ?? '',
      'x\r\ny\rz',
      { start: 0, end: 0 },
      nextId
    );
    expect(texts(pasted.draft).slice(0, 3)).toEqual(['x', 'y', 'zjquery\\.min\\.js']);
  });

  it('puts the caret right after the pasted text, before the kept row text', () => {
    // 'ab', caret a|b: rows 'a foo', 'bar b' — caret after 'bar'.
    const ids = createIdSource('c');
    const {
      draft,
      ids: [row]
    } = insertRows(draftFromSet(EMPTY_EXCLUSION_SET, ids), 'lazyload', ['ab'], null, ids);
    const at = (text: string): number | null =>
      pasteIntoRow(draft, 'lazyload', row ?? '', text, { start: 1, end: 1 }, ids).caret;
    expect(at(' foo \n bar ')).toBe('bar '.length);
    expect(at('foo\n  ')).toBe(0);
    expect(at('x\n')).toBe(0);
    expect(at('x\ny\n\n')).toBe(0);
    expect(at('plain')).toBe('aplain'.length);
    // No suffix: the end of the last row.
    const end = pasteIntoRow(draft, 'lazyload', row ?? '', 'x\n yz ', { start: 2, end: 2 }, ids);
    expect(end.caret).toBe('yz'.length);
  });

  it('changes nothing for an unknown row', () => {
    expect(
      pasteIntoRow(start, 'delayJs', 'missing', 'a\nb', { start: 0, end: 0 }, nextId).draft
    ).toBe(start);
  });
});

describe('startCommit (commitRows a slice at a time)', () => {
  /** A Delay lane mixing kept, converted, duplicate, dropped and untouched rows. */
  function mixedDraft() {
    const nextId = createIdSource();
    const texts = ['keep', 'a*', '', 'keep', '0', 'b*', '(', 'c', 'a(.*)', 'tail'];
    const base = draftFromSet(EMPTY_EXCLUSION_SET, nextId);
    const rows = texts.map((text, index) => ({ id: `r${String(index)}`, text }));
    return { ...base, rows: { ...base.rows, delayJs: rows } };
  }

  it.each([1, 2, 3, 64])('gives commitRows exactly, %i rows per slice', (size) => {
    const draft = mixedDraft();
    // `tail` is left out (the caret's row), `r0` too: an untouched row ahead.
    const ids = draft.rows.delayJs.map((row) => row.id).filter((id) => id !== 'r0' && id !== 'r9');
    const whole = commitRows(draft, 'delayJs', ids);
    const kept: string[] = [];
    const sliced = startCommit(draft, 'delayJs', ids, (stored) => kept.push(stored));
    let slices = 1;
    while (!sliced.step(size)) slices++;
    expect(sliced.result()).toEqual(whole);
    expect(slices).toBeGreaterThanOrEqual(Math.ceil(7 / size));
    // Told every committed row kept, in lane order, as stored.
    expect(kept).toEqual(['a(.*)', 'b(.*)', 'c']);
  });

  it('keeps the draft itself when nothing changes, and refuses a result read early', () => {
    const draft = mixedDraft();
    // A blank row is passed through: nothing to commit, every row done in one step.
    const unchanged = startCommit(draft, 'delayJs', ['r2']);
    expect(() => unchanged.result()).toThrow('row 0');
    expect(unchanged.step(1)).toBe(true);
    expect(unchanged.result().draft).toBe(draft);
  });
});

describe('splitLines', () => {
  it('splits on both newline styles, trims lines and drops blank ones', () => {
    expect(splitLines('a\r\nb\n\n  \nc ')).toEqual(['a', 'b', 'c']);
  });

  it('breaks lines on a lone CR too, as the field normalizes it', () => {
    expect(splitLines('a\rb\nc\r')).toEqual(['a', 'b', 'c']);
    expect(splitLines('\r\n\r')).toEqual([]);
  });
});

describe('createRowValidator', () => {
  /** A blocking check whose reason matches `reason`. */
  const blocking = (reason: RegExp): unknown => ({
    reason: expect.stringMatching(reason) as unknown,
    blocking: true
  });

  it('names invalid and risky patterns, accepts literals as text', () => {
    const validate = createRowValidator();
    // Regex rows are read as WP Rocket reads them (its save drops what PCRE rejects).
    expect(validate('delayJs', '(')).toEqual(blocking(/^WP Rocket drops this row when saving/));
    expect(validate('deferJs', '(')).toEqual(blocking(/^WP Rocket drops this row when saving/));
    expect(validate('deferJs', '(a+)+$')).toEqual(blocking(/^Risky regular expression/));
    expect(validate('lazyload', '(')).toBeNull();
    expect(validate('delayJs', 'gtag')).toBeNull();
  });

  it('names rows the session cannot store: over the row cap or with control characters', () => {
    const validate = createRowValidator();
    expect(validate('lazyload', 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars + 1))).toEqual(
      blocking(/longer than 2048/)
    );
    expect(validate('lazyload', 'a\u0007b')).toEqual(blocking(/control character/));
    expect(validate('delayJs', `x${String.fromCharCode(0xd83c)}`)).toEqual(
      blocking(/control character/)
    );
    expect(validate('lazyload', 'x'.repeat(EXCLUSION_SET_LIMITS.rowChars))).toBeNull();
  });

  it('treats blank rows as unfinished, never as errors', () => {
    expect(createRowValidator()('delayJs', '   ')).toBeNull();
  });

  it('validates the row as it would be stored: surrounding whitespace never decides', () => {
    const validate = createRowValidator();
    expect(validate('lazyload', 'logo.png\t')).toBeNull();
    expect(validate('lazyload', `  ${'x'.repeat(EXCLUSION_SET_LIMITS.rowChars)}  `)).toBeNull();
    expect(validate('delayJs', ' ( ')).toEqual(blocking(/^WP Rocket drops this row when saving/));
  });

  it('serves repeated rows from its cache and restarts past capacity', () => {
    const validate = createRowValidator(2);
    expect(validate('delayJs', '(')).toBe(validate('delayJs', '('));
    validate('delayJs', 'a');
    validate('delayJs', 'b');
    expect(validate('delayJs', '(')).toEqual(blocking(/^WP Rocket drops this row/));
  });

  it('warns, never blocks, on a row WP Rocket applies matching every script (K.5c)', () => {
    const validate = createRowValidator();
    for (const lane of ['delayJs', 'deferJs'] as const) {
      expect(validate(lane, '(?a)')).toEqual({
        reason: 'WP Rocket stores this and it excludes every script',
        blocking: false
      });
    }
  });

  it('leaves joined-only problems to the set reading, blocking or not', () => {
    const validate = createRowValidator();
    // Alone, `.*` turns Defer JS off (a warning) and `a\\Qb` fails its check:
    // next to other rows both may differ, so the row check says nothing.
    expect(validate('deferJs', '.*')).toBeNull();
    expect(validate('deferJs', 'a\\Qb')).toBeNull();
    // Delay JS reads rows alone: `.*` matches every script there.
    expect(validate('delayJs', '.*')).toMatchObject({ blocking: false });
  });
});

describe('blankRowWarning', () => {
  it('warns on a whitespace-only lazy-render row only', () => {
    expect(blankRowWarning('lazyRender', '  ')).toMatch(/^Row is only whitespace/);
    expect(blankRowWarning('lazyRender', '')).toBeNull();
    expect(blankRowWarning('lazyRender', 'id="a"')).toBeNull();
    expect(blankRowWarning('lazyload', '  ')).toBeNull();
    expect(blankRowWarning('delayJs', '  ')).toBeNull();
    // A blank pattern row is an unfinished edit: no warning (its `''` is never sent).
    expect(blankRowWarning('delayJs', '')).toBeNull();
    expect(blankRowWarning('deferJs', '')).toBeNull();
  });
});
