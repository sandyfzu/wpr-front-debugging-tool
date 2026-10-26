/**
 * The mask-id probe: a row's match over every placeholder id at once.
 * Subjects hold placeholders whose ids are the 13-NUL sentinel.
 */
import { describe, expect, it } from 'vitest';
import {
  compileIdProbe,
  documentProbeBudget,
  idBytesAt,
  ID_PROBE_LIMITS,
  type IdOutcome
} from './id-probe';
import { runtimeParse } from './translate';

const SENTINEL = '\0'.repeat(13);

/** A delayed script whose match holds one svg placeholder. */
const SUBJECT = `<script type="text/rocketlazyloadscript" id="a">el.innerHTML='<!-- WPR_SVG_${SENTINEL} -->';jQuery(1);</script>`;

/** The id starts of a test subject's placeholders (the caller knows them; tests find them). */
const idStarts = (subject: string): number[] =>
  [...subject.matchAll(/WPR_(?:SVG|XMP)_\0{13} -->/g)].map((found) => found.index + 8);

/** The probe's outcome for a Delay JS row over a subject. */
const outcome = (row: string, subject = SUBJECT, budget = documentProbeBudget()): IdOutcome =>
  compileIdProbe(runtimeParse('delay_js', row))(
    subject,
    idBytesAt(subject.length, idStarts(subject)),
    budget
  );

describe('compileIdProbe', () => {
  it('finds rows that match for some ids only, however short the hex fragment', () => {
    // Today's uniqid() ids start `6adf…`: these rows match now, not in a few years.
    for (const row of ['6adf', '_.ad', 'WPR_SVG_0', '[0-9]{3}', 'WPR_SVG_\\d', 'f -->']) {
      expect(outcome(row), row).toBe('depends');
    }
  });

  it('decides rows that match for every id, and leaves the rest to their matcher', () => {
    expect(outcome('WPR_SVG_[0-9a-f]{13} --')).toBe('all');
    // Delay JS escapes `+`: this row needs a literal plus, so it cannot step through an id.
    expect(outcome('_[0-9a-z]+ -->')).toBe('blind');
    expect(outcome('_[0-9a-z]* -->')).toBe('all');
    // Through the id and past it, then not this subject's text: no id matches.
    expect(outcome('_[0-9a-f]{13} -->zz')).toBe('none');
    expect(outcome('jquery\\(1')).toBe('blind');
    // An id is 13 digits, then a space: no 14-digit run steps through it.
    expect(outcome('[0-9a-f]{14}')).toBe('blind');
    expect(outcome('gtag')).toBe('blind');
  });

  it('is blind for rows that cannot read a hex byte (their own matcher answers)', () => {
    for (const row of [
      'WPR_SVG_',
      '-- >',
      'innerHTML',
      '/wp-includes/js/',
      'jquery\\b',
      '\\bjquery'
    ]) {
      expect(['blind', 'all', 'none'], row).toContain(outcome(row));
    }
    expect(outcome('WPR_SVG_')).toBe('blind');
    expect(outcome('jquery\\b')).toBe('blind');
  });

  it('never proves a row that could read an id through a lookaround or an atom', () => {
    expect(outcome('WPR_SVG_(?=6)')).toBe('unknown');
    expect(outcome('WPR_SVG_(?!6)')).toBe('unknown');
    // A lookaround that cannot read a hex byte sees the same for every id.
    expect(outcome('WPR_SVG_(?!z)')).toBe('blind');
    expect(outcome('(a)\\1')).toBe('unknown');
    // An assertion widens the automaton: a hex run it could touch is unknown.
    expect(outcome('\\bad')).toBe('unknown');
  });

  it('builds every construct it reads: keep, options, optional copies, empty matches', () => {
    expect(outcome('WPR_SVG_\\K[0-9]')).toBe('depends');
    expect(outcome('6a?d')).toBe('depends');
    expect(outcome('(?i)6adf')).toBe('depends');
    // A row matching the empty string matches every subject.
    expect(outcome('[0-9]*')).toBe('all');
    // `(?s)` changes matching: widened, so only unknown when it can touch an id.
    expect(outcome('(?s)6.df')).toBe('unknown');
    // Past 64 copies a repeat is widened to `+`.
    expect(outcome('6[0-9a-f]{0,100}')).toBe('unknown');
    // Widened to one copy then `*`: it may end inside an id (a safe over-flag).
    expect(outcome('[0-9]{70,}')).toBe('unknown');
    // `\R` reads no hex byte: nothing after `6` continues inside an id.
    expect(outcome('6\\Rad')).toBe('blind');
    // A back-reference may hold anything, an id byte included.
    expect(outcome('(x)\\1')).toBe('unknown');
  });

  it('proves a widened row blind when the subject never leads it into an id', () => {
    // It could step into an id after any `_`; here the id follows `G_`, never `x_`.
    expect(outcome('x_\\b6a')).toBe('blind');
  });

  it('answers unknown past its state bound', () => {
    expect(outcome('(6[0-9a-f]{60}){60}')).toBe('unknown');
    expect(ID_PROBE_LIMITS.states).toBeGreaterThan(0);
    expect(outcome('(((a|b){40}){40}){40}')).toBe('unknown');
  });

  it('is blind on a subject without placeholder ids', () => {
    expect(outcome('6adf', '<script>x()</script>')).toBe('blind');
  });
});

describe('idBytesAt', () => {
  it('marks the 13 bytes from each given start, nothing else', () => {
    const marked = [...idBytesAt(40, [2, 20])].flatMap((bit, at) => (bit === 1 ? [at] : []));
    expect(marked).toEqual([
      ...Array.from({ length: 13 }, (_, n) => 2 + n),
      ...Array.from({ length: 13 }, (_, n) => 20 + n)
    ]);
  });
});

describe('the document budget', () => {
  it('answers unknown for a row needing a run once the document’s work is spent', () => {
    expect(outcome('6adf', SUBJECT, { left: 0 })).toBe('unknown');
    // A blind row needs no run: it answers whatever is left.
    expect(outcome('gtag', SUBJECT, { left: 0 })).toBe('blind');
    const budget = { left: 50 };
    expect(outcome('6adf', SUBJECT, budget)).toBe('unknown');
    expect(budget.left).toBeLessThan(0);
  });

  it('is shared: a fresh one holds the document limit', () => {
    expect(documentProbeBudget().left).toBe(ID_PROBE_LIMITS.documentSteps);
  });
});
