/**
 * The exclusion set: what a user excludes, per feature — the single
 * declaring site for the set's shape, the feature ids it stamps, each
 * feature's row kind, and the feature-wide disable toggles. Pure data
 * vocabulary: the transforms and the pipeline consume it; nothing here
 * touches HTML, storage or messaging.
 */

/**
 * The features the engine can exclude, in pipeline execution order. The ids
 * are the detection layer's feature keys — the same vocabulary the
 * `data-wpr-fdt-excluded` marker's CSV value uses, so a rewritten page's
 * detection reads the stamps back without a translation table.
 */
export type ExclusionFeatureId =
  'delay_js' | 'defer_all_js' | 'lazyload' | 'automatic_lazy_rendering';

/**
 * A row matched as a regular expression. Compiled without flags —
 * case-sensitive and stateless, like the plugin's own matching of a served
 * tag; a row must never carry `g`/`y` (stateful) flags even if a user
 * writes one, because compilation drops them by construction.
 */
export type PatternRow = string;

/** A row matched as a literal substring — never compiled as a regex. */
export type LiteralRow = string;

/** How a feature's rows match, and where they live in the set. */
export interface ExclusionFeatureSpec {
  readonly id: ExclusionFeatureId;
  readonly rowKind: 'pattern' | 'literal';
  readonly rowsKey: keyof ExclusionSetRows;
  /**
   * The feature-wide disable toggle's key, or `null` when the feature has
   * none — exactly three toggles exist (Delay JS / Defer JS / Automatic
   * Lazy Rendering); Image Lazyload deliberately has no toggle, so its only
   * off-switch is rows that match nothing.
   */
  readonly toggleKey: 'delayJs' | 'deferJs' | 'lazyRender' | null;
}

/** The set's rows, keyed per feature. */
export interface ExclusionSetRows {
  /** Delay JS: regex rows matched against a delayed script's whole markup. */
  readonly delayJs: readonly PatternRow[];
  /** Defer JS: regex rows matched against the script's effective URL. */
  readonly deferJs: readonly PatternRow[];
  /** Image Lazyload: literal rows matched against the restored img markup. */
  readonly lazyload: readonly LiteralRow[];
  /** Automatic Lazy Rendering: regex rows matched against the opening tag. */
  readonly lazyRender: readonly PatternRow[];
}

/** The feature-wide disable toggles (three; no Lazyload toggle). */
export interface ExclusionSetToggles {
  readonly delayJs: boolean;
  readonly deferJs: boolean;
  readonly lazyRender: boolean;
}

/**
 * One exclusion set: the per-feature rows plus the feature-wide disables.
 * A feature is inactive for a document when its rows are empty and its
 * toggle is off — its transform is then the identity.
 */
export interface ExclusionSet {
  readonly rows: ExclusionSetRows;
  readonly disable: ExclusionSetToggles;
}

/**
 * The feature registry — the one declaring site mapping every feature to
 * its id, row kind, rows key and toggle key. Validation and compilation
 * map over it; adding a feature is one row here plus its transform.
 */
export const EXCLUSION_FEATURES: readonly ExclusionFeatureSpec[] = [
  { id: 'delay_js', rowKind: 'pattern', rowsKey: 'delayJs', toggleKey: 'delayJs' },
  { id: 'defer_all_js', rowKind: 'pattern', rowsKey: 'deferJs', toggleKey: 'deferJs' },
  { id: 'lazyload', rowKind: 'literal', rowsKey: 'lazyload', toggleKey: null },
  {
    id: 'automatic_lazy_rendering',
    rowKind: 'pattern',
    rowsKey: 'lazyRender',
    toggleKey: 'lazyRender'
  }
];

/** The set with no rows and nothing disabled — every surface's starting point. */
export const EMPTY_EXCLUSION_SET: ExclusionSet = {
  rows: { delayJs: [], deferJs: [], lazyload: [], lazyRender: [] },
  disable: { delayJs: false, deferJs: false, lazyRender: false }
};
