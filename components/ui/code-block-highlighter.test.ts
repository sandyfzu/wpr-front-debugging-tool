/**
 * The real shiki loader tests — `@vitest-environment node`, exercising the
 * actual `shiki/core` + JS-regex-engine pipeline (every other suite runs the
 * highlighter through a double). This pins the mount-safety contract that
 * the code block's scoped `innerHTML` depends on, so a shiki upgrade cannot
 * silently drift it: hostile source text comes out only as escaped text
 * (never markup), tokens carry the light/dark `light-dark()` colors, and the
 * root `<pre>` ships no inline style/tabindex (the component owns the chrome).
 */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getHighlighter,
  pendingHighlighter,
  resetHighlighter,
  type CodeHighlighter
} from './code-block-highlighter';

/** The hostile payloads that must survive highlighting as text only. */
const HOSTILE_CASES: Array<{ lang: 'javascript' | 'json'; code: string; name: string }> = [
  {
    name: 'span-closer + inline event handler',
    lang: 'javascript',
    code: 'const a = 1;</span><img src=x onerror="alert(1)">'
  },
  {
    name: 'script tag injection',
    lang: 'javascript',
    code: '<script>alert(1)</script>'
  },
  {
    name: 'template-literal closing constructs',
    lang: 'javascript',
    code: 'const t = `a${`inner`}</span><img src=x>`;'
  },
  {
    name: 'JSON key injection',
    lang: 'json',
    code: '{"weird</span>": "</span><script>x</script>"}'
  }
];

/** The highlighter under test (the real loader, one shared instance). */
let highlighter: CodeHighlighter;

beforeAll(async () => {
  resetHighlighter();
  highlighter = await getHighlighter();
});

/** The opening `<pre …>` tag of a highlighted output (the root chrome). */
function rootTagOf(output: string): string {
  const match = /<pre[^>]*>/.exec(output);
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
}

describe('real highlighter — safety contract (regression-pinned)', () => {
  it.each(HOSTILE_CASES)('escapes hostile input ($name) to text only', ({ lang, code }) => {
    const output = highlighter.highlight(code, { lang });
    // No hostile tag survives as markup: `<img`/`<script` must never appear
    // un-escaped in the emitted HTML.
    expect(output).not.toMatch(/<img|<script/i);
    // The characters became escaped text (shiki's pipeline emits numeric
    // character references, e.g. `<` → `&#x3C;`) — the safety is escaping.
    expect(output).toContain('&#x3C;');
    expect(output.startsWith('<pre')).toBe(true);
  });

  it('colors tokens with the light-dark pair for both palettes', () => {
    const output = highlighter.highlight('const a = 1;', { lang: 'javascript' });
    // The palette mechanism: per-token `color:light-dark(<light>,<dark>)`
    // resolved by the browser's color-scheme — the same mechanism as tokens.
    expect(output).toContain('light-dark(');
    expect(output).toContain('--shiki-light');
    expect(output).toContain('--shiki-dark');
  });

  it('stays out of chrome: no inline style or tabindex on the root pre', () => {
    for (const lang of ['javascript', 'json'] as const) {
      const output = highlighter.highlight('const a = 1;', { lang });
      const root = rootTagOf(output);
      expect(root).not.toContain('style=');
      expect(root).not.toContain('tabindex');
    }
  });

  it('guards a language outside the registered set with a throw (call-site bug)', () => {
    expect(() => highlighter.highlight('x', { lang: 'perl' as never })).toThrow();
  });
});

describe('real highlighter — process-wide singleton', () => {
  it('caches the instance across calls (many code blocks pay loading once)', () => {
    const awaited = pendingHighlighter();
    expect(awaited).toBeDefined();
    expect(getHighlighter()).toBe(awaited);
  });

  it('reloads fresh after the reset seam (tests/extension-reload path)', async () => {
    const stale = pendingHighlighter();
    resetHighlighter();
    expect(pendingHighlighter()).toBeUndefined();
    expect(await getHighlighter()).not.toBe(await stale);
  });
});
