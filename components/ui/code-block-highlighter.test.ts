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
 * block's surface token — and the on-demand grammar path (CSS/HTML: loaded
 * once per language, a failed load degrades the block and is retried).
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LanguageRegistration, ThemeRegistration } from 'shiki/core';
import cssGrammar from 'shiki/langs/css.mjs';
import htmlGrammar from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import githubLight from 'shiki/themes/github-light.mjs';
import { contrastRatio } from '../../utils/contrast';
import {
  COLOR_REPLACEMENTS,
  GRAMMAR_SOURCES,
  MAX_TOKENIZED_LINE,
  THEME_PAIR,
  createCodeHighlighter,
  getHighlighter,
  styleToClass,
  pendingHighlighter,
  resetHighlighter,
  type CodeHighlighter,
  type GrammarSource
} from './code-block-highlighter';
import { CODE_BLOCK_LANGS, type CodeLanguage } from './code-block-langs';
import { answerHighlight } from './code-block-worker-protocol';
import { isTokenStyle, tokenClassName } from './code-block-token-styles';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

/** The hostile payloads that must survive highlighting as text only. */
const HOSTILE_CASES: Array<{ lang: CodeLanguage; code: string; name: string }> = [
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
  },
  {
    name: 'CSS breaking out of a style element',
    lang: 'css',
    code: 'a { color: red; } </style><img src=x onerror="alert(1)"><style>'
  },
  {
    name: 'markup with an event handler and an embedded script',
    lang: 'html',
    code: '<img src=x onerror="alert(1)"><script>alert(1)</script><style>a{}</style>'
  }
];

/** One realistic sample per language (stylesheet rules, a served script tag). */
const SAMPLES: Readonly<Record<CodeLanguage, string>> = {
  javascript: '/* c */ const a = `t${b}` + /re/g; // x\nfunction f(x) { return x?.y ?? 1; }',
  json: '{"a": [1, true, null, "s"]}',
  css: '@media (min-width: 40em) {\n  .nav > li:hover a, #main [data-x="y"]::before {\n    color: rgb(0 0 0 / 50%) !important;\n    background: url("img.png") no-repeat;\n  }\n}\n/* note */ :root { --gap: calc(1rem + 2px); }',
  html: '<script type="rocketlazyloadscript" data-rocket-src="https://example.com/a.js?ver=1" defer data-minify="1" id="a-js"></script>'
};

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
  it.each(HOSTILE_CASES)('escapes hostile input ($name) to text only', async ({ lang, code }) => {
    const output = (await highlighter.highlight(code, { lang })).html;
    // No hostile tag survives as markup: `<img`/`<script` must never appear
    // un-escaped in the emitted HTML.
    expect(output).not.toMatch(/<img|<script/i);
    // The characters became escaped text (shiki's pipeline emits numeric
    // character references, e.g. `<` → `&#x3C;`) — the safety is escaping.
    expect(output).toContain('&#x3C;');
    expect(output.startsWith('<pre')).toBe(true);
  });

  it.each(CODE_BLOCK_LANGS)(
    'tags %s tokens with classes whose rules carry the light-dark pair',
    async (lang) => {
      const { html: markup, styles } = await highlighter.highlight(SAMPLES[lang], { lang });
      // No per-span inline styles: tokens carry generated classes.
      expect(markup).not.toContain('style=');
      expect(markup).toMatch(/class="fdt-tk-[0-9a-z]+"/);
      // The palette mechanism lives in the class rules: `color:light-dark(<light>, <dark>)`
      // resolved by the browser's color-scheme — the same mechanism as tokens.
      expect(styles.length).toBeGreaterThan(0);
      for (const [className, declarations] of styles) {
        expect(className).toBe(tokenClassName(declarations));
        expect(markup).toContain(className);
        expect(declarations).toMatch(/^color:light-dark\(/);
        expect(declarations).not.toContain('--shiki');
      }
    }
  );

  it('emits only token styles the main thread accepts (the allow-list), for every language', async () => {
    for (const lang of CODE_BLOCK_LANGS) {
      for (const style of (await highlighter.highlight(SAMPLES[lang], { lang })).styles) {
        expect(isTokenStyle(style)).toBe(true);
      }
    }
  });

  it('stays out of chrome: no inline style or tabindex on the root pre', async () => {
    for (const lang of CODE_BLOCK_LANGS) {
      const output = (await highlighter.highlight(SAMPLES[lang], { lang })).html;
      const root = rootTagOf(output);
      expect(root).not.toContain('style=');
      expect(root).not.toContain('tabindex');
    }
  });

  it('rejects a language outside the registered set (call-site bug)', async () => {
    await expect(highlighter.highlight('x', { lang: 'perl' as never })).rejects.toThrow(
      'unsupported language "perl"'
    );
    // An inherited key is not a language either (the check is own-key).
    await expect(highlighter.highlight('x', { lang: 'toString' as never })).rejects.toThrow(
      'unsupported language "toString"'
    );
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
 * `code-block.test.tsx`) per palette, read from the real token file: every
 * `--surface-1` pair it declares (the shared block and the extension-page
 * block the panel resolves), so the gate holds wherever the block renders.
 */
const CODE_SURFACES = ((): { light: string[]; dark: string[] } => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../assets/css/tokens.css'),
    'utf8'
  );
  const pairs = [
    ...css.matchAll(/--surface-1:\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/g)
  ].flatMap(([, light, dark]) =>
    light === undefined || dark === undefined ? [] : [{ light, dark }]
  );
  if (pairs.length === 0) {
    throw new Error('--surface-1 is not a light-dark(#hex, #hex) pair in tokens.css');
  }
  return { light: pairs.map(({ light }) => light), dark: pairs.map(({ dark }) => dark) };
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
  // `html` carries its embedded grammars (javascript + css) too.
  const emitted = grammarScopes([...javascript, ...json, ...cssGrammar, ...htmlGrammar]);
  const cases = [
    { palette: 'light', theme: githubLight, name: THEME_PAIR.light, surfaces: CODE_SURFACES.light },
    { palette: 'dark', theme: githubDark, name: THEME_PAIR.dark, surfaces: CODE_SURFACES.dark }
  ] as const;

  it('reads real grammar scopes and the themes the loader registers', () => {
    expect(emitted).toContain('source.js');
    expect(emitted).toContain('keyword.control.flow.js');
    expect(emitted).toContain('comment.line.double-slash.js');
    expect(emitted).toContain('source.css');
    expect(emitted).toContain('entity.other.attribute-name.class.css');
    expect(emitted).toContain('entity.name.tag.html');
    expect(emitted).toContain('entity.other.attribute-name.html');
    for (const { theme, name } of cases) expect(theme.name).toBe(name);
  });

  it.each(cases)('every emittable $palette token color is ≥ 4.5:1 on --surface-1', (entry) => {
    const colors = emittedColors(entry.theme, COLOR_REPLACEMENTS[entry.name], emitted);
    expect(colors.size).toBeGreaterThan(5);
    expect(entry.surfaces.length, 'shared + extension-page surface-1').toBe(2);
    const failing = [...colors]
      .flatMap(([color, origin]) =>
        entry.surfaces.map((surface) => ({
          color,
          origin,
          surface,
          ratio: contrastRatio(color, surface)
        }))
      )
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

  it('emits the swapped colors in real output (keyword light, comment dark)', async () => {
    const output = (
      await highlighter.highlight('// note\nconst a = 1;', { lang: 'javascript' })
    ).styles
      .map(([, declarations]) => declarations.toLowerCase())
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
async function referenceHtml(code: string, lang: CodeLanguage = 'javascript'): Promise<string> {
  const reference = await createHighlighterCore({
    langs: [javascript, json, cssGrammar, htmlGrammar],
    themes: [githubLight, githubDark],
    engine: createJavaScriptRegexEngine({ forgiving: true })
  });
  const output = reference.codeToHtml(code, {
    lang,
    themes: THEME_PAIR,
    defaultColor: 'light-dark()',
    colorReplacements: COLOR_REPLACEMENTS,
    tokenizeMaxLineLength: MAX_TOKENIZED_LINE,
    transformers: [styleToClass(new Map())],
    rootStyle: false,
    tabindex: false
  });
  reference.dispose();
  return output;
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

describe('worker handler — stylesheet and markup blocks', () => {
  it.each(['css', 'html'] as const)(
    'colors a %s block exactly as plain shiki with every grammar registered',
    async (lang) => {
      const response = await answerHighlight(getHighlighter, { id: 9, code: SAMPLES[lang], lang });
      if (!('html' in response)) throw new Error(`no html: ${response.error}`);
      expect(response.html).toBe(await referenceHtml(SAMPLES[lang], lang));
      // Several token colors, not one plain run.
      expect(new Set(response.html.match(/fdt-tk-[0-9a-z]+/g)).size).toBeGreaterThan(3);
    }
  );

  it('colors the script and style embedded in markup with their own grammars', async () => {
    const markup = '<style>\n.a { color: red; }\n</style>\n<script>\nconst a = 1;\n</script>';
    const { html: output } = await highlighter.highlight(markup, { lang: 'html' });
    const alone = async (code: string, lang: CodeLanguage): Promise<Set<string>> =>
      new Set((await highlighter.highlight(code, { lang })).html.match(/fdt-tk-[0-9a-z]+/g));
    const tokens = new Set(output.match(/fdt-tk-[0-9a-z]+/g));
    // Every token of the embedded CSS and JavaScript colors as in its own language.
    for (const token of await alone('.a { color: red; }', 'css')) expect(tokens).toContain(token);
    for (const token of await alone('const a = 1;', 'javascript')) expect(tokens).toContain(token);
  });
});

describe('grammar sources', () => {
  it('declares one source per code-block language, the common ones bundled', () => {
    expect(Object.keys(GRAMMAR_SOURCES).sort()).toEqual([...CODE_BLOCK_LANGS].sort());
    expect(GRAMMAR_SOURCES.javascript.kind).toBe('bundled');
    expect(GRAMMAR_SOURCES.json.kind).toBe('bundled');
    expect(GRAMMAR_SOURCES.css.kind).toBe('on-demand');
    expect(GRAMMAR_SOURCES.html.kind).toBe('on-demand');
  });

  it.each(['css', 'html'] as const)(
    'loads the real %s grammar from its chunk module',
    async (lang) => {
      const source = GRAMMAR_SOURCES[lang];
      if (source.kind !== 'on-demand') throw new Error(`${lang} is not on demand`);
      const grammar = await source.load();
      expect(grammar.map((entry) => entry.name)).toContain(lang);
    }
  );
});

/** Sources whose CSS grammar loads through a test-controlled loader. */
function withCssLoader(
  load: () => Promise<LanguageRegistration[]>
): Record<CodeLanguage, GrammarSource> {
  return { ...GRAMMAR_SOURCES, css: { kind: 'on-demand', load } };
}

describe('on-demand grammars', () => {
  it('loads a grammar once, on its first block, shared by concurrent first blocks', async () => {
    const load = vi.fn(() => Promise.resolve(cssGrammar));
    const instance = await createCodeHighlighter(withCssLoader(load));
    // Bundled languages never fetch.
    await instance.highlight('const a = 1;', { lang: 'javascript' });
    expect(load).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([
      instance.highlight('a { color: red; }', { lang: 'css' }),
      instance.highlight('b { color: blue; }', { lang: 'css' })
    ]);
    await instance.highlight('c {}', { lang: 'css' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(first.html).toMatch(/fdt-tk-/);
    expect(second.html).toMatch(/fdt-tk-/);
    instance.dispose();
  });

  it('fails the block when the grammar chunk fails to load, logs it, then retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi
      .fn<() => Promise<LanguageRegistration[]>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValue(cssGrammar);
    const instance = await createCodeHighlighter(withCssLoader(load));
    const failed = await answerHighlight(() => Promise.resolve(instance), {
      id: 11,
      code: 'a { color: red; }',
      lang: 'css'
    });
    // The worker answers an error: the client renders the block plain.
    expect(failed).toEqual({ id: 11, error: 'Failed to fetch dynamically imported module' });
    expect(warn).toHaveBeenCalledWith(
      '[WPR FDT] [code-highlighter] The css grammar failed to load; the block stays plain.',
      expect.any(Error)
    );
    // Other languages are unaffected; the next CSS block retries and colors.
    await expect(instance.highlight('const a = 1;', { lang: 'javascript' })).resolves.toMatchObject(
      { html: expect.stringMatching(/fdt-tk-/) as unknown }
    );
    const retried = await instance.highlight('a { color: red; }', { lang: 'css' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(retried.html).toMatch(/fdt-tk-/);
    warn.mockRestore();
    instance.dispose();
  });

  it('fails the block when the chunk holds no usable grammar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const instance = await createCodeHighlighter(withCssLoader(() => Promise.resolve([])));
    // Nothing named `css` got registered: shiki refuses the language.
    await expect(instance.highlight('a {}', { lang: 'css' })).rejects.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    instance.dispose();
  });
});
