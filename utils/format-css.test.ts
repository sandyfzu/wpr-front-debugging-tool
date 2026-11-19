/** The display-only CSS pretty-printer: structure, nesting, verbatim strings/comments, escapes, parentheses, bounds. */
import { describe, expect, it } from 'vitest';
import { formatCss } from './format-css';

describe('formatCss', () => {
  it('puts one declaration per line and indents each block', () => {
    expect(formatCss('a{color:red;margin:0}b{padding:1px}')).toBe(
      ['a {', '  color:red;', '  margin:0', '}', 'b {', '  padding:1px', '}'].join('\n')
    );
  });

  it('indents nested blocks by depth (at-rules)', () => {
    expect(formatCss('@media (min-width:600px){.a{top:0}}')).toBe(
      ['@media (min-width:600px) {', '  .a {', '    top:0', '  }', '}'].join('\n')
    );
  });

  it('collapses whitespace runs and drops blank lines from already formatted CSS', () => {
    expect(formatCss('  a ,\n\tb   {\n\n  color :  red ;\n}\n\n')).toBe(
      ['a , b {', '  color : red;', '}'].join('\n')
    );
  });

  it('keeps strings verbatim, structural characters and escaped quotes included', () => {
    expect(formatCss('a::before{content:"x;{y}  \\"z";}')).toBe(
      ['a::before {', '  content:"x;{y}  \\"z";', '}'].join('\n')
    );
    expect(formatCss("a[title='a;b']{top:0}")).toBe(
      ["a[title='a;b'] {", '  top:0', '}'].join('\n')
    );
  });

  it('keeps comments verbatim and never breaks inside them', () => {
    expect(formatCss('/* a{b;c} */a{top:0}')).toBe(['/* a{b;c} */a {', '  top:0', '}'].join('\n'));
  });

  it('never breaks inside parentheses (an unquoted data URL keeps its ";")', () => {
    expect(formatCss('a{background:url(data:image/png;base64,AA==);top:0}')).toBe(
      ['a {', '  background:url(data:image/png;base64,AA==);', '  top:0', '}'].join('\n')
    );
  });

  it('treats an escaped structural character as text', () => {
    expect(formatCss('.a\\;b{top:0}')).toBe(['.a\\;b {', '  top:0', '}'].join('\n'));
  });

  it('survives broken input: unclosed strings/comments/blocks, stray closers, trailing escape', () => {
    expect(formatCss('a{content:"open')).toBe(['a {', '  content:"open'].join('\n'));
    expect(formatCss('a{top:0} /* open')).toBe(['a {', '  top:0', '}', '/* open'].join('\n'));
    expect(formatCss('}}a{top:0')).toBe(['}', '}', 'a {', '  top:0'].join('\n'));
    expect(formatCss('a)b{top:0}')).toBe(['a)b {', '  top:0', '}'].join('\n'));
    expect(formatCss('a\\')).toBe('a\\');
  });

  it('returns "" for blank input', () => {
    expect(formatCss('')).toBe('');
    expect(formatCss(' \n\t ')).toBe('');
  });

  it('formats a megabyte of minified CSS in one linear pass', () => {
    const rule = '.c{color:red;margin:0 auto}';
    const css = rule.repeat(Math.ceil(1_048_576 / rule.length));
    const started = performance.now();
    const out = formatCss(css);
    expect(performance.now() - started).toBeLessThan(500);
    expect(out.split('\n')).toHaveLength((css.length / rule.length) * 4);
  });
});
