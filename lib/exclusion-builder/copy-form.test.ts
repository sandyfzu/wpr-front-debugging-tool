import { describe, expect, it } from 'vitest';
import {
  LAZY_RENDER_EXCLUSIONS_FILTER,
  exclusionCopyText,
  lazyRenderFilterSnippet
} from './copy-form';
import { exclusionFieldText } from './field-text';

describe('exclusionCopyText', () => {
  it('copies the settings field text for the features with a field', () => {
    for (const feature of ['delay_js', 'defer_all_js', 'lazyload'] as const) {
      expect(exclusionCopyText(feature, ['a', 'b(.*)'])).toBe(exclusionFieldText(['a', 'b(.*)']));
    }
  });

  it('copies a merging rocket_lrc_exclusions filter for Automatic Lazy Rendering', () => {
    expect(exclusionCopyText('automatic_lazy_rendering', ['id="footer"', 'class="cta"'])).toBe(
      [
        "add_filter( 'rocket_lrc_exclusions', function ( $exclusions ) {",
        '\treturn array_merge( (array) $exclusions, [',
        '\t\t\'id="footer"\',',
        '\t\t\'class="cta"\',',
        '\t] );',
        '} );'
      ].join('\n')
    );
    expect(LAZY_RENDER_EXCLUSIONS_FILTER).toBe('rocket_lrc_exclusions');
  });

  it('escapes every backslash and quote, so PHP reads the row back exactly', () => {
    const snippet = lazyRenderFilterSnippet(["it's", 'a\\', "\\'"]);
    expect(snippet).toContain("\t\t'it\\'s',");
    expect(snippet).toContain("\t\t'a\\\\',");
    expect(snippet).toContain("\t\t'\\\\\\'',");
    // Undo PHP's single-quote escapes: the rows come back as given.
    const read = [...snippet.matchAll(/^\t\t'((?:[^'\\]|\\.)*)',$/gm)].map((match) =>
      (match[1] ?? '').replace(/\\([\\'])/g, '$1')
    );
    expect(read).toEqual(["it's", 'a\\', "\\'"]);
  });
});
