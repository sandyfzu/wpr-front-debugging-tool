import { describe, expect, it } from 'vitest';
import {
  LAZY_RENDER_EXCLUSIONS_FILTER,
  exclusionCopyText,
  lazyRenderFilterSnippet
} from './copy-form';
import { exclusionFieldText } from './field-text';
import { applyPipeline } from './pipeline';
import { BUILDER_MARKER_META_NAME } from '../wp-rocket/constants';

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

describe('the builder marker is never copied', () => {
  it('stays out of every feature’s copy-all text, even for the set that wrote it', () => {
    const set = {
      rows: { delayJs: ['a\\.js'], deferJs: ['.*'], lazyload: ['hero'], lazyRender: ['below'] },
      disable: { delayJs: false, deferJs: false, lazyRender: false }
    };
    const page =
      '<html><head><script src="j.js" data-rocket-defer defer></script></head><body><img src="p.gif" data-lazy-src="r.jpg" class="hero"></body></html>';
    // The set's rewrite carries the marker; its copy forms are the rows alone.
    expect(applyPipeline(page, set).html).toContain(BUILDER_MARKER_META_NAME);
    const copies = [
      exclusionCopyText('delay_js', set.rows.delayJs),
      exclusionCopyText('defer_all_js', set.rows.deferJs),
      exclusionCopyText('lazyload', set.rows.lazyload),
      exclusionCopyText('automatic_lazy_rendering', set.rows.lazyRender)
    ];
    for (const copy of copies) {
      expect(copy).not.toContain(BUILDER_MARKER_META_NAME);
      expect(copy).not.toMatch(/\bv1\b/);
    }
  });
});
