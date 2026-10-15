/**
 * The real shiki loader tests — `@vitest-environment node`, exercising the
 * actual `shiki/core` + JS-regex-engine pipeline (every other suite runs the
 * highlighter through a double). This pins the mount-safety contract that
 * the code block's scoped `innerHTML` depends on, so a shiki upgrade cannot
 * silently drift it: hostile source text comes out only as escaped text
 * (never markup), tokens carry the light/dark `light-dark()` colors, and the
 * root `<pre>` ships no inline style/tabindex (the component owns the chrome).
 * It also gates contrast: every token color the registered grammars can
 * produce, in both themes after the color swaps, clears AA on the code
 * block's surface token.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LanguageRegistration, ThemeRegistration } from 'shiki/core';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import { contrastRatio } from '../../utils/contrast';
import {
  COLOR_REPLACEMENTS,
  MAX_TOKENIZED_LINE,
  THEME_PAIR,
  getHighlighter,
  styleToClass,
  pendingHighlighter,
  resetHighlighter,
  type CodeHighlighter
} from './code-block-highlighter';
import { answerHighlight } from './code-block-worker-protocol';
import { tokenClassName } from './code-block-token-styles';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

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
    const output = highlighter.highlight(code, { lang }).html;
    // No hostile tag survives as markup: `<img`/`<script` must never appear
    // un-escaped in the emitted HTML.
    expect(output).not.toMatch(/<img|<script/i);
    // The characters became escaped text (shiki's pipeline emits numeric
    // character references, e.g. `<` → `&#x3C;`) — the safety is escaping.
    expect(output).toContain('&#x3C;');
    expect(output.startsWith('<pre')).toBe(true);
  });

  it('tags tokens with classes whose rules carry the light-dark pair', () => {
    const { html, styles } = highlighter.highlight('const a = 1;', { lang: 'javascript' });
    // No per-span inline styles: tokens carry generated classes.
    expect(html).not.toContain('style=');
    expect(html).toMatch(/class="fdt-tk-[0-9a-z]+"/);
    // The palette mechanism lives in the class rules: `color:light-dark(<light>, <dark>)`
    // resolved by the browser's color-scheme — the same mechanism as tokens.
    expect(styles.length).toBeGreaterThan(0);
    for (const [className, declarations] of styles) {
      expect(className).toBe(tokenClassName(declarations));
      expect(html).toContain(className);
      expect(declarations).toMatch(/^color:light-dark\(/);
      expect(declarations).not.toContain('--shiki');
    }
  });

  it('stays out of chrome: no inline style or tabindex on the root pre', () => {
    for (const lang of ['javascript', 'json'] as const) {
      const output = highlighter.highlight('const a = 1;', { lang }).html;
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

/** WCAG AA for normal-size text — code renders at `text-2xs`, never "large". */
const AA_TEXT = 4.5;

/**
 * The code block's surface (`bg-surface-1` on its container, pinned in
 * `code-block.test.tsx`) per palette, read from the real token file.
 */
const CODE_SURFACE = ((): { light: string; dark: string } => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../assets/css/tokens.css'),
    'utf8'
  );
  const match = /--surface-1:\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/.exec(css);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('--surface-1 is not a light-dark(#hex, #hex) pair in tokens.css');
  }
  return { light: match[1], dark: match[2] };
})();

/**
 * Every scope name the registered grammars can emit (`name`/`contentName`
 * values anywhere in the grammar, plus the root `scopeName`), split per
 * space-separated scope. Capture placeholders (`$1`) end a name at the
 * segment before them, which keeps the prefix match below conservative.
 */
function grammarScopes(grammars: readonly LanguageRegistration[]): string[] {
  const scopes = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (
        (key === 'name' || key === 'contentName' || key === 'scopeName') &&
        typeof value === 'string'
      ) {
        for (const scope of value.split(/\s+/)) {
          const head = scope.split('.$')[0];
          if (head !== undefined && head !== '') scopes.add(head);
        }
      } else {
        visit(value);
      }
    }
  };
  visit(grammars);
  return [...scopes];
}

/**
 * Whether a theme rule can match any emitted scope. A TextMate selector
 * segment matches a scope equal to it or extending it by `.`-segments; a
 * selector matches only when every space-separated segment does. Selector
 * syntax beyond that (`-` exclusion, `|`, parentheses) counts as reachable,
 * so the filter can only over-check, never skip a live color.
 */
function reachable(scope: string | string[] | undefined, emitted: readonly string[]): boolean {
  if (scope === undefined) return true; // the theme's default rule
  const selectors = (Array.isArray(scope) ? scope : scope.split(',')).map((part) => part.trim());
  return selectors.some((selector) => {
    if (/\s-\s|[|()]/.test(selector)) return true;
    return selector
      .split(/\s+/)
      .every((segment) =>
        emitted.some(
          (name) =>
            name === segment || name.startsWith(`${segment}.`) || segment.startsWith(`${name}.`)
        )
      );
  });
}

/**
 * The foreground colors a theme can paint for the given scopes — its default
 * foreground plus every reachable rule's — as shiki emits them (after the
 * theme-scoped color swaps; lookups are lowercase, as shiki's are).
 */
function emittedColors(
  theme: ThemeRegistration,
  replacements: Readonly<Record<string, string>>,
  emitted: readonly string[]
): Map<string, string> {
  const colors = new Map<string, string>(); // emitted color -> where it comes from
  const add = (color: string | undefined, origin: string): void => {
    if (color === undefined) return;
    const lower = color.toLowerCase();
    colors.set(replacements[lower] ?? lower, origin);
  };
  add(theme.colors?.['editor.foreground'] ?? theme.fg, 'default foreground');
  for (const rule of theme.tokenColors ?? []) {
    if (!reachable(rule.scope, emitted)) continue;
    add(rule.settings.foreground, String(rule.scope ?? 'default rule'));
  }
  return colors;
}

describe('real highlighter — contrast on the code surface (WCAG AA)', () => {
  const emitted = grammarScopes([...javascript, ...json]);
  const cases = [
    { palette: 'light', theme: githubLight, name: THEME_PAIR.light, surface: CODE_SURFACE.light },
    { palette: 'dark', theme: githubDark, name: THEME_PAIR.dark, surface: CODE_SURFACE.dark }
  ] as const;

  it('reads real grammar scopes and the themes the loader registers', () => {
    expect(emitted).toContain('source.js');
    expect(emitted).toContain('keyword.control.flow.js');
    expect(emitted).toContain('comment.line.double-slash.js');
    for (const { theme, name } of cases) expect(theme.name).toBe(name);
  });

  it.each(cases)('every emittable $palette token color is ≥ 4.5:1 on --surface-1', (entry) => {
    const colors = emittedColors(entry.theme, COLOR_REPLACEMENTS[entry.name], emitted);
    expect(colors.size).toBeGreaterThan(5);
    const failing = [...colors]
      .map(([color, origin]) => ({ color, origin, ratio: contrastRatio(color, entry.surface) }))
      .filter(({ ratio }) => ratio < AA_TEXT);
    expect(failing).toEqual([]);
  });

  it.each(cases)(
    'every $palette swap target is an emittable color, applied by the highlighter',
    (entry) => {
      const swaps = COLOR_REPLACEMENTS[entry.name];
      const emittedSet = emittedColors(entry.theme, swaps, emitted);
      for (const [from, to] of Object.entries(swaps)) {
        // A swap of a color no reachable rule paints would be dead weight.
        expect(emittedColors(entry.theme, {}, emitted).has(from)).toBe(true);
        expect(emittedSet.has(to)).toBe(true);
      }
    }
  );

  it('emits the swapped colors in real output (keyword light, comment dark)', () => {
    const output = highlighter
      .highlight('// note\nconst a = 1;', { lang: 'javascript' })
      .styles.map(([, declarations]) => declarations.toLowerCase())
      .join('\n');
    // Swaps are theme-scoped: the light keyword and the dark comment move,
    // the light comment (AA already) keeps the theme's own color.
    expect(output).toContain('light-dark(#cf222e,');
    expect(output).toContain('light-dark(#6a737d, #8b949e)');
    expect(output).not.toContain('#d73a49');
    expect(output).not.toContain(', #6a737d)');
  });
});

/** The reference: plain shiki over the whole block with the loader's options. */
async function referenceHtml(code: string): Promise<string> {
  const reference = await createHighlighterCore({
    langs: [javascript, json],
    themes: [githubLight, githubDark],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  });
  const html = reference.codeToHtml(code, {
    lang: 'javascript',
    themes: THEME_PAIR,
    defaultColor: 'light-dark()',
    colorReplacements: COLOR_REPLACEMENTS,
    tokenizeMaxLineLength: MAX_TOKENIZED_LINE,
    transformers: [styleToClass(new Map())],
    rootStyle: false,
    tabindex: false
  });
  reference.dispose();
  return html;
}

/** The distinct inline colors of one output line. */
function colorsOfLine(html: string, line: number): Set<string> {
  const text = html.split('<span class="line">')[line + 1] ?? '';
  return new Set(text.match(/fdt-tk-[0-9a-z]+/g));
}

describe('worker handler — whole-block highlighting (regression pins)', () => {
  /** Answer one request through the worker's handler with the real highlighter. */
  async function answer(code: string): Promise<string> {
    const response = await answerHighlight(getHighlighter, { id: 7, code, lang: 'javascript' });
    expect(response.id).toBe(7);
    if (!('html' in response)) throw new Error(`no html: ${response.error}`);
    return response.html;
  }

  it.each([
    [
      'six long keys on one line (under the line cap)',
      `var o = {${Array.from({ length: 6 }, (_, i) => `"${'k'.repeat(230)}${String(i)}": ${String(i)}`).join(', ')}};`
    ],
    [
      'a CJK config line',
      `var i18n = ${JSON.stringify(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`key${String(i)}`, '設定を保存しました。'])))};`
    ],
    ['an identifier and an ellipsis', 'const value = compute(); // …'],
    ['a comment closing after a long line', `/*\n${'x'.repeat(400)} */\nvar a = 1;`],
    ['a template closing after a long line', `var s = \`\n${'x'.repeat(400)}\`;\nvar a = 1;`]
  ])('colors %s exactly as plain shiki over the whole block', async (_name, code) => {
    const html = await answer(code);
    expect(html).toBe(await referenceHtml(code));
    expect(html).toMatch(/fdt-tk-/);
  });

  it('leaves a giant line uncolored inline while the rest of the block colors', async () => {
    const uri = `var img = "data:image/png;base64,${'QUJD'.repeat(7_500)}";`;
    expect(uri.length).toBeGreaterThan(MAX_TOKENIZED_LINE);
    const html = await answer(`${uri}\nconst after = 1;`);
    expect(colorsOfLine(html, 0).size).toBe(0);
    expect(colorsOfLine(html, 1).size).toBeGreaterThan(1);
  });

  it('returns the six 319-char keys line (over the cap) plain, the next line colored', async () => {
    const keys = `var o = {${Array.from({ length: 6 }, (_, i) => `"${'k'.repeat(318)}${String(i)}": ${String(i)}`).join(', ')}};`;
    expect(keys.length).toBeGreaterThanOrEqual(MAX_TOKENIZED_LINE);
    const code = `${keys}\nconst after = 1;`;
    const html = await answer(code);
    expect(html).toBe(await referenceHtml(code));
    expect(colorsOfLine(html, 0).size).toBe(0);
    expect(colorsOfLine(html, 1).size).toBeGreaterThan(1);
  });

  it('colors the code after a long comment line as code, not comment', async () => {
    const html = await answer(`/*\n${'x'.repeat(400)} */\nvar a = 1;`);
    // `var`, `a`, `=`, `1` — several colors, not the comment's single one.
    expect(colorsOfLine(html, 2).size).toBeGreaterThan(1);
  });

  it('answers a failure as an error response (the client renders plain)', async () => {
    const response = await answerHighlight(getHighlighter, {
      id: 3,
      code: 'x',
      lang: 'yaml' as 'json'
    });
    expect(response).toMatchObject({ id: 3 });
    expect('error' in response).toBe(true);
  });

  it('answers a loader failure as an error response', async () => {
    const response = await answerHighlight(() => Promise.reject(new Error('chunk gone')), {
      id: 4,
      code: 'x',
      lang: 'javascript'
    });
    expect(response).toEqual({ id: 4, error: 'chunk gone' });
  });
});
