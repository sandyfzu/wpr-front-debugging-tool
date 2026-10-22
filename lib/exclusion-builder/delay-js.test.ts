/**
 * The Delay JS transform: whole-markup matching against delayed scripts
 * (both served type variants, plus the runtime status marker), restoring
 * `type`/`src` per the controller's own runtime semantics (empty carriers
 * count as absent), stamping the exclusion marker as CSV, honest identity
 * when nothing matches, and the feature-wide disable's removal of the
 * plugin's three controller scripts.
 */
import { describe, expect, it } from 'vitest';
import { delayJsTransform } from './delay-js';
import { ExclusionValidationError } from './errors';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';
import { scanTags } from './html-scan';

/** A set whose Delay JS rows are replaced. */
function setWithRows(rows: string[], disableDelayJs = false): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: disableDelayJs }
  };
}

const OLD_TYPE =
  '<script type="rocketlazyloadscript" data-rocket-src="https://s.tld/wp/a.js" id="one"></script>';
const NEW_TYPE = `<script type="text/rocketlazyloadscript" data-rocket-type='text/javascript' data-rocket-src="https://s.tld/wp/b.js" id="two">
  console.log("delayed body");
</script>`;

describe('delayJsTransform — identity arms', () => {
  it('is the identity when the document carries no delayed script', () => {
    const html = '<p>plain</p><script>live();</script>';
    const result = delayJsTransform(html, setWithRows(['a.js']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'delay_js',
      featureWide: false,
      candidates: 0,
      rewritten: 0,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: ['a.js']
    });
  });

  it('is the identity for an empty set and for an empty document', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="a.js"></script>';
    const emptySet = delayJsTransform(html, EMPTY_EXCLUSION_SET);
    expect(emptySet.html).toBe(html);
    expect(emptySet.report.candidates).toBe(1);
    expect(emptySet.report.rewritten).toBe(0);
    expect(delayJsTransform('', setWithRows(['a.js'])).html).toBe('');
  });
});

describe('delayJsTransform — restoring a live script', () => {
  it('restores `src` and drops the delay type when no original type was declared', () => {
    const result = delayJsTransform(OLD_TYPE, setWithRows(['a.js']));
    expect(result.html).toBe(
      '<script id="one" src="https://s.tld/wp/a.js" data-wpr-fdt-excluded="delay_js"></script>'
    );
    expect(result.report).toEqual({
      feature: 'delay_js',
      featureWide: false,
      candidates: 1,
      rewritten: 1,
      regionRemovals: 0,
      matchedRows: [{ row: 'a.js', rowKind: 'pattern', matches: 1 }],
      unmatchedRows: []
    });
  });

  it('restores the declared original type and keeps inline content and the end tag', () => {
    const result = delayJsTransform(NEW_TYPE, setWithRows(['b.js']));
    // The served delay `type` is double-quoted here — the restore keeps that
    // attribute's own quote style (the single-quoted one belongs to
    // `data-rocket-type`, which is dropped).
    expect(result.html).toBe(
      `<script type="text/javascript" id="two" src="https://s.tld/wp/b.js" data-wpr-fdt-excluded="delay_js">
  console.log("delayed body");
</script>`
    );
  });

  it('removes the type attribute entirely when the original had none (the controller sets no type)', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="u.js" defer></script>';
    const result = delayJsTransform(html, setWithRows(['u.js']));
    expect(result.html).toContain('<script defer src="u.js" data-wpr-fdt-excluded="delay_js">');
    expect(result.html).not.toContain('type=');
  });

  it('restores an inline delayed script (no source to move)', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-type="text/javascript">inline();</script>';
    const result = delayJsTransform(html, setWithRows(['inline']));
    expect(result.html).toBe(
      '<script type="text/javascript" data-wpr-fdt-excluded="delay_js">inline();</script>'
    );
  });

  it('overwrites a surviving plain `src` with the parked original', () => {
    // WP Rocket's served form of `src="real.js" src="placeholder.js"`: its
    // greedy rename parks the first and leaves the second (PHP-observed).
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="real.js" src="placeholder.js"></script>';
    const result = delayJsTransform(html, setWithRows(['real\\.js']));
    expect(result.html).toBe('<script src="real.js" data-wpr-fdt-excluded="delay_js"></script>');
    expect(result.html).not.toContain('placeholder.js');
  });

  it('treats an empty `data-rocket-type` as no original type — `type` is removed entirely', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-type="" data-rocket-src="u.js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.html).toBe('<script src="u.js" data-wpr-fdt-excluded="delay_js"></script>');
    expect(result.html).not.toContain('type=');
  });

  it('treats an empty `data-rocket-src` as absent — kept, nothing restored from it', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-type="text/javascript" data-rocket-src="">inline();</script>';
    const result = delayJsTransform(html, setWithRows(['inline']));
    // The type still restores; the empty src carrier stays parked and adds no `src`.
    expect(result.html).toBe(
      '<script type="text/javascript" data-rocket-src="" data-wpr-fdt-excluded="delay_js">inline();</script>'
    );
  });

  it('counts a status-marker candidate it has nothing to restore (an already-live snapshot script)', () => {
    const html = '<script type="text/javascript" data-rocket-status="executed">live();</script>';
    const result = delayJsTransform(html, setWithRows(['live']));
    expect(result.html).toBe(html);
    expect(result.report.candidates).toBe(1);
    expect(result.report.rewritten).toBe(0);
  });
});

describe('delayJsTransform — matching', () => {
  it('matches the whole script markup: attributes, body text, and the closing tag region', () => {
    const html =
      '<script type="rocketlazyloadscript" id="marker-xyz">var payload = "unique-body-token";</script>';
    for (const row of ['marker-xyz', 'unique-body-token']) {
      const result = delayJsTransform(html, setWithRows([row]));
      expect(result.report.rewritten).toBe(1);
      expect(result.report.matchedRows).toEqual([{ row, rowKind: 'pattern', matches: 1 }]);
    }
  });

  it('does not match a sibling script — the row is tested per script, not per document', () => {
    const html = `<script type="rocketlazyloadscript" data-rocket-src="mine.js"></script><script type="rocketlazyloadscript" data-rocket-src="theirs.js"></script>`;
    const result = delayJsTransform(html, setWithRows(['theirs.js']));
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(1);
    expect(result.report.matchedRows[0]?.matches).toBe(1);
  });

  it('attributes a script to the first matching row only', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="u.js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js', 'u']));
    expect(result.report.matchedRows).toEqual([{ row: 'u\\.js', rowKind: 'pattern', matches: 1 }]);
    expect(result.report.unmatchedRows).toEqual(['u']);
  });

  it('reads type values case-sensitively and rows ASCII-case-insensitively, as WP Rocket does', () => {
    // Uppercase tag names scan fine; the served type value is what isDelayJSType reads.
    const upperTag = '<SCRIPT TYPE="rocketlazyloadscript" DATA-ROCKET-SRC="u.js"></SCRIPT>';
    expect(delayJsTransform(upperTag, setWithRows(['u\\.js'])).report.rewritten).toBe(1);
    // An uppercase type VALUE is not the served delay type — not a candidate.
    const upperType = '<script type="ROCKETLAZYLOADSCRIPT" data-rocket-src="u.js"></script>';
    const upperResult = delayJsTransform(upperType, setWithRows(['u\\.js']));
    expect(upperResult.report.candidates).toBe(0);
    // Rows match with WP Rocket's `i` flag: ASCII letters fold, others do not.
    expect(delayJsTransform(OLD_TYPE, setWithRows(['A.JS'])).report.rewritten).toBe(1);
    const accented = '<script type="text/rocketlazyloadscript">var t = "été";</script>';
    expect(delayJsTransform(accented, setWithRows(['ÉTÉ'])).report.rewritten).toBe(0);
    expect(delayJsTransform(accented, setWithRows(['VAR T = "été"'])).report.rewritten).toBe(1);
  });

  it('matches raw served text — served `&#038;` entities are not decoded', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js?a=1&#038;b=2"></script>';
    expect(delayJsTransform(html, setWithRows(['a=1&#038;b=2'])).report.rewritten).toBe(1);
    expect(delayJsTransform(html, setWithRows(['a=1&b=2'])).report.rewritten).toBe(0);
  });
});

describe('delayJsTransform — adversarial markup', () => {
  it('restores every occurrence of a duplicated script and stamps each', () => {
    const html = `${OLD_TYPE}${OLD_TYPE}`;
    const result = delayJsTransform(html, setWithRows(['a\\.js']));
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(2);
    expect(result.report.matchedRows[0]?.matches).toBe(2);
    expect(result.html.match(/data-wpr-fdt-excluded="delay_js"/g)?.length).toBe(2);
  });

  it('survives minified single-line documents with several scripts', () => {
    const html = [
      '<!DOCTYPE html><html><head>',
      '<script>live();</script>',
      '<script type="rocketlazyloadscript" data-rocket-src="one.js"></script>',
      '<script type="rocketlazyloadscript" data-rocket-src="two.js"></script>',
      '</head><body></body></html>'
    ].join('');
    const result = delayJsTransform(html, setWithRows(['one\\.js', 'two\\.js']));
    expect(result.report.rewritten).toBe(2);
    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).not.toContain('rocketlazyloadscript');
    expect(result.html).toContain('src="one.js"');
    expect(result.html).toContain('src="two.js"');
    expect(result.html).toContain('live();');
  });

  it('reads attributes with `>` inside quoted values and restores inside an unterminated script', () => {
    const html = '<script type="rocketlazyloadscript" data-rocket-src="u.js" data-weird="a>b">';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.report.rewritten).toBe(1);
    expect(result.html).toContain('src="u.js"');
  });

  it('ignores scripts inside comments', () => {
    const html =
      '<!-- <script type="rocketlazyloadscript" data-rocket-src="decoy.js"></script> -->';
    const result = delayJsTransform(html, setWithRows(['decoy']));
    expect(result.report.candidates).toBe(0);
    expect(result.html).toBe(html);
  });

  it('preserves the doctype byte-for-byte and passes lone surrogates through (no byte handling here)', () => {
    const html = `<!DoCtYpE html><p>\uD800surrogate</p>${OLD_TYPE}`;
    const result = delayJsTransform(html, setWithRows(['a\\.js']));
    expect(result.html.startsWith('<!DoCtYpE html><p>\uD800surrogate</p>')).toBe(true);
    expect(result.html).toContain('\uD800surrogate');
  });

  it('lets nested `<script` text inside a body stay raw text (no double match)', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js">x("<script type=\\"rocketlazyloadscript\\">");</script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.report.candidates).toBe(1);
    expect(result.report.rewritten).toBe(1);
  });
});

describe('delayJsTransform — feature-wide disable', () => {
  it('restores every delayed script without consulting rows', () => {
    const html = `${OLD_TYPE}<script type="rocketlazyloadscript" data-rocket-src="zzz-other.js"></script>`;
    const result = delayJsTransform(html, setWithRows(['never-matches'], true));
    expect(result.report).toEqual({
      feature: 'delay_js',
      featureWide: true,
      candidates: 2,
      rewritten: 2,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: []
    });
    expect(result.html).toContain('src="https://s.tld/wp/a.js"');
    expect(result.html).toContain('src="zzz-other.js"');
    expect(result.html.match(/data-wpr-fdt-excluded="delay_js"/g)?.length).toBe(2);
  });

  it('removes the UA `?nowprocket=1` cookie/redirect bootstrap script', () => {
    const html = [
      '<script>if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {',
      'document.cookie = "rocket_hide_all_js=1; path=/";',
      'window.location.href = window.location.href + "?nowprocket=1";',
      '}</script>'
    ].join('');
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('');
    expect(result.report.regionRemovals).toBe(1);
  });

  it('removes the delay controller run-invocation script', () => {
    const html =
      '<script>if (!window.RocketLazyLoadScripts) { window.RocketLazyLoadScripts = { listeners: [] }; } RocketLazyLoadScripts.run();</script>';
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('');
    expect(result.report.regionRemovals).toBe(1);
  });

  it('removes the Elementor animation helper script', () => {
    const html =
      "<script>document.addEventListener('DOMContentLoaded', function () { RocketElementorAnimation.run(); });</script>";
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe('');
    expect(result.report.regionRemovals).toBe(1);
  });

  it('removes only the first script of each controller kind and restores the rest', () => {
    const html = [
      '<script>if (navigator.userAgent.match(/x/i)) location.href += "?nowprocket=1";</script>',
      '<script>navigator.userAgent.match(/y/i) && location.assign("?nowprocket=1");</script>',
      '<script>RocketLazyLoadScripts.run();</script>',
      '<script>RocketElementorAnimation.run();</script>',
      OLD_TYPE
    ].join('');
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.report.regionRemovals).toBe(3);
    // The second UA-redirect lookalike survives (first-of-kind removal only);
    // the delayed script is still restored.
    expect(result.html).toContain('location.assign');
    expect(result.html).toContain('src="https://s.tld/wp/a.js"');
    expect(result.html.match(/data-wpr-fdt-excluded="delay_js"/g)?.length).toBe(1);
  });

  it('keeps ordinary scripts whose content merely mentions nearby tokens', () => {
    const html = [
      '<script>navigator.userAgent.match(/x/i);</script>',
      '<script>const run = "RocketLazyLoadScripts";</script>'
    ].join('');
    const result = delayJsTransform(html, setWithRows([], true));
    expect(result.html).toBe(html);
    expect(result.report.regionRemovals).toBe(0);
  });

  it('still validates rows of a disabled feature — a broken row is surfaced, never silently inert', () => {
    expect(() => delayJsTransform(OLD_TYPE, setWithRows(['(bad['], true))).toThrow(
      ExclusionValidationError
    );
  });
});

describe('delayJsTransform — marker accumulation', () => {
  it('appends the feature id to an existing marker value', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js" data-wpr-fdt-excluded="defer_all_js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="defer_all_js, delay_js"');
  });

  it('leaves a marker that already lists the id untouched', () => {
    const html =
      '<script type="rocketlazyloadscript" data-rocket-src="u.js" data-wpr-fdt-excluded="delay_js"></script>';
    const result = delayJsTransform(html, setWithRows(['u\\.js']));
    expect(result.html).toContain('data-wpr-fdt-excluded="delay_js"');
    expect(result.html).not.toContain('delay_js,delay_js');
  });
});

// The scanner is the transform's candidate source — a malformed input that
// crashes it crashes the transform; pin the two together here.
describe('delayJsTransform — scanner parity', () => {
  it('tokenizes the restored output again (idempotence of scanning, not of transforming)', () => {
    const result = delayJsTransform(NEW_TYPE, setWithRows(['b.js']));
    const tags = scanTags(result.html);
    const restored = tags.find((tag) => tag.name === 'script');
    expect(restored?.attrs.map((attr) => attr.name)).toEqual([
      'type',
      'id',
      'src',
      'data-wpr-fdt-excluded'
    ]);
  });
});
