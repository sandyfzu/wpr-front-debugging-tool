/**
 * A beacon test's results as list rows: the above-the-fold candidates (one
 * row per record: its image URL, the beacon's element kind and label, and
 * every value of the record as named facts for the row's details) and
 * the lazy-render hashes, each with its list definition (filter chips +
 * searched text) for the panel's shared filter/search list. Pure; rows keep
 * the beacon's report order, ids are positions in it.
 */
import { choiceFacet, defineFacets, type FacetSet } from '../panel/resource-facets';
import type { ResourceFilterRow, ResourcePageDefinition } from '../panel/resources-view-model';
import type { AboveTheFoldCandidate, FeatureList, PictureSource } from './results';

/** The beacon's label for the largest candidate (its LCP). */
export const LCP_LABEL = 'lcp';

/** The beacon's label for the other above-the-fold candidates. */
export const ABOVE_THE_FOLD_LABEL = 'above-the-fold';

/** One above-the-fold row. */
export interface AboveTheFoldRow {
  /** Position in the beacon's report (the list key). */
  readonly id: number;
  /** The URL shown: the image URL, else the one the browser picked, else the first `srcset` entry's. */
  readonly url: string;
  /** The beacon's element kind (`img`, `img-srcset`, `picture`, `bg-img`, …). */
  readonly kind: string;
  /** The beacon's label (`lcp`, `above-the-fold`, or what a newer beacon sends). */
  readonly label: string;
  /** Every value of the record, named, in the order the details list them. */
  readonly facts: readonly CandidateFact[];
  /** Every fact's value, one per line, deduplicated in order: the searched text. */
  readonly detail: string;
}

/** One named value of a candidate record (the row's details). */
export interface CandidateFact {
  readonly term: string;
  readonly value: string;
}

/** One lazy-render row. */
export interface LazyRenderRow {
  readonly id: number;
  /** The element's `data-rocket-location-hash` value. */
  readonly hash: string;
}

/**
 * The first URL of a `srcset` (its first candidate's URL).
 *
 * @param srcset The attribute value.
 * @returns The URL, or `''`.
 */
function firstSrcsetUrl(srcset: string): string {
  return srcset.trim().split(/\s+/, 1)[0]?.replace(/,$/, '') ?? '';
}

/**
 * The URL a candidate row shows.
 *
 * @param candidate The record.
 * @returns The first non-empty of src, currentSrc, a background URL, a srcset URL.
 */
export function candidateUrl(candidate: AboveTheFoldCandidate): string {
  return (
    [
      candidate.src,
      candidate.currentSrc,
      candidate.backgroundUrls[0] ?? '',
      firstSrcsetUrl(candidate.srcset),
      firstSrcsetUrl(candidate.sources[0]?.srcset ?? '')
    ].find((url) => url !== '') ?? ''
  );
}

/**
 * A `<source>` element's attributes on one line each (empty ones left out).
 *
 * @param source The source.
 * @returns E.g. `srcset: a.avif 1x\nmedia: (min-width: 600px)`.
 */
function sourceLines(source: PictureSource): string {
  return (
    [
      ['srcset', source.srcset],
      ['sizes', source.sizes],
      ['media', source.media],
      ['type', source.type]
    ] as const
  )
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

/**
 * Every value of a record as named facts, empty ones left out: the image
 * attributes, the background URLs, each `<source>`, then the fields this
 * version does not interpret (by their own name).
 *
 * @param candidate The record.
 * @returns The facts, in display order.
 */
export function candidateFacts(candidate: AboveTheFoldCandidate): CandidateFact[] {
  const facts: CandidateFact[] = [
    { term: 'src', value: candidate.src },
    { term: 'URL the browser picked', value: candidate.currentSrc },
    { term: 'srcset', value: candidate.srcset },
    { term: 'sizes', value: candidate.sizes },
    ...candidate.backgroundUrls.map((url, index) => ({
      term:
        candidate.backgroundUrls.length === 1 ? 'Background' : `Background ${String(index + 1)}`,
      value: url
    })),
    ...candidate.sources.map((source, index) => ({
      term: `<source> ${String(index + 1)}`,
      value: sourceLines(source)
    })),
    ...Object.entries(candidate.extra).map(([term, value]) => ({ term, value: String(value) }))
  ];
  return facts.filter((fact) => fact.value !== '');
}

/**
 * The searched text: every value of a record, one per line, deduplicated
 * in order — the same values the details show, so a match is explainable.
 *
 * @param candidate The record.
 */
function candidateDetail(candidate: AboveTheFoldCandidate): string {
  const values = [
    candidate.src,
    candidate.currentSrc,
    candidate.srcset,
    candidate.sizes,
    ...candidate.backgroundUrls,
    ...candidate.sources.flatMap((source) => [
      source.srcset,
      source.sizes,
      source.media,
      source.type
    ]),
    ...Object.values(candidate.extra).map(String)
  ].filter((value) => value !== '');
  return [...new Set(values)].join('\n');
}

/**
 * The rows of an above-the-fold list.
 *
 * @param list The validated list (null or malformed: no rows).
 * @returns Rows in report order.
 */
export function aboveTheFoldRows(
  list: FeatureList<AboveTheFoldCandidate> | null
): readonly AboveTheFoldRow[] {
  if (list?.kind !== 'ok') return [];
  return list.items.map((candidate, id) => ({
    id,
    url: candidateUrl(candidate),
    kind: candidate.kind,
    label: candidate.label,
    facts: candidateFacts(candidate),
    detail: candidateDetail(candidate)
  }));
}

/**
 * The rows of a lazy-render list.
 *
 * @param list The validated list (null or malformed: no rows).
 * @returns Rows in report order.
 */
export function lazyRenderRows(list: FeatureList<string> | null): readonly LazyRenderRow[] {
  if (list?.kind !== 'ok') return [];
  return list.items.map((hash, id) => ({ id, hash }));
}

/** The above-the-fold list's chip ids. */
export type AboveTheFoldFilterId = 'all' | 'lcp' | 'above-the-fold';

/** The label chips past "All" — declared once (chip bar + facet). */
const LABEL_CHIPS: readonly ResourceFilterRow<AboveTheFoldRow, AboveTheFoldFilterId>[] = [
  { id: 'lcp', label: 'LCP', predicate: (row) => row.label === LCP_LABEL },
  {
    id: 'above-the-fold',
    label: 'Above the fold',
    predicate: (row) => row.label === ABOVE_THE_FOLD_LABEL
  }
];

/** The above-the-fold list's chips (by the beacon's label) and searched text (every value shown). */
export const ABOVE_THE_FOLD_LIST: ResourcePageDefinition<AboveTheFoldRow, AboveTheFoldFilterId> = {
  filters: [{ id: 'all', label: 'All', predicate: () => true }, ...LABEL_CHIPS],
  searchField: (row) => `${row.url}\n${row.kind}\n${row.label}\n${row.detail}`
};

/** The above-the-fold list's facet ids. */
export type AboveTheFoldFacetId = 'label';

/**
 * The above-the-fold list's facets: one label per record, so one choice
 * (value ids = the chip ids); a label a newer beacon sends shows under Any only.
 */
export const ABOVE_THE_FOLD_FACETS: FacetSet<AboveTheFoldRow, AboveTheFoldFacetId> = defineFacets<
  AboveTheFoldRow,
  AboveTheFoldFacetId
>([choiceFacet('label', 'Label', LABEL_CHIPS)]);

/** The lazy-render list's facets: none (search only). */
export const LAZY_RENDER_FACETS: FacetSet<LazyRenderRow, never> = defineFacets<
  LazyRenderRow,
  never
>([]);

/** The lazy-render list: no chips, the hash searched. */
export const LAZY_RENDER_LIST: ResourcePageDefinition<LazyRenderRow, 'all'> = {
  filters: [{ id: 'all', label: 'All', predicate: () => true }],
  searchField: (row) => row.hash
};

/**
 * Whether two rows with one id show the same thing (a refresh keeps the row).
 *
 * @param a A row.
 * @param b The row with the same id.
 */
export function sameAboveTheFoldRow(a: AboveTheFoldRow, b: AboveTheFoldRow): boolean {
  return a.url === b.url && a.kind === b.kind && a.label === b.label && a.detail === b.detail;
}

/**
 * Whether two lazy-render rows with one id show the same hash.
 *
 * @param a A row.
 * @param b The row with the same id.
 */
export function sameLazyRenderRow(a: LazyRenderRow, b: LazyRenderRow): boolean {
  return a.hash === b.hash;
}
