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
  isBlankRow,
  laneFeature,
  pasteIntoRow,
  removeRow,
  sameSet,
  setDisable,
  splitLines,
  trimRow,
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

  it('drops blank rows from the set and trims the rest like the settings save', () => {
    const nextId = createIdSource();
    const { draft } = insertRows(
      draftFromSet(EMPTY_EXCLUSION_SET, nextId),
      'delayJs',
      ['  ', ' gtag ', '', '\tjquery\r', 'a b'],
      null,
      nextId
    );
    expect(draftToSet(draft).rows.delayJs).toEqual(['gtag', 'jquery', 'a b']);
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
    expect(added.added).toBe(true);
    const again = addCandidate(added.draft, 'lazyload', 'logo.png', nextId);
    expect(again).toEqual({ draft: added.draft, id: added.id, added: false });
  });

  it('adds a candidate trimmed, and finds it again whatever its surrounding whitespace', () => {
    const added = addCandidate(start, 'lazyload', ' hero.webp\t', nextId);
    expect(added.draft.rows.lazyload.at(-1)?.text).toBe('hero.webp');
    const typed = updateRow(start, 'lazyload', start.rows.lazyload[0]?.id ?? '', 'logo.png  ');
    const again = addCandidate(typed, 'lazyload', 'logo.png', nextId);
    expect(again).toEqual({ draft: typed, id: start.rows.lazyload[0]?.id, added: false });
  });

  it('trims one row in place, identity when already trimmed or unknown', () => {
    const id = start.rows.delayJs[0]?.id ?? '';
    const typed = updateRow(start, 'delayJs', id, '  gtag\t');
    const trimmed = trimRow(typed, 'delayJs', id);
    expect(trimmed.rows.delayJs[0]).toEqual({ id, text: 'gtag' });
    expect(trimRow(trimmed, 'delayJs', id)).toBe(trimmed);
    expect(trimRow(trimmed, 'delayJs', 'missing')).toBe(trimmed);
  });

  it('counts the wire characters of non-blank rows, trimmed', () => {
    const blankAdded = insertRows(start, 'delayJs', ['   '], null, nextId).draft;
    expect(draftChars(blankAdded)).toBe(draftChars(start));
    const padded = insertRows(start, 'delayJs', ['  ab\t'], null, nextId).draft;
    expect(draftChars(padded)).toBe(draftChars(start) + 2);
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
 * split on LF, each line trimmed, blank lines dropped — derived from the
 * textarea and save rules, independently of the paste code.
 */
function wpRocketLines(row: string, start: number, end: number, pasted: string): string[] {
  return (row.slice(0, start) + pasted + row.slice(end))
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, ''))
    .filter((line) => line !== '');
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
    // The edited row trims when left; the set already reads it trimmed.
    expect(texts(pasted.draft)).toEqual([' a ', 'b', 'c jquery\\.min\\.js', 'gtag']);
    expect(draftToSet(pasted.draft).rows.delayJs).toEqual(
      wpRocketLines(first?.text ?? '', 0, 0, ' a \n  b  \r\n\tc ').concat('gtag')
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
    expect(draftToSet(pasted.draft).rows.lazyload).toEqual(wpRocketLines('ab', 1, 1, text));
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
  it('names invalid and risky patterns, accepts literals as text', () => {
    const validate = createRowValidator();
    // Delay JS rows are read as WP Rocket reads them (its save drops what PCRE rejects).
    expect(validate('delayJs', '(')).toMatch(/^WP Rocket drops this row when saving/);
    expect(validate('deferJs', '(')).toMatch(/^Invalid regular expression: /);
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

  it('validates the row as it would be stored: surrounding whitespace never decides', () => {
    const validate = createRowValidator();
    expect(validate('lazyload', 'logo.png\t')).toBeNull();
    expect(validate('lazyload', `  ${'x'.repeat(EXCLUSION_SET_LIMITS.rowChars)}  `)).toBeNull();
    expect(validate('delayJs', ' ( ')).toMatch(/^WP Rocket drops this row when saving/);
  });

  it('serves repeated rows from its cache and restarts past capacity', () => {
    const validate = createRowValidator(2);
    expect(validate('delayJs', '(')).toBe(validate('delayJs', '('));
    validate('delayJs', 'a');
    validate('delayJs', 'b');
    expect(validate('delayJs', '(')).toMatch(/^WP Rocket drops this row/);
  });
});
