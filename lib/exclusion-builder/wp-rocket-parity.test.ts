/**
 * WP Rocket parity: replays every row of `wp-rocket-parity.fixtures.json`
 * (expected outputs derived from the real plugin by `pnpm parity:wp-rocket`)
 * against this engine — no PHP here.
 *
 * - save rows: typed lines → the stored rows and the dropped lines (with
 *   reasons) the engine's field normalization yields;
 * - match rows: the page WP Rocket serves without user rows, run through the
 *   feature's pipeline step with the stored rows → the engine's candidates,
 *   the subjects it restores (its exclusion marker) and, per feature, the
 *   Defer page state and inline-jQuery wrapping, and the lazy-render
 *   hashing (plus, for a row with a `warning` disposition, the warning the
 *   engine names); or, for a row with a `problem` / `residual`
 *   disposition, the row problem / documented residual it names.
 *
 * Every row runs once per supported WP Rocket version, against that
 * version's expectations (the row's `byVersion` overrides applied: e.g. the
 * page that version serves).
 *
 * Every compared field is asserted per row. A field listed in the row's
 * `pending.fields` is behavior the engine does not mirror yet: it must still
 * differ, and fails once it matches — the signal to drop it from the mark.
 * Every other field must equal now. A crash (anything but the engine's
 * validation error) fails the row either way.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';
import { INLINE_WRAP_OPEN } from '../wp-rocket/constants';
import { ExclusionValidationError, type InvalidExclusionRow } from './errors';
import { saveExclusionRows, type SubmittedRow } from './field-text';
import { parseTagAt, scanTags } from './html-scan';
import { lazyRenderRekeyed } from './lazy-render-hashing';
import { expectationsFor } from './parity-version-expectations';
import { exclusionPipelineSteps } from './pipeline';
import { prevalidateExclusionSet } from './validate';
import type { TransformReport } from './report';
import {
  EMPTY_EXCLUSION_SET,
  EXCLUSION_FEATURES,
  type ExclusionFeatureId,
  type ExclusionSet
} from './set';
import { findAttribute } from './tag-edit';
import {
  comparedFields,
  parseParityTable,
  typedLineBytes,
  type DroppedLine,
  type MatchRow,
  type ParityRow,
  type SaveRow,
  type TypedLine
} from './wp-rocket-parity-table';

/** The table, validated at load: a malformed row fails the file, naming the row. */
const table = parseParityTable(
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'wp-rocket-parity.fixtures.json'),
      'utf8'
    )
  )
);

/** The element a feature's subjects are (lazy rendering: any element with an id). */
const SUBJECT_TAG: Readonly<Record<ExclusionFeatureId, string | null>> = {
  delay_js: 'script',
  defer_all_js: 'script',
  lazyload: 'img',
  automatic_lazy_rendering: null
};

/** One keyed subject tag of a page. */
interface KeyedTag {
  readonly key: string;
  readonly tagText: string;
  /** The opening tag plus its raw-text content (the opening tag alone for other tags). */
  readonly element: string;
}

/**
 * A page's subjects in document order, keyed as the table keys them: the
 * `id`, else `#n` for the n-th id-less subject tag (comments skipped, as the
 * engine's scanner skips them). A repeated id (Lazyload's `<noscript>` copy
 * of an image) is listed once, at its first occurrence.
 *
 * @param html The page.
 * @param feature The feature whose subjects to list.
 */
function subjectTags(html: string, feature: ExclusionFeatureId): KeyedTag[] {
  const name = SUBJECT_TAG[feature];
  const keyed: KeyedTag[] = [];
  let anonymous = 0;
  for (const tag of scanTags(html)) {
    if (name !== null && tag.name !== name) continue;
    const tagText = html.slice(tag.start, tag.openingEnd);
    const id = findAttribute(parseTagAt(tagText, 0), 'id')?.value ?? null;
    if (id === null && name === null) continue;
    const key = id ?? `#${String(anonymous++)}`;
    if (!keyed.some((entry) => entry.key === key)) {
      keyed.push({ key, tagText, element: html.slice(tag.start, tag.contentEnd) });
    }
  }
  return keyed;
}

/** Keys of the subjects carrying the engine's exclusion marker. */
function markedKeys(html: string, feature: ExclusionFeatureId): string[] {
  return subjectTags(html, feature)
    .filter(({ tagText }) => findAttribute(parseTagAt(tagText, 0), FDT_EXCLUDED_RESOURCE) !== null)
    .map(({ key }) => key);
}

/** How often an element holds WP Rocket's inline wrapper opening. */
function wrapperCount(element: string): number {
  return element.split(INLINE_WRAP_OPEN).length - 1;
}

/**
 * Keys of the scripts the engine's page holds wrapped more often than the
 * source page — read as the harness reads WP Rocket's (whole element: a `>`
 * in a value moves the wrapper into the opening tag).
 *
 * @param source The page before WP Rocket (the row's `html`).
 * @param page The engine's output.
 */
function wrappedKeys(source: string, page: string): string[] {
  const before = new Map(
    subjectTags(source, 'defer_all_js').map(({ key, element }) => [key, wrapperCount(element)])
  );
  return subjectTags(page, 'defer_all_js')
    .filter(({ key, element }) => wrapperCount(element) > (before.get(key) ?? 0))
    .map(({ key }) => key);
}

/**
 * The engine's inline-pass answer for a Defer row, read from the Defer
 * step's own report: `'undetermined'` when it reports undetermined scripts
 * (the table's Defer pages have no undetermined deferred script), else the
 * keys still wrapped — and `'report-mismatch'` when the report's
 * `inlineUnwrapped` disagrees with the scripts it actually unwrapped.
 *
 * @param row The match row.
 * @param run The Defer step's result on the row's served page.
 */
function engineInlineWrapped(
  row: MatchRow,
  run: { readonly html: string; readonly report: TransformReport }
): readonly string[] | 'undetermined' | 'report-mismatch' {
  if ((run.report.undetermined ?? 0) > 0) return 'undetermined';
  const servedWrapped = wrappedKeys(row.html, row.served).length;
  const stillWrapped = wrappedKeys(row.html, run.html);
  const unwrapped = servedWrapped - stillWrapped.length;
  return (run.report.inlineUnwrapped ?? 0) === unwrapped ? stillWrapped : 'report-mismatch';
}

/** A typed line as the save receives it: text, or the raw bytes of a non-UTF-8 line. */
function submitted(line: TypedLine): SubmittedRow {
  return typeof line === 'string' ? line : typedLineBytes(line);
}

/**
 * What the engine stores for a save row: the field normalization's stored
 * rows and, from its per-row diff, each dropped line with its reason (safe
 * mode off unless the row says otherwise, as the table records it).
 */
function engineSave(row: SaveRow): { stored: readonly string[]; dropped: DroppedLine[] } {
  const saved = saveExclusionRows(row.feature, row.typed.map(submitted), {
    safeMode: row.safeMode ?? false
  });
  const dropped: DroppedLine[] = [];
  saved.diffs.forEach((diff, index) => {
    const line = row.typed[index];
    if (diff.state === 'dropped' && line !== undefined) {
      dropped.push({ index, row: line, reason: diff.reason });
    }
  });
  return { stored: saved.rows, dropped };
}

/** A set carrying `rows` on `feature` (and, optionally, its feature-wide disable). */
function setFor(
  feature: ExclusionFeatureId,
  rows: readonly string[],
  featureWide = false
): ExclusionSet {
  const spec = EXCLUSION_FEATURES.find((candidate) => candidate.id === feature);
  if (spec === undefined) throw new Error(`no feature ${feature}`);
  const disable =
    featureWide && spec.toggleKey !== null
      ? { ...EMPTY_EXCLUSION_SET.disable, [spec.toggleKey]: true }
      : EMPTY_EXCLUSION_SET.disable;
  return { rows: { ...EMPTY_EXCLUSION_SET.rows, [spec.rowsKey]: rows }, disable };
}

/** The feature's pipeline step over `html`: the rewritten page and the step's report. */
function runStepResult(
  feature: ExclusionFeatureId,
  html: string,
  set: ExclusionSet
): { readonly html: string; readonly report: TransformReport } {
  // The feature's own step (Defer JS's id also names the inline-pass replay, run first).
  const step = exclusionPipelineSteps(set).findLast((candidate) => candidate.id === feature);
  if (step === undefined) throw new Error(`no pipeline step for ${feature}`);
  const result = step.apply(html);
  if (result.report === null) throw new Error(`the ${feature} step reports nothing`);
  return { html: result.html, report: result.report };
}

/** The feature's pipeline step over `html`, returning the rewritten page. */
function runStep(feature: ExclusionFeatureId, html: string, set: ExclusionSet): string {
  return runStepResult(feature, html, set).html;
}

/**
 * The engine's candidate keys on the served page: every subject it restores
 * when told to restore all — the feature-wide disable where the feature has
 * one; Lazyload (no toggle) gets the literal `=`, which every candidate's
 * subject holds (each candidate carries a `src` value to restore).
 */
function engineCandidates(row: MatchRow): string[] {
  const hasToggle = EXCLUSION_FEATURES.some(
    (spec) => spec.id === row.feature && spec.toggleKey !== null
  );
  const set = hasToggle ? setFor(row.feature, [], true) : setFor(row.feature, ['=']);
  return markedKeys(runStep(row.feature, row.served, set), row.feature);
}

/** A match row's comparable outcome. */
type MatchOutcome =
  | {
      readonly candidates: readonly string[];
      readonly excluded: readonly string[];
      readonly featureOff?: boolean | 'unknown';
      readonly inlineWrapped?: readonly string[] | 'undetermined' | 'report-mismatch';
      readonly hashed?: readonly string[];
      readonly rekeyed?: readonly string[] | null;
      readonly warnings?: readonly (string | null)[];
    }
  | { readonly problems: readonly (string | null)[] };

/** The distinct problem ids of named rows (`null` where an entry has none), sorted. */
function problemIds(entries: readonly InvalidExclusionRow[]): (string | null)[] {
  const ids = entries.map((entry) =>
    'problem' in entry && typeof entry.problem === 'string' ? entry.problem : null
  );
  return [...new Set(ids)].sort();
}

/**
 * The lazy-render elements the engine reports re-keyed, by id (`null` when
 * it cannot rebuild the hash order).
 */
function engineRekeyed(row: MatchRow): string[] | null {
  return (
    lazyRenderRekeyed(row.served, row.rows)?.map(
      (tag) => findAttribute(tag, 'id')?.value ?? `@${String(tag.start)}`
    ) ?? null
  );
}

/**
 * The engine's outcome for a match row. A validation error is an answer
 * (its problem ids); any other throw is a crash and propagates. Defer's
 * `featureOff`: the report's page state — `off` is `true`, `'unknown'`
 * when it could not be replayed (never equal to WP Rocket's boolean), else
 * `false`. Defer's `inlineWrapped`: see {@link engineInlineWrapped}.
 * `warnings`: the warning ids prevalidation names for the set.
 */
function engineMatch(row: MatchRow): MatchOutcome {
  try {
    const featureSet = setFor(row.feature, row.rows);
    // A Delay JS row with Defer JS rows: the engine reads the inline pass under them.
    const set =
      row.deferRows === undefined
        ? featureSet
        : { ...featureSet, rows: { ...featureSet.rows, deferJs: row.deferRows } };
    const run = runStepResult(row.feature, row.served, set);
    const excluded = markedKeys(run.html, row.feature);
    const candidates = engineCandidates(row);
    const lazyRender =
      row.feature === 'automatic_lazy_rendering'
        ? {
            hashed: candidates.filter((key) => !excluded.includes(key)),
            rekeyed: engineRekeyed(row)
          }
        : {};
    return {
      candidates,
      excluded,
      ...(row.feature === 'defer_all_js'
        ? {
            featureOff:
              run.report.pageState === 'unknown' ? 'unknown' : run.report.pageState === 'off',
            inlineWrapped: engineInlineWrapped(row, run)
          }
        : {}),
      ...lazyRender,
      warnings: problemIds(prevalidateExclusionSet(set).warnings)
    };
  } catch (error) {
    if (error instanceof ExclusionValidationError) return { problems: problemIds(error.invalid) };
    throw error;
  }
}

/** The outcome a match row expects from the engine: its disposition, else WP Rocket's. */
function expectedMatch(row: MatchRow): MatchOutcome {
  const engine = row.engine;
  if (engine !== undefined && 'problem' in engine) return { problems: [engine.problem] };
  if (engine !== undefined && 'residual' in engine) {
    return { candidates: engine.candidates, excluded: engine.excluded };
  }
  return {
    ...(engine === undefined ? {} : { warnings: [engine.warning] }),
    candidates: row.candidates,
    excluded: row.excluded,
    ...(row.featureOff === undefined ? {} : { featureOff: row.featureOff }),
    ...(row.inlineWrapped === undefined
      ? {}
      : {
          inlineWrapped: row.inlineUndetermined === undefined ? row.inlineWrapped : 'undetermined'
        }),
    ...(row.hashed === undefined ? {} : { hashed: row.hashed, rekeyed: row.rekeyed })
  };
}

/** Whether a value is a list of keys / problem ids (strings, or `null` for an unnamed problem). */
function isKeyList(value: unknown): value is (string | null)[] {
  return Array.isArray(value) && value.every((item) => item === null || typeof item === 'string');
}

/** Order-free comparison form of one field: key lists sorted, anything else as is. */
function normalized(value: unknown): unknown {
  return isKeyList(value) ? [...value].sort((a, b) => String(a).localeCompare(String(b))) : value;
}

/**
 * Assert a row field by field over its compared fields (an absent field
 * reads as `undefined`): a pending field must still differ, every other
 * field must equal.
 */
function assertRow(
  row: ParityRow,
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>
): void {
  const pending = row.pending?.fields ?? [];
  for (const field of comparedFields(row)) {
    const got = normalized(actual[field]);
    const want = normalized(expected[field]);
    if (pending.includes(field)) {
      expect(
        got,
        `${row.id}.${field} now matches WP Rocket — drop "${field}" from its pending fields`
      ).not.toEqual(want);
    } else {
      expect(got, `${row.id}.${field}`).toEqual(want);
    }
  }
}

/** The test title: id, the note, and the pending mark. */
function title(row: ParityRow): string {
  const pending =
    row.pending === undefined
      ? ''
      : `[pending ${row.pending.owner}: ${row.pending.fields.join(', ')}] `;
  return `${pending}${row.id}${row.note === undefined ? '' : ` — ${row.note}`}`;
}

/**
 * The table's rows as one version expects them (its `byVersion` overrides
 * applied), so every row replays against that version's served page and outputs.
 *
 * @param version The WP Rocket version.
 */
function rowsFor(version: string): (SaveRow | MatchRow)[] {
  // Resolved per kind: `Omit` over the row union would drop its `kind` discriminant.
  return table.rows.map((row) =>
    row.kind === 'save' ? expectationsFor(row, version) : expectationsFor(row, version)
  );
}

describe('WP Rocket parity table', () => {
  it('replays a row expecting per version (its version-keyed outputs are exercised)', () => {
    expect(table.rows.some((row) => row.byVersion !== undefined)).toBe(true);
  });
});

describe.each(SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version] as const))(
  'WP Rocket parity table under WP Rocket %s',
  (version) => {
    const rows = rowsFor(version);

    // The harness keys subjects with its own tag scan; this replay must see the
    // same keys in the same order, or it would compare different elements.
    it('keys the served page subjects exactly as the harness did', () => {
      for (const row of rows) {
        if (row.kind !== 'match') continue;
        const keys = subjectTags(row.served, row.feature).map(({ key }) => key);
        const expected = row.subjects ?? row.candidates;
        const seen =
          row.subjects === undefined ? keys.filter((key) => expected.includes(key)) : keys;
        expect({ row: row.id, keys: seen }).toEqual({ row: row.id, keys: expected });
      }
    });

    describe('save rows (typed → stored + dropped)', () => {
      for (const row of rows) {
        if (row.kind !== 'save') continue;
        it(title(row), () => {
          assertRow(row, engineSave(row), { stored: row.stored, dropped: row.dropped });
        });
      }
    });

    describe('match rows (stored rows + served page → engine outcome)', () => {
      for (const row of rows) {
        if (row.kind !== 'match') continue;
        it(title(row), () => {
          assertRow(row, engineMatch(row), expectedMatch(row));
        });
      }
    });
  }
);
