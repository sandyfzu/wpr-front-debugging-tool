/**
 * Attribute edits over a tag's own text: each edit re-locates the attribute
 * in the (small) tag text, so sequential edits never fight over spans;
 * removal collapses whitespace; value writes pick a quote the value
 * survives; and the FDT exclusion marker accumulates feature ids as CSV
 * without ever clobbering or duplicating an existing value.
 */
import { describe, expect, it } from 'vitest';
import {
  addAttributeValue,
  applyPatches,
  findAttribute,
  removeAttribute,
  setAttributeValue,
  stampExclusionMarker,
  type TextPatch
} from './tag-edit';
import { scanTags } from './html-scan';
import type { ScannedTag } from './html-scan';

/** The first tag of `html` plus its opening-tag text — the editor's input pair. */
function firstTag(html: string): { tag: ScannedTag; tagText: string } {
  const [tag] = scanTags(html);
  if (!tag) throw new Error(`No tag in fixture: ${html}`);
  return { tag, tagText: html.slice(tag.start, tag.openingEnd) };
}

describe('findAttribute', () => {
  it('finds attributes case-insensitively by name', () => {
    const { tag } = firstTag('<IMG DATA-LAZY-SRC="x.jpg">');
    expect(findAttribute(tag, 'data-lazy-src')?.value).toBe('x.jpg');
    expect(findAttribute(tag, 'absent')).toBeNull();
  });
});

describe('removeAttribute', () => {
  it('removes a middle attribute with its following whitespace', () => {
    const { tagText } = firstTag('<div data-x="1" class="c" id="i">');
    expect(removeAttribute(tagText, 'data-x')).toBe('<div class="c" id="i">');
  });

  it('removes a last attribute with its preceding whitespace instead', () => {
    const { tagText } = firstTag('<div class="c" id="i" data-x="1">');
    expect(removeAttribute(tagText, 'data-x')).toBe('<div class="c" id="i">');
  });

  it('removes an only attribute cleanly, including on self-closing tags', () => {
    const solo = firstTag('<div data-x="1">');
    expect(removeAttribute(solo.tagText, 'data-x')).toBe('<div>');
    const selfClosing = firstTag('<img data-x="1"/>');
    expect(removeAttribute(selfClosing.tagText, 'data-x')).toBe('<img/>');
  });

  it('matches the attribute name exactly — `defer` is not found inside `data-rocket-defer`', () => {
    const { tagText } = firstTag('<script data-rocket-defer="defer">');
    expect(removeAttribute(tagText, 'defer')).toBe('<script data-rocket-defer="defer">');
  });

  it('removes an attribute that is followed directly by another (no whitespace between)', () => {
    const { tagText } = firstTag('<div data-x="1"class="c">');
    expect(removeAttribute(tagText, 'data-x')).toBe('<div class="c">');
  });

  it('returns the text unchanged when the attribute is absent', () => {
    const { tagText } = firstTag('<div class="c">');
    expect(removeAttribute(tagText, 'data-x')).toBe('<div class="c">');
  });
});

describe('setAttributeValue', () => {
  it('replaces a quoted value in place, keeping the quote style', () => {
    const { tagText } = firstTag("<script type='text/rocketlazyloadscript' src='x.js'>");
    expect(setAttributeValue(tagText, 'type', 'text/javascript')).toBe(
      "<script type='text/javascript' src='x.js'>"
    );
  });

  it('re-quotes an unquoted value and gives a valueless attribute its value', () => {
    const unquoted = firstTag('<script defer=defer>');
    expect(setAttributeValue(unquoted.tagText, 'defer', 'a b')).toBe('<script defer="a b">');
    const valueless = firstTag('<script defer>');
    expect(setAttributeValue(valueless.tagText, 'defer', 'x')).toBe('<script defer="x">');
  });

  it('switches the quote when the value carries the existing one', () => {
    const { tagText } = firstTag('<script type="t">');
    expect(setAttributeValue(tagText, 'type', 'has"double')).toBe("<script type='has\"double'>");
  });

  it('escapes only as needed when both quotes appear, and the tag survives a re-scan', () => {
    const value = 'both"and\'quotes';
    const { tagText } = firstTag('<script type="t">');
    const written = setAttributeValue(tagText, 'type', value);
    expect(written).toContain('&quot;');
    // The engine moves raw text: the escape rides along and the consuming
    // browser's parser decodes it back — the tag itself stays well-formed.
    expect(findAttribute(firstTag(written).tag, 'type')?.value).toBe("both&quot;and'quotes");
  });

  it('returns the text unchanged when the attribute is absent', () => {
    const { tagText } = firstTag('<div class="c">');
    expect(setAttributeValue(tagText, 'data-x', 'v')).toBe('<div class="c">');
  });
});

describe('addAttributeValue', () => {
  it('inserts before the closing bracket of the opening tag', () => {
    const { tagText } = firstTag('<script defer>');
    expect(addAttributeValue(tagText, 'src', 'u.js')).toBe('<script defer src="u.js">');
  });

  it('inserts before the self-closing slash', () => {
    const { tagText } = firstTag('<img/>');
    expect(addAttributeValue(tagText, 'src', 'a.jpg')).toBe('<img src="a.jpg"/>');
  });

  it('does not double the whitespace when the tag already has a trailing space', () => {
    const { tagText } = firstTag('<script defer >');
    expect(addAttributeValue(tagText, 'src', 'u.js')).toBe('<script defer src="u.js">');
  });

  it('round-trips a value through a re-scan', () => {
    const value = 'quote\'and"double';
    const { tagText } = firstTag('<img alt="x"/>');
    const written = addAttributeValue(tagText, 'src', value);
    expect(findAttribute(firstTag(written).tag, 'src')?.value).toBe("quote'and&quot;double");
  });
});

describe('stampExclusionMarker', () => {
  it('adds the marker with the feature id when the element carries none', () => {
    const { tagText } = firstTag('<script src="a.js">');
    expect(stampExclusionMarker(tagText, 'delay_js')).toBe(
      '<script src="a.js" data-wpr-fdt-excluded="delay_js">'
    );
  });

  it('appends to an existing marker as CSV (comma + space) without clobbering its raw value', () => {
    const { tagText } = firstTag('<script src="a.js" data-wpr-fdt-excluded="defer_all_js">');
    expect(stampExclusionMarker(tagText, 'delay_js')).toBe(
      '<script src="a.js" data-wpr-fdt-excluded="defer_all_js, delay_js">'
    );
  });

  it('stamps nothing when the feature id is already listed', () => {
    const { tagText } = firstTag(
      '<script src="a.js" data-wpr-fdt-excluded=" defer_all_js, delay_js ">'
    );
    expect(stampExclusionMarker(tagText, 'delay_js')).toBe(tagText);
  });

  it('gives a valueless marker its first feature id', () => {
    const { tagText } = firstTag('<script src="a.js" data-wpr-fdt-excluded>');
    expect(stampExclusionMarker(tagText, 'defer_all_js')).toBe(
      '<script src="a.js" data-wpr-fdt-excluded="defer_all_js">'
    );
  });
});

describe('applyPatches', () => {
  it('applies tag-replacement and region-removal patches over original coordinates', () => {
    const html = '<p>a</p><script>x</script><p>b</p>';
    const patches: TextPatch[] = [
      { start: 8, end: 16, text: '<script defer>' },
      { start: 26, end: 34, text: '' }
    ];
    expect(applyPatches(html, patches)).toBe('<p>a</p><script defer>x</script>');
  });

  it('supports zero-width insertions at the same position (applied order: last wins the earlier slot)', () => {
    expect(
      applyPatches('<p>', [
        { start: 2, end: 2, text: ' one' },
        { start: 2, end: 2, text: ' two' }
      ])
    ).toBe('<p two one>');
  });

  it('returns the same string for no patches and fails fast on overlapping ones', () => {
    const html = 'abcd';
    expect(applyPatches(html, [])).toBe(html);
    expect(() =>
      applyPatches(html, [
        { start: 0, end: 3, text: 'x' },
        { start: 2, end: 4, text: 'y' }
      ])
    ).toThrow(/overlap/i);
  });
});
