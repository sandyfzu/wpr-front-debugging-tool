/**
 * What "copy all" hands the user for each feature, in the form WP Rocket
 * takes the rows: the settings field's text where the feature has a field;
 * a ready-to-paste PHP filter where it has none (Automatic Lazy Rendering
 * reads its exclusions only from the `rocket_lrc_exclusions` filter — one
 * `string[]` argument, which WP Rocket's own callback merges its remote list
 * into, so the snippet merges too rather than replacing).
 */
import { exclusionFieldText } from './field-text';
import type { ExclusionFeatureId } from './set';

/** The filter Automatic Lazy Rendering reads its exclusions from. */
export const LAZY_RENDER_EXCLUSIONS_FILTER = 'rocket_lrc_exclusions';

/**
 * A row as a PHP single-quoted string: `\` and `'` escaped (every
 * backslash, so a row ending in one cannot escape the closing quote).
 *
 * @param row The row.
 */
function phpQuoted(row: string): string {
  return `'${row.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/**
 * The rows as a PHP snippet adding them to `rocket_lrc_exclusions` (for a
 * theme's functions.php or a must-use plugin), merged with the exclusions
 * already there.
 *
 * @param rows The rows, as stored.
 */
export function lazyRenderFilterSnippet(rows: readonly string[]): string {
  return [
    `add_filter( '${LAZY_RENDER_EXCLUSIONS_FILTER}', function ( $exclusions ) {`,
    '\treturn array_merge( (array) $exclusions, [',
    ...rows.map((row) => `\t\t${phpQuoted(row)},`),
    '\t] );',
    '} );'
  ].join('\n');
}

/** Each feature's copy form. */
const COPY_FORMS: Readonly<Record<ExclusionFeatureId, (rows: readonly string[]) => string>> = {
  delay_js: exclusionFieldText,
  defer_all_js: exclusionFieldText,
  lazyload: exclusionFieldText,
  automatic_lazy_rendering: lazyRenderFilterSnippet
};

/**
 * The text "copy all" copies for a feature's stored rows.
 *
 * @param feature The feature.
 * @param rows The rows, as stored (no blank ones).
 */
export function exclusionCopyText(feature: ExclusionFeatureId, rows: readonly string[]): string {
  return COPY_FORMS[feature](rows);
}
